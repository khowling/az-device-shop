import mongodb from 'mongodb';
import { ObjectId, Timestamp } from 'bson';
import { Processor, ProcessorOptions } from "@az-device-shop/eventing/processor"
import { OrderActionType, OrderStateManager, OrderStage, OrderObject } from './orderingState.js'


async function validateOrder({ esConnection, trigger }, next) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        const mongo_spec = await esConnection.db.collection("orders_spec").findOne({ _id: new ObjectId(trigger.doc_id), partition_key: esConnection.tenentKey })
        // translate the db document '*_id' ObjectId fields to '*Id' strings
        spec = { ...mongo_spec, ...(mongo_spec.items && { items: mongo_spec.items.map(i => { return { ...i, ...(i.product_id && { productId: i.product_id.toHexString() }) } }) }) }
    }

    return await next({ type: OrderActionType.OrdersNew, spec }, { update_ctx: { spec } } as ProcessorOptions)
}


async function allocateInventry(ctx, next) {
    const added  = ctx.lastLinkedRes.orders.added as OrderObject
    console.log(`allocateInventry`)
    return await next({ type: OrderActionType.OrdersProcessLineItems, _id: added._id }, { update_ctx: { order_id: added._id }} as ProcessorOptions)
}

async function picking(ctx, next) {
    // check result of allocateInventry action
    const { failed, message } = ctx.lastLinkedRes.orders.merged.status
    console.log(`picking forward ctx.order_id=${ctx.order_id}`)
    return await next(!failed ? { type: OrderActionType.StatusUpdate, _id: ctx.order_id, status: { stage: OrderStage.PickingReady } } : null, failed && {complete: true} as ProcessorOptions)
}

async function waitforPickingComplete(ctx, next) {
    const currentVal : OrderObject = ctx.linkedStore.getValue('orders', 'items', ctx.order_id)
    return await next(null, 
        { retry_until: { isTrue: currentVal.status.stage === OrderStage.PickingComplete} } as ProcessorOptions
    )
}

async function shipping(ctx, next) {
    console.log(`shipping forward`)
    return await next({ type: OrderActionType.StatusUpdate, _id: ctx.order_id, status: { stage: OrderStage.Shipped } }, { sleep_until: Date.now() + 1000 * 60 * 1 /* 1mins */ } as ProcessorOptions)
}

async function complete(ctx, next) {
    console.log(`complete forward`)
    return await next({ type: OrderActionType.StatusUpdate, _id: ctx.order_id, status: { stage: OrderStage.Complete } })
}

// ---------------------------------------------------------------------------------------
import {ApplicationState, default as ServiceWebServer} from "@az-device-shop/eventing/webserver"
import { EventStoreConnection } from "@az-device-shop/eventing/store-connection"

