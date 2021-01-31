const assert = require('assert')


export interface OrderObject {
    id: string;
    spec: any;
    status: OrderStatus;
}

export interface OrderStatus extends DocStatus {
    stage?: OrderStage;

    // Factory status
    orderId?: string;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}

export enum OrderStage {
    Draft,// = "Draft",
    New,// = "New",
    InventoryAllocated,// = "Validated",
    PickingReady,// = "PickingReady",
    PickingAccepted,
    PickingComplete,// = "PickingComplete",
    Shipped,// = "Shipped",
    Complete// = "Complete",
}


import { StateManager, StateUpdates, UpdatesMethod, ReducerReturnWithSlice, ReducerReturn } from '../util/flux'
export { StateUpdates } from '../util/flux'

// Mutate state in a Consistant, Safe, recorded mannore
export interface OrderAction {
    type: OrderActionType;
    id?: string;
    spec?: any;
    status?: any;
}
export enum OrderActionType {
    New = 'orders/New',
    InventryNew = 'inventry/New',
    StatusUpdate = 'orders/StatusUpdate',
    PickingProcess = 'orders/PickingProcess',
    AllocateInventory = 'orders/AllocateInventory',
    Complete = 'orders/Complete'
}

interface OrderReducerState {
    items: Array<OrderObject>;
    order_sequence: number;
}


function orderReducer(state: OrderReducerState = { items: [], order_sequence: 0 }, action: OrderAction, passInSlice): ReducerReturnWithSlice | OrderReducerState {

    if (action) {
        const { spec, id, status } = action
        switch (action.type) {
            case 'orders/New':
                const required_props = ['items']
                if (required_props.reduce((a, v) => a && spec.hasOwnProperty(v), true) && Array.isArray(spec.items) && spec.items.length > 0) {
                    if (state.items.findIndex(w => w.id === id) < 0) {
                        return [[false, [
                            { method: UpdatesMethod.Inc, doc: { order_sequence: 1 } },
                            { method: UpdatesMethod.Add, path: 'items', doc: { id, spec: action.spec, status: { failed: false, orderId: 'ORD' + String(state.order_sequence).padStart(5, '0'), stage: OrderStage.New } } }
                        ]]]
                    } else {
                        return [[true, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { id: `${id}-dup`, spec: action.spec, status: { failed: true, message: `Adding order with "id" that already exists id=${id}`, stage: OrderStage.New } } }
                        ]]]
                    }
                } else {
                    return [[true, [
                        { method: UpdatesMethod.Add, path: 'items', doc: { id, spec: action.spec, status: { failed: true, message: `Require lines items missing. ${required_props.map(i => `"${i}"`).join(',')}`, stage: OrderStage.New } } }
                    ]]]
                }
            case 'orders/StatusUpdate':
                return [[false, [
                    { method: UpdatesMethod.Merge, path: 'items', filter: { id }, doc: { status } }
                ]]]
            case 'orders/AllocateInventory':

                const idx = state.items.findIndex(w => w.id === id)
                let order_update: OrderStatus = { failed: false, stage: OrderStage.InventoryAllocated }
                let inventory_updates: Array<StateUpdates> = []

                if (idx >= 0) {
                    const order_spec = state.items[idx].spec
                    const [inventoryState, inventoryReducer] = passInSlice

                    if (order_spec.items && order_spec.items.length > 0) {

                        for (let i of order_spec.items) {
                            if (i.item._id) {
                                const
                                    sku = i.item._id.toHexString(),
                                    required_qty = i.qty

                                const [inv_failed, inv_update] = inventoryReducer(inventoryState, { type: OrderActionType.AllocateInventory, spec: { sku, required_qty } })
                                if (!inv_failed) {
                                    inventory_updates = inventory_updates.concat(inv_update)
                                } else {
                                    order_update = { ...order_update, failed: true, message: `Inventory Allocation Failed, Insufficnet stock sku=${sku}` }
                                    break
                                }
                            } else {
                                order_update = { ...order_update, failed: true, message: `Inventory Allocation Failed, Malformed lineitem` }
                                break
                            }
                        }
                    } else {
                        order_update = { ...order_update, failed: true, message: `Inventory Allocation Failed, no lineitems` }
                    }
                } else {
                    order_update = { ...order_update, failed: true, message: `Inventory Allocation Failed, No order found id=${id}` }
                }

                return order_update.failed ?
                    [
                        [true, [{ method: UpdatesMethod.Merge, path: 'items', filter: { id }, doc: { status: order_update } }]]
                    ]
                    :
                    [
                        [false, [{ method: UpdatesMethod.Merge, path: 'items', filter: { id }, doc: { status: order_update } }]],
                        [false, inventory_updates]
                    ]

            default:
                // action not for this reducer, so no updates
                return [null, null]
        }
    } else {
        // is no 'action' return state (used to allow reducer to initialise its own state slice)
        return state
    }
}


export interface PickingItem {
    id: number;
    stage: FactoryStage;
    acceptedtime?: number;
    starttime?: number;
    waittime?: number;
    allocated_capacity?: number;
    progress?: number;
}
export enum FactoryStage { Waiting, Building, Complete }

