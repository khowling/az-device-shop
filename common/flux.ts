const assert = require('assert')
const { Timestamp } = require('mongodb')

export interface StateStore {
    name: string;
    state: any;
    serializeState(): any;
    deserializeState(newstate: any): void
    apply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): void
}

class JSStateStore implements StateStore {

    private _name
    private _state

    constructor(name, initstate) {
        this._name = name
        this._state = initstate
    }

    get name() {
        return this._name
    }

    get state() {
        return this._state
    }

    set state(newstate) {
        this._state = newstate
    }

    get serializeState() {
        return { ...this._state }
    }

    deserializeState(newstate) {
        if (newstate) {
            this.state = { ...newstate }
        }
    }

    static imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }

    static apply_incset({ method, doc }, val) {
        return {
            ...val, ...Object.keys(doc).map(k => {
                return {
                    [k]: method === 'inc' ? doc[k] + val[k] : doc[k]
                }
            }).reduce((a, i) => { return { ...a, ...i } }, {})
        }
    }

    apply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): void {

        const state = this._state
        const _control: StateUpdateControl = statechanges._control as StateUpdateControl


        assert(_control && _control.head_sequence === state._control.head_sequence, `applyToLocalState: Panic, cannot apply update head_sequence=${_control && _control.head_sequence} to state at head_sequence=${state._control.head_sequence}`)
        let newstate = { _control: { head_sequence: state._control.head_sequence + 1, lastupdated: _control.lastupdated } }

        console.log(`[${this.name}] apply(): change._control.head_sequence=${_control.head_sequence} to state._control.head_sequence=${state._control.head_sequence}`)

        for (let stateKey of Object.keys(statechanges)) {
            if (stateKey === '_control') continue
            // get the relevent section of the state
            const stateKeyChanges: Array<StateUpdates> = statechanges[stateKey] as Array<StateUpdates>
            let reducerKeyState = this._state[stateKey]

            for (let i = 0; i < stateKeyChanges.length; i++) {
                const update: StateUpdates = stateKeyChanges[i]
                let pathKeyState = update.path ? reducerKeyState[update.path] : reducerKeyState

                switch (update.method) {
                    case 'inc':
                    case 'set':
                        if (update.filter) { // array
                            assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                            const
                                filter_key = Object.keys(update.filter)[0], filter_val = update.filter[filter_key],
                                update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)
                            assert(update_idx >= 0, `applyToLocalState: Panic applying a "UpdatesMethod.Inc|UpdatesMethod.Set" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                            pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, JSStateStore.apply_incset(update as any, pathKeyState[update_idx]))

                        } else { // object
                            pathKeyState = JSStateStore.apply_incset(update as any, pathKeyState)
                        }
                        break
                    case 'add':
                        assert(Array.isArray(pathKeyState), `applyToLocalState: Cannot apply "UpdatesMethod.Add" to non-Array on "${stateKey}"`)
                        pathKeyState = [...pathKeyState, update.doc]
                        break
                    case 'rm':
                        assert(Array.isArray(pathKeyState), `applyToLocalState: Cannot apply "UpdatesMethod.Rm" to non-Array on "${stateKey}"`)
                        assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                        const
                            filter_key = Object.keys(update.filter)[0],
                            filter_val = update.filter[filter_key],
                            update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)
                        assert(update_idx >= 0, `applyToLocalState: Panic applying a "update" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                        pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, null)
                        break
                    case 'merge':
                        if (update.filter) { // array
                            assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                            const
                                filter_key = Object.keys(update.filter)[0],
                                filter_val = update.filter[filter_key],
                                update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)

                            assert(update_idx >= 0, `applyToLocalState: Panic applying a "update" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                            const new_doc_updates = Object.keys(update.doc).map(k => {
                                return {
                                    [k]:
                                        update.doc[k] && Object.getPrototypeOf(update.doc[k]).isPrototypeOf(Object) && pathKeyState[update_idx][k] && Object.getPrototypeOf(pathKeyState[update_idx][k]).isPrototypeOf(Object) ?
                                            { ...pathKeyState[update_idx][k], ...update.doc[k] } : update.doc[k]
                                }
                            }).reduce((a, i) => { return { ...a, ...i } }, {})
                            const new_doc = { ...pathKeyState[update_idx], ...new_doc_updates }
                            pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, new_doc)
                        } else {
                            assert(false, 'applyToLocalState, "UpdatesMethod.Update" requires a filter (its a array operator)')
                        }
                        break
                    default:
                        assert(false, `applyToLocalState: Cannot apply update seq=${_control.head_sequence}, unknown method=${update.method}`)
                }

                if (update.path) {
                    // if path, the keystate must be a object
                    reducerKeyState = { ...reducerKeyState, [update.path]: pathKeyState }
                } else {
                    // keystate could be a object or value or array
                    reducerKeyState = pathKeyState
                }
            }
            newstate[stateKey] = reducerKeyState
        }
        this._state = { ...this._state, ...newstate }
        //console.log(`apply: ${JSON.stringify(this._state)}`)
    }
}

export interface StateUpdateControl {
    head_sequence: number;
    lastupdated: number;
}

export interface StateUpdates {
    method: UpdatesMethod;
    path?: string; // state path to process (optional)
    filter?: any; // fiilter object
    doc?: any;
}
export enum UpdatesMethod {
    Inc = 'inc',
    Rm = 'rm',
    Add = 'add',
    Merge = 'merge',
    Set = 'set'
}

export interface ReducerInfo {
    failed: boolean;
    id?: string;
    message?: string;
}

export type ReducerReturnWithSlice = [ReducerInfo, Array<StateUpdates>][];
export type ReducerReturn = [ReducerInfo, Array<StateUpdates>];

export interface ReducerWithPassin<S, A> {
    sliceKey: string;
    passInSlice: string;
    initState: S;
    fn: (connection: any, state: S, action: A, passInSlice: Array<any>) => Promise<ReducerReturnWithSlice>
}

export interface Reducer<S, A> {
    sliceKey: string;
    initState: S;
    fn: (connection: any, state: S, action: A) => Promise<ReducerReturn>
}

interface ControlReducerState {
    head_sequence: number;
    lastupdated: number;
}
interface ControlReducer {
    sliceKey: string;
    initState: ControlReducerState;
    fn: (connection: any, state: ControlReducerState) => Promise<[boolean, ControlReducerState]>
}

export interface StateManagerInterface {
    name: string;
    stateStore: StateStore;
    dispatch(action: any): Promise<{ [key: string]: ReducerInfo }>
    processAction(action: any): Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]>
    stateStoreApply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): void

}

import { EventEmitter } from 'events'
import { StateConnection } from './stateConnection'

export class StateManager extends EventEmitter implements StateManagerInterface {

    private _name
    private _stateStore: StateStore
    private _connection: StateConnection
    // A reducer that invokes every reducer inside the reducers object, and constructs a state object with the same shape.
    private _rootReducer

    constructor(name: string, connection: StateConnection, reducers: Array<Reducer<any, any> | ReducerWithPassin<any, any>>) {
        super()
        this._name = name
        this._connection = connection

        const allReducers = [this.applyReducer()].concat(reducers as any)
        this._stateStore = new JSStateStore(this._name, allReducers.reduce((acc, i) => { return { ...acc, ...{ [i.sliceKey]: i.initState } } }, {}))
        this._rootReducer = this.combineReducers(this._connection, allReducers)
        //console.log(`StateManager: ${JSON.stringify(this.state)}`)
    }

    get name() {
        return this._name
    }

    get stateStore() {
        return this._stateStore
    }

    private applyReducer(): ControlReducer {
        return {
            sliceKey: '_control',
            initState: { head_sequence: 0, lastupdated: null } as ControlReducerState,
            fn: async function (connection, state: ControlReducerState) {
                return [false, { head_sequence: state.head_sequence, lastupdated: Date.now() }]
            }
        }
    }


    private combineReducers(coonnection, reducers) {
        // A reducer function that invokes every reducer inside the passed
        // *   object, and builds a state object with the same shape.
        return async function (state, action): Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]> {

            assert(action, 'reducers require action parameter')
            //let hasChanged = false
            const allUpdates = {}

            for (let { sliceKey, passInSlice, fn } of reducers) {
                //const key = finalReducerKeys[i]
                const previousStateForKey = state[sliceKey]
                assert(passInSlice ? reducers.findIndex(r => r.sliceKey === passInSlice) >= 0 : true, `reducer definition "${sliceKey}" requires a missing passInSlice reducer "${passInSlice}"`)
                const reducerRes = await fn(coonnection, previousStateForKey, action, action && passInSlice ? [state[passInSlice], reducers.find(r => r.sliceKey === passInSlice).fn] : null)

                // state changes
                const sliceUpdates = passInSlice ? reducerRes[0] : reducerRes
                const passInUpdates = passInSlice ? reducerRes[1] : null

                //console.log(`get sliceKey=${sliceKey}: ${JSON.stringify(reducerRes)}`)
                if (sliceUpdates) {
                    //console.log(sliceUpdates)
                    assert(sliceUpdates.length === 2 && sliceKey === '_control' ? true : Array.isArray(sliceUpdates[1]) && sliceUpdates[1].length > 0, `Error reducer at slice "${sliceKey}" return unexected value`)
                    allUpdates[sliceKey] = allUpdates[sliceKey] ? [allUpdates[sliceKey][0] || sliceUpdates[0], [...allUpdates[sliceKey][1], ...sliceUpdates[1]]] : sliceUpdates
                }
                if (passInUpdates) {
                    assert(passInUpdates.length === 2 && Array.isArray(passInUpdates[1]) && passInUpdates[1].length > 0, `Error reducer at slice "${sliceKey}" return unexected passInUpdates value for slice "${passInSlice}"`)
                    allUpdates[passInSlice] = allUpdates[passInSlice] ? [allUpdates[passInSlice][0] || passInUpdates[0], [...allUpdates[passInSlice][1], ...passInUpdates[1]]] : passInUpdates
                }
            }

            return Object.keys(allUpdates).length > 1 ? [
                Object.keys(allUpdates).map(k => { return { [k]: allUpdates[k][0] } }).reduce((acc, i) => { return { ...acc, ...i } }, {}),
                Object.keys(allUpdates).map(k => { return { [k]: allUpdates[k][1] } }).reduce((acc, i) => { return { ...acc, ...i } }, {})
            ] : [null, null]

        }
    }

    // Used by external processor when managing multiple state updates //
    //
    async processAction(action: any): Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]> {
        return await this._rootReducer(this.stateStore.state, action)
    }
    stateStoreApply(statechanges) {
        return this.stateStore.apply(statechanges)
    }
    //////////////////////////////////////////////////////


    // Used when only this state is updated
    //
    async dispatch(action): Promise<{ [key: string]: ReducerInfo }> {
        //console.log(`Action: \n${JSON.stringify(action)}`)
        assert(this._connection, 'dispatch: Cannot apply processor actions, no "Connection" details provided')
        const cs = this._connection

        let release = await cs.mutex.aquire()
        const [reducerInfo, changes] = await this._rootReducer(this.stateStore.state, action)
        // console.log(`Updates: \n${JSON.stringify(changes)}`)

        if (changes) {
            console.log(`[${this.name}] dispatch(): action.type=${action.type} ${changes ? `Event: current_head=${changes._control.head_sequence}` : ''}`)
            // persist events
            const msg = {
                sequence: cs.sequence + 1,
                _ts: new Timestamp(), // Emptry timestamp will be replaced by the server to the current server time
                partition_key: cs.tenent.email,
                [this.name]: changes
            }
            const res = await cs.db.collection(cs.collection).insertOne(msg)
            this.emit('changes', msg)
            cs.sequence = cs.sequence + 1
            // apply events to local state
            this._stateStore.apply(changes)
        }
        release()
        //  Object.keys(allUpdates).reduce((acc, i) => allUpdates[i][0] || acc, false),
        return reducerInfo
        //console.log(`State: \n${JSON.stringify(this.state)}`)
    }
}