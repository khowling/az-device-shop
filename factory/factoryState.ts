import assert from 'assert'


export interface WorkItemObject {
    id: string;
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
    Draft,// = "Draft",
    New,// = "New",
    FactoryReady,// = "FactoryReady",
    FactoryAccepted,// = "FactoryAccepted",
    FactoryComplete,// = "FactoryComplete",
    MoveToWarehouse,// = "MoveToWarehouse",
    InventoryAvailable,// = "InventoryAvailable"
}



import { StateManager, StateUpdates, UpdatesMethod, ReducerReturnWithSlice, ReducerReturn, ReducerWithPassin, Reducer } from '@az-device-shop/eventing/state'
import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
export { StateUpdates } from '@az-device-shop/eventing/state'

// Mutate state in a Consistant, Safe, recorded mannore
export interface WorkItemAction {
    type: WorkItemActionType;
    id?: string;
    spec?: any;
    status?: any;
}
export enum WorkItemActionType {
    New = 'workItems/New',
    StatusUpdate = 'workItems/StatusUpdate',
    FactoryProcess = 'factory/Process',
    CompleteInventry = 'workItems/InventoryAvailable',
    INventoryNew = 'inventry/New',
    TidyUp = 'tidyUp'
}

interface WorkItemReducerState {
    items: Array<WorkItemObject>;
    workitem_sequence: number;
}

