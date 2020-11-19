import { Processor } from './processor'

export interface OrderingState {
    sequence: number;
    inventory: Map<string, InventoryStatus>;
    orders: Array<OrderObject>;
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

export interface PickingStatus {
    allocated_update: number;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}


////
// Change Events
export interface ChangeEvent {
    statechanges: Array<StateChange>; // Required transational changes to state
    nextaction: boolean; // end of lifecycle?
    sequence?: number; // Set when statechanges are applied to state
    processor?: any; // {
    //    [processor name]: ProcessorInfo | Custom
    // }

}

export interface StateChange {
    kind: string;
    metadata: {
        type: ChangeEventType;
        doc_id?: string;
    };
    status: OrderStatus | InventoryStatus | PickingStatus;
}
export enum ChangeEventType {
    CREATE,
    UPDATE,
    DELETE
}

// Replace array entry at index 'index' with 'val'
function imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), val, ...array.slice(index + 1)] }

export function apply_change_events(state: OrderingState, change: ChangeEvent): [OrderingState, ChangeEvent] {

    if (change.statechanges && change.statechanges.length > 0) {

        let newstate: OrderingState = { ...state, sequence: state.sequence + 1, lastupdated: Date.now() }

        if (change.sequence && (change.sequence !== newstate.sequence)) {
            throw new Error(`apply_change_events, Cannot re-apply change sequence ${change.sequence}, expecting ${newstate.sequence}`)
        }

        for (let c of change.statechanges) {

            const { doc_id, type } = c.metadata
            switch (c.kind) {
                case "Order":
                    if (type === ChangeEventType.UPDATE) {
                        const order_idx = doc_id ? newstate.orders.findIndex(o => o.doc_id === doc_id) : -1
                        if (order_idx >= 0) {
                            const existing_order = newstate.orders[order_idx]
                            const new_order = { ...existing_order, status: { ...existing_order.status, ...c.status } }
                            newstate.orders = imm_splice(newstate.orders, order_idx, new_order)
                        } else {
                            throw new Error(`apply_change_events, Cannot find existing ${c.kind} with doc_id=${doc_id}`)
                        }
                    } else if (type === ChangeEventType.CREATE) {
                        // using typescript "type assertion"
                        // https://www.typescriptlang.org/docs/handbook/advanced-types.html#type-guards-and-differentiating-types
                        newstate.orders = newstate.orders.concat([{ doc_id, status: c.status as OrderStatus }])
                    }
                    break
                case "Inventory":
                    const inventory_updates: Map<string, InventoryStatus> = new Map()
                    const new_status = c.status as InventoryStatus
                    const existing_sku: InventoryStatus = newstate.inventory.get(doc_id)

                    if (type === ChangeEventType.UPDATE) { // // got new Onhand value (replace)
                        if (!existing_sku) {
                            throw new Error(`apply_change_events, Cannot find existing ${c.kind} with doc_id=${doc_id}`)
                        }
                        inventory_updates.set(doc_id, new_status)
                    } else if (type === ChangeEventType.CREATE) { // got new Inventory onhand (additive)
                        inventory_updates.set(doc_id, { onhand: existing_sku ? (existing_sku.onhand + new_status.onhand) : new_status.onhand })
                    }
                    newstate.inventory = new Map([...newstate.inventory, ...inventory_updates])
                    break
                case "Picking":
                    if (type === ChangeEventType.UPDATE) { // // got new Onhand value (replace)
                        const { allocated_update } = c.status as PickingStatus
                        newstate.picking_allocated = newstate.picking_allocated + allocated_update
                    } else {
                        throw new Error(`apply_change_events, only support updates on ${c.kind}`)
                    }
                    break
                default:
                    throw new Error(`apply_change_events, Unsupported kind ${c.kind} in local state`)
            }
        }
        return [newstate, { ...change, sequence: newstate.sequence }]
    }
    return [state, change]
}


/* ////////////////////////////////////////////////////// AZURE STORAGE  //////////////
import {
    BlobServiceClient,
    StorageSharedKeyCredential,
    BlobDownloadResponseModel
} from "@azure/storage-blob";
import { callbackify } from "util"

function getBlobClient() {
    console.log(`looking for saved starting point ${process.env.STORAGE_ACCOUNT}`)
    const sharedKeyCredential = new StorageSharedKeyCredential(process.env.STORAGE_ACCOUNT, process.env.STORAGE_MASTER_KEY)
    const blobServiceClient = new BlobServiceClient(`https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`, sharedKeyCredential)
    const containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER)

    //const createContainerResponse = await containerClient.create();
    console.log(`Create container ${process.env.STORAGE_CONTAINER} successfully`);
    const blobClient = containerClient.getBlockBlobClient(process.env.STORAGE_CHECKPOINT_FILE);
    return blobClient
}
async function getLatestOrderingState_AzureBlob(ctx) {

    const blobClient = getBlobClient()
    try {
        let res1: Buffer = await blobClient.downloadToBuffer()
        ordering_state = JSON.parse(res1.toString())
    } catch (e) {
        console.error(e)
    }
}

async function orderCheckpoint_AzureBlob(ctx) {
    // Create a blob
    const blobClient = getBlobClient()

    const content = "hello";
    const uploadBlobResponse = await blobClient.upload(content, Buffer.byteLength(content));
    console.log(`Upload block blob successfully`, uploadBlobResponse.requestId);

}
*/ //////////////////////////////////////////////////////////////////////////////////////////


