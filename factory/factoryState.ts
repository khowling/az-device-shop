import assert from 'assert'


export interface WorkItemObject {
    _id: number;
    spec: any;
    status: WorkItemStatus;
}

export interface WorkItemStatus extends DocStatus {
    stage?: WorkItemStage;
    // Factory status
    workItemId?: string;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}

export enum WorkItemStage {
    Draft,
    New,
    FactoryReady,
    FactoryAccepted,
    FactoryComplete,
    MoveToWarehouse,
    InventoryAvailable
}



import { StateManager, StateUpdates, StateStoreDefinition,  UpdatesMethod, ReducerReturnWithSlice, ReducerFunction, ReducerFunctionWithSlide, ReducerWithPassin, Reducer, StateStoreValueType } from '@az-device-shop/eventing/state'
import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
export { StateUpdates } from '@az-device-shop/eventing/state'

// Mutate state in a Consistant, Safe, recorded mannore
export interface FactoryAction {
    type: FactoryActionType;
    _id?: number;
    spec?: any;
    status?: any;
}
export enum FactoryActionType {
    New,
    StatusUpdate,
    FactoryProcess,
    CompleteInventry,
    ReserveInvSeq,
    TidyUp
}

// This returns a 'Reducer' function that performs an 'action <FactoryAction>' on the 'workItems <WorkItemReducerState>' 'slice' of the factory State
// and returns an array of 'state updates <StateUpdate>' that can be applied to a current state view by another function
// It also provides a 'initState' for the slice.
// It is a 'ReducerWithPassin', as the function it allows an attitional parameter 'passInSlice', this contains another Reducer & State that that  
function workItemsReducer(): ReducerWithPassin<FactoryAction> {

    return {
        sliceKey: 'workItems',
        passInSlice: 'inventory_complete',
        initState: {
            "items" : {
                type: StateStoreValueType.List,
                identifierFormat: {prefix: 'WI', zeroPadding: 5}
            }
        } as StateStoreDefinition,
        fn: async function (/*connection,*/ state, action, passInSlice?) {
            const { spec, _id, status } = action
            switch (action.type) {
                case FactoryActionType.New:
                    const required_props = ['productId', 'qty', 'warehouse']
                    if (required_props.reduce((a, v) => a && spec.hasOwnProperty(v), true)) {

                        return [[{ failed: false }, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { spec: action.spec, status: { failed: false, /*workItemId: 'WI' + String(state.workitem_sequence).padStart(5, '0'),*/ stage: WorkItemStage.New } } }
                        ]]]
                        
                    } else {
                        return [[{ failed: true }, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { spec: action.spec, status: { failed: true, message: `Require properties missing. ${required_props.map(i => `"${i}"`).join(',')}`, stage: WorkItemStage.New } } }
                        ]]]
                    }
                case FactoryActionType.StatusUpdate:
                    return [[{ failed: false }, [
                        { method: UpdatesMethod.Update, path: 'items', filter: { _id }, doc: { "$set": {status} } }
                    ]]]
                case FactoryActionType.TidyUp:
                    return [[{ failed: false }, [
                        { method: UpdatesMethod.Rm, path: 'items', filter: { _id } }
                    ]]]
                case FactoryActionType.CompleteInventry:

                    const wi = state.getValue('workItems', 'items', _id)
                    if (wi) {
                        const inventoryReducer = passInSlice as ReducerFunction<FactoryAction>

                        return [[{ failed: false }, [
                            { method: UpdatesMethod.Update, path: 'items', filter: { _id }, doc: { "$set": {status: { failed: false, stage: WorkItemStage.InventoryAvailable }} } }
                        ]], await inventoryReducer(/*connection, */ state, { type:  FactoryActionType.ReserveInvSeq, _id, spec })]
                    } else {
                        return [[{ failed: true }, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { _id, status: { stage: WorkItemStage.InventoryAvailable, failed: true, message: `workItem missing in store _id=${_id}` } } }
                        ]]]
                    }
                default:
                    // action not for this reducer, so no updates
                    return [null, null]
            }
        }
    }
}



export interface FactoryItem extends DocStatus {
    _id?: number;
    workItem_id?: number;
    stage: FactoryStage;
    acceptedtime?: number;
    starttime?: number;
    waittime?: number;
    allocated_capacity?: number;
    progress?: number;
}
export enum FactoryStage { Waiting, Building, Complete }


