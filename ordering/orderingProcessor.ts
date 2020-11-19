import { Processor, ProcessorOptions } from './processor'
import { ChangeEvent, StateChange, ChangeEventType, apply_change_events, inflateState_Filesystem, orderCheckpoint_Filesystem, PickingStage, OrderStage, OrderingState, OrderObject, OrderStatus, InventoryStatus, PickingStatus } from './orderingState'

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


// Perform Action on ordering_state
interface OrderingAction {
    // Order actions
    type: ActionType;
    spec?: any; // used for NewOrUpdatedOrder / NewInventory
    doc_id?: string; // used for all updates
    status?: any; // used for StatusUpdate Actions
    //trigger?: object; // used for NewOrUpdatedOrder / NewInventory
}
enum ActionType { StatusUpdate, NewInventory, NewOrUpdatedOrder, AllocateInventory, ProcessPicking }

// Store in "https://github.com/Level/level"
// In Memory, volatile state
// Storing large objects in a GC language is questionable, maybe look at rocksdb
var ordering_state: OrderingState
var last_inventory_trigger

function local_state_op(action: OrderingAction): ChangeEvent {
    const [new_state, change] = ordering_operation(ordering_state, action)
    ordering_state = new_state
    return change
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
        case ActionType.ProcessPicking: {

            // A simulation for picking,
            // In a real implementation, this may be implemented in another process, with this process listenting for updates
            const MAX_PICKING_CAPACITY = 5
            const TIME_TO_PICK_A_ORDER = 30 * 1000 //30 seconds

            let picking_allocated_update = 0// state.picking_allocated
            const orders_in_picking: Array<OrderObject> = state.orders.filter(s => s.status.stage === OrderStage.Picking)
            const now = Date.now()

            const statechanges: Array<StateChange> = []

            // check orders in picking status look for for completion to free up capacity
            for (let ord of orders_in_picking.filter(o => o.status.picking.status === PickingStage.Picking)) {
                // all orders in Picking status
                const { doc_id, status } = ord
                let order_status_update = {}

                const timeleft = TIME_TO_PICK_A_ORDER - (now - status.picking.starttime)

                if (timeleft > 0) { // not finished, just update progress
                    order_status_update = { picking: { ...status.picking, progress: Math.floor(100 - ((timeleft / TIME_TO_PICK_A_ORDER) * 100.0)) } }
                } else { // finished
                    picking_allocated_update = picking_allocated_update - status.picking.allocated_capacity
                    order_status_update = { picking: { ...status.picking, status: PickingStage.Complete, progress: 100, allocated_capacity: 0 }, stage: OrderStage.PickingComplete }
                }
                statechanges.push({ kind: "Order", metadata: { doc_id, type: ChangeEventType.UPDATE }, status: { failed: false, ...order_status_update } })
            }

            // check orders in picking status look for for completion to free up capacity
            for (let ord of orders_in_picking.filter(o => o.status.picking.status === PickingStage.Waiting)) {
                // all orders in Picking status
                const { doc_id, status } = ord
                let order_status_update = {}
                const required_capacity = 1

                if ((MAX_PICKING_CAPACITY - (state.picking_allocated + picking_allocated_update)) >= required_capacity) {
                    // we have capacity, move to inprogress
                    order_status_update = { picking: { ...status.picking, status: PickingStage.Picking, allocated_capacity: required_capacity, progress: 0, waittime: now - status.picking.starttime } }
                    picking_allocated_update = picking_allocated_update + required_capacity
                } else {
                    // still need to wait
                    order_status_update = {
                        picking: { ...status.picking, waittime: now - status.picking.starttime }
                    }

                }
                statechanges.push({ kind: "Order", metadata: { doc_id, type: ChangeEventType.UPDATE }, status: { failed: false, ...order_status_update } })
            }

            if (picking_allocated_update !== 0) {
                statechanges.push({ kind: "Picking", metadata: { type: ChangeEventType.UPDATE }, status: { allocated_update: picking_allocated_update } })
            }
            if (statechanges.length > 0) {
                return apply_change_events(state, { nextaction: null, statechanges: statechanges })
            }
            return [state, null]
        }
        default:
            return [state, null]
    }
}

