import assert from 'assert'
import mongodb  from 'mongodb'
const { Timestamp } = mongodb


import type { StateStore, StateUpdates, StateUpdateControl } from './stateStore.js'
import { JSStateStore } from './stateStore.js'
import { LevelStateStore } from './levelStateStore.js'
export type { StateUpdates, UpdatesMethod, StateStore, StateUpdateControl } from './stateStore.js'

export interface ReducerInfo {
    failed: boolean;
    added?: any;
    message?: string;
}

export type ReducerReturn = [ReducerInfo, Array<StateUpdates>] | null;
export type ReducerReturnWithSlice = Array<([ReducerInfo, Array<StateUpdates>] | null)>;

export type ReducerFunction<A> = (state: StateStore, action: A) => Promise<ReducerReturn>;
export type ReducerFunctionWithSlide<A> = (state: StateStore, action: A, passInSlice?: (state: StateStore, action?: A) => Promise<ReducerReturn> | Promise<ReducerReturnWithSlice>) => Promise<ReducerReturnWithSlice>;

// Interface for a Reducer, operating on the state sliceKey, defining an initial state
export interface Reducer<A> {
    sliceKey: string;
    initState: StateStoreDefinition;
    fn: ReducerFunction<A>
}

// Interface for a Reducer, that has a Passin Slice
// The Passin Slide is a update to a nested state
export interface ReducerWithPassin<A> {
    sliceKey: string;
    passInSlice: string;
    initState: StateStoreDefinition;
    fn: ReducerFunctionWithSlide<A>
}

// replae enum with const type
const VALUE_TYPES = {
    HASH: "hash",
    LIST: "list",
    COUNTER: "counter"
}
export type StateStoreValueType = keyof typeof VALUE_TYPES

export interface StateStoreDefinition {
    [key:string] : {
        type: StateStoreValueType
        identifierFormat?: {
            prefix?: string,
            zeroPadding?: number,
        }
        values?: {
            [key: string] : string | number | ((o: any) => any)
        }
    }
}

/*

interface ControlReducerState {
    head_sequence: number;
    lastupdated: number;
}
interface ControlReducer {
    sliceKey: string;
    initState: StateStoreDefinition;
    fn: (/ *connection: any,* / state: ControlReducerState) => Promise<[boolean, ControlReducerState]>
}
*/

export interface StateManagerInterface extends EventEmitter {
    name: string;
    stateStore: StateStore;
    rootReducer: (state, action) => Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]>;
    dispatch(action, linkedStateAction?): Promise<[{ [key: string]: ReducerInfo }, { [key: string]: ReducerInfo }]>
    stateStoreApply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): void
}

import { EventEmitter } from 'events'
import { EventStoreConnection } from './eventStoreConnection.js'

// StateManager
// dispach() - takes 'Action', executes reducers to get array of "State Changes", pushes changes to eventStore, and applies to local stateStore (stateStore.apply)
export class StateManager<A> extends EventEmitter implements StateManagerInterface {

