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

                function dispatch(i, change: ChangeEvent) {
                    if (context.eventfn && change && change.statechanges) {
                        context.eventfn(context, change)
                    }
                    if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                    index = i
                    let fn = middleware[i]
                    if (i === middleware.length) fn = next
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
    last_triggers?: Array<{
        type: ActionType;
        value: any;
    }>
}

interface OrderObject {
    doc_id: string;
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
enum OrderStage { OrderQueued, InventoryAllocated, OrderNumberGenerated, WaitingPicking, Picking, Shipping, Complete }

interface InventoryStatus { //extends DocStatus {
    //stage: InventoryStage;
    onhand: number;
}
enum InventoryStage { NewInventory, AllocatedToOrder }


interface DocStatus {
    failed: boolean;
    message?: string;
}




// Change Events
interface ChangeEvent {
    sequence?: number;
    nextaction: boolean;
    trigger?: {
        type: ActionType;
        value: object;
    }
    statechanges: Array<StateChange>;
}

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
    spec?: any; // full doc used for NewOrUpdatedOrder / New Inventory
    doc_id?: string; // used for all updates
    data?: any;
    trigger?: object;
}
enum ActionType { ApplyChangeEvent, NewInventory, NewOrUpdatedOrder, AllocateNumber, AllocateInventory }

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
        if (change.trigger) {
            const idx = newstate.last_triggers.findIndex(t => t.type === change.trigger.type)
            if (idx < 0) {
                newstate.last_triggers = newstate.last_triggers.concat(change.trigger)
            } else {
                newstate.last_triggers = imm_splice(newstate.last_triggers, idx, change.trigger)
            }
        }

        for (let c of change.statechanges) {
            if (change.sequence && (change.sequence !== newstate.sequence)) {
                throw new Error(`Cannot re-apply change sequence ${change.sequence}, expecting ${newstate.sequence}`)
            }
            const { doc_id, type } = c.metadata
            switch (c.kind) {
                case "Order":
                    if (type === ChangeEventType.CREATE) {
                        // using typescript "type assertion"
                        // https://www.typescriptlang.org/docs/handbook/advanced-types.html#type-guards-and-differentiating-types
                        newstate.orders = newstate.orders.concat([{ doc_id, status: c.status as OrderStatus }])
                    } else if (type === ChangeEventType.UPDATE) {

                        const order_idx = doc_id ? newstate.orders.findIndex(o => o.doc_id === doc_id) : -1
                        if (order_idx >= 0) {
                            const existing_order = newstate.orders[order_idx]
                            const new_order = { ...existing_order, status: { ...existing_order.status, ...c.status } }
                            newstate.orders = imm_splice(newstate.orders, order_idx, new_order)
                        } else {
                            throw new Error(`Cannot find existing ${c.kind} with doc_id=${doc_id}`)
                        }
                    }
                    break
                case "Inventory":
                    const inventory_updates: Map<string, InventoryStatus> = new Map()
                    const new_status = c.status as InventoryStatus
                    const existing_sku: InventoryStatus = newstate.inventory.get(doc_id)

                    if (type === ChangeEventType.UPDATE) {
                        if (!existing_sku) {
                            throw new Error(`Cannot find existing ${c.kind} with doc_id=${doc_id}`)
                        }
                        // got new Onhand value (replace)
                        inventory_updates.set(doc_id, new_status)
                    } else if (type === ChangeEventType.CREATE) {
                        // got new Inventory onhand (additive)
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

    //const sequence = state.sequence + 1
    //let nextaction = true
    //const newstate = { ...state, sequence, lastupdated: Date.now() }

    switch (action.type) {

        case ActionType.NewInventory: {
            const { product, qty } = action.spec
            //const inventory_updates: Map<string, InventoryObject> = new Map()
            //inventory_updates.set(action.spec.product, { category: action.spec.category, onhand: action.spec.qty + (state.inventory.has(action.spec.product) ? state.inventory.get(action.spec.product).onhand : 0) })

            return apply_change_events(state, { trigger: { type: action.type, value: action.trigger }, nextaction: true, statechanges: [{ kind: "Inventory", metadata: { doc_id: product, type: ChangeEventType.CREATE }, status: { onhand: qty } }] })
            //})})

            //return [{ ...newstate, inventory: new Map([...state.inventory, ...inventory_updates]) },
            //{
            //    sequence, nextaction, statechanges:
            //        Array.from(inventory_updates).map(([sku, inv_obj]): StateChange => {
            //            return { kind: "Inventory", metadata: { doc_id: sku, type: ChangeEventType.CREATE }, status: { failed: false, stage: InventoryStage.NewInventory, ...inv_obj } }
            //        })
            //}
            //]
        }
        case ActionType.NewOrUpdatedOrder: {
            const { spec } = action

            // Validate order spec
            let new_order_status
            if (spec && spec.items && spec.items.length > 0) {
                new_order_status = { failed: false, stage: OrderStage.OrderQueued }
            } else {
                //nextaction = false
                new_order_status = { failed: true, stage: OrderStage.OrderQueued, message: "Invalid Order - No items" }
            }

            // Needs to be Idempotent
            // TODO: Check if its a new Order or if state already has the Order & what the change is & if we accept the change


            return apply_change_events(state, { trigger: { type: action.type, value: action.trigger }, nextaction: !new_order_status.failed, statechanges: [{ kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.CREATE }, status: new_order_status }] })
            //    return [{ ...newstate, orders: state.orders.concat([{ doc_id: spec._id.toHexString(), status: new_order_status }]) },
            //    { sequence, nextaction, statechanges: [{ kind: "Order", metadata: { doc_id: spec._id, type: ChangeEventType.CREATE }, status: new_order_status }] }]
        }
        case ActionType.AllocateNumber: {
            const { spec, data } = action
            //const order_idx = doc_id ? state.orders.findIndex(o => o.doc_id === doc_id) : -1

            //if (order_idx >= 0) {
            //    const existing_order = state.orders[order_idx]

            // Needs to be Idempotent
            // TODO: Check if state already has Order Number 

            return apply_change_events(state, { nextaction: true, statechanges: [{ kind: "Order", metadata: { doc_id: spec.doc_id.toHexString(), type: ChangeEventType.UPDATE }, status: { failed: false, stage: OrderStage.OrderNumberGenerated, order_number: data } }] })


            //    const new_order = { ...existing_order, status: { ...existing_order.status, stage: OrderStage.OrderNumberGenerated, order_number: data } }

            //    return [{ ...newstate, orders: imm_splice(state.orders, order_key_idx, new_order) },
            //    { sequence, nextaction, statechanges: [{ kind: "Order", metadata: { doc_id: action.doc_id, type: ChangeEventType.UPDATE }, status: new_order.status }] }]
        }
        case ActionType.AllocateInventory: {
            // Check aviable Inventory, if any failed, fail the whole order
            const { spec } = action

            const order_key_idx = spec.doc_id ? state.orders.findIndex(o => o.doc_id === spec.doc_id.toHexString()) : -1
            const existing_order = state.orders[order_key_idx]

            //let new_order = { ...existing_order, status: { ...existing_order.status, stage: OrderStage.InventoryAllocated } }
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
                //if (!new_order.status.failed) {
                //    new_inventory = new Map([...state.inventory, ...inventory_updates])
                //    new_order.status.inventory = []
                //}
            } else {
                order_status_update = { ...order_status_update, failed: true, message: `No lineitems on Order` }
            }
            const order_statechange: StateChange = { kind: "Order", metadata: { doc_id: spec.doc_id.toHexString(), type: ChangeEventType.UPDATE }, status: order_status_update }
            let inventory_statechanges: Array<StateChange> = []

            if (!order_status_update.failed) {
                inventory_statechanges = Array.from(inventory_updates).map(([sku, inv_obj]): StateChange => {
                    return { kind: "Inventory", metadata: { doc_id: sku, type: ChangeEventType.UPDATE }, status: { onhand: inv_obj.onhand } }
                })

            }
            return apply_change_events(state, { nextaction: !order_status_update.failed, statechanges: [order_statechange].concat(inventory_statechanges) })

            //return [
            //    { ...newstate, orders: imm_splice(state.orders, order_key_idx, new_order), inventory: new_inventory },
            //    {
            //        sequence, nextaction, statechanges: [
            //            { kind: "Order", metadata: { ...new_order.metadata, type: ChangeEventType.UPDATE }, status: new_order.status },
            //            ...Array.from(inventory_updates).map(([sku, inv_obj]): StateChange => {
            //                return { kind: "Inventory", metadata: { doc_id: sku, type: ChangeEventType.UPDATE }, status: { failed: false, stage: InventoryStage.NewInventory, ...inv_obj } }
            //            })
            //        ]
            //    }
            //]
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
    await next(local_state_op({ type: ActionType.NewOrUpdatedOrder, spec: ctx.spec, trigger: ctx.trigger }))
    console.log('newReadOrder back')
}


async function generateOrderNo(ctx, next) {
    console.log(`generateOrderNo forward, spec: ${JSON.stringify(ctx.trigger)}`)
    const order_seq = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ _id: "order-sequence-stage1", partition_key: ctx.tenent.email }, { $inc: { sequence_value: 1 } }, { upsert: true, returnOriginal: false, returnNewDocument: true })
    const order_number = 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0')
    await next(local_state_op({ type: ActionType.AllocateNumber, spec: ctx.spec, data: order_number }))
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
    //await next(local_state_op({ type: ActionType.StatusUpdate, doc_id: ctx.trigger.documentKey._id.toHexString() }))
    await next()
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

async function orderCheckpoint_Filesystem(ctx, state_snapshot: OrderingState): Promise<number> {
    const now = new Date()
    const filename = `${chkdir}/${ctx.tenent.email}/${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${('0' + now.getDate()).slice(-2)}-${('0' + now.getHours()).slice(-2)}-${('0' + now.getMinutes()).slice(-2)}-${('0' + now.getSeconds()).slice(-2)}--${state_snapshot.sequence}.json`
    console.log(`writing movement ${filename}`)
    await fs.promises.writeFile(filename, JSON.stringify(state_snapshot))
    return state_snapshot.sequence
}

async function getLatestOrderingState_Filesystem(ctx): Promise<OrderingState> {
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
        return await JSON.parse(fs.promises.readFile(dir + '/' + latestfile.filename, 'UTF-8'))
    } else {
        console.log(`No checkpoint found, start from 0`)
        return { sequence: 0, last_triggers: [], lastupdated: null, picking_capacity: 0, inventory: new Map(), orders: [] }
    }
}

