const Emitter = require('events')
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

                function dispatch(i, changes: Array<ChangeEvent>) {
                    if (context.eventfn && changes && changes.length > 0) {
                        context.eventfn(context, changes)
                        if (changes[0].status.failed) return Promise.reject(changes[0].status.message)
                    }
                    if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                    index = i
                    let fn = middleware[i]
                    if (i === middleware.length) fn = next
                    if (!fn) return Promise.resolve()
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
            NewOrder: 30
        }
    },
    "inventory": { collection: "inventory" },
    "business": { collection: "business" },
    "events": {
        description: "collection for immutable event log, when transient state is derrived from material views",
        collection: "events"
    }
}


interface OrderingState {
    sequence: number;
    inventory: Map<string, InventoryObject>;
    orders: Array<OrderObject>;
    picking_capacity: number;
    lastupdated: number;
}


interface OrderObject {
    spec: any; // What state you desire for the object
    metadata: {
        doc_id: string;
    };
    status: OrderStatus;
}

interface OrderStatus extends DocStatus {
    stage: OrderStage;
    starttime?: number;

    order_number?: string;
    inventory?: any;

    last_update?: number;
    waittime?: number;
    allocated_capacity?: number;
    progress?: number;
}

enum OrderStage { NewRequiredOrder, InventoryAllocated, OrderNumberGenerated, WaitingPicking, Picking, Shipping, Complete }


type InventoryObject = {
    onhand: number;
    category: string;
}


enum InventoryStage { NewInventory }


// Change Events

interface ChangeEvent {
    kind: string;
    metadata: {
        type?: ChangeEventType;
        sequence: number;
        doc_id: string;
    };
    status: OrderStatus | InventoryStatus;
}
enum ChangeEventType {
    CREATE,
    UPDATE,
    DELETE
}
interface InventoryStatus extends DocStatus {
    stage: InventoryStage;
    onhand: number;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}


// Perform Action on ordering_state

interface OrderingAction {

    // Order actions
    type: ActionType;
    spec?: any; // full doc used for NewOrder / New Inventory
    doc_id?: string; // used for all updates
    data?: any;
}
enum ActionType { NewInventory, NewOrder, AllocateNumber, AllocateInventory }

// Store in "https://github.com/Level/level"
// In Memory, volatile state
// Storing large objects in a GC language is questionable, maybe look at rocksdb
var ordering_state: OrderingState = { sequence: 0, lastupdated: Date.now(), picking_capacity: 0, inventory: new Map(), orders: [] }

function local_state_op(action: OrderingAction): Array<ChangeEvent> {
    const [new_state, change] = ordering_operation(ordering_state, action)
    ordering_state = new_state
    return change
}

