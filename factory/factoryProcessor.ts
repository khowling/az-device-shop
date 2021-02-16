
import { ObjectId } from 'mongodb'
import { Processor, ProcessorOptions } from '../common/processor'
import {
    StateUpdates, WorkItemActionType, WorkItemAction,
    FactoryStateManager,
    WorkItemStage
} from './factoryState'

export enum OperationLabel { NEWINV = "NEWINV" }



async function validateRequest({ connection, trigger, flow_id }, next: (action: WorkItemAction, options: ProcessorOptions, event_label?: string) => any) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        const mongo_spec = await connection.db.collection("inventory_spec").findOne({ _id: ObjectId(trigger.doc_id), partition_key: connection.tenent.email })
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


// Mongo require

const assert = require('assert').strict
const MongoURL = process.env.MONGO_DB

import { StateConnection } from '../common/stateConnection'
import { startCheckpointing, restoreState } from '../common/event_hydrate'
import { mongoWatchProcessorTrigger } from '../common/processorActions'

async function factory_startup() {
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    console.log(`factory_startup (1):  Initilise Connection`)
    const cs = await new StateConnection(MongoURL, 'factory_events').init()


    console.log(`factory_startup (2):  create factory state manager "factoryState"`)
    const factoryState = new FactoryStateManager('emeafactory_v0', cs)

    console.log(`factory_startup (3):  create factory workflow manager "factoryProcessor", and use middleware`)
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

    console.log(`factory_startup (4): restored to event sequence=${cs.sequence},  "factoryState" restored to head_sequence=${factoryState.stateStore.state._control.head_sequence}  #workItems=${factoryState.stateStore.state.workItems.items.length}, "factoryProcessor" restored to flow_sequence=${factoryProcessor.processorState.flow_sequence}`)


    console.log(`factory_startup (5): Re-start active "factoryProcessor" workflows, #flows=${factoryProcessor.processorState.proc_map.length}`)
    const prInterval = factoryProcessor.initProcessors(function ({ id, stage }) {
        const widx = factoryState.stateStore.state.workItems.items.findIndex(o => o.id === id)
        if (widx < 0) {
            throw new Error(`factory_startup: Got a processor state without the state: id=${id}`)
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

    console.log(`factory_startup (8): Starting Interval to run "FactoryProcess" action (5 seconds)`)
    const factInterval = setInterval(async function () {
        //console.log('factory_startup: checking on progress WorkItems in "FactoryStage.Building"')
        await factoryState.dispatch({ type: WorkItemActionType.FactoryProcess })
    }, 5000)


    const mwatch = mongoWatchProcessorTrigger(cs, 'inventory_spec', factoryProcessor, { "status": 'Required' })

    return { factoryProcessor, factoryState }
}



//  ---- Factory Monitoring Websocket
//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;

function ws_server_startup({ factoryProcessor, factoryState }) {

    const WebSocket = require('ws'),
        http = require('http'),
        //    serveStatic = require('serve-static'),
        //    useragent = require('express-useragent'),
        port = process.env.PORT || 9091

    const httpTrigger = async function (req, res) {
        const { headers, method, url } = req

        if (method === 'POST' && url === '/submit') {
            let body = ''
            req.on('data', (chunk) => {
                body = body + chunk
            });
            req.on('end', async () => {
                //console.log(`http trigger got: ${body}`)
                try {
                    const po = await factoryProcessor.initiateWorkflow({ trigger: { doc: JSON.parse(body) } })
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

            });
        } else if (method === 'GET' && url.includes('/query/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'tbc',
            }))
        } else {

            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('probe ok');

        }
    }

    const ws_server_clients: WS_ServerClientType = new Map()

    const httpServer = http.createServer(httpTrigger).listen(port)
    console.log(`ws_server_startup: listening to port ${port}`)

    // Web Socket Server
    const wss = new WebSocket.Server({
        perMessageDeflate: false,
        server: httpServer
    });

    wss.on('connection', function connection(ws) {
        console.log(`websocket connection`)
        const client_id = ws_server_clients.size
        ws_server_clients.set(client_id, ws)

        ws.send(JSON.stringify({
            type: "snapshot",
            metadata: {
                factory_txt: ['Waiting', 'Building', 'Complete'],
                stage_txt: ['Draft', 'New', 'FactoryReady', 'FactoryAccepted', 'FactoryComplete', 'MoveToWarehouse', 'InventoryAvailable']
            },
            state: factoryState.stateStore.serializeState
        }))

        ws.on('close', function close() {
            if (ws_server_clients.has(client_id)) {
                // dont send any more messages
                ws_server_clients.delete(client_id)
                console.log(`disconnected ${client_id}`)
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

    factoryProcessor.on('changes', (events) => sendEvents(events[factoryState.name]))
    factoryState.on('changes', (events) => sendEvents(events[factoryState.name]))
}

async function init() {
    //try {
    ws_server_startup(await factory_startup())
    //} catch (e) {
    //    console.error(e)
    //    process.exit(1)
    //}
}

init()
