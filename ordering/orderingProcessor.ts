import { ObjectId } from 'mongodb'
import { Processor, ProcessorOptions } from '../common/processor'
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
        const mongo_spec = await connection.db.collection("orders_spec").findOne({ _id: ObjectId(trigger.doc_id), partition_key: connection.tenent.email })
        spec = { ...mongo_spec, ...(mongo_spec.items && { items: mongo_spec.items.map(i => { return { ...i, ...(i.item && i.item._id && { productId: i.item._id.toHexString() }) } }) }) }
    }

    await next({ type: OrderActionType.OrdersNew, id: flow_id, spec }, { update_ctx: { spec } } as ProcessorOptions)
}


async function allocateInventry({ flow_id, spec }, next) {
    console.log(`allocateInventry`)
    await next({ type: OrderActionType.OrdersProcessLineItems, id: flow_id, spec })
}

async function picking({ flow_id, spec }, next) {
    console.log(`picking forward`)
    await next({ type: OrderActionType.StatusUpdate, id: flow_id, spec, status: { stage: OrderStage.PickingReady } }, { sleep_until: { id: flow_id, stage: OrderStage.PickingComplete } } as ProcessorOptions)
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

import { StateConnection } from '../common/stateConnection'
import { startCheckpointing, restoreState } from '../common/event_hydrate'
import { mongoCollectionDependency, mongoWatchProcessorTrigger } from '../common/processorActions'

async function orderingProcessor() {

    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    console.log(`orderingProcessor (1):  Create "StateConnection" and "OrderStateManager" and "Processor"`)
    const cs = await new StateConnection(MongoURL, 'order_events').init()
    const orderState = new OrderStateManager('ordemea_v01', cs)
    const orderProcessor = new Processor('pemea_v01', cs, { statePlugin: orderState })
    // add connection to ctx, to allow middleware access, (maybe not required!)
    orderProcessor.context.connection = cs

    console.log(`orderingProcessor (2):  Create actions for "Processor" workflow name=${orderProcessor.name}`)
    orderProcessor.use(validateOrder)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
    let last_checkpoint = await restoreState(cs, chkdir, [
        orderState.stateStore,
        orderProcessor.stateStore
    ])
    console.log(`orderingProcessor (4): Restored "${cs.collection}" to sequence=${cs.sequence},  "orderState" restored state to head_sequence=${orderState.stateStore.state._control.head_sequence}  #orders=${orderState.stateStore.state.orders.items.length} #onhand=${orderState.stateStore.state.inventory.onhand.length}, "orderProcessor" restored to flow_sequence=${orderProcessor.processorState.flow_sequence}`)

    console.log(`orderingProcessor (5): Re-start active "orderProcessor" workflows, #flows=${orderProcessor.processorState.proc_map.length}`)
    const prInterval = orderProcessor.initProcessors(function ({ id, stage }) {
        const oidx = orderState.stateStore.state.orders.items.findIndex(o => o.id === id)
        if (oidx < 0) {
            throw new Error(`orderingProcessor: Got a processor state without the state: id=${id}`)
        } else if (stage !== orderState.stateStore.state.orders.items[oidx].status.stage) {
            return true
        }
        return false
    })

    if (false) {
        const cpInterval = startCheckpointing(cs, chkdir, last_checkpoint, [
            orderState.stateStore,
            orderProcessor.stateStore
        ])
    }


    console.log(`orderingProcessor (6): starting picking control loop (5 seconds)`)
    const pickInterval = setInterval(async function () {
        await orderState.dispatch({ type: OrderActionType.PickingProcess })
    }, 5000)



    const iwatch = mongoCollectionDependency(cs, orderState, 'inventory', 'inventory_complete', OrderActionType.InventryNew)
    const mwatch = mongoWatchProcessorTrigger(cs, 'orders_spec', orderProcessor, { "status": 30 })

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

    const httpServer = http.createServer(function probes(req, res) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('okay');
    }).listen(port)
    console.log(`ws_server_startup: listening to port ${port}`)

    // Web Socket Server
    const wss = new WebSocket.Server({
        perMessageDeflate: false,
        server: httpServer
    });

    const ws_server_clients: WS_ServerClientType = new Map()

    wss.on('connection', function connection(ws) {
        console.log(`websocket connection`)
        const client_id = ws_server_clients.size
        ws_server_clients.set(client_id, ws)

        ws.send(JSON.stringify({
            type: "snapshot",
            metadata: {
                factory_txt: ['Waiting', 'Picking', 'Complete'],
                stage_txt: ['Draft',
                    'New',
                    'InventoryAllocated',
                    'PickingReady',
                    'PickingAccepted',
                    'PickingComplete',
                    'Shipped',
                    'Complete']
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
    ws_server_startup(await orderingProcessor())

    //} catch (e) {
    //    console.error(e)
    //    process.exit(1)
    //}
}

init()
