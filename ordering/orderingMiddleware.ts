const Emitter = require('events')


interface ProcessingState {
    last_inventory_trigger: any;
    last_order_trigger: any;
    order_processing: Map<string, ProcessorInfo>
}
var processor_state: ProcessingState

function processor_state_apply(state: ProcessingState, val: ProcessorInfo): ProcessingState {
    const ret_state = { ...state, order_processing: new Map(state.order_processing) }
    if (val.processor === ProcessorType.ORDER) {
        if (val.trigger_full) {
            ret_state.last_order_trigger = val.trigger_full
        }
        if (val.complete) {
            ret_state.order_processing.delete(val.trigger_doc_id)
        } else {
            ret_state.order_processing.set(val.trigger_doc_id, val)
        }
    } else if (val.processor === ProcessorType.INVENTORY) {
        ret_state.last_inventory_trigger = val.trigger_full
    }
    return ret_state
}


class Processor extends Emitter {

    constructor(options = {}) {
        super();
        this.context = {};
        this.middleware = [];
    }

    use(fn) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');

        console.log('use %s', fn._name || fn.name || '-');
        this.middleware.push(fn);
        return this;
    }

    callback(inflate = false) {

        function compose(middleware) {

            return function (context, next) {

                // last called middleware #
                let index = -1
                return dispatch(0, null)

                function dispatch(i, change: ChangeEvent) {

                    if (i <= index) return Promise.reject(new Error('next() called multiple times'))

                    index = i
                    let fn = middleware[i]
                    if (i === middleware.length) fn = next

                    // Add processor details for processor hydration & call 'eventfn' to store in log
                    if (context.eventfn && change) {
                        const processor: ProcessorInfo = {
                            processor: ProcessorType.ORDER,
                            trigger_doc_id: context.trigger.documentKey._id.toHexString(),
                            function_idx: i,
                            complete: (!change.nextaction) || !fn
                        }
                        if (i === 1) { // just send full trigger info on completion of 1st middleware
                            processor.trigger_full = context.trigger
                        }

                        processor_state = processor_state_apply(processor_state, processor)

                        // write to event log
                        context.eventfn(context, { ...change, processor })
                    }

                    if ((change && !change.nextaction) || !fn) return Promise.resolve()
                    try {
                        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
                    } catch (err) {
                        return Promise.reject(err)
                    }
                }
            }
        }

        const fn = compose(this.middleware);

        const handleRequest = (doc) => {
            // doc._id == event document includes a resume token as the _id field
            // doc.clusterTime == 
            // doc.opertionType == "insert"
            // doc.ns.coll == "Collection"
            // doc.documentKey == A document that contains the _id of the document created or modified
            console.log('Processor Triggered')
            const ctx = this.createContext(doc)
            return this.handleRequest(ctx, fn);
        }

        return handleRequest
    }

    handleRequest(ctx, fnMiddleware) {
        console.log('handlerequest')
        const handleResponse = () => console.log(`done spec: ${JSON.stringify(ctx.status)}`)
        const onerror = err => console.error(`Any error in the pipeline ends here: ${err}`)
        return fnMiddleware(ctx).then(handleResponse).catch(onerror)
    }

    createContext(doc) {
        // Duplicate The static contexts (tenent, db, etc), into a 'session' ctx
        // Object.create creates a new object, using an existing object as the prototype
        const context = Object.create(this.context);
        context.trigger = doc
        return context
    }

}

const StoreDef = {
    "orders": {
        collection: "orders",
        status: {
            InactiveCart: 5,
            ActiveCart: 10,
            NewOrUpdatedOrder: 30
        }
    },
    "inventory": { collection: "inventory" },
    "business": { collection: "business" },
    "order_events": {
        description: "collection for immutable event log from orderprocessor, when transient state is derrived from material views",
        collection: "order_events"
    }
}

interface OrderingState {
    sequence: number;
    inventory: Map<string, InventoryStatus>;
    orders: Array<OrderObject>;
    picking_capacity: number;
    lastupdated: number;
}

interface OrderObject {
    doc_id: string;
    status: OrderStatus;
}


interface OrderStatus extends DocStatus {
    stage: OrderStage;
    order_number?: string;
    inventory?: any;
    picking?: {
        waittime: number;
        allocated_capacity: number;
        progress: number;
    }
}
enum OrderStage { OrderQueued, OrderNumberGenerated, InventoryAllocated, WaitingPicking, Picking, Shipping, Complete }

