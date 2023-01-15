import assert from 'assert'


export interface WorkItemObject {
    _id: number;
    identifier?: string;
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


// replae enum with const type
const WORKITEM_STAGE = {
    DRAFT: 'Draft',
    NEW: 'New',
    FACTORY_READY: 'FactoryReady',
    FACTORY_ACCEPTED: 'FactoryAccepted',
    FACTORY_COMPLETE: 'FactoryComplete',
    MOVE_TO_WAREHOUSE: 'MoveToWarehouse',
    INVENTORY_AVAILABLE: 'InventoryAvailable'
} as const

export type WorkItemStage = keyof typeof WORKITEM_STAGE




import { StateManager }  from '@az-device-shop/eventing/state'
import type {  StateUpdates, StateStoreDefinition,  UpdatesMethod, ReducerReturnWithSlice, ReducerFunction, ReducerFunctionWithSlide, ReducerWithPassin, Reducer, StateStoreValueType, ReducerInfo } from '@az-device-shop/eventing/state'
import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
export { StateUpdates, StateUpdateControl } from '@az-device-shop/eventing/state'

// Mutate state in a Consistant, Safe, recorded mannore
export interface FactoryAction {
    type: FactoryActionType;
    _id?: number;
    spec?: any;
    status?: any;
}

// replae enum with const type
const FACTORY_ACTION = {
    NEW: 'New',
    STATUS_UPDATE: 'StatusUpdate',
    FACTORY_PROCESS: 'FactoryProcess',
    COMPLETE_INVENTORY: 'CompleteInventry',
    RESERVE_INV_SEQ: 'ReserveInvSeq',
    TIDY_UP: 'TidyUp'
} as const

export type FactoryActionType = keyof typeof FACTORY_ACTION


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
                type: 'LIST',
                identifierFormat: {prefix: 'WI', zeroPadding: 5}
            }
        } as StateStoreDefinition,
        fn: async function (/*connection,*/ state, action, passInSlice?) {
            const { spec, _id, status } = action
            switch (action.type) {
                case 'NEW':
                    const required_props = ['productId', 'qty', 'warehouse']
                    if (required_props.reduce((a, v) => a && spec.hasOwnProperty(v), true)) {

                        return [[{ failed: false }, [
                            { method: 'ADD', path: 'items', doc: { spec: action.spec, status: { failed: false,  stage: 'New' } } }
                        ]]]
                        
                    } else {
                        return [[{ failed: true }, [
                            { method: 'ADD', path: 'items', doc: { spec: action.spec, status: { failed: true, message: `Require properties missing. ${required_props.map(i => `"${i}"`).join(',')}`, stage: 'NEW' } } }
                        ]]]
                    }
                case 'STATUS_UPDATE':
                    return [[{ failed: false }, [
                        { method: 'UPDATE', path: 'items', filter: { _id  } as { _id: number}, doc: { "$set": {status} } }
                    ]]]
                case 'TIDY_UP':
                    return [[{ failed: false }, [
                        { method: 'RM', path: 'items', filter: { _id } as { _id: number} }
                    ]]]
                case 'COMPLETE_INVENTORY':

                    const wi = state.getValue('workItems', 'items', _id)
                    if (wi) {
                        const inventoryReducer = passInSlice as ReducerFunction<FactoryAction>

                        return [[{ failed: false }, [
                            { method: 'UPDATE', path: 'items', filter: { _id } as { _id: number}, doc: { "$set": {status: { failed: false, stage: 'INVENTORY_AVAILABLE' }} } }
                        ]], await inventoryReducer(/*connection, */ state, { type:  'RESERVE_INV_SEQ', _id, spec })]
                    } else {
                        return [[{ failed: true }, [
                            { method: 'ADD', path: 'items', doc: { _id, status: { stage: 'INVENTORY_AVAILABLE', failed: true, message: `workItem missing in store _id=${_id}` } } }
                        ]]]
                    }
                default:
                    // action not for this reducer, so no updates
                    return [null,null]
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
                type: 'LIST',
                identifierFormat: {prefix: 'FO', zeroPadding: 5} 
            },
            "factoryStatus": {
                type: 'HASH',
                values: {
                    "capacity_allocated": 0
                }
            }
        } as StateStoreDefinition,
        fn: async function (/*connection, */state, action, passInSlice) {

            switch (action.type) {
                case 'TIDY_UP':
                    return [[{ failed: false }, [
                        { method: 'RM', path: 'items', filter: { _id: action._id } as { _id: number} }
                    ]]]
                case 'FACTORY_PROCESS':

                    const workItemsReducer = passInSlice as ReducerFunctionWithSlide<FactoryAction>

                    //console.log(`workItemsState=${JSON.stringify(workItemsState)}`)
                    const now = Date.now()
                    let capacity_allocated_update = 0

                    let factory_updates: Array<StateUpdates> = []
                    let workitem_updates: Array<StateUpdates> = []

                    const factoryItems : Array<FactoryItem> = state.getValue('factory', 'items')
                    // check wi in factory_status status look for for completion to free up capacity
                    for (let item of factoryItems.filter(o => o.stage === FactoryStage.Building)  as Array<FactoryItem>) {
                        // all wi in Picking status
                        //const { id, status } = ord
                        const timeleft = (timeToProcess /* * qty */) - (now - (item.starttime as number))

                        if (timeleft > 0) { // not finished, just update progress
                            factory_updates.push({ method: 'UPDATE', path: 'items', filter: { _id: item._id } as { _id: number } , doc: { "$set": {progress: Math.floor(100 - ((timeleft / timeToProcess) * 100.0)) }} })
                        } else { // finished
                            capacity_allocated_update = capacity_allocated_update - (item.allocated_capacity as number)
                            factory_updates.push({ method: 'UPDATE', path: 'items', filter: { _id: item._id } as { _id: number }, doc: { "$set": {stage: FactoryStage.Complete, progress: 100, allocated_capacity: 0 } }})
                            const [[status, complete_updates]] = await workItemsReducer(state, { type: 'STATUS_UPDATE', _id: item.workItem_id, status: { stage: 'FACTORY_COMPLETE' } }) as Array<[ReducerInfo, Array<StateUpdates>]> 
                            workitem_updates = workitem_updates.concat(complete_updates)
                        }
                        //statechanges.push({ kind, metadata: { flow_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    const required_capacity = 1

                    // new WorkItems that are ready for the Factory
                    const {capacity_allocated} = state.getValue("factory", "factoryStatus")
                    const workItems: Array<WorkItemObject> = state.getValue('workItems', 'items')
                    for (let wi of workItems.filter(i => i.status.stage === 'FACTORY_READY') as Array<WorkItemObject>) {
                        const [[{ failed }, accept_updates]] = await workItemsReducer(state, { type: 'STATUS_UPDATE', _id: wi._id, status: { stage: 'FACTORY_ACCEPTED' } }) as Array<[ReducerInfo, Array<StateUpdates>]> 
                        workitem_updates = workitem_updates.concat(accept_updates)

                        if ((factoryCapacity - (capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: 'ADD', path: 'items', doc: { workItem_id: wi._id, stage: FactoryStage.Building, acceptedtime: now, starttime: now, allocated_capacity: required_capacity, progress: 0, waittime: 0 } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // need to wait
                            factory_updates.push({ method: 'ADD', path: 'items', doc: { workItem_id: wi._id, stage: FactoryStage.Waiting, acceptedtime: now, waittime: 0 } })
                        }
                    }

                    // check factory in "waiting" status
                    const factoryItems2 : Array<FactoryItem> = state.getValue('factory', 'items')
                    for (let item of factoryItems2.filter(o => o.stage === FactoryStage.Waiting) as Array<FactoryItem>) {
                        if ((factoryCapacity - (capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: 'UPDATE', path: 'items', filter: { _id: item._id } as { _id: number }, doc: { "$set": {stage: FactoryStage.Building, allocated_capacity: required_capacity, progress: 0, waittime: now - (item.acceptedtime as number) } }})
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // still need to wait
                            factory_updates.push({ method: 'UPDATE', path: 'items', filter: { _id: item._id } as { _id: number }, doc: { "$set": { waittime: now - (item.acceptedtime as number)}} })
                        }
                        //statechanges.push({ kind, metadata: { id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    if (capacity_allocated_update !== 0) {
                        factory_updates.push({ method: 'UPDATE', path: 'factoryStatus',  doc: {  "$set": {capacity_allocated: capacity_allocated + capacity_allocated_update }} })
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
                type: 'COUNTER',
            }
        },
        fn: async function (/*connection,*/ state, action) {

            const { spec, _id, type } = action
            switch (type) {
                case 'RESERVE_INV_SEQ':


                    //if (result && result.insertedId) {
                    return [{ failed: false }, [
                        { method: 'INC', path: 'inventry_sequence' }
                        //{ method: 'ADD', path: 'items', doc: { ...spec, id: 'INV' + String(state.inventry_sequence).padStart(5, '0'), inventry_sequence: state.inventry_sequence } }
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
