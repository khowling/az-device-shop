import { Processor, ProcessorOptions, ProcessingState } from '../util/processor'
import {
    StateChange, ChangeEventType,
    OrderStateManager,
    PickingStage, OrderStage, OrderObject, OrderStatus, InventoryStatus
} from './orderingState'

const StoreDef = {
    "business": { collection: "business" }
}


// Perform Action on ordering_state
interface OrderingAction {
    // Order actions
    type: ActionType;
    spec?: any; // used for NewOrUpdatedOrder / NewInventory
    doc_id?: string; // used for all updates
    status?: any; // used for StatusUpdate Actions
}
enum ActionType { NewInventory, NewOrUpdatedOrder, AllocateInventory, AllocateOrderNumber, StatusUpdate, ProcessPicking }

// Store in "https://github.com/Level/level"
// In Memory, volatile state
// Storing large objects in a GC language is questionable, maybe look at rocksdb


// Performs the operations against the local state, 
// validate if the requested operation is ok, then generate ChangeEvents and call 'apply_change_events' to apply to local state
function ordering_operation({ stateManager }, action: OrderingAction): [boolean, Array<StateChange>] {

    const next_sequence = stateManager.state.ordering_sequence + 1
    switch (action.type) {

        case ActionType.NewInventory: {
            const { product, qty, warehouse } = action.spec
            return stateManager.apply_change_events([{ kind: "Inventory", metadata: { doc_id: product, type: ChangeEventType.CREATE, next_sequence }, status: { onhand: qty } }])
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
            return stateManager.apply_change_events([{ kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.CREATE, next_sequence }, status: new_order_status }])
        }
        case ActionType.AllocateOrderNumber: {
            const { spec } = action
            return stateManager.apply_change_events([
                { kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE, next_sequence }, status: { stage: OrderStage.OrderNumberGenerated, order_number: 'ORD' + String(stateManager.state.order_sequence + 1).padStart(5, '0') } },
                { kind: "OrderingUpdate", metadata: { type: ChangeEventType.INC, next_sequence }, status: { sequence_update: 1 } }
            ])
        }
        case ActionType.StatusUpdate: {
            const { spec, status } = action
            // Needs to be Idempotent
            // TODO: Check if state already has Order Number 
            return stateManager.apply_change_events([{ kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...status } }])
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
            const order_statechange: StateChange = { kind: "Order", metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE, next_sequence }, status: order_status_update }
            let inventory_statechanges: Array<StateChange> = []

            if (!order_status_update.failed) {
                inventory_statechanges = Array.from(inventory_updates).map(([sku, inv_obj]): StateChange => {
                    return { kind: "Inventory", metadata: { doc_id: sku, type: ChangeEventType.UPDATE, next_sequence }, status: { onhand: inv_obj.onhand } }
                })
            }
            return stateManager.apply_change_events([order_statechange].concat(inventory_statechanges))
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
                statechanges.push({ kind: "Order", metadata: { doc_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...order_status_update } })
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
                statechanges.push({ kind: "Order", metadata: { doc_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...order_status_update } })
            }

            if (picking_allocated_update !== 0) {
                statechanges.push({ kind: "OrderingUpdate", metadata: { type: ChangeEventType.UPDATE, next_sequence }, status: { allocated_update: picking_allocated_update } })
            }
            if (statechanges.length > 0) {
                return stateManager.apply_change_events(statechanges)
            }
            return [false, null]
        }
        default:
            return [false, null]
    }
}


async function validateOrder(ctx, next) {
    console.log(`validateOrder forward, find order id=${ctx.trigger.documentKey._id.toHexString()}`)
    const spec = await ctx.db.collection('orders_spec').findOne({ _id: ctx.trigger.documentKey._id, partition_key: ctx.tenent.email })

    const [containsfailed, changes] = ordering_operation(ctx, { type: ActionType.NewOrUpdatedOrder, spec })
    await next(changes, { endworkflow: containsfailed, update_ctx: { spec } } as ProcessorOptions)
}


async function generateOrderNo(ctx, next) {
    console.log(`generateOrderNo forward`)
    //const order_seq = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ _id: "order-sequence-stage1", partition_key: ctx.tenent.email }, { $inc: { sequence_value: 1 } }, { upsert: true, returnOriginal: false, returnNewDocument: true })
    //const order_number = 'ORD' + String(order_seq.value.sequence_value).padStart(5, '0')
    const [containsfailed, changes] = ordering_operation(ctx, { type: ActionType.AllocateOrderNumber, spec: ctx.spec })
    await next(changes, { endworkflow: containsfailed } as ProcessorOptions)
}

async function allocateInventry(ctx, next) {
    console.log(`allocateInventry`)
    const [containsfailed, changes] = ordering_operation(ctx, { type: ActionType.AllocateInventory, spec: ctx.spec })
    await next(changes, { endworkflow: containsfailed } as ProcessorOptions)
}