interface InventoryStatus {
    onhand: number;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}

// Change Events
interface ChangeEvent {
    statechanges: Array<StateChange>; // Required transational changes to state
    nextaction: boolean; // end of lifecycle?
    sequence?: number; // Set when statechanges are applied to state
    processor?: ProcessorInfo; // Set by processor before applied to log for processor state re-hydration

}
interface ProcessorInfo {
    processor: ProcessorType;
    trigger_doc_id?: string;
    function_idx?: number;
    trigger_full?: object;
    complete?: boolean;
}
enum ProcessorType { ORDER, INVENTORY }

interface StateChange {
    kind: string;
    metadata: {
        type?: ChangeEventType;
        doc_id: string;
    };
    status: OrderStatus | InventoryStatus;
}
enum ChangeEventType {
    CREATE,
    UPDATE,
    DELETE
}


// Perform Action on ordering_state

interface OrderingAction {
    // Order actions
    type: ActionType;
    spec?: any; // used for NewOrUpdatedOrder / NewInventory
    doc_id?: string; // used for all updates
    status?: any; // used for StatusUpdate Actions
    //trigger?: object; // used for NewOrUpdatedOrder / NewInventory
}
enum ActionType { StatusUpdate, NewInventory, NewOrUpdatedOrder, AllocateInventory }

// Store in "https://github.com/Level/level"
// In Memory, volatile state
// Storing large objects in a GC language is questionable, maybe look at rocksdb
var ordering_state: OrderingState

function local_state_op(action: OrderingAction): ChangeEvent {
    const [new_state, change] = ordering_operation(ordering_state, action)
    ordering_state = new_state
    return change
}

// Replace array entry at index 'index' with 'val'
function imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), val, ...array.slice(index + 1)] }

function apply_change_events(state: OrderingState, change: ChangeEvent): [OrderingState, ChangeEvent] {

    if (change.statechanges && change.statechanges.length > 0) {

        let newstate: OrderingState = { ...state, sequence: state.sequence + 1, lastupdated: Date.now() }

        /* Lets move this to the OrderProcessor
        if (change.trigger) {
            const idx = newstate.last_triggers.findIndex(t => t.type === change.trigger.type)
            if (idx < 0) {
                newstate.last_triggers = newstate.last_triggers.concat(change.trigger)
            } else {
                newstate.last_triggers = imm_splice(newstate.last_triggers, idx, change.trigger)
            }
        }
        */

        for (let c of change.statechanges) {
            if (change.sequence && (change.sequence !== newstate.sequence)) {
                throw new Error(`Cannot re-apply change sequence ${change.sequence}, expecting ${newstate.sequence}`)
            }
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
                            throw new Error(`Cannot find existing ${c.kind} with doc_id=${doc_id}`)
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
                            throw new Error(`Cannot find existing ${c.kind} with doc_id=${doc_id}`)
                        }
                        inventory_updates.set(doc_id, new_status)
                    } else if (type === ChangeEventType.CREATE) { // got new Inventory onhand (additive)
                        inventory_updates.set(doc_id, { onhand: existing_sku ? (existing_sku.onhand + new_status.onhand) : new_status.onhand })
                    }
                    newstate.inventory = new Map([...newstate.inventory, ...inventory_updates])
                    break
                default:
                    throw new Error(`Unsupported kind ${c.kind} in local state`)
            }
        }
        return [newstate, { ...change, sequence: newstate.sequence }]
    }
    return [state, change]
}

