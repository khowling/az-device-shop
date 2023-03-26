import { strict as assert } from 'node:assert';
import mongodb, {Timestamp }  from 'mongodb'



//import { JSStateStore } from './jsStateStore.js'
import { LevelStateStore } from './levelStateStore.js'

export type ReducerInfo = {
    failed: boolean;
    added?: any;
    message?: string;
}

export type ReducerReturn = [ReducerInfo, Array<StateUpdate>] | [null,null];
export type ReducerReturnWithSlice = Array<ReducerReturn>;

export type ReducerFunction<S, A> = (state: StateStore<S>, action: A) => Promise<ReducerReturn>;
export type ReducerFunctionWithSlide<S, A> = (state: StateStore<S>, action: A, passIn?: ReducerFunction<S,A>, passInWithSlice?: ReducerFunctionWithSlide<S,A>) => Promise<ReducerReturnWithSlice>;

// Interface for a Reducer, operating on the state sliceKey, defining an initial state
export type Reducer<S, A> = {
    sliceKey: string;
    initState: StateStoreDefinition;
    fn: ReducerFunction<S, A>
}

// Interface for a Reducer, that has a Passin Slice
// The Passin Slide is a update to a nested state
export type ReducerWithPassin<S, A> = {
    sliceKey: string;
    passInSlice: string;
    initState: StateStoreDefinition;
    fn: ReducerFunctionWithSlide<S, A>
}

// replae enum with const type
const VALUE_TYPES = {
    HASH: "hash",
    LIST: "list",
    METRIC: "counter"
}
export type StateStoreValueType = keyof typeof VALUE_TYPES

export type StateStoreDefinition = {
    [key:string] : {
        type: StateStoreValueType
        identifierFormat?: {
            prefix?: string,
            zeroPadding?: number,
        }
        values?: {
            [key: string] : string | number | null
        }
    }
}



export type StateChanges = {
    [sliceKey: string]: Array<StateUpdate>
} & Control

export type StateStore<S> = {
    name: string;
    stateDefinition: { [sliceKey: string]: StateStoreDefinition};
    getValue(reducerKey: string, path: string, idx?: number): Promise<any>;
    debugState(): void;
    initStore(ops: {distoryExisting: boolean}): Promise<void>;
    serializeState(): Promise<S>;
    // deserializeState(newstate: {[statekey: string]: any}): void
    apply(sequence: number, statechanges: StateChanges): Promise<{[reducerKey: string] : ApplyInfo}>
}


export type StateUpdate = {
    method: UpdatesMethod;
    path: string; // state path to process (optional)
    filter?: {
        _id: number
    }; // fiilter object
    doc?: any;
}

// replae enum with const type
const UPDATES_METHOD = {
    INC: 'inc',
    SET: 'set',
    RM: 'rm',
    ADD: 'add',
    UPDATE: 'update'
} as const

export type UpdatesMethod = keyof typeof UPDATES_METHOD


export type ApplyInfo = {
    added?: {};
    merged?: {};
    inc?: {};
}

export interface StateManagerInterface<S, A , LS = {}, LA ={}> extends EventEmitter {
    name: string;
    stateStore: StateStore<S>;
    getLogSequenece(): Promise<number>;
    rootReducer: (state: StateStore<S>, action: A) => Promise<[{ [key: string]: ReducerInfo }, StateChanges]>;
    dispatch(action: A, linkedStateAction?: LA): Promise<[ sequence: number, reducerInfo: { [key: string]: ReducerInfo }, linkedReducerInfo: { [key: string]: ReducerInfo }]>
}

import { EventEmitter } from 'events'
import { EventStoreConnection } from './eventStoreConnection.js'

export type Control = {
    _control?: {
        sequence: number;
     //   lastupdated: number;
    }
}

