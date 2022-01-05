import mongodb from 'mongodb';
const { ObjectId } = mongodb;
import { Processor, ProcessorOptions } from "@az-device-shop/eventing/processor"
import { WorkItemActionType, WorkItemAction, FactoryStateManager, WorkItemStage } from './factoryState.js'

export enum OperationLabel { NEWINV = "NEWINV" }

async function validateRequest({ esConnection, trigger, flow_id }, next: (action: WorkItemAction, options: ProcessorOptions, event_label?: string) => any) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        const mongo_spec = await esConnection.db.collection("inventory_spec").findOne({ _id: new ObjectId(trigger.doc_id), partition_key: esConnection.tenentKey })
        // translate the db document '*_id' ObjectId fields to '*Id' strings
        spec = { ...mongo_spec, ...(mongo_spec.product_id && { productId: mongo_spec.product_id.toHexString() }) }
    }

    await next({ type: WorkItemActionType.New, id: flow_id, spec }, { update_ctx: { spec } } as ProcessorOptions)
}

async function inFactory({ flow_id, spec }, next) {
    await next({ type: WorkItemActionType.StatusUpdate, id: flow_id, spec, status: { stage: WorkItemStage.FactoryReady } }, { sleep_until: { id: flow_id, stage: WorkItemStage.FactoryComplete } } as ProcessorOptions)
}

async function moveToWarehouse({ flow_id, spec }, next) {
    await next({ type: WorkItemActionType.StatusUpdate, id: flow_id, spec, status: { stage: WorkItemStage.MoveToWarehouse } }, { sleep_until: { time: Date.now() + 1000 * 10 /* 10 secs */ } } as ProcessorOptions)
}


async function publishInventory({ flow_id, spec }, next) {
    await next({ type: WorkItemActionType.CompleteInventry, id: flow_id, spec }, { sleep_until: { time: Date.now() + 1000 * 10 /* 10 secs */ } }, OperationLabel.NEWINV)
}

async function tidyUp({ flow_id, spec }, next) {
    await next({ type: WorkItemActionType.TidyUp, id: flow_id })
}

// ---------------------------------------------------------------------------------------
import {ApplicationState, default as ServiceWebServer}  from '@az-device-shop/eventing/webserver'
import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
import { startCheckpointing, restoreState } from '@az-device-shop/eventing/state-restore'
import { watchProcessorTriggerWithTimeStamp } from '@az-device-shop/eventing/processor-actions'

async function factoryStartup(cs: EventStoreConnection, appState: ApplicationState) {

    appState.log(`factoryStartup (1):  create factory state manager "factoryState"`)
    const factoryState = new FactoryStateManager('emeafactory_v0', cs)

    appState.log(`factoryStartup (2):  create factory processor "factoryProcessor" & add workflow tasks`)
    const factoryProcessor = new Processor('emeaprocessor_v001', cs, { statePlugin: factoryState })
    // add esConnection to ctx, to allow middleware access, (maybe not required!)
    factoryProcessor.context.esConnection = cs
    // add workflow actions
    factoryProcessor.use(validateRequest)
    factoryProcessor.use(inFactory)
    factoryProcessor.use(moveToWarehouse)
    factoryProcessor.use(publishInventory)
    factoryProcessor.use(tidyUp)


    appState.log(`factoryStartup (3): Hydrate local stateStores "factoryState" & "factoryProcessor" from snapshots & event log`)
    const chkdir = `${process.env.FILEPATH || '.'}/factory_checkpoint`
    const last_checkpoint = await restoreState(cs, chkdir, [
        factoryState.stateStore,
        factoryProcessor.stateStore
    ])
    appState.log(`factoryStartup (3): Complete Hydrate, restored to event sequence=${cs.sequence},  "factoryState" restored to head_sequence=${factoryState.stateStore.state._control.head_sequence}  #workItems=${factoryState.stateStore.state.workItems.items.length}, "factoryProcessor" restored to flow_sequence=${factoryProcessor.processorState.flow_sequence}`)



    appState.log(`factoryStartup (4): Re-start active "factoryProcessor" workflows, #flows=${factoryProcessor.processorState.proc_map.length}`)
    const prInterval = factoryProcessor.initProcessors(function ({ id, stage }) {
        const widx = factoryState.stateStore.state.workItems.items.findIndex(o => o.id === id)
        if (widx < 0) {
            throw new Error(`factoryStartup: Got a processor state without the state: id=${id}`)
        } else if (stage !== factoryState.stateStore.state.workItems.items[widx].status.stage) {
            return true
        }
        return false
    })

    if (false) {
        const cpInterval = startCheckpointing(cs, chkdir, last_checkpoint, [
            factoryState.stateStore,
            factoryProcessor.stateStore
        ])
    }

    appState.log(`factoryStartup (5): Starting Interval to run "FactoryProcess" control loop (5 seconds)`)
    const factInterval = setInterval(async function () {
        //console.log('factoryStartup: checking on progress WorkItems in "FactoryStage.Building"')
        await factoryState.dispatch({ type: WorkItemActionType.FactoryProcess })
    }, 5000)

    appState.log(`factoryStartup (6): Starting new "inventory_spec" watch"`)
    const mwatch = watchProcessorTriggerWithTimeStamp(cs, 'inventory_spec', factoryProcessor, { "status": 'Required' })

    appState.log(`factoryStartup: FINISHED`, true)
    return { factoryProcessor, factoryState }
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

    let { factoryState, factoryProcessor } = await factoryStartup(await esConnection.init(), appState)

    // Http health + monitoring + API
    const web = new ServiceWebServer({ port: process.env.PORT || 9091, healthFn:  appState.healthz})

    // curl -XPOST "http://localhost:9091/submit" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
    web.addRoute('POST', '/submit', (req, res) => {
        let body = ''
        req.on('data', (chunk) => {
            body = body + chunk
        });
        req.on('end', async () => {
            //console.log(`http trigger got: ${body}`)
            try {
                const po = await factoryProcessor.initiateWorkflow({ trigger: { doc: JSON.parse(body) } }, null)
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
    factoryProcessor.on('changes', (events) => web.sendAllClients({ type: "events", state: events[factoryState.name] }))
    factoryState.on('changes', (events) => web.sendAllClients({ type: "events", state: events[factoryState.name] }))

}

init()