function factoryReducer(timeToProcess = 10 * 1000 /*3 seconds per item*/, factoryCapacity = 5): ReducerWithPassin<FactoryAction> {

    return {
        sliceKey: 'factory',
        passInSlice: 'workItems',
        initState: {
            "items" : {
                type: StateStoreValueType.List,
                identifierFormat: {prefix: 'FO', zeroPadding: 5} 
            },
            "factoryStatus": {
                type: StateStoreValueType.Hash,
                values: {
                    "capacity_allocated": 0
                }
            }
        } as StateStoreDefinition,
        fn: async function (/*connection, */state, action, passInSlice) {

            switch (action.type) {
                case FactoryActionType.TidyUp:
                    return [[{ failed: false }, [
                        { method: UpdatesMethod.Rm, path: 'items', filter: { _id: action._id } }
                    ]]]
                case FactoryActionType.FactoryProcess:

                    const workItemsReducer = passInSlice as ReducerFunctionWithSlide<FactoryAction>

                    //console.log(`workItemsState=${JSON.stringify(workItemsState)}`)
                    const now = Date.now()
                    let capacity_allocated_update = 0

                    let factory_updates: Array<StateUpdates> = []
                    let workitem_updates: Array<StateUpdates> = []

                    // check wi in factory_status status look for for completion to free up capacity
                    for (let item of state.getValue('factory', 'items').filter(o => o.stage === FactoryStage.Building)  as Array<FactoryItem>) {
                        // all wi in Picking status
                        //const { id, status } = ord
                        const timeleft = (timeToProcess /* * qty */) - (now - item.starttime)

                        if (timeleft > 0) { // not finished, just update progress
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { "$set": {progress: Math.floor(100 - ((timeleft / timeToProcess) * 100.0)) }} })
                        } else { // finished
                            capacity_allocated_update = capacity_allocated_update - item.allocated_capacity
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { "$set": {stage: FactoryStage.Complete, progress: 100, allocated_capacity: 0 } }})
                            const [[status, complete_updates]] = await workItemsReducer(state, { type: FactoryActionType.StatusUpdate, _id: item.workItem_id, status: { stage: WorkItemStage.FactoryComplete } })
                            workitem_updates = workitem_updates.concat(complete_updates)
                        }
                        //statechanges.push({ kind, metadata: { flow_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    const required_capacity = 1

                    // new WorkItems that are ready for the Factory
                    const {capacity_allocated} = state.getValue("factory", "factoryStatus")
                    for (let wi of state.getValue('workItems', 'items').filter(i => i.status.stage === WorkItemStage.FactoryReady) as Array<WorkItemObject>) {
                        const [[{ failed }, accept_updates]] = await workItemsReducer(state, { type: FactoryActionType.StatusUpdate, _id: wi._id, status: { stage: WorkItemStage.FactoryAccepted } })
                        workitem_updates = workitem_updates.concat(accept_updates)

                        if ((factoryCapacity - (capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: UpdatesMethod.Add, path: 'items', doc: { workItem_id: wi._id, stage: FactoryStage.Building, acceptedtime: now, starttime: now, allocated_capacity: required_capacity, progress: 0, waittime: 0 } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // need to wait
                            factory_updates.push({ method: UpdatesMethod.Add, path: 'items', doc: { workItem_id: wi._id, stage: FactoryStage.Waiting, acceptedtime: now, waittime: 0 } })
                        }
                    }

                    // check factory in "waiting" status
                    for (let item of state.getValue('factory', 'items').filter(o => o.stage === FactoryStage.Waiting) as Array<FactoryItem>) {
                        if ((factoryCapacity - (capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { "$set": {stage: FactoryStage.Building, allocated_capacity: required_capacity, progress: 0, waittime: now - item.acceptedtime } }})
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // still need to wait
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { "$set": { waittime: now - item.acceptedtime }} })
                        }
                        //statechanges.push({ kind, metadata: { id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    if (capacity_allocated_update !== 0) {
                        factory_updates.push({ method: UpdatesMethod.Update, path: 'factoryStatus',  doc: {  "$set": {capacity_allocated: capacity_allocated + capacity_allocated_update }} })
                    }

                    return [factory_updates.length > 0 ? [{ failed: false }, factory_updates] : null, workitem_updates.length > 0 ? [{ failed: false }, workitem_updates] : null] as ReducerReturnWithSlice

                default:
                    // action not for this reducer, so no updates
                    return [null, null]
            }
        }
    }
}



export interface InventoryItem {
    _id: number;
    workItemId: string;
    qty: number;
    productId: string;
    warehouse: string;
}

interface InventoryReducerState {
    //items: Array<InventoryItem>;
    inventry_sequence: number;
}

function inventryReducer(): Reducer<FactoryAction> {

    return {
        sliceKey: 'inventory_complete',
        initState: { 
            "inventry_sequence": {
                type: StateStoreValueType.Counter,
            }
        },
        fn: async function (/*connection,*/ state, action) {

            const { spec, _id, type } = action
            switch (type) {
                case FactoryActionType.ReserveInvSeq:


                    //if (result && result.insertedId) {
                    return [{ failed: false }, [
                        { method: UpdatesMethod.Inc, path: 'inventry_sequence' }
                        //{ method: UpdatesMethod.Add, path: 'items', doc: { ...spec, id: 'INV' + String(state.inventry_sequence).padStart(5, '0'), inventry_sequence: state.inventry_sequence } }
                    ]]
                    //} else {
                    //    return [{ failed: true }, null]
                    //}
                default:
                    // action not for this reducer, so no updates
                    return null
            }
        }
    }
}

export class FactoryStateManager extends StateManager<FactoryAction> {

    constructor(name: string, connection: EventStoreConnection) {
        super(name, connection, [
            workItemsReducer(),
            factoryReducer(),
            inventryReducer()
        ])
    }
}