function initFactoryReducer(timeToProcess = 30 * 1000 /*3 seconds per item*/, pickingCapacity = 5) {

    return function (state: { items: Array<PickingItem>, capacity_allocated: number } = { items: [], capacity_allocated: 0 }, action: OrderAction, passInSlice) {

        if (action) {
            switch (action.type) {
                case OrderActionType.PickingProcess:

                    const [orderState, orderReducer] = passInSlice
                    //console.log(`orderState=${JSON.stringify(orderState)}`)
                    const now = Date.now()
                    let capacity_allocated_update = 0

                    let factory_updates = []
                    let order_updates = []

                    // check wi in factory_status status look for for completion to free up capacity
                    for (let item of state.items.filter(o => o.stage === FactoryStage.Building)) {
                        // all wi in Picking status
                        //const { id, status } = ord
                        const timeleft = (timeToProcess /* * qty */) - (now - item.starttime)

                        if (timeleft > 0) { // not finished, just update progress
                            factory_updates.push({ method: 'update', path: 'items', filter: { id: item.id }, doc: { progress: Math.floor(100 - ((timeleft / timeToProcess) * 100.0)) } })
                        } else { // finished
                            capacity_allocated_update = capacity_allocated_update - item.allocated_capacity
                            factory_updates.push({ method: 'update', path: 'items', filter: { id: item.id }, doc: { stage: FactoryStage.Complete, progress: 100, allocated_capacity: 0 } })
                            const [[complete_failed, complete_updates]] = orderReducer(orderState, { type: 'orders/StatusUpdate', id: item.id, status: { stage: OrderStage.PickingComplete } })
                            order_updates = order_updates.concat(complete_updates)
                        }
                        //statechanges.push({ kind, metadata: { flow_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    const required_capacity = 1

                    // new orders that are ready for the Factory
                    for (let wi of orderState.items.filter(i => i.status.stage === OrderStage.PickingReady)) {
                        const [[accept_failed, accept_updates]] = orderReducer(orderState, { type: 'orders/StatusUpdate', id: wi.id, status: { stage: OrderStage.PickingAccepted } })
                        order_updates = order_updates.concat(accept_updates)

                        if ((pickingCapacity - (state.capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: 'add', path: 'items', doc: { id: wi.id, stage: FactoryStage.Building, acceptedtime: now, starttime: now, allocated_capacity: required_capacity, progress: 0, waittime: 0 } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // need to wait
                            factory_updates.push({ method: 'add', path: 'items', doc: { id: wi.id, stage: FactoryStage.Waiting, acceptedtime: now, waittime: 0 } })
                        }
                    }

                    // check wi in "waiting" status
                    for (let item of state.items.filter(o => o.stage === FactoryStage.Waiting)) {
                        if ((pickingCapacity - (state.capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: 'update', path: 'items', filter: { id: item.id }, doc: { stage: FactoryStage.Building, allocated_capacity: required_capacity, progress: 0, waittime: now - item.acceptedtime } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // still need to wait
                            factory_updates.push({ method: 'update', path: 'items', filter: { id: item.id }, doc: { waittime: now - item.acceptedtime } })
                        }
                        //statechanges.push({ kind, metadata: { id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    if (capacity_allocated_update !== 0) {
                        factory_updates.push({ method: "inc", doc: { capacity_allocated: capacity_allocated_update } })
                    }

                    return [factory_updates.length > 0 ? [false, factory_updates] : null, order_updates.length > 0 ? [false, order_updates] : null]

                default:
                    // action not for this reducer, so no updates
                    return [null, null]
            }
        } else {
            // is no 'action' return state (used to allow reducer to initialise its own state slice)
            return state
        }
    }
}


export interface InventoryItem {
    qty: number;
    product: string;
    warehouse: string;
}



function inventryReducer(state: Array<InventoryItem> = [], action: OrderAction): ReducerReturn | Array<InventoryItem> {
    if (action) {
        const { spec, id, type } = action
        switch (type) {
            case OrderActionType.InventryNew:
                const { product, qty, warehouse } = spec
                const existing_idx = state.findIndex(i => i.product === product)
                if (existing_idx >= 0) {
                    return [false, [
                        { method: UpdatesMethod.Inc, filter: { product }, doc: { qty } }
                    ]]
                } else {
                    return [false, [
                        { method: UpdatesMethod.Add, doc: spec }
                    ]]
                }
                break
            case OrderActionType.AllocateInventory:
                const { sku, required_qty } = spec
                const sku_idx = state.findIndex(i => i.product === sku)
                if (sku_idx >= 0) {
                    if (state[sku_idx].qty >= required_qty) {
                        return [false, [
                            { method: UpdatesMethod.Inc, filter: { product: sku }, doc: { qty: -required_qty } }
                        ]]
                    } else {
                        return [true, null]
                    }
                } else {
                    return [true, null]
                }

            default:
                // action not for this reducer, so no updates
                return null
        }
    } else {
        // is no 'action' return state (used to allow reducer to initialise its own state slice)
        return state
    }
}

export class OrderStateManager extends StateManager {

    constructor(opts: any = {}) {
        super({
            stateMutex: opts.stateMutex,
            commitEventsFn: opts.commitEventsFn,
            reducers: {
                orders: { passInSlice: 'inventory', reducerFn: orderReducer }
                , picking: { passInSlice: 'orders', reducerFn: initFactoryReducer() }
                , inventory: { reducerFn: inventryReducer }
            }
        })
    }
}
