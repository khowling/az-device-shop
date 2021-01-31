import { Processor, ProcessorOptions } from '../util/processor'
import {
    StateUpdates, OrderActionType,
    OrderStateManager,
    OrderStage, OrderObject, OrderStatus
} from './orderingState'

const StoreDef = {
    "business": { collection: "business" }
}


async function validateOrder({ connection, trigger, flow_id }, next) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        spec = await connection.db.collection("orders_spec").findOne({ _id: trigger.doc_id, partition_key: connection.tenent.email })
    }

    await next({ type: OrderActionType.New, id: flow_id, spec }, { update_ctx: { spec } } as ProcessorOptions)
}


async function allocateInventry({ flow_id, spec }, next) {
    console.log(`allocateInventry`)
    await next({ type: OrderActionType.AllocateInventory, id: flow_id, spec })
}

async function picking({ flow_id, spec }, next) {
    console.log(`picking forward`)
    await next({ type: OrderActionType.StatusUpdate, id: flow_id, spec, status: { stage: OrderStage.PickingReady } }, { sleep_until: { stage: OrderStage.PickingComplete } } as ProcessorOptions)
}

async function shipping({ flow_id, spec }, next) {
    console.log(`shipping forward`)
    await next({ type: OrderActionType.StatusUpdate, id: flow_id, spec, status: { stage: OrderStage.Shipped } }, { sleep_until: { time: Date.now() + 1000 * 60 * 3 /* 3mins */ } } as ProcessorOptions)
}

async function complete({ flow_id, spec }, next) {
    console.log(`complete forward`)
    await next({ type: OrderActionType.StatusUpdate, id: flow_id, spec, status: { stage: OrderStage.Complete } })
}

// ---------------------------------------------------------------------------------------

const { MongoClient, ObjectID } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB

import { Atomic } from '../util/atomic'
import { snapshotState, returnLatestSnapshot, rollForwardState } from '../util/event_hydrate'


