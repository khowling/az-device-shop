import assert from 'assert'


export interface OrderObject {
    _id: number;
    spec: any;
    status: OrderStatus;
}

export interface OrderStatus extends DocStatus {
    stage?: OrderStage;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}

export enum OrderStage {
    Draft,
    New,
    InventoryAllocated,
    PickingReady,
    PickingAccepted,
    PickingComplete,
    Shipped,
    Complete
}


import { StateManager, StateUpdates, StateStoreDefinition, StateStoreValueType, UpdatesMethod, ReducerReturnWithSlice, ReducerReturn, ReducerWithPassin, Reducer, ReducerFunction, ReducerFunctionWithSlide } from '@az-device-shop/eventing/state'
import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
export { StateUpdates } from '@az-device-shop/eventing/state'

// Mutate state in a Consistant, Safe, recorded mannore
export interface OrderAction {
    type: OrderActionType;
    _id?: number;
    spec?: any;
    status?: any;
    trigger?: any;
}
export enum OrderActionType {
    OrdersNew,
    StatusUpdate,
    PickingProcess,
    OrdersProcessLineItems,
    Complete,
    InventryNew,
    InventoryAllocate
}


function orderReducer(): ReducerWithPassin<OrderAction> {

    return {
        sliceKey: 'orders',
        passInSlice: 'inventory',
        initState: { 
            "items": {
                type: StateStoreValueType.List,
                identifierFormat: {prefix: 'ORD', zeroPadding: 5}
            }
        } as StateStoreDefinition,
        fn: async function (state, action, passInSlice) {
            const { spec, _id, status } = action
            switch (action.type) {
                case OrderActionType.OrdersNew:
                    const required_props = ['items']
                    const required_items_props = ['productId', 'qty']
                    if (required_props.reduce((a, p) => a && spec.hasOwnProperty(p), true)
                        && Array.isArray(spec.items) && spec.items.length > 0
                        && required_items_props.reduce((a, ip) => a && spec.items.reduce((ia, i) => ia && i.hasOwnProperty(ip), true), true)
                    ) {

                        return [[{ failed: false }, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { spec: action.spec, status: { failed: false, stage: OrderStage.New } } }
                        ]]]
                       
                    } else {
                        return [[{ failed: true }, [
                            { method: UpdatesMethod.Add, path: 'items', doc: { spec: action.spec, status: { failed: true, message: `Require lines items missing. ${required_props.map(i => `"${i}"`).join(',')}`, stage: OrderStage.New } } }
                        ]]]
                    }
                case OrderActionType.StatusUpdate:
                    return [[{ failed: false }, [
                        { method: UpdatesMethod.Update, path: 'items', filter: { _id }, doc: { "$set": { status }} }
                    ]]]
                case OrderActionType.OrdersProcessLineItems:

                    const order = state.getValue('orders', 'items', _id)
                    let order_update: OrderStatus = { failed: false, stage: OrderStage.InventoryAllocated }
                    let inventory_updates: Array<StateUpdates> = []

                    if (order) {
                        const inventoryReducer = passInSlice as ReducerFunction<OrderAction>

                        if (order.spec.items.items && order.spec.items.items.length > 0) {

                            for (let spec of order.spec.items.items) {

                                const [{ failed }, inv_update] = await inventoryReducer(state, { type: OrderActionType.InventoryAllocate, spec })
                                if (!failed) {
                                    inventory_updates = inventory_updates.concat(inv_update)
                                } else {
                                    order_update = { ...order_update, failed: true, message: `Inventory Allocation Failed, Insufficnet stock productId=${spec.productId}` }
                                    break
                                }
                            }
                        } else {
                            order_update = { ...order_update, failed: true, message: `Inventory Allocation Failed, no lineitems` }
                        }
                    } else {
                        order_update = { ...order_update, failed: true, message: `Inventory Allocation Failed, No order found id=${_id}` }
                    }

                    return order_update.failed ?
                        [
                            [{ failed: true }, [{ method: UpdatesMethod.Update, path: 'items', filter: { _id }, doc: { status: order_update } }]]
                        ]
                        :
                        [
                            [{ failed: false }, [{ method: UpdatesMethod.Update, path: 'items', filter: { _id }, doc: { status: order_update } }]],
                            [{ failed: false }, inventory_updates]
                        ]

                default:
                    // action not for this reducer, so no updates
                    return [null, null]
            }
        }
    }
}