// Performs the operations against the local state, 
// validate if the requested operation is ok, then generate ChangeEvents and call 'apply_change_events' to apply to local state
function ordering_operation(state: OrderingState, action: OrderingAction): [OrderingState, ChangeEvent] {

    switch (action.type) {

        case ActionType.NewInventory: {
            const { product, qty } = action.spec
            return apply_change_events(state, { /*trigger: { type: action.type, value: action.trigger },*/ nextaction: true, statechanges: [{ kind: "Inventory", metadata: { doc_id: product, type: ChangeEventType.CREATE }, status: { onhand: qty } }] })
        }
        case ActionType.NewOrUpdatedOrder: {
            const { spec } = action

            // Validate order spec
            let new_order_status
            if (spec && spec.items && spec.items.length > 0) {
                new_order_status = { failed: false, stage: OrderStage.OrderQueued }
            } else {
                new_order_status = { failed: true, stage: OrderStage.OrderQueued, message: "Invalid Order - No items" }
            }
            // Needs to be Idempotent
            // TODO: Check if its a new Order or if state already has the Order & what the change is & if we accept the change
            return apply_change_events(state, { /*trigger: { type: action.type, value: action.trigger },*/ nextaction: !new_order_status.failed, statechanges: [{ kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.CREATE }, status: new_order_status }] })
        }
        case ActionType.StatusUpdate: {
            const { spec, status } = action
            // Needs to be Idempotent
            // TODO: Check if state already has Order Number 
            return apply_change_events(state, { nextaction: true, statechanges: [{ kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE }, status: { failed: false, ...status } }] })
        }
        case ActionType.AllocateInventory: {
            // Check aviable Inventory, if any failed, fail the whole order
            const { spec } = action
            let order_status_update: OrderStatus = { failed: false, stage: OrderStage.InventoryAllocated }
            const inventory_updates: Map<string, InventoryStatus> = new Map()

            //let new_inventory = state.inventory
            if (spec.items && spec.items.length > 0) {
                for (let i of spec.items) {
                    if (i.item._id) {
                        const sku = i.item._id.toHexString(),
                            inv = inventory_updates.get(sku) || state.inventory.get(sku)

                        if (!inv || inv.onhand < i.qty) {
                            order_status_update = { ...order_status_update, failed: true, message: `Inventory Allocation Failed ${i.item._id}, onhand ${inv ? inv.onhand : "no inv"}, requested ${i.qty}` }
                            break
                        } else {
                            inventory_updates.set(sku, { onhand: inv.onhand - i.qty })
                        }
                    } else {
                        order_status_update = { ...order_status_update, failed: true, message: `Inventory Allocation Failed, Failed, no Item on order line ${i + 1}` }
                        break
                    }
                }
            } else {
                order_status_update = { ...order_status_update, failed: true, message: `No lineitems on Order` }
            }
            const order_statechange: StateChange = { kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE }, status: order_status_update }
            let inventory_statechanges: Array<StateChange> = []

            if (!order_status_update.failed) {
                inventory_statechanges = Array.from(inventory_updates).map(([sku, inv_obj]): StateChange => {
                    return { kind: "Inventory", metadata: { doc_id: sku, type: ChangeEventType.UPDATE }, status: { onhand: inv_obj.onhand } }
                })
            }
            return apply_change_events(state, { nextaction: !order_status_update.failed, statechanges: [order_statechange].concat(inventory_statechanges) })
        }
        default:
            return [state, null]
    }
}

async function newReadOrder(ctx, next) {
    console.log(`newReadOrder forward, find order id=${ctx.trigger.documentKey._id.toHexString()}, continuation=${ctx.trigger._id}`)

    const find_order = { _id: ctx.trigger.documentKey._id, partition_key: ctx.tenent.email }

    // ctx - 'caches' information in the 'session' that will be required for the middleware operations, but not required in the state
    ctx.spec = await ctx.db.collection(StoreDef["orders"].collection).findOne(find_order)
    // pass in the required data, and perform transational operation on the state
    await next(local_state_op({ type: ActionType.NewOrUpdatedOrder, spec: ctx.spec }))
    console.log('newReadOrder back')
}


async function generateOrderNo(ctx, next) {
    console.log(`generateOrderNo forward, spec: ${JSON.stringify(ctx.trigger)}`)
    const order_seq = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ _id: "order-sequence-stage1", partition_key: ctx.tenent.email }, { $inc: { sequence_value: 1 } }, { upsert: true, returnOriginal: false, returnNewDocument: true })
    const order_number = 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0')
    await next(local_state_op({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.OrderNumberGenerated, order_number: order_number } }))
    console.log('generateOrderNo back')
}

async function allocateInventry(ctx, next) {
    console.log(`allocateInventry forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    await next(local_state_op({ type: ActionType.AllocateInventory, spec: ctx.spec }))
    console.log('allocateInventry back')
}


function picking_control_loop() {

    // check orders in picking status for completion
    // progress & complete

    // look for waiting / new picking & start if capacity
    //
}

async function picking(ctx, next) {

    console.log(`picking forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    //Picking
    ctx.eventfn(ctx, local_state_op({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.WaitingPicking, picking: { waitingtime: 0 } } }))

    await next()
    console.log('picking back')
}

