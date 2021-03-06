import { ObjectId } from 'mongodb'
import { Processor, ProcessorOptions } from '../common/processor'
import { OrderActionType, OrderStateManager, OrderStage } from './orderingState'


async function validateOrder({ connection, trigger, flow_id }, next) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        const mongo_spec = await connection.db.collection("orders_spec").findOne({ _id: ObjectId(trigger.doc_id), partition_key: connection.tenentKey })
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
import ServiceWebServer from '../common/ServiceWebServer'
import { StateConnection } from '../common/stateConnection'
import { startCheckpointing, restoreState } from '../common/event_hydrate'
import { mongoCollectionDependency, mongoWatchProcessorTrigger } from '../common/processorActions'

async function orderingStartup(cs: StateConnection) {

    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    console.log(`orderingStartup (1):  Create order state manager "OrderStateManager" and order workflow manager "orderProcessor"`)
    const orderState = new OrderStateManager('ordemea_v01', cs)
    const orderProcessor = new Processor('pemea_v01', cs, { statePlugin: orderState })

    // add connection to ctx, to allow middleware access, (maybe not required!)
    orderProcessor.context.connection = cs

    // add workflow actions
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
    console.log(`orderingStartup (4): Restored "${cs.collection}" to sequence=${cs.sequence},  "orderState" restored state to head_sequence=${orderState.stateStore.state._control.head_sequence}  #orders=${orderState.stateStore.state.orders.items.length} #onhand=${orderState.stateStore.state.inventory.onhand.length}, "orderProcessor" restored to flow_sequence=${orderProcessor.processorState.flow_sequence}`)

    console.log(`orderingStartup (5): Re-start active "orderProcessor" workflows, #flows=${orderProcessor.processorState.proc_map.length}`)
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


    console.log(`orderingStartup (6): starting picking control loop (5 seconds)`)
    const pickInterval = setInterval(async function () {
        await orderState.dispatch({ type: OrderActionType.PickingProcess })
    }, 5000)



    const iwatch = mongoCollectionDependency(cs, orderState, 'inventory', 'inventory_complete', 'inventoryId', 'spec', OrderActionType.InventryNew)
    const mwatch = mongoWatchProcessorTrigger(cs, 'orders_spec', orderProcessor, { "status": 30 })

    return { orderProcessor, orderState }
}


// ---------------------------------------------------------------------------------------
async function init() {

    const murl = process.env.MONGO_DB
    console.log(`Initilise Consumer Connection ${murl}`)
    const connection = new StateConnection(murl, 'order_events')

    connection.on('tenent_changed', async (oldTenentId) => {
        console.error(`StateConnection: TENENT CHANGED - DELETING existing ${connection.collection} documents partition_id=${oldTenentId} & existing`)
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
