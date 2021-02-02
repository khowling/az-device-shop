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

const assert = require('assert').strict
const MongoURL = process.env.MONGO_DB

import { StateConnection } from '../util/stateConnection'
import { snapshotState, restoreState } from '../util/event_hydrate'


async function orderprocessing_startup() {

    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    console.log(`orderprocessing_startup (1):  Initilise Connection`)
    const cs = await new StateConnection(new URL(MongoURL), 'order_events').init()

    console.log(`orderprocessing_startup (2):  create order state manager "orderState"`)
    const orderState = new OrderStateManager('ordemea_v01', cs)

    console.log(`orderprocessing_startup (3):  create order workflow manager "orderProcessor", and use middleware`)
    const orderProcessor = new Processor('pemea_v01', cs, { statePlugin: orderState })

    // add connection to ctx, to allow middleware access, (maybe not required!)
    orderProcessor.context.connection = cs

    orderProcessor.use(validateOrder)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
    let [restore_sequence, last_checkpoint] = await restoreState(cs, chkdir, [
        orderState.stateStore,
        orderProcessor.stateStore
    ])
    cs.sequence = restore_sequence


    console.log(`orderprocessing_startup (4): restored to event sequence=${cs.sequence},  "orderState" restored to head_sequence=${orderState.stateStore.state._control.head_sequence}  #orders=${orderState.stateStore.state.orders.items.length}, "orderProcessor" restored to flow_sequence=${orderProcessor.processorState.flow_sequence}`)

    console.log(`orderprocessing_startup (5): Re-start active "orderProcessor" workflows, #flows=${orderProcessor.processorState.proc_map.length}`)
    function checkRestartStage({ id, stage }) {
        const oidx = orderState.stateStore.state.orders.items.findIndex(o => o.id === id)
        if (oidx < 0) {
            throw new Error(`orderprocessing_startup: Got a processor state without the state: id=${id}`)
        } else if (stage !== orderState.stateStore.state.orders.items[oidx].status.stage) {
            return true
        }
        return false
    }
    orderProcessor.restartProcessors(checkRestartStage, true)

    console.log(`orderprocessing_startup (6): loop to re-start 'sleep_until' processes..`)
    setInterval(() => {
        // check to restart 'sleep_until' processes
        orderProcessor.restartProcessors(checkRestartStage, false)//, orderProcessor.state, false)
    }, 1000 * 5 /* 5 seconds */)



    const LOOP_MINS = 10, LOOP_CHANGES = 100
    console.log(`orderprocessing_startup (7): Starting Interval to checkpoint state  (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (cs, chkdir) => {
        console.log(`Checkpointing check: seq=${cs.sequence},  Processing size=${orderProcessor.processorState.proc_map.length}`)
        if (cs.sequence > last_checkpoint + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            last_checkpoint = await snapshotState(cs, chkdir, [
                orderState.stateStore,
                orderProcessor.stateStore
            ])
        }
    }, 1000 * 60 * LOOP_MINS, cs, chkdir)


    console.log(`orderprocessing_startup (8): starting picking control loop (5 seconds)`)
    setInterval(async function () {
        await orderState.dispatch({ type: OrderActionType.PickingProcess })
    }, 5000)



    const inv_last_processed = orderState.stateStore.state.inventory_complete.last_incoming_processed

    //const cont_inv_token = last_inventory_trigger
    //assert((orderState.state.inventory.size === 0) === (!last_inventory_trigger), 'Error, we we have inflated inventry, we need a inventory continuation token')

    // If we are starting from a empty trigger, or a sequence trigger
    if (!inv_last_processed.continuation) {
        console.log(`orderprocessing_startup (9): "inventory_complete": No continuation, so read all existing records from seq#=${inv_last_processed.sequence} before starting new watch`)

        // get db time, so we know where to continue the watch
        const admin = cs.db.admin()
        const { startAtOperationTime } = await admin.replSetGetStatus()

        await cs.db.collection('inventory_complete').createIndex({ sequence: 1 })
        const cursor = await cs.db.collection('inventory_complete').aggregate(
            [
                { $match: { $and: [{ "partition_key": cs.tenent.email }, { sequence: { $gt: inv_last_processed.sequence } }] } },
                { $sort: { "sequence": 1 } }
            ]
        )

        while (await cursor.hasNext()) {
            const { _id, partition_key, sequence, ...spec } = await cursor.next()
            await orderState.dispatch({ type: OrderActionType.NewInventryComplete, id: _id.toHexString(), spec, trigger: { sequence, ...(await !cursor.hasNext() && { continuation: { startAtOperationTime } }) } })
            console.log();
        }
        /*
                var factory_events_seq = await rollForwardState(connection, "inventory_complete", last_inventory_trigger ? last_inventory_trigger.factory_events_sequence : 0, "NEWINV", async ({ sequence, state, processor }) => {
                    if (state) {
                        for (const { status } of state) {
                            if (status.complete_item && status.completed_sequence) { // { "qty" : 180, "product" : "5f5253167403c56057f5bb0e", "warehouse" : "emea" }
                                last_inventory_trigger = { factory_events_sequence: sequence, completed_sequence: status.completed_sequence }
                                await orderState.dispatch({ type: OrderActionType.NewInventryComplete, spec: status.complete_item }, { "inventory": last_inventory_trigger })
                            }
                        }
                    }
                })
                // it processed any  events, then start main watch from timestamp from query, else assume there are no factory events.
                console.log(`processed events up until seq#=${factory_events_seq}, setting watch resume from timestamp`)
                last_inventory_trigger = { watch_resume: { startAtOperationTime: lastStableCheckpointTimestamp } }
        */
    }



    //assert(!(last_inventory_trigger && last_inventory_trigger.factory_events_sequence), `orderprocessing_startup (10):  start watch "inventory_complete" for NEWINV. resume cannot be a sequence`)
    const { continuation } = orderState.stateStore.state.inventory_complete.last_incoming_processed
    console.log(`orderprocessing_startup (10):  start watch "inventory_complete" for NEWINV (startAfter=${continuation})`)

    var inventoryStreamWatcher = cs.db.collection("inventory_complete").watch([
        { $match: { $and: [{ "operationType": { $in: ["insert"] } }, { "fullDocument.partition_key": cs.tenent.email } /*, { "fullDocument.label": "NEWINV" }*/] } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ],
        { fullDocument: "updateLookup", ...(continuation && { ...continuation }) }
    ).on('change', async doc => {
        const { _id, partition_key, sequence, ...spec } = doc.fullDocument
        await orderState.dispatch({ type: OrderActionType.NewInventryComplete, id: _id.toHexString(), spec, trigger: { sequence, continuation: { startAfter: doc._id } } })
    })








    const cont_token = orderProcessor.processorState.last_incoming_processed
    //assert((order_processor_state.processor_sequence === 0) === (!cont_order_token), 'orderprocessing_startup (11):  start watch for new "orders_spec": Error, we we have inflated ordering processors, we need a orders_spec continuation token')
    console.log(`orderprocessing_startup (11):  start watch for new "orders_spec" (startAfter=${cont_token})`)
    cs.db.collection("orders_spec").watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": cs.tenent.email }, { "fullDocument.status": 30 /*NewOrUpdatedOrder*/ }] } }
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

    const ws_server_clients: WS_ServerClientType = new Map()

    wss.on('connection', function connection(ws) {

        const client_id = ws_server_clients.size
        ws_server_clients.set(client_id, ws)

        ws.send(JSON.stringify({
            type: "snapshot",
            metadata: {
                stage_txt: ['OrderQueued', 'OrderNumberGenerated', 'InventoryAllocated', 'Picking', 'PickingComplete', 'Shipped', 'Complete']
            },
            state: orderState.stateStore.serializeState
        }))

        ws.on('close', function close() {
            if (ws_server_clients.has(client_id)) {
                // dont send any more messages
                ws_server_clients.delete(client_id)
                console.log(`ws_server_startup: disconnected ${client_id}`)
            }
        })
    })

    function sendEvents(state) {
        console.log('got emitted events!!')
        console.log(state)
        if (state) {
            // console.log(`sending state updates to ${ws_server_clients.size} clients`)
            for (let [key, ws] of ws_server_clients.entries()) {
                ws.send(JSON.stringify({ type: "events", state }))
            }
        }
    }

    orderProcessor.on('changes', (events) => sendEvents(events[orderState.name]))
    orderState.on('changes', (events) => sendEvents(events[orderState.name]))
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