async function shipping(ctx, next) {
    console.log(`shipping forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    await next()
    console.log(`shipping back`)
}



const { MongoClient, ObjectID, ObjectId } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB

import {
    BlobServiceClient,
    StorageSharedKeyCredential,
    BlobDownloadResponseModel
} from "@azure/storage-blob";
import { callbackify } from "util"


////////////////////////////////////////////////////// AZURE STORAGE  //////////////
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
//////////////////////////////////////////////////////////////////////////////////////////


const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
const fs = require('fs')

async function orderCheckpoint_Filesystem(ctx, state_snapshot: OrderingState, processor_snapshop: ProcessingState): Promise<number> {
    const now = new Date()
    const filename = `${chkdir}/${ctx.tenent.email}/${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${('0' + now.getDate()).slice(-2)}-${('0' + now.getHours()).slice(-2)}-${('0' + now.getMinutes()).slice(-2)}-${('0' + now.getSeconds()).slice(-2)}--${state_snapshot.sequence}.json`
    console.log(`writing movement ${filename}`)
    await fs.promises.writeFile(filename, JSON.stringify({
        state_snapshot: { ...state_snapshot, inventory: [...state_snapshot.inventory] },
        processor_snapshop: { ...processor_snapshop, order_processing: [...processor_snapshop.order_processing] }
    }))
    return state_snapshot.sequence
}

async function getLatestOrderingState_Filesystem(ctx): Promise<[OrderingState, ProcessingState]> {
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
            { ...processor_snapshop, processing: new Map(processor_snapshop.processing) }
        ]
    } else {
        console.log(`No checkpoint found, start from 0`)
        return [
            { sequence: 0, lastupdated: null, picking_capacity: 0, inventory: new Map(), orders: [] },
            { last_order_trigger: null, last_inventory_trigger: null, order_processing: new Map() }
        ]
    }
}

async function inflateState_Filesystem(ctx): Promise<[OrderingState, ProcessingState]> {

    try {
        let [ordering_state, processing_state] = await getLatestOrderingState_Filesystem(ctx)
        console.log(`reading order_events from database from seq#=${ordering_state.sequence}`)

        await ctx.db.collection("order_events").createIndex({ sequence: 1 })
        const inflate_events = await ctx.db.collection("order_events").aggregate(
            [
                { $match: { $and: [{ "partition_key": ctx.tenent.email }, { sequence: { $gt: ordering_state.sequence } }] } },
                { $sort: { "sequence": 1 } }
            ]
        ).toArray()

        if (inflate_events && inflate_events.length > 0) {
            console.log(`replaying from seq#=${inflate_events[0].sequence}, to seq#=${inflate_events[inflate_events.length - 1].sequence}  to state`)

            // HOW??? TODO
            for (let i = 0; i < inflate_events.length; i++) {
                const { _id, partition_key, processor, ...change } = inflate_events[i]
                const [new_state] = apply_change_events(ordering_state, change)
                ordering_state = new_state
                if (!processor) {
                    throw new Error(`Error re-hydrating event record seq#=${change.sequence}, no processor info. Exiting...`)
                }
                processing_state = processor_state_apply(processing_state, processor)
            }
        }
        return [ordering_state, processing_state]
    } catch (e) {
        if (e.statusCode === 403) {
            throw new Error('**** its wsl2 date issue dummy')
        } else {
            throw new Error(`Failed to re-hydrate ${e}`)
        }
    }

}

async function order_startup() {
    const murl = new URL(MongoURL)
    console.log(`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string

    const orderProcessor = new Processor()

    orderProcessor.use(newReadOrder)
    orderProcessor.use(generateOrderNo)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)

    const db = orderProcessor.context.db = client.db()

    try {

        orderProcessor.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
        console.log(`order_startup: starting context tenent=${orderProcessor.context.tenent.email}`)

        // Setup action on next()
        orderProcessor.context.eventfn = ws_server_emit

        const [inflated_ordering_state, inflated_processor_state] = await inflateState_Filesystem(orderProcessor.context)

        ordering_state = inflated_ordering_state
        processor_state = inflated_processor_state

        let lastcheckpoint_seq: number = ordering_state.sequence
        console.log(`order_startup: inflated to seq=${ordering_state.sequence}, #orders=${ordering_state.orders.length}, #inv=${ordering_state.inventory.size}`)

        const LOOP_MINS = 1, LOOP_CHANGES = 100
        console.log(`order_startup: starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
        // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
        setInterval(async (ctx) => {
            console.log(`Checkpointing check: seq=${ordering_state.sequence}, #orders=${ordering_state.orders.length}, #inv=${ordering_state.inventory.size}.  Processing size=${processor_state.order_processing.size}`)
            if (ordering_state.sequence > lastcheckpoint_seq + LOOP_CHANGES) {
                console.log(`do checkpoint`)
                lastcheckpoint_seq = await orderCheckpoint_Filesystem(ctx, { ...ordering_state }, { ...processor_state })
            }
        }, 1000 * 60 * LOOP_MINS, orderProcessor.context)


        assert((ordering_state.orders.length === 0) === (!processor_state.last_order_trigger), 'Error, we we have inflated orders, we need a order continuation token')
        console.log(`order_startup:  start watch for new "orders" (startAfter=${processor_state.last_order_trigger && processor_state.last_order_trigger._id})`)
        db.collection(StoreDef["orders"].collection).watch(
            [
                { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": StoreDef["orders"].status.NewOrUpdatedOrder }] } }
                , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
            ],
            { fullDocument: "updateLookup", ...(processor_state.last_order_trigger && { startAfter: processor_state.last_order_trigger._id }) }
            // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
        ).on('change', orderProcessor.callback())



        assert((ordering_state.inventory.size === 0) === (!processor_state.last_inventory_trigger), 'Error, we we have inflated inventry, we need a inventory continuation token')
        console.log(`order_startup:  start watch for new "inventory" (startAfter=${processor_state.last_inventory_trigger && processor_state.last_inventory_trigger._id})`)
        const inventoryAggregationPipeline = [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": "Available" }] } },
            { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
        ]
        var inventoryStreamWatcher = db.collection(StoreDef["inventory"].collection).watch(
            inventoryAggregationPipeline,
            { fullDocument: "updateLookup", ...(processor_state.last_inventory_trigger && { startAfter: processor_state.last_inventory_trigger._id }) }
        )
        inventoryStreamWatcher.on('change', data => {
            //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
            console.log(`inventoryStreamWatcher : ${JSON.stringify(data.fullDocument)}`)
            // spec 
            // _id
            // qty
            // status
            // category
            // product 
            // warehouse

            const change = local_state_op({ type: ActionType.NewInventory, spec: data.fullDocument })
            const processor: ProcessorInfo = {
                processor: ProcessorType.INVENTORY,
                trigger_full: data
            }

            processor_state = processor_state_apply(processor_state, processor)
            ws_server_emit(orderProcessor.context, { ...change, processor })
        })
    } catch (e) {
        console.error(e)
        process.exit(1)
    }
}

//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()
function ws_server_emit(ctx, change: ChangeEvent) {
    //if (factory_updates && factory_updates.length > 0) {
    const res = ctx.db.collection("order_events").insertOne({ partition_key: ctx.tenent.email, ...change })

    console.log(`sending factory updates to ${ws_server_clients.size} clients`)
    for (let [key, ws] of ws_server_clients.entries()) {
        //console.log(`${key}`)
        const { processor, ...changewoprocessor } = change
        ws.send(JSON.stringify({ type: "events", change: changewoprocessor }))
    }
    //}
}

function ws_server_startup() {

    const WebSocket = require('ws'),
        http = require('http'),
        port = process.env.PORT || 9090,
        Koa = require('koa'),
        Router = require('koa-router')

    const app = new Koa()

    // Init Routes
    app.use(new Router({ prefix: '/api' })
        .get('/onhand/:sku', async function (ctx, next) {

            try {
                ctx.body = ordering_state.inventory.get(ctx.params.sku) || {}
                await next()
            } catch (e) {
                ctx.throw(400, `Cannot retreive onhand`)
            }

        })
        .routes())


    const httpServer = http.createServer(app.callback()).listen(port)
    console.log(`listening to port ${port}`)

    // Web Socket Server
    const wss = new WebSocket.Server({
        perMessageDeflate: false,
        server: httpServer
    });

    wss.on('connection', function connection(ws) {

        const client_id = ws_server_clients.size
        ws_server_clients.set(client_id, ws)

        ws.send(JSON.stringify({
            type: "snapshot", state: {
                ...ordering_state,
                // convert Inventry Map into Array of objects
                inventory: Array.from(ordering_state.inventory).map(([sku, val]) => {
                    return { doc_id: sku, status: val }
                })
            }
        }))

        ws.on('close', function close() {
            if (ws_server_clients.has(client_id)) {
                // dont send any more messages
                ws_server_clients.delete(client_id)
                console.log(`disconnected ${client_id}`)
            }
        })
    })
}


ws_server_startup()
order_startup()