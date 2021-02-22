import { ObjectId } from 'mongodb'
import { Processor, ProcessorOptions } from '../common/processor'
import { WorkItemActionType, WorkItemAction, FactoryStateManager, WorkItemStage } from './factoryState'

export enum OperationLabel { NEWINV = "NEWINV" }

async function validateRequest({ connection, trigger, flow_id }, next: (action: WorkItemAction, options: ProcessorOptions, event_label?: string) => any) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        const mongo_spec = await connection.db.collection("inventory_spec").findOne({ _id: ObjectId(trigger.doc_id), partition_key: connection.tenentKey })
        // remove the ObjectId from 'productId'
        spec = { ...mongo_spec, ...(mongo_spec.productId && { productId: mongo_spec.productId.toHexString() }) }
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
import ServiceWebServer from '../common/ServiceWebServer'
import { StateConnection } from '../common/stateConnection'
import { startCheckpointing, restoreState } from '../common/event_hydrate'
import { mongoWatchProcessorTrigger } from '../common/processorActions'

async function factoryStartup(cs: StateConnection) {

    console.log(`factoryStartup (1):  create factory state manager "factoryState"`)
    const factoryState = new FactoryStateManager('emeafactory_v0', cs)
    const factoryProcessor = new Processor('emeaprocessor_v001', cs, { statePlugin: factoryState })

    // add connection to ctx, to allow middleware access, (maybe not required!)
    factoryProcessor.context.connection = cs

    // add workflow actions
    factoryProcessor.use(validateRequest)
    factoryProcessor.use(inFactory)
    factoryProcessor.use(moveToWarehouse)
    factoryProcessor.use(publishInventory)
    factoryProcessor.use(tidyUp)

    const chkdir = `${process.env.FILEPATH || '.'}/factory_checkpoint`
    const last_checkpoint = await restoreState(cs, chkdir, [
        factoryState.stateStore,
        factoryProcessor.stateStore
    ])

    console.log(`factoryStartup (4): restored to event sequence=${cs.sequence},  "factoryState" restored to head_sequence=${factoryState.stateStore.state._control.head_sequence}  #workItems=${factoryState.stateStore.state.workItems.items.length}, "factoryProcessor" restored to flow_sequence=${factoryProcessor.processorState.flow_sequence}`)


    console.log(`factoryStartup (5): Re-start active "factoryProcessor" workflows, #flows=${factoryProcessor.processorState.proc_map.length}`)
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

    console.log(`factoryStartup (8): Starting Interval to run "FactoryProcess" action (5 seconds)`)
    const factInterval = setInterval(async function () {
        //console.log('factoryStartup: checking on progress WorkItems in "FactoryStage.Building"')
        await factoryState.dispatch({ type: WorkItemActionType.FactoryProcess })
    }, 5000)

    const mwatch = mongoWatchProcessorTrigger(cs, 'inventory_spec', factoryProcessor, { "status": 'Required' })
    return { factoryProcessor, factoryState }
}


// ---------------------------------------------------------------------------------------
async function init() {

    const murl = process.env.MONGO_DB
    console.log(`Initilise Consumer Connection ${murl}`)
    const connection = new StateConnection(murl, 'factory_events')

    connection.on('tenent_changed', async (oldTenentId) => {
        console.error(`StateConnection: TENENT CHANGED - DELETING existing ${connection.collection} documents partition_id=${oldTenentId} & existing`)
        await connection.db.collection(connection.collection).deleteMany({ partition_key: oldTenentId })
        process.exit()
    })

    let { factoryState, factoryProcessor } = await factoryStartup(await connection.init())

    // Http health + monitoring + API
    const web = new ServiceWebServer({ port: process.env.PORT || 9091 })

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