function controlReducer<S,A>(): Reducer<S, A> {
    return {
        sliceKey: '_control',
        initState: { 
            "log_sequence": {
                type: 'METRIC'
            },
            "change_count": {
                type: 'METRIC'
            }
        } as StateStoreDefinition,
        fn: async function () {
            // Keep a counter of the number of changes that have been applyed to the state
            return  [{ failed: false }, [{ method: 'INC', path: 'change_count' }]]
        }
    }
}


// StateManager
// dispach() - takes 'Action', executes reducers to get array of "State Changes", pushes changes to eventStore, and applies to local stateStore (stateStore.apply)
export class StateManager<S, A, LS = {}, LA = {}> extends EventEmitter implements StateManagerInterface<S, A , LS, LA> {

    private _name
    private _stateStore: StateStore<S>
    private _connection: EventStoreConnection
    // A reducer that invokes every reducer inside the reducers object, and constructs a state object with the same shape.
    private _rootReducer: (state: StateStore<S>, action: A) => Promise<[{ [key: string]: ReducerInfo }, StateChanges]>
    
    // Linked StateManager, where this StateManager can dispatch actions to the linked StateManager
    private _linkedStateManager: StateManagerInterface<LS, LA> | undefined
    
    constructor(name: string, connection: EventStoreConnection, reducers: Array<Reducer<S, A>>, reducersWithPassin: Array<ReducerWithPassin<S, A>>, linkedStateManager?: StateManagerInterface<LS, LA>) {
        super()
        this._name = name
        this._connection = connection
        this._linkedStateManager = linkedStateManager

        // allReducers is array of all reducers returned objects <Reducer>
        const reducersWithControl = [controlReducer<S,A>()].concat(reducers)
        const reducersInitState = reducersWithControl.reduce((acc, i) => { return { ...acc, ...{ [i.sliceKey]: i.initState } } }, {})
        const reducersWithPassinInitState = reducersWithPassin.reduce((acc, i) => { return { ...acc, ...{ [i.sliceKey]: i.initState } } }, {})

        this._stateStore = new LevelStateStore<S>(this._name, {...reducersInitState, ...reducersWithPassinInitState} )

        this._rootReducer = this.combineReducers(/*this._connection, */ reducersWithControl, reducersWithPassin)
        //console.log(`StateManager: ${JSON.stringify(this.state)}`)
    }

    get rootReducer() {
        return this._rootReducer
    }

    get name() {
        return this._name
    }

    async getLogSequenece() {
        return await this._stateStore.getValue('_control', 'log_sequence')
    }

    get stateStore() {
        return this._stateStore
    }

