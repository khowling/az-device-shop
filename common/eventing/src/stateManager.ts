import { strict as assert } from 'node:assert';
import mongodb, {MongoAPIError, Timestamp }  from 'mongodb'
import { ObjectId } from 'bson'



import { JSStateStore } from './jsStateStore.js'
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
} 

export type StateStore<S> = {
    name: string;
    stateDefinition: { [sliceKey: string]: StateStoreDefinition};
    getValue(reducerKey: string, path: string, idx?: number): Promise<any>;
    debugState(): void;
    initStore(ops: {distoryExisting: boolean}): Promise<void>;
    serializeState(): Promise<S>;
    // deserializeState(newstate: {[statekey: string]: any}): void
    apply(sequence: number, statechanges: StateChanges, linkedApplyInfo?: {[slice: string]: ApplyInfo}): Promise<{[reducerKey: string] : ApplyInfo}>
}


export type CalculatedValueDef = { 
    target: string;
    linkedApplyInfo?: boolean,
    applyFilter? : {
        sliceKey: string;
        path: string;
        operation: 'added' | 'merged';
        find: { 
            key: string;
            value: number;
        }
        attribute?: string;
    }
}
export type StateUpdate = {
    method: UpdatesMethod;
    path: string; // state path to process (optional)
    filter?: {
        _id: number
    }; // fiilter object
    doc?: any;
    setCalc?: CalculatedValueDef
    
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
    [path: string]: {
        added?: any[];
        merged?: any[];
        inc?: {};
    }
}

export type ChangeMessage = {
    sequence: number;
    _ts: Timestamp;
    partition_key: ObjectId | undefined;
    stores: {
        [storeName: string]: {
            changes: StateChanges;
            linkedStoreName?: string;
        }
    }
}

type CombindReducerFunction<S, A> = (state: StateStore<S>, action: A) => Promise<[{ [sliceKey: string]: ReducerInfo }, {[sliceKey: string]: Array<StateUpdate>} ]>


export interface StateManagerInterface<S, A , LS = {}, LA ={}> extends EventEmitter {
    name: string;
    stateStore: StateStore<S>;
    getLogSequenece(): Promise<number>;
    rootReducer: CombindReducerFunction<S, A>;
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
            //return  [{ failed: false }, [{ method: 'INC', path: 'change_count' }]]
            return [null, null]
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
    private _rootReducer: CombindReducerFunction<S, A>
    
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

        this._stateStore = new /*Level*/ /*JS*/ LevelStateStore<S>(this._name, {...reducersInitState, ...reducersWithPassinInitState} )

        this._rootReducer = this.combineReducers( reducersWithControl, reducersWithPassin)

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

    /* combineReducers: Returns a function that runs all the registered state reducers that produces info on success/failour of the reducer action, and the changes required to the state
     * This function will only be ran once and stored in the event log once, so can be happliy changed in new release of the software 
     * the Function Returning:
     *  In position [0], the all the reducerInfo by sliceKey (reducer info is information about if the operation was a success or failour).
     *  In position [1], the array of resulting state changes by sliceKey (that is applied to the store in strict sequence)
     */
    private combineReducers(reducers: Array<Reducer<S, A>>, reducersWithPassin: Array<ReducerWithPassin<S, A>>): CombindReducerFunction<S,A> {
        
        return async function (state, action) {

            assert(action, 'reducers require action parameter')
            //let hasChanged = false
            const combinedReducerInfo: {[sliceKey: string]: ReducerInfo} = {}
            const combinedStateUpdates: {[sliceKey: string]: Array<StateUpdate>} = {}

            function addreduceroutput(sliceKey: string, ret: ReducerReturn) {
                const [info, updates] = ret
                // If one fails, then use that as the info, otherwise use the last one
                if (info && !(combinedReducerInfo[sliceKey] && combinedReducerInfo[sliceKey].failed)){
                    combinedReducerInfo[sliceKey] = info
                }
                // just concat all the state updates under the slicekey
                if (updates) combinedStateUpdates[sliceKey] = [...(combinedStateUpdates[sliceKey] || []),  ...updates] 
            }
            
            for (let reducer of reducers) {
                addreduceroutput(reducer.sliceKey, await reducer.fn(state, action))
            }

            for (let reducerpassin of reducersWithPassin) {
                // reducers wuth passin slice, so this reducer may call the fn on another reducer
                const passInFn = reducers.find(r => r.sliceKey === reducerpassin.passInSlice)?.fn
                const passInWithSliceFn = reducersWithPassin.find(r => r.sliceKey === reducerpassin.passInSlice)?.fn

                assert (action ? (passInFn || passInWithSliceFn): true, `combineReducers: reducer with pass in slice definition "${reducerpassin.sliceKey}" requires a missing passInSlice reducer function at "${reducerpassin.passInSlice}"`)
                const [ret, passinret] = await reducerpassin.fn(/*coonnection,*/ state, action, action ? passInFn : undefined, action ? passInWithSliceFn : undefined)

                if (ret) addreduceroutput(reducerpassin.sliceKey, ret)
                if (passinret) addreduceroutput(reducerpassin.passInSlice, passinret)

            }

            return [combinedReducerInfo, combinedStateUpdates]
        }
    }

