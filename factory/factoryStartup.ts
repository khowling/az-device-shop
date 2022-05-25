import mongodb from 'mongodb';
import { ObjectId } from 'bson'
import { Processor, ProcessorOptions } from "@az-device-shop/eventing/processor"
import { FactoryActionType, FactoryAction, FactoryStateManager, WorkItemStage, WorkItemObject } from './factoryState.js'

async function validateRequest({ esConnection, trigger }, next: (action: FactoryAction, options: ProcessorOptions, event_label?: string) => any) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        const mongo_spec = await esConnection.db.collection("inventory_spec").findOne({ _id: new ObjectId(trigger.doc_id), partition_key: esConnection.tenentKey })
        // translate the db document '*_id' ObjectId fields to '*Id' strings
        spec = { ...mongo_spec, ...(mongo_spec.product_id && { productId: mongo_spec.product_id.toHexString() }) }
    }

    return await next({ type: FactoryActionType.New, spec }, { update_ctx: { spec } } as ProcessorOptions)
}

async function sendToFactory(ctx, next) {
    const added : WorkItemObject  = ctx.lastLinkedRes.workItems.added as WorkItemObject
    return await next(
        { type: FactoryActionType.StatusUpdate, _id: added._id, status: { stage: WorkItemStage.FactoryReady } }, { update_ctx: { wi_id: added._id } } as ProcessorOptions
    )
}

async function waitforFactoryComplete(ctx, next) {
    const currentVal : WorkItemObject = ctx.linkedStore.getValue('workItems', 'items', ctx.wi_id)
    return await next(null, 
        { retry_until: { isTrue: currentVal.status.stage === WorkItemStage.FactoryComplete} } as ProcessorOptions
    )
}

async function moveToWarehouse(ctx, next) {
    return await next({ type: FactoryActionType.StatusUpdate, _id: ctx.wi_id, spec: ctx.spec, status: { stage: WorkItemStage.MoveToWarehouse } }, { sleep_until: Date.now() + 1000 * 4 /* 4 secs */  } as ProcessorOptions)
}


async function publishInventory(ctx, next) {

    return await next({ type: FactoryActionType.CompleteInventry, _id: ctx.wi_id, spec: ctx.spec }, { sleep_until: { time: Date.now() + 1000 * 5 /* 5 secs */ } })
}

async function completeInventoryAndFinish(ctx, next) {
    console.log (`publishInventory: ctx.lastLinkedRes=${JSON.stringify(ctx.lastLinkedRes.inventory_complete.inc)}`)
    const completeInvSeq = parseInt(ctx.lastLinkedRes.inventory_complete.inc)
    const result = await ctx.esConnection.db.collection("inventory_complete").insertOne({
        _id: completeInvSeq,
        sequence: completeInvSeq,
        partition_key: ctx.esConnection.tenentKey,
        inventoryId: 'INV' + String(completeInvSeq).padStart(5, '0'),
        spec: ctx.spec,
        workItem_id: ctx.wi_id
    })



    return await next({ type: FactoryActionType.TidyUp, _id: ctx.wi_id })
}

// ---------------------------------------------------------------------------------------
import {ApplicationState, default as ServiceWebServer}  from '@az-device-shop/eventing/webserver'
import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
//import { watchProcessorTriggerWithTimeStamp } from '@az-device-shop/eventing/processor-actions'