export interface PickingItem {
    _id: number;
    order_id: number;
    stage: FactoryStage;
    acceptedtime?: number;
    starttime?: number;
    waittime?: number;
    allocated_capacity?: number;
    progress?: number;
}
export enum FactoryStage { Waiting, Building, Complete }

interface FactoryReducerState {
    items: Array<PickingItem>;
    capacity_allocated: number;
}

function initPickingReducer(timeToProcess = 30 * 1000 /*3 seconds per item*/, pickingCapacity = 5): ReducerWithPassin<OrderAction> {

    return {
        sliceKey: 'picking',
        passInSlice: 'orders',
        initState: { 
            "items": {
                type: StateStoreValueType.List,
                identifierFormat: {prefix: 'PICK', zeroPadding: 5}
            },
            "pickingStatus": {
                type: StateStoreValueType.Hash,
                values: {
                    "capacity_allocated": 0
                }
            }
        } as StateStoreDefinition,
        fn: async function (state, action, passInSlice) {

            switch (action.type) {
                case OrderActionType.PickingProcess:

                    const orderReducer = passInSlice as ReducerFunctionWithSlide<OrderAction>

                    //console.log(`orderState=${JSON.stringify(orderState)}`)
                    const now = Date.now()
                    let capacity_allocated_update = 0

                    let factory_updates: Array<StateUpdates> = []
                    let order_updates: Array<StateUpdates> = []

                    // check order in factory_status status look for for completion to free up capacity
                    for (let item of state.getValue('picking', 'items').filter(o => o.stage === FactoryStage.Building) as Array<PickingItem>) {
                        // all order in Picking status
                        //const { id, status } = ord
                        const timeleft = (timeToProcess /* * qty */) - (now - item.starttime)

                        if (timeleft > 0) { // not finished, just update progress
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { progress: Math.floor(100 - ((timeleft / timeToProcess) * 100.0)) } })
                        } else { // finished
                            capacity_allocated_update = capacity_allocated_update - item.allocated_capacity
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { stage: FactoryStage.Complete, progress: 100, allocated_capacity: 0 } })
                            const [[status, complete_updates]] = await orderReducer(state, { type: OrderActionType.StatusUpdate, _id: item.order_id, status: { stage: OrderStage.PickingComplete } })
                            order_updates = order_updates.concat(complete_updates)
                        }
                        //statechanges.push({ kind, metadata: { flow_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    const required_capacity = 1

                    // new orders that are ready for the Factory
                    const {capacity_allocated} = state.getValue("factory", "pickingStatus")
                    for (let order of state.getValue('orders', 'items').filter(i => i.status.stage === OrderStage.PickingReady) as Array<OrderObject>) {
                        const [[{ failed }, accept_updates]] = await orderReducer(state, { type: OrderActionType.StatusUpdate, _id: order._id, status: { stage: OrderStage.PickingAccepted } })
                        order_updates = order_updates.concat(accept_updates)

                        if ((pickingCapacity - (capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: UpdatesMethod.Add, path: 'items', doc: { order_id: order._id, stage: FactoryStage.Building, acceptedtime: now, starttime: now, allocated_capacity: required_capacity, progress: 0, waittime: 0 } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // need to wait
                            factory_updates.push({ method: UpdatesMethod.Add, path: 'items', doc: { order_id: order._id, stage: FactoryStage.Waiting, acceptedtime: now, waittime: 0 } })
                        }
                    }

                    // check order in "waiting" status
                    for (let item of state.getValue('picking', 'items').filter(o => o.stage === FactoryStage.Waiting)  as Array<PickingItem>) {
                        if ((pickingCapacity - (capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                            // we have capacity, move to inprogress
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { stage: FactoryStage.Building, allocated_capacity: required_capacity, progress: 0, waittime: now - item.acceptedtime } })
                            capacity_allocated_update = capacity_allocated_update + required_capacity
                        } else {
                            // still need to wait
                            factory_updates.push({ method: UpdatesMethod.Update, path: 'items', filter: { _id: item._id }, doc: { waittime: now - item.acceptedtime } })
                        }
                        //statechanges.push({ kind, metadata: { id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                    }

                    if (capacity_allocated_update !== 0) {
                        factory_updates.push({ method: UpdatesMethod.Update, path: 'pickingStatus', doc: { "$set": { capacity_allocated: capacity_allocated + capacity_allocated_update} } })
                    }

                    return [factory_updates.length > 0 ? [{ failed: false }, factory_updates] : null, order_updates.length > 0 ? [{ failed: false }, order_updates] : null] as ReducerReturnWithSlice

                default:
                    // action not for this reducer, so no updates
                    return [null, null]
            }
        }
    }
}