var event_seq: number
async function orderprocessing_startup() {

    const murl = new URL(MongoURL)
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    console.log(`orderprocessing_startup (1):  connecting to: ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    const db = client.db()
    const connection = {
        db, tenent: await db.collection("business").findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
    }

    // Get state apply mutex
    const stateMutex = new Atomic()

    const orderState = new OrderStateManager({
        commitEventsFn: commitEvents.bind(null, connection),
        stateMutex,
    });


    const orderProcessor = new Processor({
        name: "ordProcv1",
        statePlugin: {
            processActionFn: orderState.processAction.bind(orderState),
            applyEventsFn: orderState.stateStoreApply.bind(orderState),
            commitEventsFn: commitEvents.bind(null, connection),
            stateMutex
        }
    })

    // add connection to ctx, to allow middleware access, (maybe not required!)
    orderProcessor.context.connection = connection

    orderProcessor.use(validateOrder)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    console.log(`orderprocessing_startup (3):  get latest checkpoint file, return event sequence #, state and processor snapshots`)
    const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
    const { sequence_snapshot, state_snapshot, processor_snapshop } = await returnLatestSnapshot(connection, chkdir)

    orderState.stateStore.deserializeState(state_snapshot)
    orderProcessor.deserializeState(processor_snapshop && processor_snapshop[orderProcessor.name])

    // Set "event_seq" & "lastcheckpoint_seq" to value from snapshop
    event_seq = sequence_snapshot ? sequence_snapshot : 0
    let lastcheckpoint_seq: number = event_seq
    let last_inventory_trigger = processor_snapshop ? processor_snapshop[orderProcessor.name] : null

    console.log(`orderprocessing_startup (4): read events since last checkpoint (seq#=${event_seq}), apply to orderState and order_processor_state`)
    event_seq = await rollForwardState(connection, "order_events", event_seq, null, ({ state, processor }) => {
        if (state) {
            process.stdout.write('s')
            orderState.stateStoreApply(state)
        }
        if (processor) {
            if (processor[orderProcessor.name]) {
                process.stdout.write('p')
                orderProcessor.applyEvents(processor[orderProcessor.name])
            }
            if (processor["inventory"]) {
                process.stdout.write('i')
                last_inventory_trigger = processor["inventory"]
            }
        }
    })
    console.log(`orderprocessing_startup (5): restored 'ordering state' to seq=${orderState.stateStore.state._control.head_sequence}, #orders=${orderState.stateStore.state.orders.items.length}, #inv=${orderState.stateStore.state.inventory.length}`)

    console.log(`orderprocessing_startup (6): re-start processor state, order count=${orderProcessor.state.proc_map.size}`)
    function checkRestartStage(id, stage) {
        const oidx = orderState.stateStore.state.orders.items.findIndex(o => o.id === id)
        if (oidx < 0) {
            throw new Error(`orderprocessing_startup: Got a processor state without the state: id=${id}`)
        } else if (stage !== orderState.stateStore.state.orders.items[oidx].status.stage) {
            return true
        }
        return false
    }
    orderProcessor.restartProcessors(checkRestartStage, true)

    console.log(`orderprocessing_startup (7): loop to re-start 'sleep_until' processes..`)
    setInterval(() => {
        // check to restart 'sleep_until' processes
        orderProcessor.restartProcessors(checkRestartStage, false)//, orderProcessor.state, false)
    }, 1000 * 5 /* 5 seconds */)



    const LOOP_MINS = 10, LOOP_CHANGES = 100
    console.log(`orderprocessing_startup (8): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (c, chkdir) => {
        console.log(`Checkpointing check: seq=${event_seq}, #orders=${orderState.stateStore.state.orders.items.length}, #inv=${orderState.stateStore.state.inventory.length}.  Processing size=${orderProcessor.state.proc_map.size}`)
        if (event_seq > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            await snapshotState(c, chkdir, event_seq,
                orderState.stateStore.serializeState, {
                [orderProcessor.name]: orderProcessor.serializeState,
                "inventory": last_inventory_trigger
            }
            )
            lastcheckpoint_seq = event_seq
        }
    }, 1000 * 60 * LOOP_MINS, connection, chkdir)


    console.log(`orderprocessing_startup (9): starting picking control loop (5 seconds)`)
    setInterval(async function () {
        await orderState.dispatch({ type: OrderActionType.PickingProcess })
    }, 5000)


    //const cont_inv_token = last_inventory_trigger
    //assert((orderState.state.inventory.size === 0) === (!last_inventory_trigger), 'Error, we we have inflated inventry, we need a inventory continuation token')

    // If we are starting from a empty trigger, or a sequence trigger
    if ((!last_inventory_trigger) || last_inventory_trigger.factory_events_sequence) {
        console.log(`orderprocessing_startup (10):  start watch "factory_events":  NO last_inventory_trigger watch_resume, so read all existing events from seq#=${last_inventory_trigger ? last_inventory_trigger.factory_events_sequence : 0} before starting new watch`)

        // get db time, so we know where to continue the watch
        const admin = db.admin()
        const { lastStableCheckpointTimestamp } = await admin.replSetGetStatus()

        var factory_events_seq = await rollForwardState(connection, "factory_events", last_inventory_trigger ? last_inventory_trigger.factory_events_sequence : 0, "NEWINV", async ({ sequence, state, processor }) => {
            if (state) {
                for (const { status } of state) {
                    if (status.complete_item && status.completed_sequence) { // { "qty" : 180, "product" : "5f5253167403c56057f5bb0e", "warehouse" : "emea" }
                        last_inventory_trigger = { factory_events_sequence: sequence, completed_sequence: status.completed_sequence }
                        await orderState.dispatch({ type: OrderActionType.InventryNew, spec: status.complete_item }, { "inventory": last_inventory_trigger })
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
        { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": connection.tenent.email }, { "fullDocument.label": "NEWINV" }] } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ],
        { fullDocument: "updateLookup", ...(last_inventory_trigger && { ...last_inventory_trigger.watch_resume }) }
    ).on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
        console.log(`inventoryStreamWatcher got complete Inventory labeld event`)

        last_inventory_trigger = { watch_resume: { startAfter: data._id } }
        assert(data.fullDocument.state && data.fullDocument.state.inventory, `Watching "${data.ns.coll}" for label="NEWINV" records, but not received "state.inventory" change`)
        const { inventory } = data.fullDocument.state
        orderState.stateStoreApply({ inventory })
    })

    const cont_token = orderProcessor.state.last_trigger['orders_spec']
    //assert((order_processor_state.processor_sequence === 0) === (!cont_order_token), 'orderprocessing_startup (11):  start watch for new "orders_spec": Error, we we have inflated ordering processors, we need a orders_spec continuation token')
    console.log(`orderprocessing_startup (11):  start watch for new "orders_spec" (startAfter=${cont_token})`)
    db.collection("orders_spec").watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": connection.tenent.email }, { "fullDocument.status": 30 /*NewOrUpdatedOrder*/ }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup", ...(cont_token && { startAfter: cont_token.startAfter }) }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', doc => {
        // doc._id == event document includes a resume token as the _id field
        // doc.clusterTime == 
        // doc.opertionType == "insert"
        // doc.ns.coll == "Collection"
        // doc.documentKey == A document that contains the _id of the document created or modified 
        orderProcessor.initiateWorkflow({ trigger: { doc_id: doc.documentKey._id } }, { [doc.ns.coll]: { startAfter: doc._id } })
    })

    return { orderProcessor, orderState }
}

//  ---- Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()

async function commitEvents({ db, tenent }, state: Array<StateUpdates>, processor: any, label?: string) {

    if (state || processor) {
        const res = await db.collection("order_events").insertOne({
            sequence: ++event_seq,
            partition_key: tenent.email,
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

function ws_server_startup({ orderProcessor, orderState }) {

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
            },
            state: orderState.stateStore.serializeState
            /* {
                ...orderState.stateStore.serializeState,
                // convert Inventry Map into Array of objects
                //inventory: Array.from(orderState.state.inventory).map(([sku, val]) => {
                //    return { doc_id: sku, status: val }
                //})
            }*/
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
    ws_server_startup(await orderprocessing_startup())

    //} catch (e) {
    //    console.error(e)
    //    process.exit(1)
    //}
}

init()