async function factoryStartup(cs: EventStoreConnection, appState: ApplicationState) {

    appState.log(`factoryStartup (1):  create factory state manager "factoryState"`)
    const factoryState = new FactoryStateManager('emeafactory_v0', cs)

    appState.log(`factoryStartup (2):  create factory processor "factoryProcessor" & add workflow tasks`)
    const factoryProcessor = new Processor('emeaprocessor_v001', cs, { linkedStateManager: factoryState })
    // add esConnection to ctx, to allow middleware access, (maybe not required!)
    factoryProcessor.context.esConnection = cs
    // add workflow actions
    factoryProcessor.use(validateRequest)
    factoryProcessor.use(sendToFactory)
    factoryProcessor.use(waitforFactoryComplete)
    factoryProcessor.use(moveToWarehouse)
    factoryProcessor.use(publishInventory)
    factoryProcessor.use(completeInventoryAndFinish)

    const submitFn = await factoryProcessor.listen()


    appState.log(`factoryStartup (5): Starting Interval to run "FactoryProcess" control loop (5 seconds)`)
    const factInterval = setInterval(async function () {
        //console.log('factoryStartup: checking on progress WorkItems in "FactoryStage.Building"')
        await factoryState.dispatch({ type: FactoryActionType.FactoryProcess })
    }, 5000)

    const watchCollection = 'inventory_spec', filter = { "status": 'Required' }
    appState.log(`factoryStartup (6): Starting new ${watchCollection} watch"`)

    let last_incoming_processed = factoryProcessor.getProcessorState('last_incoming_processed')
    
    if (!last_incoming_processed.continuation) {

        // No oplog continuation, so instead of starting the watch from the current position, read the collection from the sequence (or the start of the file)
        // inventory_spec & order_spec, nether have 'sequence' fields, so order by '_ts' Timestamp
        await cs.db.collection(watchCollection).createIndex({ '_ts': 1 })

        // Need aggretate to allow for ordering!
        const cursor = await cs.db.collection(watchCollection).aggregate([
                { $match: { $and: [{ 'partition_key': cs.tenentKey}, filter] } },
                { $sort: { '_ts': 1 } } 
        ])
    
        while ( await cursor.hasNext()) {
            const doc = await cursor.next()
            await submitFn({ trigger: { doc_id: doc._id.toHexString() } }, { continuation: { startAtOperationTime: doc._ts } })
        }
    }

    // now look for continuation again (as the statements above will have updated the processor state!)
    last_incoming_processed = factoryProcessor.getProcessorState('last_incoming_processed')


    console.log(`watchProcessorTriggerWithTimeStamp:  for [${factoryProcessor.name}]: Start watch "${watchCollection}"  continuation=${last_incoming_processed.continuation} (if continuation undefined, start watch from now)`)
    cs.db.collection(watchCollection).watch(
        [
            { $match: { $and: [{ 'operationType': { $in: ['insert'].concat(process.env.USE_COSMOS ? ['update', 'replace'] : []) } }, { 'fullDocument.partition_key': cs.tenentKey }].concat(filter ? Object.keys(filter).reduce((acc, i) => { return { ...acc, ...{ [`fullDocument.${i}`]: filter[i] } } }, {}) as any : []) } }
            // https://docs.microsoft.com/en-us/azure/cosmos-db/mongodb/change-streams?tabs=javascript#current-limitations
            , { $project: { 'ns': 1, 'documentKey': 1,  ...(!process.env.USE_COSMOS && {"operationType": 1 } ), 'fullDocument.status': 1, 'fullDocument.partition_key': 1 } }
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

        await submitFn({ trigger: { doc_id: documentKey._id.toHexString() } }, { continuation: { /* startAfter */ resumeAfter: change._id } })
    })


    appState.log(`factoryStartup: FINISHED`, true)
    return { submitFn, factoryState, processorState: factoryProcessor.stateManager }
}


// ---------------------------------------------------------------------------------------
async function init() {

    const appState = new ApplicationState()

    const murl = process.env.MONGO_DB
    appState.log(`Initilise EventStoreConnection with 'factory_events' (MONGO_DB=${murl})`)
    const esConnection = new EventStoreConnection(murl, 'factory_events')

    esConnection.on('tenent_changed', async (oldTenentId) => {
        appState.log(`EventStoreConnection: TENENT CHANGED - DELETING existing ${esConnection.collection} documents partition_id=${oldTenentId} & existing`, false, true)
        await esConnection.db.collection(esConnection.collection).deleteMany({ partition_key: oldTenentId })
        process.exit()
    })

    let { submitFn, factoryState, processorState } = await factoryStartup(await esConnection.init(true), appState)

    // Http health + monitoring + API
    const web = new ServiceWebServer({ port: process.env.PORT || 9091, appState})

    // curl -XPOST "http://localhost:9091/submit" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
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
    /* ** defined on the ServiceWebServer constructor
    web.addRoute('GET', '/healthz', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'All Good'
        }))
    })
    */
    web.createServer()


    // WebSocket - telemetry
    web.createWebSocketServer()
    web.on('newclient', ws => {
        ws.send(JSON.stringify({
            type: "snapshot",
            metadata: {
                factory_txt: ['Waiting', 'Building', 'Complete'],
                stage_txt: ['Draft', 'New', 'FactoryReady', 'FactoryAccepted', 'FactoryComplete', 'MoveToWarehouse', 'InventoryAvailable']
            },
            state: factoryState.stateStore.serializeState
        }))
    })
    processorState.on('changes', (events) => web.sendAllClients({ type: "events", state: events[factoryState.name] }))
    factoryState.on('changes', (events) => web.sendAllClients({ type: "events", state: events[factoryState.name] }))

}

init()