// This returns a 'Reducer' function that performs an 'action <WorkItemAction>' on the 'workItems <WorkItemReducerState>' 'slice' of the factory State
// and returns an array of 'state updates <StateUpdate>' that can be applied to a current state view by another function
// It also provides a 'initState' for the slice.
// It is a 'ReducerWithPassin', as the function it allows an attitional parameter 'passInSlice', this contains another Reducer & State that that  
function workItemsReducer(): ReducerWithPassin<WorkItemReducerState, WorkItemAction> {

    return {
        sliceKey: 'workItems',
        passInSlice: 'inventory_complete',
        initState: { items: [], workitem_sequence: 0 } as WorkItemReducerState,
        fn: async function (connection, state: WorkItemReducerState, action: WorkItemAction, passInSlice): Promise<ReducerReturnWithSlice> {
            const { spec, id, status } = action
            switch (action.type) {
                case 'workItems/New':
                    const required_props = ['productId', 'qty', 'warehouse']
                    if (required_props.reduce((a, v) => a && spec.hasOwnProperty(v), true)) {
                        if (state.items.findIndex(w => w.id === id) < 0) {
                            return [[{ failed: false }, [
                                { method: UpdatesMethod.Inc, doc: { workitem_sequence: 1 } },
                                { method: UpdatesMethod.Add, path: 'items', doc: { id, spec: action.spec, status: { failed: false, workItemId: 'WI' + String(state.workitem_sequence).padStart(5, '0'), stage: WorkItemStage.New } } }
                            ]]]
                        } else {
                            return [[{ failed: true }, [
                                { method: UpdatesMethod.Add, path: 'items', doc: { id, spec: action.spec, status: { failed: true, message: `Adding workItem with "id" that already exists id=${id}`, stage: WorkItemStage.New } } }
                            ]]]
                        }
                    } else {
                        return [[{ failed: true }, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { id, spec: action.spec, status: { failed: true, message: `Require properties missing. ${required_props.map(i => `"${i}"`).join(',')}`, stage: WorkItemStage.New } } }
                        ]]]
                    }
                case 'workItems/StatusUpdate':
                    return [[{ failed: false }, [
                        { method: UpdatesMethod.Merge, path: 'items', filter: { id }, doc: { status } }
                    ]]]
                case 'tidyUp':
                    return [[{ failed: false }, [
                        { method: UpdatesMethod.Rm, path: 'items', filter: { id } }
                    ]]]
                case 'workItems/InventoryAvailable':

                    const wiidx = state.items.findIndex(w => w.id === id)
                    if (wiidx >= 0) {
                        const [inventoryState, inventoryReducer] = passInSlice

                        return [[{ failed: false }, [
                            { method: UpdatesMethod.Merge, path: 'items', filter: { id }, doc: { status: { failed: false, stage: WorkItemStage.InventoryAvailable } } }
                        ]], await inventoryReducer(connection, inventoryState, { type: 'inventry/New', id, spec })]
                    } else {
                        return [[{ failed: true }, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { id, status: { stage: WorkItemStage.InventoryAvailable, failed: true, message: `workItem missing in store id=${id}` } } }
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
    id: number;
    stage: FactoryStage;
    acceptedtime?: number;
    starttime?: number;
    waittime?: number;
    allocated_capacity?: number;
    progress?: number;
}
export enum FactoryStage { Waiting, Building, Complete }

interface FactoryReducerState {
    items: Array<FactoryItem>;
    capacity_allocated: number;
}

function initFactoryReducer(timeToProcess = 30 * 1000 /*3 seconds per item*/, factoryCapacity = 5): ReducerWithPassin<FactoryReducerState, WorkItemAction> {

    return {
        sliceKey: 'factory',
        passInSlice: 'workItems',
        initState: { items: [], capacity_allocated: 0 } as FactoryReducerState,
        fn: async function (connection, state: FactoryReducerState, action: WorkItemAction, passInSlice): Promise<ReducerReturnWithSlice> {

            switch (action.type) {
                case 'tidyUp':
                    return [[{ failed: false }, [
                        { method: UpdatesMethod.Rm, path: 'items', filter: { id: action.id } }
                    ]]]
                case 'factory/Process':

                    const [workItemsState, workItemsReducer] = passInSlice
                    //console.log(`workItemsState=${JSON.stringify(workItemsState)}`)
                    const now = Date.now()
                    let capacity_allocated_update = 0

                    let factory_updates: Array<StateUpdates> = []
                    let workitem_updates: Array<StateUpdates> = []

                    // check wi in factory_status status look for for completion to free up capacity
                    for (let item of state.items.filter(o => o.stage === FactoryStage.Building)) {
                        // all wi in Picking status
                        //const { id, status } = ord
                        const timeleft = (timeToProcess /* * qty */) - (now - item.starttime)

                        if (timeleft > 0) { // not finished, just update progress
                            factory_updates.push({ method: UpdatesMethod.Merge, path: 'items', filter: { id: item.id }, doc: { progress: Math.floor(100 - ((timeleft / timeToProcess) * 100.0)) } })
                        } else { // finished
                            capacity_allocated_update = capacity_allocated_update - item.allocated_capacity
                            factory_updates.push({ method: UpdatesMethod.Merge, path: 'items', filter: { id: item.id }, doc: { stage: FactoryStage.Complete, progress: 100, allocated_capacity: 0 } })
                            const [[{ failed }, complete_updates]] = await workItemsReducer(connection, workItemsState, { type: 'workItems/StatusUpdate', id: item.id, status: { stage: WorkItemStage.FactoryComplete } })
                            workitem_updates = workitem_updates.concat(complete_updates)
                        }
                        //statechanges.push({ kind, metadata: { flow_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    const required_capacity = 1

                    // new WorkItems that are ready for the Factory
                    for (let wi of workItemsState.items.filter(i => i.status.stage === WorkItemStage.FactoryReady)) {
                        const [[{ failed }, accept_updates]] = await workItemsReducer(connection, workItemsState, { type: 'workItems/StatusUpdate', id: wi.id, status: { stage: WorkItemStage.FactoryAccepted } })
                        workitem_updates = workitem_updates.concat(accept_updates)

                        if ((factoryCapacity - (state.capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: UpdatesMethod.Add, path: 'items', doc: { id: wi.id, stage: FactoryStage.Building, acceptedtime: now, starttime: now, allocated_capacity: required_capacity, progress: 0, waittime: 0 } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // need to wait
                            factory_updates.push({ method: UpdatesMethod.Add, path: 'items', doc: { id: wi.id, stage: FactoryStage.Waiting, acceptedtime: now, waittime: 0 } })
                        }
                    }

                    // check wi in "waiting" status
                    for (let item of state.items.filter(o => o.stage === FactoryStage.Waiting)) {
                        if ((factoryCapacity - (state.capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: UpdatesMethod.Merge, path: 'items', filter: { id: item.id }, doc: { stage: FactoryStage.Building, allocated_capacity: required_capacity, progress: 0, waittime: now - item.acceptedtime } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // still need to wait
                            factory_updates.push({ method: UpdatesMethod.Merge, path: 'items', filter: { id: item.id }, doc: { waittime: now - item.acceptedtime } })
                        }
                        //statechanges.push({ kind, metadata: { id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    if (capacity_allocated_update !== 0) {
                        factory_updates.push({ method: UpdatesMethod.Inc, doc: { capacity_allocated: capacity_allocated_update } })
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
    id: string;
    workItemId: string;
    qty: number;
    productId: string;
    warehouse: string;
}

interface InventoryReducerState {
    //items: Array<InventoryItem>;
    inventry_sequence: number;
}

function inventryReducer(): Reducer<InventoryReducerState, WorkItemAction> {

    return {
        sliceKey: 'inventory_complete',
        initState: { /*items: [], */ inventry_sequence: 0 } as InventoryReducerState,
        fn: async function (connection, state: InventoryReducerState, action: WorkItemAction): Promise<ReducerReturn> {

            const { spec, id, type } = action
            switch (type) {
                case 'inventry/New':
                    const result = await connection.db.collection("inventory_complete").insertOne({
                        sequence: state.inventry_sequence + 1,
                        partition_key: connection.tenentKey,
                        inventoryId: 'INV' + String(state.inventry_sequence).padStart(5, '0'),
                        spec
                    })
                    if (result && result.insertedId) {
                        return [{ failed: false }, [
                            { method: UpdatesMethod.Inc, doc: { inventry_sequence: 1 } }
                            //{ method: UpdatesMethod.Add, path: 'items', doc: { ...spec, id: 'INV' + String(state.inventry_sequence).padStart(5, '0'), inventry_sequence: state.inventry_sequence } }
                        ]]
                    } else {
                        return [{ failed: true }, null]
                    }
                default:
                    // action not for this reducer, so no updates
                    return null
            }
        }
    }
}

export class FactoryStateManager extends StateManager {

    constructor(name: string, connection: EventStoreConnection) {
        super(name, connection, [
            workItemsReducer(),
            initFactoryReducer(),
            inventryReducer()
        ])
    }
}