async function setOrderSpec(ctx, next) {
    console.log(`setOrderSpec forward, find order id=${ctx.trigger.documentKey._id.toHexString()}, continuation=${ctx.trigger._id}`)
    const find_order = { _id: ctx.trigger.documentKey._id, partition_key: ctx.tenent.email }
    // ctx - 'caches' information in the 'session' that will be required for the middleware operations, but not required in the state
    ctx.spec = await ctx.db.collection(StoreDef["orders"].collection).findOne(find_order)
    // pass in the required data, and perform transational operation on the state
    await next()
    console.log('setOrderSpec back')
}

async function validateOrder(ctx, next) {
    console.log(`validateOrder forward, find order id=${ctx.trigger.documentKey._id.toHexString()}, continuation=${ctx.trigger._id}`)
    // pass in the required data, and perform transational operation on the state
    const change = local_state_op({ type: ActionType.NewOrUpdatedOrder, spec: ctx.spec })
    await next(change, { nextaction: change.nextaction } as ProcessorOptions)
}


async function generateOrderNo(ctx, next) {
    console.log(`generateOrderNo forward, spec: ${JSON.stringify(ctx.trigger)}`)
    const order_seq = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ _id: "order-sequence-stage1", partition_key: ctx.tenent.email }, { $inc: { sequence_value: 1 } }, { upsert: true, returnOriginal: false, returnNewDocument: true })
    const order_number = 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0')
    const change = local_state_op({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.OrderNumberGenerated, order_number: order_number } })
    await next(change, { nextaction: change.nextaction } as ProcessorOptions)
}