    private combineReducers(/*coonnection,*/ reducers: Array<Reducer<S, A>>, reducersWithPassin: Array<ReducerWithPassin<S, A>>): (state: StateStore<S>, action: A) => Promise<[{ [key: string]: ReducerInfo }, StateChanges]> {
        // A reducer function that invokes every reducer inside the passed
        // *   object, and builds a state object with the same shape.
        return async function (state: StateStore<S>, action: A): Promise<[{ [key: string]: ReducerInfo }, StateChanges ]> {

            assert(action, 'reducers require action parameter')
            //let hasChanged = false
            const combinedReducerInfo: {[key: string]: ReducerInfo} = {}
            const combinedStateUpdates: {[key: string]: Array<StateUpdate>} = {}

            function addreduceroutput(key: string, ret: ReducerReturn) {
                const [info, updates] = ret
                // If one fails, then use that as the info, otherwise use the last one
                combinedReducerInfo[key] = info && info.failed ? info : combinedReducerInfo[key]
                // just concat all the state updates under the slicekey
                if (updates) combinedStateUpdates[key] = [...(combinedStateUpdates[key] || []),  ...updates] 
            }
            
            for (let reducer of reducers) {

                addreduceroutput(reducer.sliceKey, await reducer.fn(state, action))

                //const [reducerInfo, stateUpdates] = await reducer.fn(/*coonnection,*/ state, action)

                // If one fails, then use that as the info, otherwise use the last one
                //combinedReducerInfo[reducer.sliceKey] = reducerInfo && reducerInfo.failed ? reducerInfo : combinedReducerInfo[reducer.sliceKey]
                // just concat all the state updates under the slicekey
                //if (stateUpdates) combinedStateUpdates[reducer.sliceKey] = [...(combinedStateUpdates[reducer.sliceKey] || []),  ...stateUpdates] 
            }

            for (let reducerpassin of reducersWithPassin) {
                // reducers wuth passin slice, so this reducer may call the fn on another reducer
                const passInFn = reducers.find(r => r.sliceKey === reducerpassin.passInSlice)?.fn
                const passInWithSliceFn = reducersWithPassin.find(r => r.sliceKey === reducerpassin.passInSlice)?.fn

                assert (action ? (passInFn || passInWithSliceFn): true, `combineReducers: reducer with pass in slice definition "${reducerpassin.sliceKey}" requires a missing passInSlice reducer function at "${reducerpassin.passInSlice}"`)
                const [ret, passinret] = await reducerpassin.fn(/*coonnection,*/ state, action, action ? passInFn : undefined, action ? passInWithSliceFn : undefined)

                if (ret) addreduceroutput(reducerpassin.sliceKey, ret)
                if (passinret) addreduceroutput(reducerpassin.passInSlice, passinret)

                //for (let [reducerInfo, stateUpdates] of resultsArray) {
                //    // If one fails, then use that as the info, otherwise use the last one
                //    combinedReducerInfo[reducerpassin.sliceKey] = reducerInfo && reducerInfo.failed ? reducerInfo : combinedReducerInfo[reducerpassin.sliceKey]
                //    // just concat all the state updates under the slicekey
                //    if (stateUpdates) combinedStateUpdates[reducerpassin.sliceKey] = [...(combinedStateUpdates[reducerpassin.sliceKey] || []),  ...stateUpdates] 
                //}
            }

            return [combinedReducerInfo, combinedStateUpdates]

/*
            for (let reducer of reducers) {
                //const key = finalReducerKeys[i]
                //const previousStateForKey = null // state[sliceKey]
                assert(reducer.passInSlice ? reducers.findIndex(r => r.sliceKey === reducer.passInSlice) >= 0 : true, `reducer definition "${reducer.sliceKey}" requires a missing passInSlice reducer "${reducer.passInSlice}"`)

                // reducers return [ReducerInfo, Array<StateUpdates>]
                // return for a Reducer that has a "passInSlice", it return a array of [ReducerInfo, Array<StateUpdates>]
                const reducerRes = await reducer.fn(/ *coonnection,* / state, action, action && reducer.passInSlice ? reducers.find(r => r.sliceKey === reducer.passInSlice).fn : null)

                // state changes
                const sliceUpdates = reducer.passInSlice ? reducerRes[0] : reducerRes
                const passInUpdates = reducer.passInSlice ? reducerRes[1] : null

                //console.log(`get sliceKey=${sliceKey}: ${JSON.stringify(reducerRes)}`)
                if (sliceUpdates) {
                    //console.log(sliceUpdates)
                    assert(sliceUpdates.length === 2 && reducer.sliceKey === '_control' ? true : Array.isArray(sliceUpdates[1]) && sliceUpdates[1].length > 0, `Error reducer at sliceKey=${reducer.sliceKey}, return unexected value`)
                    allUpdates[reducer.sliceKey] = allUpdates[reducer.sliceKey] ? [allUpdates[reducer.sliceKey][0] || sliceUpdates[0], [...allUpdates[reducer.sliceKey][1], ...sliceUpdates[1]]] : sliceUpdates
                }
                if (passInUpdates) {
                    assert(passInUpdates.length === 2 && Array.isArray(passInUpdates[1]) && passInUpdates[1].length > 0, `Error reducer at sliceKey=${reducer.sliceKey}, return unexected passInUpdates value for passInSlice=${reducer.passInSlice}`)
                    allUpdates[reducer.passInSlice] = allUpdates[reducer.passInSlice] ? [allUpdates[reducer.passInSlice][0] || passInUpdates[0], [...allUpdates[reducer.passInSlice][1], ...passInUpdates[1]]] : passInUpdates
                }
            }

            return Object.keys(allUpdates).length > 1 ? [
                Object.keys(allUpdates).map(k => { return { [k]: allUpdates[k][0] } }).reduce((acc, i) => { return { ...acc, ...i } }, {}),
                Object.keys(allUpdates).map(k => { return { [k]: allUpdates[k][1] } }).reduce((acc, i) => { return { ...acc, ...i } }, {})
            ] : [null, null]
*/
        }
    }

