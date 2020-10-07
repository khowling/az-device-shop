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

    callback() {

        function compose(middleware) {

            return function (context, next) {

                // last called middleware #

                let index = -1
                //const init_event = { type: OrderingEventType.NewOrder, failed: false }
                return dispatch(0, null)

                function dispatch(i, event: Order) {
                    if (context.eventfn && event) context.eventfn([event])
                    if (event && event.status.failed) return Promise.reject(event.status.message)
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
    "orders": { collection: "orders" },
    "inventory": { collection: "inventory" },
    "business": { collection: "business" }
}


interface OrderingState {
    inventory: Map<string, Inventory>;
    orders: Array<Order>;
    picking_capacity: number;
    lastupdated: number;
}


interface Order {
    //metadata: Order_metadata;
    spec: any;
    status: Order_status;
}

interface Order_status {
    stage: Order_Stage;
    starttime?: number;

    order_number?: string;
    inventory?: any;

    last_update?: number;
    waittime?: number;
    allocated_capacity?: number;
    progress?: number;

    failed: boolean;
    message?: string;
}
enum Order_Stage { NewRequiredOrder, InventoryAllocated, OrderNumberGenerated, Picking, Shipping, Complete, NewInventory }




type Inventory = { onhand: number; };
interface InventoryState {

    lastupdated: number;
}

// Perform Action on ordering_state
enum ActionType { NewInventory, NewOrder, AllocateNumber, AllocateInventory }
interface OrderingAction {

    // Order actions
    type: ActionType;
    spec?: any; // full doc used for NewOrder
    doc_id?: string; // used for all other Order updates
    data?: any;

    // stock actions
    sku?: string;
    qty?: number;
}
const update = require('immutability-helper')
var ordering_state: OrderingState = { lastupdated: Date.now(), picking_capacity: 0, inventory: new Map(), orders: [] }

function local_state_op(action: OrderingAction): Order {
    const [new_state, changes] = ordering_operation(ordering_state, action)
    ordering_state = new_state
    return changes
}

function ordering_operation(state: OrderingState, action: OrderingAction): [OrderingState, Order] {

    const nownow = Date.now()
    const order_key_idx = action.doc_id ? state.orders.findIndex(o => o.spec._id.toHexString() === action.doc_id) : -1

    switch (action.type) {
        case ActionType.NewInventory:
            return [{ lastupdated: Date.now(), orders: state.orders, picking_capacity: state.picking_capacity, inventory: state.inventory.set(action.sku, { onhand: action.qty }) }, null]

        case ActionType.NewOrder:
            if (action.spec && action.spec.items && action.spec.items.length > 0) {
                const new_order = { spec: action.spec, status: { failed: false, stage: Order_Stage.NewRequiredOrder } }
                return [{ lastupdated: Date.now(), orders: state.orders.concat([new_order]), picking_capacity: state.picking_capacity, inventory: state.inventory }, new_order]
            } else {
                const failed_order = { spec: action.spec, status: { failed: true, stage: Order_Stage.NewRequiredOrder, message: "Invalid Order - no items" } }
                return [{ lastupdated: Date.now(), orders: state.orders.concat([failed_order]), picking_capacity: state.picking_capacity, inventory: state.inventory }, failed_order]
            }
        case ActionType.AllocateNumber:
            const new_order = { spec: state.orders[order_key_idx].spec, status: { ...state.orders[order_key_idx].status, stage: Order_Stage.OrderNumberGenerated, order_number: action.data } }
            return [{ lastupdated: Date.now(), picking_capacity: state.picking_capacity, inventory: state.inventory, orders: state.orders.splice(order_key_idx, 1, new_order) }, new_order]

        case ActionType.AllocateInventory:
            // Check aviable Inventory, if any failed, fail the whole order
            const inventory_updates: Map<string, Inventory> = new Map()
            const order: Order = state.orders[order_key_idx]
            if (order.spec.items && order.spec.items.length > 0) {
                for (let i of order.spec.items.items) {
                    if (i.item._id) {
                        const sku = i.item._id.toHexString(),
                            inv = state.inventory.get(sku)

                        if (!inv || inv.onhand < i.qty) {
                            const failed_order = { spec: order.spec, status: { ...order.status, failed: true, stage: Order_Stage.InventoryAllocated, message: `Failed Application ${i.item._id}` } }
                            return [{ lastupdated: Date.now(), orders: state.orders.splice(order_key_idx, 1, failed_order), picking_capacity: state.picking_capacity, inventory: state.inventory }, failed_order]
                        } else {
                            inventory_updates.set(sku, { onhand: inv.onhand - i.qty })
                        }
                    } else {
                        const failed_order = { spec: order.spec, status: { ...order.status, failed: true, stage: Order_Stage.InventoryAllocated, message: `Failed, no Item on order` } }
                        return [{ lastupdated: Date.now(), orders: state.orders.splice(order_key_idx, 1, failed_order), picking_capacity: state.picking_capacity, inventory: state.inventory }, failed_order]
                    }
                }

                // We have inventory for the order, allocate the inventory
                const new_order = { spec: order.spec, status: { ...order.status, failed: false, stage: Order_Stage.InventoryAllocated, inventory: [] } }
                return [{ lastupdated: Date.now(), orders: state.orders.splice(order_key_idx, 1, new_order), picking_capacity: state.picking_capacity, inventory: new Map([...state.inventory, ...inventory_updates]) }, new_order]
            } else {
                const failed_order = { spec: order.spec, status: { ...order.status, failed: true, stage: Order_Stage.InventoryAllocated, message: "Not valid Order" } }
                return [{ lastupdated: Date.now(), orders: state.orders.splice(order_key_idx, 1, failed_order), picking_capacity: state.picking_capacity, inventory: state.inventory }, failed_order]

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
    console.log('generateOrderNo back')
}


async function generateOrderNo(ctx, next) {
    console.log(`generateOrderNo forward, spec: ${JSON.stringify(ctx.trigger)}`)
    const order_seq = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ _id: "order-sequence-stage1", partition_key: ctx.tenent.email }, { $inc: { sequence_value: 1 } }, { upsert: true, returnOriginal: false, returnNewDocument: true })
    const order_number = 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0')
    //const order = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenent.email }, { $set: { order_number: 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0'), status: StoreDef["orders"].status.NewOrder, owner: { _id: ctx.session.auth.sub } } })
    //ctx.status = { ...ctx.status, order_number }
    await next(local_state_op({ type: ActionType.AllocateNumber, data: order_number, doc_id: ctx.trigger.documentKey._id }))
    console.log('generateOrderNo back')
}

async function allocateInventry(ctx, next) {
    console.log(`allocateInventry forward, spec: ${JSON.stringify(ctx.spec)}, status: ${JSON.stringify(ctx.status)}`)
    //const [event] = local_state_op({ type: ActionType.AllocateInventory, doc_id: ctx.trigger.documentKey._id })
    //ctx.status = { ...ctx.status, inv: [] }
    await next(local_state_op({ type: ActionType.AllocateInventory, doc_id: ctx.trigger.documentKey._id }))
    console.log('allocateInventry back')
}

async function picking(ctx, next) {
    console.log(`picking forward, spec: ${JSON.stringify(ctx.spec)}, status: ${JSON.stringify(ctx.status)}`)
    await next()
    console.log('picking back')
}

async function shipping(ctx, next) {
    console.log(`shipping forward, spec: ${JSON.stringify(ctx.spec)}, status: ${JSON.stringify(ctx.status)}`)
    await next()
    console.log(`shipping back`)
}





const { MongoClient, ObjectID, ObjectId } = require('mongodb'),
    MongoURL = process.env.MONGO_DB



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
    orderProcessor.context.eventfn = ws_server_emit

    // Watch for new new Required Orders
    const orderAggregationPipeline = [
        { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": "Required" }] } }
        //,{ $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ]
    var orderStreamIterator = db.collection(StoreDef["orders"].collection).watch(
        orderAggregationPipeline,
        // By default, watch() returns the delta of those fields modified by an update operation
        // Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
        //{ fullDocument: "updateLookup" }
    )
    orderStreamIterator.on('change', orderProcessor.callback())

    // Watch for new new Available Inventory
    const inventoryAggregationPipeline = [
        { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": "Available" }] } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ]
    var inventoryStreamIterator = db.collection(StoreDef["inventory"].collection).watch(
        inventoryAggregationPipeline,

        {
            fullDocument: "updateLookup"
        }
    )
    inventoryStreamIterator.on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
        console.log(`inventoryStreamIterator : ${JSON.stringify(data.fullDocument)}`)
        local_state_op({ type: ActionType.NewInventory, sku: data.fullDocument._id, qty: data.fullDocument.qty })
    })
}



//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()
function ws_server_emit(changes: Array<Order>) {
    //if (factory_updates && factory_updates.length > 0) {
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

        ws.send(JSON.stringify({ type: "snapshot", state: ordering_state.orders }))

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