async function orderingStartup(cs: EventStoreConnection, appState: ApplicationState) {

    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    appState.log(`orderingStartup (1):  Create order state manager "orderState"`)
    const orderState = new OrderStateManager('emeaordering_v0', cs)

    appState.log(`orderingStartup (2):  create ordering processor "orderProcessor" & add workflow tasks`)
    const orderProcessor = new Processor('emeaprocessor_v001', cs, { linkedStateManager: orderState })
    // add connection to ctx, to allow middleware access, (maybe not required!)
    orderProcessor.context.esConnection = cs
    // add workflow actions
    orderProcessor.use(validateOrder)
    orderProcessor.use(allocateInventry)
    orderProcessor.use(picking)
    orderProcessor.use(waitforPickingComplete)
    orderProcessor.use(shipping)
    orderProcessor.use(complete)

    const submitFn = await orderProcessor.listen()

    appState.log(`orderingStartup (3): Starting Interval to run "PickingProcess" control loop (5 seconds)`)
    const pickInterval = setInterval(async function () {
        await orderState.dispatch({ type: OrderActionType.PickingProcess })
    }, 5000)


    const invCompleteCollection = 'inventory_complete' // has sequence
    appState.log(`orderingStartup 4): reading and watching "${invCompleteCollection}"`)
    
    if (true) { // Check if no continuation, read watchCollection from seqenuce, or the start of the collection 
        const { sequence, continuation } = orderState.stateStore.getValue('inventory', 'last_incoming_processed')

        // No oplog continuation, so instead of starting the watch from the current position
        if (!continuation) {
            appState.log(`orderingStartup 4): reading and watching "${invCompleteCollection}, starting from sequence ${sequence}`)
            await cs.db.collection(invCompleteCollection).createIndex({ sequence: 1 })

            const cursor = await cs.db.collection(invCompleteCollection).aggregate(
                [
                    { $match: { $and: [{ 'partition_key': cs.tenentKey }].concat(sequence ? { sequence: { $gt: sequence } } as any : []) } },
                ].concat({ $sort: { sequence: 1 } } as any)
            )
        
            while (await cursor.hasNext()) {
                const invCompleteDoc = await cursor.next()
                await orderState.dispatch({ type: OrderActionType.InventryNew, /* inventoryId: doc.inventoryId,*/ invCompleteDoc, trigger: { sequence: invCompleteDoc.sequence } })
            }

        }
    }

    //assert(!(last_inventory_trigger && last_inventory_trigger.factory_events_sequence), `orderingProcessor (10):  start watch "collection" for NEWINV. resume cannot be a sequence`)
    const { sequence, continuation } = orderState.stateStore.getValue('inventory', 'last_incoming_processed')

    appState.log(`orderingStartup 4): reading and watching "${invCompleteCollection}, starting watch sequence sequence=${sequence}, continuation=${continuation}`)
    cs.db.collection(invCompleteCollection).watch([
        { $match: { $and: [{ 'operationType': { $in: ['insert'].concat(process.env.USE_COSMOS ? ['update', 'replace'] : []) } }, { 'fullDocument.partition_key': cs.tenentKey }].concat(sequence ? { 'fullDocument.sequence': { $gt: sequence } } as any : []) } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ],
        { fullDocument: "updateLookup", ...(continuation && { ...continuation }) }
    ).on('change', async change => {
        const invCompleteDoc = change.fullDocument
        console.log(`watchDispatchWithSequence collection="${invCompleteCollection}": change _id=${JSON.stringify(change._id)} (invCompleteDoc.sequence=${invCompleteDoc.sequence})`)
        await orderState.dispatch({ type:  OrderActionType.InventryNew, invCompleteDoc, trigger: { sequence: invCompleteDoc.sequence, continuation: { /* startAfter */ resumeAfter: change._id } } })
    })


    // /////////////////////////////////////////////////////////////////////////////
    // If no continuation, read any checked out documents from "orders_spec" using , then start a watch!
    // When checkout, web sets status=30 && $currentDate: { "_checkoutTimeStamp": { $type: "timestamp" } }, can use this for continuation
    const orderSpecCollection = 'orders_spec', filter = { "status": 30, "_checkoutTimeStamp": {$ne:null}}
    appState.log(`orderingStartup 5): reading and watching "${orderSpecCollection}"`)

    let last_incoming_processed = orderProcessor.getProcessorState('last_incoming_processed')
    
    if (!last_incoming_processed.continuation) {

        // No oplog continuation, so instead of starting the watch from the current position, read the collection from the sequence (or the start of the file)
        // inventory_spec & order_spec, nether have 'sequence' fields, so order by '_ts' Timestamp
        await cs.db.collection(orderSpecCollection).createIndex({ '_checkoutTimeStamp': 1, "status": 1})

        // Need aggretate to allow for ordering!
        const cursor = await cs.db.collection(orderSpecCollection).aggregate([
                { $match: { $and: [{ 'partition_key': cs.tenentKey}, filter] } },
                { $sort: { '_checkoutTimeStamp': 1 } } 
        ])
    
        while (await cursor.hasNext()) {
            const doc = await cursor.next()
            await submitFn({ trigger: { doc_id: doc._id.toHexString() } }, { continuation: { startAtOperationTime: doc._checkoutTimeStamp } })
        }
    }

    // now look for continuation again (as the statements above will have updated the processor state!)
    last_incoming_processed = orderProcessor.getProcessorState('last_incoming_processed')
    const lastTimestamp = last_incoming_processed?.continuation?.startAtOperationTime as Timestamp

    console.log(`factoryStartup (6):  for [${orderProcessor.name}]: Start watch "${orderSpecCollection}"  continuation=${last_incoming_processed.continuation} (if continuation undefined, start watch from now)`)
    cs.db.collection(orderSpecCollection).watch(
        [
            { $match: { $and: [{ 'operationType': { $in: ['insert','update', 'replace'] } }, { 'fullDocument.partition_key': cs.tenentKey }].concat(filter ? Object.keys(filter).reduce((acc, i) => { return { ...acc, ...{ [`fullDocument.${i}`]: filter[i] } } }, {}) as any : []) } }
            // https://docs.microsoft.com/en-us/azure/cosmos-db/mongodb/change-streams?tabs=javascript#current-limitations
            , { $project: { 'ns': 1, 'documentKey': 1,  "operationType": 1 , 'fullDocument._checkoutTimeStamp': 1, 'fullDocument.status': 1, 'fullDocument.partition_key': 1 } }
        ],
        { fullDocument: 'updateLookup', ...(last_incoming_processed.continuation && last_incoming_processed.continuation) }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', async change => {
        // change._id == event document includes a resume token as the _id field
        // change.clusterTime == 
        // change.opertionType == "insert"
        // change.ns.coll == "Collection"
        // change.documentKey == A document that contains the _id of the document created or modified 

        // Typescript error: https://jira.mongodb.org/browse/NODE-3621
        const documentKey  = change.documentKey  as unknown as { _id: ObjectId }
         
        if (lastTimestamp && lastTimestamp.comp(change.fullDocument._checkoutTimeStamp) === 0 ) {
            console.log (`skipping, already processed ${lastTimestamp}`)
        } else {
            await submitFn({ trigger: { doc_id: documentKey._id.toHexString() } }, { continuation: { /* startAfter */ resumeAfter: change._id } })
        }
    })

    appState.log(`orderingStartup: FINISHED`, true)
    return { submitFn, orderState, processorState: orderProcessor.stateManager }
}