    // Used when only this state is updated
    //
    async dispatch(action: A, linkedStateAction?: LA): Promise<[ sequence: number, reducerInfo: { [key: string]: ReducerInfo }, linkedReducerInfo: { [key: string]: ReducerInfo }]> {
        //console.log(`Action: \n${JSON.stringify(action)}`)
        assert (this._connection.db, 'dispatch: Cannot apply processor actions, no "db" details provided')
        assert(this._connection, 'dispatch: Cannot apply processor actions, no "Connection" details provided')
        assert((!linkedStateAction) || this._linkedStateManager, 'dispatch: Cannot apply linkedStateAction if there is no linkedStateManager defined')


        let release = await this._connection.mutex.aquire()
        let applyInfo : { [key:string] : ApplyInfo} = {}, applyLinkInfo : { [key:string] : ApplyInfo} = {}

        // Generate array of "Changes" to be recorded & applied to the leveldb store, and "Info" about the changes (has it failed etc)
        //
        const [linkReducerInfo, linkChanges] = linkedStateAction && this._linkedStateManager ? await this._linkedStateManager.rootReducer(this._linkedStateManager.stateStore, linkedStateAction) : [{}, {}]
        const [reducerInfo, changes] = await this.rootReducer(this.stateStore, action)
        
        // Store the changes in the mongo collection, with sequence number
        //
        if ((changes && Object.keys(changes).length > 0) || (linkChanges && Object.keys(linkChanges).length > 0)) {
            // persist events
            const msg = {
                sequence: this._connection.sequence + 1,
                _ts: new Timestamp(0,0), // Emptry timestamp will be replaced by the server to the current server time
                partition_key: this._connection.tenentKey,
                ...(changes && Object.keys(changes).length > 0 && { [this.name]: changes }),
                ...(linkChanges && this._linkedStateManager && Object.keys(linkChanges).length > 0 && { [this._linkedStateManager.name]: linkChanges })
            }
            const res = await this._connection.db.collection(this._connection.collection).insertOne(msg)
            this.emit('changes', msg)
            this._connection.sequence = this._connection.sequence + 1

            // This is where the linked state will be updated, so any items added will get their new id's (used by process state manager)
            // We want to apply this output to the processor state
            applyLinkInfo = linkChanges && this._linkedStateManager && Object.keys(linkChanges).length > 0 ? await this._linkedStateManager.stateStore.apply(this._connection.sequence, linkChanges) : {}
            // apply events to local state
            applyInfo = changes && Object.keys(changes).length > 0 ? await this.stateStore.apply(this._connection.sequence, changes) : {}
            
        }

        release()
        // Combine reducerInfo with applyInfo
        const allInfo: { [key: string]: ReducerInfo & ApplyInfo } = reducerInfo ? Object.keys(applyInfo).reduce((acc, i) => { return { ...acc, [i]: {...applyInfo[i], ...acc[i]} as ReducerInfo & ApplyInfo } }, reducerInfo) : {}
        const allLinkInfo: { [key: string]: ReducerInfo & ApplyInfo } = linkReducerInfo ? Object.keys(applyLinkInfo).reduce((acc, i) => { return { ...acc, [i]: {...applyLinkInfo[i], ...acc[i]} } }, linkReducerInfo) : {}
        return [this._connection.sequence, allInfo, allLinkInfo]
        //console.log(`State: \n${JSON.stringify(this.state)}`)
    }
}