    // Used when only this state is updated
    //
    async dispatch(action: A, linkedStateAction?: LA): Promise<[ sequence: number, reducerInfo: { [key: string]: ReducerInfo & ApplyInfo }, linkedReducerInfo: { [key: string]: ReducerInfo & ApplyInfo }]> {
        //console.log(`Action: \n${JSON.stringify(action)}`)
        assert (this._connection.db, 'dispatch: Cannot apply processor actions, no "db" details provided')
        assert(this._connection, 'dispatch: Cannot apply processor actions, no "Connection" details provided')
        assert((!linkedStateAction) || this._linkedStateManager, 'dispatch: Cannot apply linkedStateAction if there is no linkedStateManager defined')


        let release = await this._connection.mutex.aquire()
        let applyInfo : { [key:string] : ApplyInfo} = {}, applyLinkInfo : { [key:string] : ApplyInfo} = {}

        // Generate array of "Changes" to be recorded & applied to the leveldb store, and "Info" about the changes (has it failed etc)
        //
        let [linkReducerInfo, linkChanges] = linkedStateAction && this._linkedStateManager ? await this._linkedStateManager.rootReducer(this._linkedStateManager.stateStore, linkedStateAction) : [{}, {}]
        let [reducerInfo, changes] = await this.rootReducer(this.stateStore, action)

        //  If changes in store, then increment the store change_count
        if (changes && Object.keys(changes).length > 0) {
            changes = { ...changes, _control: [{ method: 'INC', path: 'change_count' }] }
        }

        //  If changes on linkStore, then increment the store change_count
        if (linkChanges && Object.keys(linkChanges).length > 0) {
            linkChanges = { ...linkChanges, _control: [{ method: 'INC', path: 'change_count' }] }
        }
        


        if ((changes && Object.keys(changes).length > 0) || (linkChanges && Object.keys(linkChanges).length > 0)) {
            
                    
            // Store the changes in the mongo collection, with sequence number
            //
            const msg : ChangeMessage = {
                sequence: this._connection.sequence + 1,
                _ts: new Timestamp(0,0), // Emptry timestamp will be replaced by the server to the current server time
                partition_key: this._connection.tenentKey,
                stores: {
                    ...(linkChanges && this._linkedStateManager && Object.keys(linkChanges).length > 0 && { [this._linkedStateManager.name]: {changes: linkChanges} }),
                    ...(changes && Object.keys(changes).length > 0 && { [this.name]: {changes, ...(this._linkedStateManager?.name && {linkedStoreName: this._linkedStateManager.name})} })
                }
            }
            const res = await this._connection.db.collection(this._connection.collection).insertOne(msg)
            this.emit('changes', msg)
            this._connection.sequence = this._connection.sequence + 1


            // Apply Changes to State Store
            // This is where the linked state will be updated, so any items added will get their new id's (used by process state manager)
            // We want to apply this output to the processor state
            applyLinkInfo = linkChanges && this._linkedStateManager && Object.keys(linkChanges).length > 0 ? await this._linkedStateManager.stateStore.apply(this._connection.sequence, linkChanges) : {}
            // apply events to local state
            applyInfo = changes && Object.keys(changes).length > 0 ? await this.stateStore.apply(this._connection.sequence, changes, applyLinkInfo) : {}
            
        }

        release()

        // Combine reducerInfo with applyInfo & return
        const allInfo: { [key: string]: ReducerInfo & ApplyInfo } = reducerInfo ? Object.keys(applyInfo).reduce((acc, i) => { return { ...acc, [i]: {...applyInfo[i], ...acc[i]} as ReducerInfo & ApplyInfo } }, reducerInfo) : {}
        const allLinkInfo: { [key: string]: ReducerInfo & ApplyInfo } = linkReducerInfo ? Object.keys(applyLinkInfo).reduce((acc, i) => { return { ...acc, [i]: {...applyLinkInfo[i], ...acc[i]} } }, linkReducerInfo) : {}
        return [this._connection.sequence, allInfo, allLinkInfo]
        //console.log(`State: \n${JSON.stringify(this.state)}`)
    }
}