// ---------------------------------------------------------------------------------------
async function init() {

    const appState = new ApplicationState()

    const murl = process.env.MONGO_DB
    appState.log(`Initilise EventStoreConnection with 'order_events' (MONGO_DB=${murl})`)
    const connection = new EventStoreConnection(murl, 'order_events')

    connection.on('tenent_changed', async (oldTenentId) => {
        appState.log(`EventStoreConnection: TENENT CHANGED - DELETING existing ${connection.collection} documents partition_id=${oldTenentId} & existing`, false, true)
        await connection.db.collection(connection.collection).deleteMany({ partition_key: oldTenentId })
        process.exit()
    })

    let { submitFn, orderState, processorState } = await orderingStartup(await connection.init(true), appState)

    // Http health + monitoring + API
    const web = new ServiceWebServer({ port: process.env.PORT || 9090, appState })

    // curl -XPOST "http://localhost:9090/submit" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
    web.addRoute('POST', '/submit', (req, res) => {
        let body = ''
        req.on('data', (chunk) => {
            body = body + chunk
        });
        req.on('end', async () => {
            //console.log(`http trigger got: ${body}`)
            try {
                const po = await submitFn({ trigger: { doc: JSON.parse(body) } }, null)
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ack',
                    info: po,
                    status_url: `/query/${po.added._id}`
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
                stateDefinition: orderState.stateStore.stateDefinition,
                factory_txt: ['Waiting', 'Picking', 'Complete'],
                stage_txt: ['Draft',
                    'New',
                    'InventoryAllocated',
                    'PickingReady',
                    'PickingAccepted',
                    'PickingComplete',
                    'Shipped',
                    'Complete',
                    'Failed']
            },
            state: orderState.stateStore.serializeState
        }))
    })
    processorState.on('changes', (events) => 
        events[orderState.name] && web.sendAllClients({ type: "events", state: events[orderState.name] })
    )
    orderState.on('changes', (events) => 
        web.sendAllClients({ type: "events", state: events[orderState.name] })
    )

}



init()