export interface InventoryItem {
    _id: number;
    productId: string;
    qty: number;
    warehouse: string;
}

interface InventoryReducerState {
    onhand: Array<InventoryItem>;
    last_incoming_processed: {
        sequence: number;
        continuation: any;
    }
}

function inventryReducer(): Reducer<OrderAction> {

    return {
        sliceKey: 'inventory',
        initState: { 
            "onhand": { // InventoryItem
                type: StateStoreValueType.List,
            }, 
            "last_incoming_processed": {
                type: StateStoreValueType.Hash,
                values: { 
                    sequence: 0, 
                    continuation: null 
                } 
            } 
        } as StateStoreDefinition,
        fn: async function (state, action) {

            const { spec, _id, type } = action
            switch (type) {
                case OrderActionType.InventryNew: {
                    const { productId, qty } = spec

                    let inventory_updates: Array<StateUpdates> = []
                    if (action.trigger) {

                        const last_incoming_processed = state.getValue('inventory', 'last_incoming_processed')
                        // require trigger sequence
                        assert(Number.isInteger(action.trigger.sequence) && action.trigger.sequence === last_incoming_processed.sequence + 1, `inventryReducer, cannot apply incoming new trigger.sequence=${action.trigger.sequence}, last_incoming_processed=${last_incoming_processed.sequence}`)
                        inventory_updates.push({ method: UpdatesMethod.Inc, path: 'last_incoming_processed' })

                        if (action.trigger.continuation) {
                            inventory_updates.push({ method: UpdatesMethod.Update, path: 'last_incoming_processed', doc: { "$set": {continuation: action.trigger.continuation }} })
                        }
                    }
                    const existing_product = state.getValue('inventory', 'onhand').find(i => i.productId === productId) as InventoryItem
                    if (existing_product) {
                        return [{ failed: false }, inventory_updates.concat({ method: UpdatesMethod.Update, path: 'onhand', filter: { _id: existing_product._id }, doc: { "$set": { qty: qty + existing_product.qty} } })]
                    } else {
                        return [{ failed: false }, inventory_updates.concat({ method: UpdatesMethod.Add, path: 'onhand', doc: spec })]
                    }
                }
                case OrderActionType.InventoryAllocate: {
                    const { productId, qty } = spec
                    const existing_product = state.getValue('inventory', 'onhand').findIndex(i => i.productId === productId) as InventoryItem
                    if (existing_product) {
                        if (existing_product.qty >= qty) {
                            return [{ failed: false }, [
                                { method: UpdatesMethod.Update, path: 'onhand', filter: { _id: existing_product._id }, doc: { "$set": { qty: existing_product.qty - qty} } }
                            ]]
                        } else {
                            return [{ failed: true }, null]
                        }
                    } else {
                        return [{ failed: true }, null]
                    }
                }
                default:
                    // action not for this reducer, so no updates
                    return null
            }

        }
    }
}

export class OrderStateManager extends StateManager<OrderAction> {

    constructor(name: string, connection: EventStoreConnection) {
        super(name, connection, [
            orderReducer(),
            initPickingReducer(),
            inventryReducer()
        ])
    }
}
