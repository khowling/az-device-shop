const assert = require('assert')


export interface OrderingState {
    ordering_sequence: number;
    inventory: Map<string, InventoryStatus>;
    orders: Array<OrderObject>;
    order_sequence: number;
    picking_allocated: number;
    lastupdated: number;
}

export interface OrderObject {
    doc_id: string;
    status: OrderStatus;
}


export interface OrderStatus extends DocStatus {
    stage?: OrderStage;
    order_number?: string;
    inventory?: any;
    picking?: {
        status: PickingStage;
        starttime: number;
        waittime: number;
        allocated_capacity: number;
        progress: number;
    }
}
export enum OrderStage { OrderQueued, OrderNumberGenerated, InventoryAllocated, Picking, PickingComplete, Shipped, Complete }
export enum PickingStage { Waiting, Picking, Complete }

export interface InventoryStatus {
    onhand: number;
}

export interface OrderingUpdate {
    allocated_update?: number;
    sequence_update?: number;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}


/*
// Change Events
export interface ChangeEvent {
    statechanges: Array<StateChange>; // Required transational changes to state
    nextaction: boolean; // end of lifecycle?
    sequence?: number; // Set when statechanges are applied to state
    processor?: any; // {
    //    [processor name]: ProcessorInfo | Custom
    // }

}
*/

export interface StateChange {
    kind: string;
    metadata: {
        type: ChangeEventType;
        doc_id?: string;
        next_sequence: number;
    };
    status: OrderStatus | InventoryStatus | OrderingUpdate;
}
export enum ChangeEventType {
    CREATE,
    UPDATE,
    DELETE,
    INC
}


export class OrderStateManager {

    _state = { ordering_sequence: 0, lastupdated: null, picking_allocated: 0, inventory: new Map(), order_sequence: 0, orders: [] }

    constructor(opts: any = {}) {
    }

    get state() {
        return this._state;
    }

    set state(newstate: OrderingState) {
        this._state = newstate
    }

    get serializeState() {
        return { ...this._state, inventory: [...this._state.inventory] }
    }

    static deserializeState(newstate): OrderingState {
        if (newstate) {
            return { ...newstate, inventory: new Map(newstate.inventory) }
        } else {
            return { ordering_sequence: 0, lastupdated: null, picking_allocated: 0, inventory: new Map(), order_sequence: 0, orders: [] }
        }
    }

    // Replace array entry at index 'index' with 'val'
    static imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), val, ...array.slice(index + 1)] }

    apply_change_events(statechanges: Array<StateChange>): [boolean, Array<StateChange>] {

        assert(statechanges && statechanges.length > 0, "No changes provided")

        let newstate: OrderingState = { ...this.state, ordering_sequence: this.state.ordering_sequence + 1, lastupdated: Date.now() }
        let contains_failed = false

        for (let { kind, metadata, status } of statechanges) {

            assert(metadata.next_sequence && metadata.next_sequence === newstate.ordering_sequence, `apply_change_events, Cannot apply change sequence ${metadata.next_sequence}, expecting ${newstate.ordering_sequence}`)

            switch (kind) {
                case "Order": {
                    const { doc_id, type } = metadata
                    const new_status = status as OrderStatus

                    if (new_status.failed) { contains_failed = true }
                    if (type === ChangeEventType.UPDATE) {
                        const order_idx = doc_id ? newstate.orders.findIndex(o => o.doc_id === doc_id) : -1
                        if (order_idx >= 0) {
                            const existing_order = newstate.orders[order_idx]
                            const new_order = { ...existing_order, status: { ...existing_order.status, ...new_status } }
                            newstate.orders = OrderStateManager.imm_splice(newstate.orders, order_idx, new_order)
                        } else {
                            throw new Error(`apply_change_events, Cannot find existing ${kind} with doc_id=${doc_id}`)
                        }
                    } else if (type === ChangeEventType.CREATE) {
                        // using typescript "type assertion"
                        // https://www.typescriptlang.org/docs/handbook/advanced-types.html#type-guards-and-differentiating-types
                        newstate.orders = newstate.orders.concat([{ doc_id, status: new_status }])
                    }
                    break
                }
                case "Inventory": {
                    const { doc_id, type } = metadata
                    const new_status = status as InventoryStatus

                    const inventory_updates: Map<string, InventoryStatus> = new Map()
                    const existing_sku: InventoryStatus = newstate.inventory.get(doc_id)

                    if (type === ChangeEventType.UPDATE) { // // got new Onhand value (replace)
                        if (!existing_sku) {
                            throw new Error(`apply_change_events, Cannot find existing ${kind} with doc_id=${doc_id}`)
                        }
                        inventory_updates.set(doc_id, new_status)
                    } else if (type === ChangeEventType.CREATE) { // got new Inventory onhand (additive)
                        inventory_updates.set(doc_id, { onhand: existing_sku ? (existing_sku.onhand + new_status.onhand) : new_status.onhand })
                    }
                    newstate.inventory = new Map([...newstate.inventory, ...inventory_updates])
                    break
                }
                case "OrderingUpdate": {
                    const { type } = metadata
                    const new_status = status as OrderingUpdate

                    if (new_status.sequence_update && type === ChangeEventType.INC) {
                        newstate.order_sequence = newstate.order_sequence + new_status.sequence_update
                    } else if (new_status.allocated_update && type === ChangeEventType.UPDATE) { // // got new Onhand value (replace)
                        newstate.picking_allocated = newstate.picking_allocated + new_status.allocated_update
                    } else {
                        throw new Error(`apply_change_events, Unsupported OrderingUpdate`)
                    }
                    break
                }
                default:
                    throw new Error(`apply_change_events, Unsupported kind ${kind} in local state`)
            }
        }
        this._state = newstate
        return [contains_failed, statechanges]
    }
}