function imm_splice(array, index, val) { return [...array.slice(0, index), val, ...array.slice(index + 1)] }
function ordering_operation(state: OrderingState, action: OrderingAction): [OrderingState, Array<ChangeEvent>] {

    const sequence = state.sequence + 1
    const newstate = { ...state, sequence, lastupdated: Date.now() }

    switch (action.type) {
        case ActionType.NewInventory: {
            const inventory_updates: Map<string, InventoryObject> = new Map()
            inventory_updates.set(action.spec.product, { category: action.spec.category, onhand: action.spec.qty + (state.inventory.has(action.spec.product) ? state.inventory.get(action.spec.product).onhand : 0) })

            return [{ ...newstate, inventory: new Map([...state.inventory, ...inventory_updates]) },
            Array.from(inventory_updates).map(([sku, inv_obj]): ChangeEvent => {
                return { kind: "Inventory", metadata: { sequence, doc_id: sku, type: ChangeEventType.CREATE }, status: { failed: false, stage: InventoryStage.NewInventory, ...inv_obj } }
            })
            ]
        }
        case ActionType.NewOrder: {
            const spec = action.spec
            let new_order_status
            if (spec && spec.items && spec.items.length > 0) {
                new_order_status = { failed: false, stage: OrderStage.NewRequiredOrder }
            } else {
                new_order_status = { failed: true, stage: OrderStage.NewRequiredOrder, message: "Invalid spec - no items" }
            }
            return [{ ...newstate, orders: state.orders.concat([{ spec, metadata: { doc_id: spec._id.toHexString() }, status: new_order_status }]) }, [{ kind: "Order", metadata: { sequence, doc_id: spec._id, type: ChangeEventType.CREATE }, status: new_order_status }]]
        }
        case ActionType.AllocateNumber: {
            const order_key_idx = action.doc_id ? state.orders.findIndex(o => o.metadata.doc_id === action.doc_id) : -1
            const existing_order = state.orders[order_key_idx]
            const new_order = { ...existing_order, status: { ...existing_order.status, stage: OrderStage.OrderNumberGenerated, order_number: action.data } }
            return [{ ...newstate, orders: imm_splice(state.orders, order_key_idx, new_order) }, [{ kind: "Order", metadata: { ...new_order.metadata, sequence, type: ChangeEventType.UPDATE }, status: new_order.status }]]
        }
        case ActionType.AllocateInventory: {
            // Check aviable Inventory, if any failed, fail the whole order
            const inventory_updates: Map<string, InventoryObject> = new Map()
            const order_key_idx = action.doc_id ? state.orders.findIndex(o => o.metadata.doc_id === action.doc_id) : -1
            const existing_order = state.orders[order_key_idx]
            let new_order = { ...existing_order, status: { ...existing_order.status, stage: OrderStage.InventoryAllocated } }
            let new_inventory = state.inventory
            if (existing_order.spec.items && existing_order.spec.items.length > 0) {
                for (let i of existing_order.spec.items) {
                    if (i.item._id) {
                        const sku = i.item._id.toHexString(),
                            inv = state.inventory.get(sku)

                        if (!inv || inv.onhand < i.qty) {
                            new_order.status.failed = true
                            new_order.status.message = `Inventory Allocation Failed ${i.item._id}, onhand ${inv ? inv.onhand : "no inv"}, requested ${i.qty}`
                            break
                        } else {
                            inventory_updates.set(sku, { ...inv, onhand: inv.onhand - i.qty })
                        }
                    } else {
                        new_order.status.failed = true
                        new_order.status.message = `Failed, no Item on order`
                        break
                    }
                }

                if (!new_order.status.failed) {
                    new_inventory = new Map([...state.inventory, ...inventory_updates])
                    new_order.status.inventory = []
                }
            } else {
                new_order.status.failed = true
                new_order.status.message = "Not valid Order"
            }

            return [
                { ...newstate, orders: imm_splice(state.orders, order_key_idx, new_order), inventory: new_inventory },
                [
                    { kind: "Order", metadata: { ...new_order.metadata, sequence, type: ChangeEventType.UPDATE }, status: new_order.status },
                    ...Array.from(inventory_updates).map(([sku, inv_obj]): ChangeEvent => {
                        return { kind: "Inventory", metadata: { sequence, doc_id: sku, type: ChangeEventType.CREATE }, status: { failed: false, stage: InventoryStage.NewInventory, ...inv_obj } }
                    })
                ]
            ]
        }
        default:
            return [state, null]
    }
}

async function newReadOrder(ctx, next) {
    const find_order = { _id: ObjectId(ctx.trigger.documentKey._id), partition_key: ctx.tenent.email }
    console.log(`newReadOrder forward, find: ${JSON.stringify(find_order)}`)
    const order = await ctx.db.collection(StoreDef["orders"].collection).findOne(find_order)
    await next(local_state_op({ type: ActionType.NewOrder, spec: order || find_order }))
    console.log('newReadOrder back')
}


async function generateOrderNo(ctx, next) {
    console.log(`generateOrderNo forward, spec: ${JSON.stringify(ctx.trigger)}`)
    const order_seq = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ _id: "order-sequence-stage1", partition_key: ctx.tenent.email }, { $inc: { sequence_value: 1 } }, { upsert: true, returnOriginal: false, returnNewDocument: true })
    const order_number = 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0')
    await next(local_state_op({ type: ActionType.AllocateNumber, data: order_number, doc_id: ctx.trigger.documentKey._id.toHexString() }))
    console.log('generateOrderNo back')
}

