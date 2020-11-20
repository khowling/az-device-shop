import { Processor, ProcessorOptions, ProcessingState } from './processor'
import {
    ChangeEvent, StateChange, ChangeEventType,
    OrderStateManager,
    PickingStage, OrderStage, OrderObject, OrderStatus, InventoryStatus
} from './orderingState'

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


// Performs the operations against the local state, 
// validate if the requested operation is ok, then generate ChangeEvents and call 'apply_change_events' to apply to local state
function ordering_operation({ stateManager }, action: OrderingAction): ChangeEvent {

    switch (action.type) {

        case ActionType.NewInventory: {
            const { product, qty } = action.spec
            return stateManager.apply_change_events({ nextaction: true, statechanges: [{ kind: "Inventory", metadata: { doc_id: product, type: ChangeEventType.CREATE }, status: { onhand: qty } }] })
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
            return stateManager.apply_change_events({ nextaction: !new_order_status.failed, statechanges: [{ kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.CREATE }, status: new_order_status }] })
        }
        case ActionType.StatusUpdate: {
            const { spec, status } = action
            // Needs to be Idempotent
            // TODO: Check if state already has Order Number 
            return stateManager.apply_change_events({ nextaction: true, statechanges: [{ kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE }, status: { failed: false, ...status } }] })
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
                            inv = inventory_updates.get(sku) || stateManager.state.inventory.get(sku)

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
            return stateManager.apply_change_events({ nextaction: !order_status_update.failed, statechanges: [order_statechange].concat(inventory_statechanges) })
        }
        case ActionType.ProcessPicking: {

            // A simulation for picking,
            // In a real implementation, this may be implemented in another process, with this process listenting for updates
            const MAX_PICKING_CAPACITY = 5
            const TIME_TO_PICK_A_ORDER = 30 * 1000 //30 seconds

            let picking_allocated_update = 0// state.picking_allocated
            const orders_in_picking: Array<OrderObject> = stateManager.state.orders.filter(s => s.status.stage === OrderStage.Picking)
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

                if ((MAX_PICKING_CAPACITY - (stateManager.state.picking_allocated + picking_allocated_update)) >= required_capacity) {
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
                return stateManager.apply_change_events({ nextaction: null, statechanges: statechanges })
            }
            return null
        }
        default:
            return null
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
    const change = ordering_operation(ctx, { type: ActionType.NewOrUpdatedOrder, spec: ctx.spec })
    await next(change, { endworkflow: !change.nextaction } as ProcessorOptions)
}


async function generateOrderNo(ctx, next) {
    console.log(`generateOrderNo forward, spec: ${JSON.stringify(ctx.trigger)}`)
    const order_seq = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ _id: "order-sequence-stage1", partition_key: ctx.tenent.email }, { $inc: { sequence_value: 1 } }, { upsert: true, returnOriginal: false, returnNewDocument: true })
    const order_number = 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0')
    const change = ordering_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.OrderNumberGenerated, order_number: order_number } })
    await next(change, { endworkflow: !change.nextaction } as ProcessorOptions)
}