const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
const fs = require('fs')
// last inventory item processed


export async function orderCheckpoint_Filesystem(ctx, state_snapshot: OrderingState, processor_snapshop: any, last_inventory_trigger: any): Promise<number> {
    const now = new Date()
    const filename = `${chkdir}/${ctx.tenent.email}/${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${('0' + now.getDate()).slice(-2)}-${('0' + now.getHours()).slice(-2)}-${('0' + now.getMinutes()).slice(-2)}-${('0' + now.getSeconds()).slice(-2)}--${state_snapshot.sequence}.json`
    console.log(`writing movement ${filename}`)
    await fs.promises.writeFile(filename, JSON.stringify({
        state_snapshot: { ...state_snapshot, inventory: [...state_snapshot.inventory] },
        processor_snapshop: {
            [ctx.processor]: processor_snapshop,
            inventory: last_inventory_trigger
        }
    }))
    return state_snapshot.sequence
}

async function getLatestOrderingState_Filesystem(ctx): Promise<[OrderingState, any]> {
    const dir = `${chkdir}/${ctx.tenent.email}`
    await fs.promises.mkdir(dir, { recursive: true })
    let latestfile = { fileseq: null, filedate: null, filename: null }
    const checkpoints = await fs.promises.readdir(dir)
    const filename_re = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})-(\\d{2})-(\\d{2})-(\\d).json`)
    for (let dir_entry of checkpoints) {
        const entry_match = dir_entry.match(filename_re)
        if (entry_match) {
            const [filename, year, month, day, hour, minute, second, fileseq] = entry_match

            if (latestfile.fileseq === null || latestfile.fileseq < fileseq) {
                latestfile = { fileseq, filedate: new Date(year, month - 1, day, hour, minute, second), filename }
            }
        }
    }
    if (latestfile.filename) {
        console.log(`Loading checkpoint seq#=${latestfile.fileseq} from=${latestfile.filename}`)
        const { state_snapshot, processor_snapshop } = await JSON.parse(fs.promises.readFile(dir + '/' + latestfile.filename, 'UTF-8'))
        return [
            { ...state_snapshot, inventory: new Map(state_snapshot.inventory) },
            { [ctx.processor]: Processor.deserializeState(processor_snapshop[ctx.processor]), inventory: processor_snapshop.inventory }
        ]
    } else {
        console.log(`No checkpoint found, start from 0`)
        return [
            { sequence: 0, lastupdated: null, picking_allocated: 0, inventory: new Map(), orders: [] },
            { [ctx.processor]: Processor.deserializeState(), inventory: null }
        ]
    }
}

export async function inflateState_Filesystem(ctx): Promise<[OrderingState, any]> {

    try {
        let [ordering_state, required_processor_state] = await getLatestOrderingState_Filesystem(ctx)
        console.log(`inflateState_Filesystem: reading order_events from database from seq#=${ordering_state.sequence}`)

        await ctx.db.collection("order_events").createIndex({ sequence: 1 })
        const inflate_events = await ctx.db.collection("order_events").aggregate(
            [
                { $match: { $and: [{ "partition_key": ctx.tenent.email }, { sequence: { $gt: ordering_state.sequence } }] } },
                { $sort: { "sequence": 1 } }
            ]
        ).toArray()

        if (inflate_events && inflate_events.length > 0) {
            console.log(`inflateState_Filesystem: replaying from seq#=${inflate_events[0].sequence}, to seq#=${inflate_events[inflate_events.length - 1].sequence}  to state`)

            // HOW??? TODO
            for (let i = 0; i < inflate_events.length; i++) {
                const { _id, partition_key, processor, ...change } = inflate_events[i]
                const [new_state] = apply_change_events(ordering_state, change)
                ordering_state = new_state
                if (!processor) {
                    // its find to have a ordering state change that is not controlled by the processor (ie picking)
                    //throw new Error(`Error re-hydrating event record seq#=${change.sequence}, no processor info. Exiting...`)
                } else {
                    if (processor[ctx.processor]) {
                        required_processor_state[ctx.processor] = Processor.processor_state_apply(required_processor_state[ctx.processor], processor[ctx.processor])
                    }
                    if (processor.inventory) {
                        required_processor_state["inventory"] = processor.inventory
                    }

                }
            }
        }
        return [ordering_state, required_processor_state]
    } catch (e) {
        if (e.statusCode === 403) {
            throw new Error('**** its wsl2 date issue dummy')
        } else {
            throw new Error(`Failed to re-hydrate ${e}`)
        }
    }

}