async function allocateInventry(ctx, next) {
    console.log(`allocateInventry forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    const change = local_state_op({ type: ActionType.AllocateInventory, spec: ctx.spec })
    await next(change, { nextaction: change.nextaction } as ProcessorOptions)
}

async function picking(ctx, next) {
    console.log(`picking forward, trigger: ${JSON.stringify(ctx.trigger)}`)

    await next(
        local_state_op({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Picking, picking: { starttime: Date.now(), status: PickingStage.Waiting, waittime: 0, progress: 0 } } }),
        { nextaction: true, sleep_until: { stage: OrderStage.PickingComplete } } as ProcessorOptions)
}

async function shipping(ctx, next) {
    console.log(`shipping forward`)
    await next(local_state_op({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Shipped } }),
        { nextaction: true, sleep_until: { time: Date.now() + 1000 * 60 * 60 /* 1hr */ } } as ProcessorOptions)
}

async function complete(ctx, next) {
    console.log(`complete forward`)
    await next(local_state_op({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Complete } }))
}

const { MongoClient, ObjectID, ObjectId } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB



async function order_processor_startup() {
    const murl = new URL(MongoURL)

    console.log(`order_processor_startup (1):  connecting to: ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string

    const orderProcessor = new Processor({ name: "ordProcv1" })

    orderProcessor.use(setOrderSpec)
    orderProcessor.use(validateOrder)
    orderProcessor.use(generateOrderNo)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    const db = orderProcessor.context.db = client.db()
    orderProcessor.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
    console.log(`order_processor_startup (2):  got context tenent=${orderProcessor.context.tenent.email}`)

    // Setup action on next()
    orderProcessor.context.eventfn = ws_server_emit

    // inflate ordering_state & get required_processor_state
    const [inflated_ordering_state, required_processor_state] = await inflateState_Filesystem(orderProcessor.context)
    ordering_state = inflated_ordering_state

    console.log(`order_processor_startup (3): re-inflating processor state`)

    function checkRestartStage(doc_id, stage) {
        const order_state = ordering_state.orders.find(o => o.doc_id === doc_id)
        if (!order_state) {
            throw new Error(`order_processor_startup: Got a processor state without the ordering state: doc_id=${doc_id}`)
        } else if (stage !== order_state.status.stage) {
            return true
        }
        return false
    }


    orderProcessor.restartProcessors(checkRestartStage, required_processor_state[orderProcessor.name])//, true)



    console.log(`order_processor_startup (4): loop to re-inflate 'sleep_until' processes`)
    setInterval(() => {
        // check to restart 'sleep_until' processes
        orderProcessor.restartProcessors(checkRestartStage)//, orderProcessor.state, false)
    }, 1000 * 5 /* 5 seconds */)


    let lastcheckpoint_seq: number = ordering_state.sequence
    console.log(`order_processor_startup (5): inflated to seq=${ordering_state.sequence}, #orders=${ordering_state.orders.length}, #inv=${ordering_state.inventory.size}`)

    const LOOP_MINS = 1, LOOP_CHANGES = 100
    console.log(`order_processor_startup (6): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (ctx) => {
        console.log(`Checkpointing check: seq=${ordering_state.sequence}, #orders=${ordering_state.orders.length}, #inv=${ordering_state.inventory.size}.  Processing size=${orderProcessor.state.proc_map.size}`)
        if (ordering_state.sequence > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            lastcheckpoint_seq = await orderCheckpoint_Filesystem(ctx, { ...ordering_state }, orderProcessor.serializeState(), last_inventory_trigger)
        }
    }, 1000 * 60 * LOOP_MINS, orderProcessor.context)

    console.log(`order_processor_startup (7): starting picking control loop (5 seconds)`)
    setInterval(function (ctx) {
        const change = local_state_op({ type: ActionType.ProcessPicking })
        if (change) {
            ws_server_emit(ctx, change)
        }
    }, 5000, orderProcessor.context)


    /*
    // Start processing control loop
    setInterval(function (ctx) {
        // This loop re-hydrates, or checks for restarts paused steps in the process.

        // Get orderstate
        for each ordering_state
            - lookup processor state

                - if no processor,
                    what to do????
        //
    }, 5000, orderProcessor.context)
    */
    const cont_order_token = required_processor_state[orderProcessor.name].last_trigger
    assert((ordering_state.orders.length === 0) === (!cont_order_token), 'Error, we we have inflated orders, we need a order continuation token')
    console.log(`order_processor_startup (8):  start watch for new "orders" (startAfter=${cont_order_token && cont_order_token._id})`)
    db.collection(StoreDef["orders"].collection).watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": StoreDef["orders"].status.NewOrUpdatedOrder }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup", ...(cont_order_token && { startAfter: cont_order_token._id }) }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', orderProcessor.callback())


    const cont_inv_token = required_processor_state["inventory"]
    assert((ordering_state.inventory.size === 0) === (!cont_inv_token), 'Error, we we have inflated inventry, we need a inventory continuation token')
    console.log(`order_processor_startup (9):  start watch for new "inventory" (startAfter=${cont_inv_token && cont_inv_token._id})`)
    const inventoryAggregationPipeline = [
        { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": "Available" }] } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ]
    var inventoryStreamWatcher = db.collection(StoreDef["inventory"].collection).watch(
        inventoryAggregationPipeline,
        { fullDocument: "updateLookup", ...(cont_inv_token && { startAfter: cont_inv_token._id }) }
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
        //const processor: ProcessorInfo = {
        //    processor: ProcessorType.INVENTORY,
        //    trigger_full: data
        //}

        //processor_state = processor_state_apply(processor_state, processor)
        last_inventory_trigger = data
        ws_server_emit(orderProcessor.context, { ...change, processor: { "inventory": data } })
    })

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
        port = process.env.PORT || 9090

    /* /////   If we want to expose a API for the frontend
    const    
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
    */ ////////////////////////////////////////////

    const httpServer = http.createServer().listen(port)
    console.log(`ws_server_startup: listening to port ${port}`)

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
                console.log(`ws_server_startup: disconnected ${client_id}`)
            }
        })
    })
}

async function init() {
    try {
        await order_processor_startup()
        await ws_server_startup()

    } catch (e) {
        console.error(e)
        process.exit(1)
    }
}

init()