async function picking(ctx, next) {
    console.log(`picking forward`)
    const [containsfailed, changes] = ordering_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Picking, picking: { starttime: Date.now(), status: PickingStage.Waiting, waittime: 0, progress: 0 } } })
    await next(changes, { endworkflow: containsfailed, sleep_until: { stage: OrderStage.PickingComplete } } as ProcessorOptions)
}

async function shipping(ctx, next) {
    console.log(`shipping forward`)
    const [containsfailed, changes] = ordering_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Shipped } })
    await next(changes, { endworkflow: containsfailed, sleep_until: { time: Date.now() + 1000 * 60 * 3 /* 3mins */ } } as ProcessorOptions)
}

async function complete(ctx, next) {
    console.log(`complete forward`)
    const [containsfailed, changes] = ordering_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: OrderStage.Complete } })
    await next(changes, { endworkflow: containsfailed } as ProcessorOptions)
}

// ---------------------------------------------------------------------------------------

const { MongoClient, ObjectID } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB

import { snapshotState, returnLatestSnapshot, rollForwardState } from '../util/event_hydrate'

var event_seq = 0

async function orderprocessing_startup() {
    const murl = new URL(MongoURL)

    console.log(`orderprocessing_startup (1):  connecting to: ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string

    const orderProcessor = new Processor({ name: "ordProcv1" })

    orderProcessor.use(validateOrder)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(generateOrderNo)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    const db = orderProcessor.context.db = client.db()
    orderProcessor.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
    console.log(`orderprocessing_startup (2):  got context tenent=${orderProcessor.context.tenent.email}`)

    // Setup action on next()
    orderProcessor.context.eventfn = ws_server_emit

    const orderState = new OrderStateManager();
    orderProcessor.context.stateManager = orderState

    console.log(`orderprocessing_startup (3):  get latest checkpoint file, return event sequence #, state and processor snapshots`)
    const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
    const { sequence_snapshot, state_snapshot, processor_snapshop } = await returnLatestSnapshot(orderProcessor.context, chkdir)

    event_seq = sequence_snapshot ? sequence_snapshot : event_seq
    let lastcheckpoint_seq: number = event_seq
    orderState.state = OrderStateManager.deserializeState(state_snapshot)
    let order_processor_state: ProcessingState = Processor.deserializeState(processor_snapshop && processor_snapshop[orderProcessor.name])
    let last_inventory_trigger = processor_snapshop ? processor_snapshop[orderProcessor.name] : null

    console.log(`orderprocessing_startup (4): read events since last checkpoint (seq#=${event_seq}), apply to orderState and order_processor_state`)
    event_seq = await rollForwardState(orderProcessor.context, "order_events", event_seq, null, ({ state, processor }) => {
        if (state) {
            process.stdout.write('s')
            orderState.apply_change_events(state)
        }
        if (processor) {
            if (processor[orderProcessor.name]) {
                process.stdout.write('p')
                order_processor_state = Processor.processor_state_apply(order_processor_state, processor[orderProcessor.name])
            }
            if (processor["inventory"]) {
                process.stdout.write('i')
                last_inventory_trigger = processor["inventory"]
            }
        }
    })
    console.log(`orderprocessing_startup (5): restored 'ordering state' to seq=${orderState.state.ordering_sequence}, #orders=${orderState.state.orders.length}, #inv=${orderState.state.inventory.size}`)

    console.log(`orderprocessing_startup (6): re-start processor state, order count=${order_processor_state.proc_map.size}`)
    function checkRestartStage(doc_id, stage) {
        const state = orderState.state.orders.find(o => o.doc_id === doc_id)
        if (!state) {
            throw new Error(`orderprocessing_startup: Got a processor state without the state: doc_id=${doc_id}`)
        } else if (stage !== state.status.stage) {
            return true
        }
        return false
    }
    orderProcessor.restartProcessors(checkRestartStage, order_processor_state)

    console.log(`orderprocessing_startup (7): loop to re-start 'sleep_until' processes..`)
    setInterval(() => {
        // check to restart 'sleep_until' processes
        orderProcessor.restartProcessors(checkRestartStage)//, orderProcessor.state, false)
    }, 1000 * 5 /* 5 seconds */)



    const LOOP_MINS = 10, LOOP_CHANGES = 100
    console.log(`orderprocessing_startup (8): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (ctx, chkdir) => {
        console.log(`Checkpointing check: seq=${event_seq}, #orders=${orderState.state.orders.length}, #inv=${orderState.state.inventory.size}.  Processing size=${orderProcessor.state.proc_map.size}`)
        if (event_seq > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            await snapshotState(ctx, chkdir, event_seq,
                orderState.serializeState, {
                [ctx.processor]: orderProcessor.serializeState(),
                "inventory": last_inventory_trigger
            }
            )
            lastcheckpoint_seq = event_seq
        }
    }, 1000 * 60 * LOOP_MINS, orderProcessor.context, chkdir)


    console.log(`orderprocessing_startup (9): starting picking control loop (5 seconds)`)
    setInterval(function (ctx) {
        const [containsfailed, changes] = ordering_operation(ctx, { type: ActionType.ProcessPicking })
        ws_server_emit(ctx, changes, null)
    }, 5000, orderProcessor.context)


    //const cont_inv_token = last_inventory_trigger
    assert((orderState.state.inventory.size === 0) === (!last_inventory_trigger), 'Error, we we have inflated inventry, we need a inventory continuation token')

    // If we are starting from a empty trigger, or a sequence trigger
    if ((!last_inventory_trigger) || last_inventory_trigger.factory_events_sequence) {
        console.log(`orderprocessing_startup (10):  start watch "factory_events":  NO last_inventory_trigger watch_resume, so read all existing events from seq#=${last_inventory_trigger ? last_inventory_trigger.factory_events_sequence : 0} before starting new watch`)

        // get db time, so we know where to continue the watch
        const admin = db.admin()
        const { lastStableCheckpointTimestamp } = await admin.replSetGetStatus()

        var factory_events_seq = await rollForwardState(orderProcessor.context, "factory_events", last_inventory_trigger ? last_inventory_trigger.factory_events_sequence : 0, "NEWINV", ({ sequence, state, processor }) => {
            if (state) {
                for (const { status } of state) {
                    if (status.complete_item) { // { "qty" : 180, "product" : "5f5253167403c56057f5bb0e", "warehouse" : "emea" }
                        last_inventory_trigger = { factory_events_sequence: sequence }
                        const [containsfailed, changes] = ordering_operation(orderProcessor.context, { type: ActionType.NewInventory, spec: status.complete_item })
                        ws_server_emit(orderProcessor.context, changes, { "inventory": last_inventory_trigger })
                    }
                }
            }
        })
        // it processed any  events, then start main watch from timestamp from query, else assume there are no factory events.
        console.log(`processed events up until seq#=${factory_events_seq}, setting watch resume from timestamp`)
        last_inventory_trigger = { watch_resume: { startAtOperationTime: lastStableCheckpointTimestamp } }

    }

    assert(!(last_inventory_trigger && last_inventory_trigger.factory_events_sequence), `orderprocessing_startup (10):  start watch "factory_events" for NEWINV. resume cannot be a sequence`)

    console.log(`orderprocessing_startup (10):  start watch "factory_events" for NEWINV (startAfter=${last_inventory_trigger})`)
    var inventoryStreamWatcher = db.collection("factory_events").watch([
        { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.label": "NEWINV" }] } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ],
        { fullDocument: "updateLookup", ...(last_inventory_trigger && { ...last_inventory_trigger.watch_resume }) }
    ).on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
        console.log(`inventoryStreamWatcher got complete Inventory labeld event`)

        last_inventory_trigger = { watch_resume: { startAfter: data._id } }
        for (const { status } of data.fullDocument.state) {
            if (status.complete_item) { // { "qty" : 180, "product" : "5f5253167403c56057f5bb0e", "warehouse" : "emea" }
                const [containsfailed, changes] = ordering_operation(orderProcessor.context, { type: ActionType.NewInventory, spec: status.complete_item })
                ws_server_emit(orderProcessor.context, changes, { "inventory": last_inventory_trigger })
            }
        }

    })

    const cont_order_token = order_processor_state.last_trigger
    assert((order_processor_state.processor_sequence === 0) === (!cont_order_token), 'orderprocessing_startup (11):  start watch for new "orders_spec": Error, we we have inflated ordering processors, we need a orders_spec continuation token')
    console.log(`orderprocessing_startup (11):  start watch for new "orders_spec" (startAfter=${cont_order_token && cont_order_token._id})`)
    db.collection("orders_spec").watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": orderProcessor.context.tenent.email }, { "fullDocument.status": 30 /*NewOrUpdatedOrder*/ }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup", ...(cont_order_token && { startAfter: cont_order_token._id }) }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', orderProcessor.callback())


    return orderProcessor.context
}

//  ---- Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()
function ws_server_emit(ctx, state: Array<StateChange>, processor: any, label?: string) {

    if (state || processor) {
        const res = ctx.db.collection("order_events").insertOne({
            sequence: ++event_seq,
            partition_key: ctx.tenent.email,
            ...(label && { label }),
            ...(state && { state }),
            ...(processor && { processor })
        })

        if (state) {
            console.log(`ws_server_emit: sending updates to ${ws_server_clients.size} clients`)
            for (let [key, ws] of ws_server_clients.entries()) {
                ws.send(JSON.stringify({ type: "events", state }))
            }
        }
    }
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
            type: "snapshot",
            metadata: {
                stage_txt: ['OrderQueued', 'OrderNumberGenerated', 'InventoryAllocated', 'Picking', 'PickingComplete', 'Shipped', 'Complete']
            }, state: {
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
    const ctx = await orderprocessing_startup()
    ws_server_startup(ctx)

    //} catch (e) {
    //    console.error(e)
    //    process.exit(1)
    //}
}

init()