    private _name
    private _stateStore: StateStore
    private _connection: EventStoreConnection
    // A reducer that invokes every reducer inside the reducers object, and constructs a state object with the same shape.
    private _rootReducer: (state: StateStore, action: A) => Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]>
    
    // Linked StateManager, where this StateManager can dispatch actions to the linked StateManager
    private _linkedStateManager: StateManagerInterface
    
    constructor(name: string, connection: EventStoreConnection, reducers: Array<Reducer<A> | ReducerWithPassin<A>>, linkedStateManager?: StateManagerInterface) {
        super()
        this._name = name
        this._connection = connection
        this._linkedStateManager = linkedStateManager

        // allReducers is array of all reducers returned objects <Reducer>
        const allReducers = [this.applyReducer()].concat(reducers as any)

        this._stateStore = new JSStateStore(
            this._name, 
            // construct the initstate of all reducers combined!
            allReducers.reduce((acc, i) => { return { ...acc, ...{ [i.sliceKey]: i.initState } } }, {})
        )

        this._rootReducer = this.combineReducers(/*this._connection, */ allReducers)
        //console.log(`StateManager: ${JSON.stringify(this.state)}`)
    }

    get rootReducer() {
        return this._rootReducer
    }

    get name() {
        return this._name
    }

    get stateStore() {
        return this._stateStore
    }

    private applyReducer(): Reducer<null> {
        return {
            sliceKey: '_control',
            initState: { 
                "head_sequence": {
                    type: 'COUNTER'
                }
            } as StateStoreDefinition,
            fn: async function () {
                return [{ failed: false }, [{ method: 'INC', path: 'head_sequence' }]]
            }
        }
    }


    private combineReducers(/*coonnection,*/ reducers): (state: StateStore, action: A) => Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]> {
        // A reducer function that invokes every reducer inside the passed
        // *   object, and builds a state object with the same shape.
        return async function (state: StateStore, action: A): Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]> {

            assert(action, 'reducers require action parameter')
            //let hasChanged = false
            const allUpdates = []

            for (let reducer of reducers) {
                const { sliceKey, passInSlice, fn } = reducer
                //const key = finalReducerKeys[i]
                //const previousStateForKey = null // state[sliceKey]
                assert(passInSlice ? reducers.findIndex(r => r.sliceKey === passInSlice) >= 0 : true, `reducer definition "${sliceKey}" requires a missing passInSlice reducer "${passInSlice}"`)

                // reducers return [ReducerInfo, Array<StateUpdates>]
                // return for a Reducer that has a "passInSlice", it return a array of [ReducerInfo, Array<StateUpdates>]
                const reducerRes = await fn(/*coonnection,*/ state, action, action && passInSlice ? reducers.find(r => r.sliceKey === passInSlice).fn : null)

                // state changes
                const sliceUpdates = passInSlice ? reducerRes[0] : reducerRes
                const passInUpdates = passInSlice ? reducerRes[1] : null

                //console.log(`get sliceKey=${sliceKey}: ${JSON.stringify(reducerRes)}`)
                if (sliceUpdates) {
                    //console.log(sliceUpdates)
                    assert(sliceUpdates.length === 2 && sliceKey === '_control' ? true : Array.isArray(sliceUpdates[1]) && sliceUpdates[1].length > 0, `Error reducer at sliceKey=${sliceKey}, return unexected value`)
                    allUpdates[sliceKey] = allUpdates[sliceKey] ? [allUpdates[sliceKey][0] || sliceUpdates[0], [...allUpdates[sliceKey][1], ...sliceUpdates[1]]] : sliceUpdates
                }
                if (passInUpdates) {
                    assert(passInUpdates.length === 2 && Array.isArray(passInUpdates[1]) && passInUpdates[1].length > 0, `Error reducer at sliceKey=${sliceKey}, return unexected passInUpdates value for passInSlice=${passInSlice}`)
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
    /*
    async processAction(action: any): Promise<[{ [key: string]: ReducerInfo }, { [key: string]: StateUpdateControl | Array<StateUpdates> }]> {
        return await this._rootReducer(/ * this.stateStore.state * / null, action)
    }
    */
    stateStoreApply(statechanges) {
        return this.stateStore.apply(statechanges)
    }
    //////////////////////////////////////////////////////


    // Used when only this state is updated
    //
    async dispatch(action: A, linkedStateAction?): Promise<[{ [key: string]: ReducerInfo }, { [key: string]: ReducerInfo }]> {
        //console.log(`Action: \n${JSON.stringify(action)}`)
        assert(this._connection, 'dispatch: Cannot apply processor actions, no "Connection" details provided')
        assert((!linkedStateAction) || this._linkedStateManager, 'dispatch: Cannot apply linkedStateAction if there is no linkedStateManager defined')
        
        const cs = this._connection

        let release = await cs.mutex.aquire()
        let applyInfo = {}, applyLinkInfo = {}

        const [linkReducerInfo, linkChanges] = linkedStateAction ? await this._linkedStateManager.rootReducer(this._linkedStateManager.stateStore, linkedStateAction) : [{}, {}]
        const [reducerInfo, changes] = await this.rootReducer(this.stateStore, action)
        
        // console.log(`Updates: \n${JSON.stringify(changes)}`)

        if ((changes && Object.keys(changes).length > 0) || (linkChanges && Object.keys(linkChanges).length > 0)) {
            //console.log(`[${this.name}] dispatch(): action.type=${action.type} ${changes ? `Event: current_head=${changes._control.head_sequence}` : ''}`)
            // persist events
            const msg = {
                sequence: cs.sequence + 1,
                _ts: new Timestamp(0,0), // Emptry timestamp will be replaced by the server to the current server time
                partition_key: cs.tenentKey,
                ...(changes && Object.keys(changes).length > 0 && { [this.name]: changes }),
                ...(linkChanges && Object.keys(linkChanges).length > 0 && { [this._linkedStateManager.name]: linkChanges })
            }
            const res = await cs.db.collection(cs.collection).insertOne(msg)
            this.emit('changes', msg)
            cs.sequence = cs.sequence + 1

            // This is where the linked state will be updated, so any items added will get their new id's (used by process state manager)
            // We want to apply this output to the processor state
            applyLinkInfo = linkChanges && Object.keys(linkChanges).length > 0 ? this._linkedStateManager.stateStore.apply(linkChanges) : {}
            // apply events to local state
            applyInfo = changes && Object.keys(changes).length > 0 ? this.stateStore.apply(changes) : {}
            
        }

        release()
        // Combine reducerInfo with applyInfo
        const allInfo = reducerInfo ? Object.keys(reducerInfo).reduce((acc, i) => { return { ...acc, [i]: {...reducerInfo[i], ...acc[i]} } }, applyInfo) : {}
        const allLinkInfo = linkReducerInfo ? Object.keys(linkReducerInfo).reduce((acc, i) => { return { ...acc, [i]: {...reducerInfo[i], ...acc[i]} } }, applyLinkInfo) : {}
        return [allInfo, allLinkInfo]
        //console.log(`State: \n${JSON.stringify(this.state)}`)
    }
}