async function allocateInventry(ctx, next) {
    console.log(`allocateInventry forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    const change = ordering_operation(ctx, { type: ActionType.AllocateInventory, spec: ctx.spec })
    await next(change, { endworkflow: !change.nextaction } as ProcessorOptions)
}

async function picking(ctx, next) {
    console.log(`picking forward, trigger: ${JSON.stringify(ctx.trigger)}`)

    await next(
        ordering_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Picking, picking: { starttime: Date.now(), status: PickingStage.Waiting, waittime: 0, progress: 0 } } }),
        { sleep_until: { stage: OrderStage.PickingComplete } } as ProcessorOptions)
}

async function shipping(ctx, next) {
    console.log(`shipping forward`)
    await next(ordering_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Shipped } }),
        { sleep_until: { time: Date.now() + 1000 * 60 * 3 /* 3mins */ } } as ProcessorOptions)
}

async function complete(ctx, next) {
    console.log(`complete forward`)
    await next(ordering_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Complete } }))
}

const { MongoClient, ObjectID, ObjectId } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB


function applyProcessorEvents(processor_name, order_state: ProcessingState, inv_state, processor_state_events): [ProcessingState, any] {
    let ret_order_state = { ...order_state }
    let ret_inv_state = inv_state
    if (processor_state_events) {
        for (let processor of processor_state_events) {
            if (processor[processor_name]) {
                process.stdout.write('o')
                ret_order_state = Processor.processor_state_apply(ret_order_state, processor[processor_name])
            } else if (processor["inventory"]) {
                process.stdout.write('i')
                ret_inv_state = processor["inventory"]
            }
        }
        process.stdout.write('\n')
    }
    return [ret_order_state, ret_inv_state]
}

async function order_processor_startup() {
    const murl = new URL(MongoURL)

    console.log(`order_processor_startup (1):  connecting to: ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string

    const orderProcessor = new Processor({ name: "ordProcv1" })

    orderProcessor.use(setOrderSpec)
    orderProcessor.use(validateOrder)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(generateOrderNo)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    const db = orderProcessor.context.db = client.db()
    orderProcessor.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
    console.log(`order_processor_startup (2):  got context tenent=${orderProcessor.context.tenent.email}`)

    // Setup action on next()
    orderProcessor.context.eventfn = ws_server_emit

    const orderState = new OrderStateManager();
    orderProcessor.context.stateManager = orderState

    const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
    const { processor_snapshop } = await orderState.applyStateFromSnapshot(orderProcessor.context, chkdir)

    const [order_process_state, inv_process_state] = applyProcessorEvents(
        orderProcessor.context.processor,
        processor_snapshop ? Processor.deserializeState(processor_snapshop[orderProcessor.name]) : Processor.deserializeState(),
        processor_snapshop ? processor_snapshop["inventory"] : null,
        await orderState.rollForwardState(orderProcessor.context))

    var last_inventory_trigger = inv_process_state


    console.log(`order_processor_startup (3): restore 'ordering state', seq=${orderState.state.sequence}, #orders=${orderState.state.orders.length}, #inv=${orderState.state.inventory.size}`)

    function checkRestartStage(doc_id, stage) {
        const order_state = orderState.state.orders.find(o => o.doc_id === doc_id)
        if (!order_state) {
            throw new Error(`order_processor_startup: Got a processor state without the ordering state: doc_id=${doc_id}`)
        } else if (stage !== order_state.status.stage) {
            return true
        }
        return false
    }

    //const processorState: ProcessingState = required_processor_state[orderProcessor.name]
    console.log(`order_processor_startup (4): re-applying active processor state, order#=${order_process_state.proc_map.size}`)
    orderProcessor.restartProcessors(checkRestartStage, order_process_state)

    console.log(`order_processor_startup (5): loop to re-inflate 'sleep_until' processes..`)
    setInterval(() => {
        // check to restart 'sleep_until' processes
        orderProcessor.restartProcessors(checkRestartStage)//, orderProcessor.state, false)
    }, 1000 * 5 /* 5 seconds */)


    let lastcheckpoint_seq: number = orderState.state.sequence

    const LOOP_MINS = 1, LOOP_CHANGES = 100
    console.log(`order_processor_startup (6): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (ctx, chkdir) => {
        console.log(`Checkpointing check: seq=${orderState.state.sequence}, #orders=${orderState.state.orders.length}, #inv=${orderState.state.inventory.size}.  Processing size=${orderProcessor.state.proc_map.size}`)
        if (orderState.state.sequence > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            lastcheckpoint_seq = await orderState.snapshotState(ctx, chkdir, {
                [ctx.processor]: orderProcessor.serializeState(),
                "inventory": last_inventory_trigger
            })
        }
    }, 1000 * 60 * LOOP_MINS, orderProcessor.context, chkdir)


    console.log(`order_processor_startup (7): starting picking control loop (5 seconds)`)
    setInterval(function (ctx) {
        const change = ordering_operation(ctx, { type: ActionType.ProcessPicking })
        if (change) {
            ws_server_emit(ctx, change)
        }
    }, 5000, orderProcessor.context)

    const cont_order_token = order_process_state.last_trigger
    assert((orderState.state.orders.length === 0) === (!cont_order_token), 'Error, we we have inflated orders, we need a order continuation token')
    console.log(`order_processor_startup (8):  start watch for new "orders" (startAfter=${cont_order_token && cont_order_token._id})`)
    db.collection(StoreDef["orders"].collection).watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": StoreDef["orders"].status.NewOrUpdatedOrder }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup", ...(cont_order_token && { startAfter: cont_order_token._id }) }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', orderProcessor.callback())


    const cont_inv_token = inv_process_state
    assert((orderState.state.inventory.size === 0) === (!cont_inv_token), 'Error, we we have inflated inventry, we need a inventory continuation token')
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

        const change = ordering_operation(orderProcessor.context, { type: ActionType.NewInventory, spec: data.fullDocument })
        //const processor: ProcessorInfo = {
        //    processor: ProcessorType.INVENTORY,
        //    trigger_full: data
        //}

        last_inventory_trigger = data
        ws_server_emit(orderProcessor.context, { ...change, processor: { "inventory": data } })
    })

    return orderProcessor.context
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

function ws_server_startup({ stateManager }) {

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
                ...stateManager.state,
                // convert Inventry Map into Array of objects
                inventory: Array.from(stateManager.state.inventory).map(([sku, val]) => {
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
    //try {
    const ctx = await order_processor_startup()
    await ws_server_startup(ctx)

    //} catch (e) {
    //    console.error(e)
    //    process.exit(1)
    //}
}

init()