async function inflateState_Filesystem(ctx): Promise<OrderingState> {

    try {
        let ordering_state = await getLatestOrderingState_Filesystem(ctx)

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
                const { _id, partition_key, ...change } = inflate_events[i]
                const [new_state, applied_change] = apply_change_events(ordering_state, change)
                ordering_state = new_state
            }
        }

        return ordering_state

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

        // Setup action on next()
        orderProcessor.context.eventfn = ws_server_emit


        ordering_state = await inflateState_Filesystem(orderProcessor.context)
        let lastcheckpoint_seq: number = ordering_state.sequence

        // start the checkpointing process
        // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
        setInterval(async (ctx) => {
            console.log(`Checkpointing check: seq=${ordering_state.sequence}, #orders=${ordering_state.orders.length}, #inv=${ordering_state.inventory.size}`)
            if (ordering_state.sequence > lastcheckpoint_seq + 100) {
                console.log(`do checkpoint`)
                lastcheckpoint_seq = await orderCheckpoint_Filesystem(ctx, { ...ordering_state })
            }
        }, 1000 * 60 * 1, orderProcessor.context)


        const order_startAfter = ordering_state.last_triggers.find(t => t.type === ActionType.NewOrUpdatedOrder)
        // Watch for new new Required Orders
        db.collection(StoreDef["orders"].collection).watch(
            [
                { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": StoreDef["orders"].status.NewOrUpdatedOrder }] } }
                , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
            ],
            { fullDocument: "updateLookup", ...(order_startAfter && { startAfter: order_startAfter.value._id }) }
            // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
        ).on('change', orderProcessor.callback())


        const inventory_startAfter = ordering_state.last_triggers.find(t => t.type === ActionType.NewInventory)
        // Watch for new new Available Inventory
        const inventoryAggregationPipeline = [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": "Available" }] } },
            { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
        ]
        var inventoryStreamWatcher = db.collection(StoreDef["inventory"].collection).watch(
            inventoryAggregationPipeline,
            { fullDocument: "updateLookup", ...(inventory_startAfter && { startAfter: inventory_startAfter.value._id }) }
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
            ws_server_emit(orderProcessor.context, local_state_op({ type: ActionType.NewInventory, trigger: data, spec: data.fullDocument }))
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
        ws.send(JSON.stringify({ type: "events", change }))
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
                //orders: ordering_state.orders.map((o: OrderObject) => { return { metadata: { doc_id: o.spec._id }, status: o.status } }),
                // convert Inventry Map into Array
                inventory: Array.from(ordering_state.inventory).map(([sku, val]) => {
                    return { doc_id: sku, status: { onhand: val.onhand } }
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