async function allocateInventry(ctx, next) {
    console.log(`allocateInventry forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    await next(local_state_op({ type: ActionType.AllocateInventory, doc_id: ctx.trigger.documentKey._id.toHexString() }))
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
    await next(local_state_op({ type: ActionType.StatusUpdate, doc_id: ctx.trigger.documentKey._id.toHexString() }))
    await next()WaitingPicking
    console.log('picking back')
}

async function shipping(ctx, next) {
    console.log(`shipping forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    await next()
    console.log(`shipping back`)
}



const { MongoClient, ObjectID, ObjectId } = require('mongodb'),
    MongoURL = process.env.MONGO_DB

import {
    BlobServiceClient,
    StorageSharedKeyCredential,
    BlobDownloadResponseModel
} from "@azure/storage-blob";
import { exit } from "process";

function getCheckpoint() {
    console.log(`looking for saved starting point ${process.env.STORAGE_ACCOUNT}`)
    const sharedKeyCredential = new StorageSharedKeyCredential(process.env.STORAGE_ACCOUNT, process.env.STORAGE_MASTER_KEY)
    const blobServiceClient = new BlobServiceClient(`https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`, sharedKeyCredential)
    const containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER)

    //const createContainerResponse = await containerClient.create();

    console.log(`Create container ${process.env.STORAGE_CONTAINER} successfully`);

    const blobClient = containerClient.getBlockBlobClient(process.env.STORAGE_CHECKPOINT_FILE);
    return blobClient
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
    orderProcessor.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ _id: ObjectID("singleton001"), partition_key: "root" })

    // rehydrate - replay events
    // db.getReplicationInfo()
    //db.events.watch([{ $match: { "operationType": "insert" } }], { startAtOperationTime: Date.parse(db.getReplicationInfo().tFirst) })
    const blobClient = getCheckpoint()

    try {
        let res1: Buffer = await blobClient.downloadToBuffer()
        ordering_state = JSON.parse(res1.toString())

        console.log(`inflated ordering_state : ${JSON.stringify(ordering_state)}`)

        await db.collection(StoreDef["events"].collection).createIndex({ sequence: 1 })

        const inflate_events = db.collection(StoreDef["events"].collection).aggregate(
            [
                { $match: { $and: [{ "partition_key": orderProcessor.context.tenent.email }, { sequence: { $gt: ordering_state.sequence } }] } },
                { $sort: { "sequence": 1 } }
            ]
        ).toArray()


    } catch (e) {
        if (e.statusCode === 403) {
            console.error('**** its wsl2 date issue dummy')
            exit(1)
        } else {
            console.warn(`nothing to re-hydrate`)
            //const content = JSON.stringify({ ordering_state, })
            //const uploadBlobResponse = await blobClient.upload(content, content.length);
        }
    }

    // Create a blob
    /*
    const content = "hello";
    const blobName = "newblob" + new Date().getTime();
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const uploadBlobResponse = await blockBlobClient.upload(content, Buffer.byteLength(content));
    console.log(`Upload block blob ${blobName} successfully`, uploadBlobResponse.requestId);
    */

    // Start watch new events
    orderProcessor.context.eventfn = ws_server_emit

    // Watch for new new Required Orders
    db.collection(StoreDef["orders"].collection).watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": StoreDef["orders"].status.NewOrder }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup" }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', orderProcessor.callback())

    // Watch for new new Available Inventory
    const inventoryAggregationPipeline = [
        { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": "Available" }] } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ]
    var inventoryStreamWatcher = db.collection(StoreDef["inventory"].collection).watch(
        inventoryAggregationPipeline,

        {
            fullDocument: "updateLookup"
        }
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
        ws_server_emit(orderProcessor.context, local_state_op({ type: ActionType.NewInventory, spec: data.fullDocument }))
    })
}

//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()
function ws_server_emit(ctx, changes: Array<ChangeEvent>) {
    //if (factory_updates && factory_updates.length > 0) {
    const res = ctx.db.collection(StoreDef["events"].collection).insertOne({ partition_key: ctx.tenent.email, trigger: ctx.trigger, changes })

    console.log(`sending factory updates to ${ws_server_clients.size} clients`)
    for (let [key, ws] of ws_server_clients.entries()) {
        //console.log(`${key}`)
        ws.send(JSON.stringify({ type: "events", changes }))
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
                // convert orders array from full orders object to just metadata & state
                orders: ordering_state.orders.map((o: OrderObject) => { return { metadata: { doc_id: o.spec._id }, status: o.status } }),
                // convert Inventry Map into Array
                inventory: Array.from(ordering_state.inventory).map(([sku, val]) => {
                    return { metadata: { doc_id: sku }, status: { onhand: val.onhand } }
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