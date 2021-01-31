const assert = require('assert')

class JSStateStore {

    private _state

    constructor(initstate) {
        this._state = initstate
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

    apply(statechanges) {

        assert(statechanges._control && statechanges._control.head_sequence === this._state._control.head_sequence, `applyToLocalState: Panic, cannot apply update head_sequence=${statechanges._control && statechanges._control.head_sequence} to state at head_sequence=${this._state._control.head_sequence}`)
        let newstate = { _control: { head_sequence: this._state._control.head_sequence + 1, lastupdated: statechanges._control.lastupdated } }

        for (let stateKey of Object.keys(statechanges)) {
            if (stateKey === '_control') continue
            // get the relevent section of the state
            let reducerKeyState = this._state[stateKey]

            for (let i = 0; i < statechanges[stateKey].length; i++) {
                const update: StateUpdates = statechanges[stateKey][i]
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
                            const new_doc_updates = Object.keys(update.doc).map(k => { return { [k]: Object.getPrototypeOf(update.doc[k]).isPrototypeOf(Object) && Object.getPrototypeOf(pathKeyState[update_idx][k]).isPrototypeOf(Object) ? { ...pathKeyState[update_idx][k], ...update.doc[k] } : update.doc[k] } }).reduce((a, i) => { return { ...a, ...i } }, {})
                            const new_doc = { ...pathKeyState[update_idx], ...new_doc_updates }
                            pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, new_doc)
                        } else {
                            assert(false, 'applyToLocalState, "UpdatesMethod.Update" requires a filter (its a array operator)')
                        }
                        break
                    default:
                        assert(false, `applyToLocalState: Cannot apply update seq=${statechanges._control.head_sequence}, unknown method=${update.method}`)
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
export type ReducerReturnWithSlice = [boolean, Array<StateUpdates>][];
export type ReducerReturn = [boolean, Array<StateUpdates>];

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

export class StateManager {

    // hols
    private _stateStore
    private commitEventsFn
    private _stateMutex
    private _connection
    // A reducer that invokes every reducer inside the reducers object, and constructs a state object with the same shape.
    private _rootReducer

    constructor(opts) {
        this._connection = opts.connection
        this._stateMutex = opts.stateMutex
        this.commitEventsFn = opts.commitEventsFn

        let reducers = [this.applyReducer()].concat(opts.reducers)
        this._stateStore = new JSStateStore(opts.initState || reducers.reduce((acc, i) => { return { ...acc, ...{ [i.sliceKey]: i.initState } } }, {}))
        this._rootReducer = this.combineReducers(this._connection, reducers)
        //console.log(`StateManager: ${JSON.stringify(this.state)}`)
    }

    get stateStore() {
        return this._stateStore
    }

    applyReducer(): ControlReducer {
        return {
            sliceKey: '_control',
            initState: { head_sequence: 0, lastupdated: null } as ControlReducerState,
            fn: async function (connection, state: ControlReducerState) {
                return [false, { head_sequence: state.head_sequence, lastupdated: Date.now() }]
            }
        }
    }


    combineReducers(coonnection, reducers) {
        // A reducer function that invokes every reducer inside the passed
        // *   object, and builds a state object with the same shape.
        return async function (state, action) {

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
                Object.keys(allUpdates).reduce((acc, i) => allUpdates[i][0] || acc, false),
                Object.keys(allUpdates).map(k => { return { [k]: allUpdates[k][1] } }).reduce((acc, i) => { return { ...acc, ...i } }, {})
            ] : [null, null]

        }
    }

    // Used by external processor when managing multiple state updates //
    //
    async processAction(action) {
        return await this._rootReducer(this.stateStore.state, action)
    }
    stateStoreApply(statechanges) {
        return this.stateStore.apply(statechanges)
    }
    //////////////////////////////////////////////////////


    // Used when only this state is updated
    //
    async dispatch(action, processor?: any, label?: string) {
        //console.log(`Action: \n${JSON.stringify(action)}`)

        let release = await this._stateMutex.aquire()

        const [failed, statechanges] = await this._rootReducer(this.stateStore.state, action)

        // console.log(`Updates: \n${JSON.stringify(statechanges)}`)

        if (statechanges) {
            console.log(`factoryState.apply: action: flow_id=${action.id} type=${action.type}. ${statechanges ? `Event: current_head=${statechanges._control.head_sequence}` : ''}`)
            // persist events
            await this.commitEventsFn(statechanges, processor, label)
            // apply events to local state
            this._stateStore.apply(statechanges)
        }
        release()

        //console.log(`State: \n${JSON.stringify(this.state)}`)
    }
}