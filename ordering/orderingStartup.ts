import mongodb from 'mongodb';
const { ObjectId } = mongodb;
import { Processor, ProcessorOptions } from "@az-device-shop/eventing/processor"
import { OrderActionType, OrderStateManager, OrderStage } from './orderingState.js'


async function validateOrder({ connection, trigger, flow_id }, next) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        const mongo_spec = await connection.db.collection("orders_spec").findOne({ _id: new ObjectId(trigger.doc_id), partition_key: connection.tenentKey })
        // translate the db document '*_id' ObjectId fields to '*Id' strings
        spec = { ...mongo_spec, ...(mongo_spec.items && { items: mongo_spec.items.map(i => { return { ...i, ...(i.product_id && { productId: i.product_id.toHexString() }) } }) }) }
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
import ServiceWebServer from "@az-device-shop/eventing/webserver"
import { EventStoreConnection } from "@az-device-shop/eventing/store-connection"
import { startCheckpointing, restoreState } from "@az-device-shop/eventing/state-restore"
import { watchDispatchWithSequence, watchProcessorTriggerWithTimeStamp } from "@az-device-shop/eventing/processor-actions"

async function orderingStartup(cs: EventStoreConnection) {

    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    console.log(`orderingStartup (1):  Create order state manager "orderState"`)
    const orderState = new OrderStateManager('emeaordering_v0', cs)

    console.log(`orderingStartup (2):  create ordering processor "orderProcessor" & add workflow tasks`)
    const orderProcessor = new Processor('emeaprocessor_v001', cs, { statePlugin: orderState })
    // add connection to ctx, to allow middleware access, (maybe not required!)
    orderProcessor.context.connection = cs
    // add workflow actions
    orderProcessor.use(validateOrder)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(picking)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    console.log(`orderingStartup (3): Hydrate local stateStores "orderState" & "orderProcessor" from snapshots & event log`)
    const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
    let last_checkpoint = await restoreState(cs, chkdir, [
        orderState.stateStore,
        orderProcessor.stateStore
    ])
    console.log(`orderingStartup (3): Complete Hydrate, restored "${cs.collection}" to sequence=${cs.sequence},  "orderState" restored state to head_sequence=${orderState.stateStore.state._control.head_sequence}  #orders=${orderState.stateStore.state.orders.items.length} #onhand=${orderState.stateStore.state.inventory.onhand.length}, "orderProcessor" restored to flow_sequence=${orderProcessor.processorState.flow_sequence}`)

    console.log(`orderingStartup (4): Re-start active "orderProcessor" workflows, #flows=${orderProcessor.processorState.proc_map.length}`)
    const prInterval = orderProcessor.initProcessors(function ({ id, stage }) {
        const oidx = orderState.stateStore.state.orders.items.findIndex(o => o.id === id)
        if (oidx < 0) {
            throw new Error(`orderingStartup: Got a processor state without the state: id=${id}`)
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


    console.log(`orderingStartup (5): Starting Interval to run "PickingProcess" control loop (5 seconds)`)
    const pickInterval = setInterval(async function () {
        await orderState.dispatch({ type: OrderActionType.PickingProcess })
    }, 5000)


    console.log(`orderingStartup (6): Starting new "inventory_complete" watch"`)
    const iwatch = watchDispatchWithSequence(cs, orderState, 'inventory', 'inventory_complete', 'inventoryId', 'spec', OrderActionType.InventryNew)

    console.log(`orderingStartup (7): Starting new "orders_spec" watch"`)
    const mwatch = watchProcessorTriggerWithTimeStamp(cs, 'orders_spec', orderProcessor, { "status": 30 })

    console.log(`orderingStartup: FINISHED`)
    return { orderProcessor, orderState }
}


// ---------------------------------------------------------------------------------------
async function init() {

    const murl = process.env.MONGO_DB
    console.log(`Initilise EventStoreConnection with 'order_events' (MONGO_DB=${murl})`)
    const connection = new EventStoreConnection(murl, 'order_events')

    connection.on('tenent_changed', async (oldTenentId) => {
        console.error(`EventStoreConnection: TENENT CHANGED - DELETING existing ${connection.collection} documents partition_id=${oldTenentId} & existing`)
        await connection.db.collection(connection.collection).deleteMany({ partition_key: oldTenentId })
        process.exit()
    })

    let { orderState, orderProcessor } = await orderingStartup(await connection.init())

    // Http health + monitoring + API
    const web = new ServiceWebServer({ port: process.env.PORT || 9090 })

    // curl -XPOST "http://localhost:9090/submit" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
    web.addRoute('POST', '/submit', (req, res) => {
        let body = ''
        req.on('data', (chunk) => {
            body = body + chunk
        });
        req.on('end', async () => {
            //console.log(`http trigger got: ${body}`)
            try {
                const po = await orderProcessor.initiateWorkflow({ trigger: { doc: JSON.parse(body) } }, null)
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ack',
                    info: po,
                    status_url: `/query/${po.id}`
                }))
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                return res.end(JSON.stringify({
                    status: 'nack',
                    error: `failed to create workflow err=${err}`
                }))
            }
        })
    })
    web.addRoute('GET', '/query/', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'tbc',
        }))
    })
    web.addRoute('GET', '/healthz', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'All Good'
        }))
    })
    web.createServer()


    // WebSocket - telemetry
    web.createWebSocketServer()
    web.on('newclient', ws => {
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
    })
    orderProcessor.on('changes', (events) => web.sendAllClients({ type: "events", state: events[orderState.name] }))
    orderState.on('changes', (events) => web.sendAllClients({ type: "events", state: events[orderState.name] }))

}



init()
