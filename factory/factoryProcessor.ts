import { Processor, ProcessorOptions } from '../util/processor'
import {
    StateUpdates, WorkItemActionType, WorkItemAction,
    FactoryStateManager,
    WorkItemStage
} from './factoryState'

export enum OperationLabel { NEWINV = "NEWINV" }



async function validateRequest({ connection, trigger, flow_id }, next: (action: WorkItemAction, options: ProcessorOptions, event_label?: string) => any) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        spec = await connection.db.collection("inventory_spec").findOne({ _id: trigger.doc_id, partition_key: connection.tenent.email })
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
const { MongoClient, ObjectID } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB

import { Atomic } from '../util/atomic'
import { snapshotState, restoreLatestSnapshot, rollForwardState } from '../util/event_hydrate'

var event_seq: number
var stateFactoryName = 'emeafactory_v0.0.1'
async function factory_startup() {

    const murl = new URL(MongoURL)
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    console.log(`factory_startup (1):  connecting to db: ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    const db = client.db()
    const connection = {
        db, tenent: await db.collection("business").findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
    }

    // Get state apply mutex
    const stateMutex = new Atomic()

    console.log(`factory_startup (2):  create factory state manager "factoryState"`)
    const factoryState = new FactoryStateManager(stateFactoryName, {
        connection,
        commitEventsFn: commitEvents.bind(null, connection),
        stateMutex,
    })

    console.log(`factory_startup (3):  create factory workflow manager "factoryProcessor", and use middleware`)
    const factoryProcessor = new Processor('emeafactory_processor_v0.0.1', {
        name: "fctProcv1",
        statePlugin: factoryState,//{
        //processActionFn: factoryState.processAction.bind(factoryState),
        //applyEventsFn: factoryState.stateStoreApply.bind(factoryState), //Events.bind(factoryState),
        commitEventsFn: commitEvents.bind(null, connection),
        stateMutex
        // }
    })
    // add connection to ctx, to allow middleware access, (maybe not required!)
    factoryProcessor.context.connection = connection

    factoryProcessor.use(validateRequest)
    factoryProcessor.use(inFactory)
    factoryProcessor.use(moveToWarehouse)
    factoryProcessor.use(publishInventory)
    factoryProcessor.use(tidyUp)

    console.log(`factory_startup (3):  get latest checkpoint file, deserialize to "factoryState" & "factoryProcessor"`)
    const chkdir = `${process.env.FILEPATH || '.'}/factory_checkpoint`
    event_seq = await restoreLatestSnapshot(connection, chkdir, [
        factoryState.stateStore,
        factoryProcessor.stateStore
    ])
    /*
    const { sequence_snapshot, state_snapshot, processor_snapshop } = await returnLatestSnapshot(connection, chkdir)
    factoryState.stateStore.deserializeState(state_snapshot)
    factoryProcessor.deserializeState(processor_snapshop && processor_snapshop[factoryProcessor.name])
    */
    // Set "event_seq" & "lastcheckpoint_seq" to value from snapshop
    /*
    event_seq = sequence_snapshot ? sequence_snapshot : 0
    */

    let lastcheckpoint_seq: number = event_seq

    console.log(`factory_startup (4):  read events since last checkpoint (seq#=${event_seq}), apply to factoryState and factoryProcessor`)
    await rollForwardState(connection, "factory_events", event_seq, [
        factoryState.stateStore,
        factoryProcessor.stateStore
    ])

    console.log(`factory_startup (5): restored factory state to head_sequence=${factoryState.stateStore.state._control.head_sequence}, factory #workItems=${factoryState.stateStore.state.workItems.items.length}`)

    console.log(`factory_startup (6): re-start workflow engine state @ seq=${factoryProcessor.processorState.processor_sequence}, active flows count=${factoryProcessor.processorState.proc_map.length}`)
    function checkRestartStage({ id, stage }) {
        const widx = factoryState.stateStore.state.workItems.items.findIndex(o => o.id === id)
        if (widx < 0) {
            throw new Error(`factory_startup: Got a processor state without the state: id=${id}`)
        } else if (stage !== factoryState.stateStore.state.workItems.items[widx].status.stage) {
            return true
        }
        return false
    }
    factoryProcessor.restartProcessors(checkRestartStage, true)

    if (true) {
        console.log(`factory_startup (7): loop to re-start 'sleep_until' processes..`)
        setInterval(() => {
            //console.log('factory_startup: check to restart "sleep_until" processes')
            factoryProcessor.restartProcessors(checkRestartStage, false)
        }, 1000 * 10 /* 10 seconds */)
    }



    const LOOP_MINS = 10, LOOP_CHANGES = 100
    console.log(`factory_startup (8): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (c, chkdir) => {
        console.log(`Checkpointing check: seq=${event_seq},  Processing size=${factoryProcessor.processorState.proc_map.length}`)
        if (event_seq > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            await snapshotState(c, chkdir, event_seq, stateMutex, [
                factoryState.stateStore,
                factoryProcessor.stateStore
            ])
            lastcheckpoint_seq = event_seq
        }
    }, 1000 * 60 * LOOP_MINS, connection, chkdir)


    if (true) {
        console.log(`factory_startup (9): starting factory control loop (5 seconds)`)
        setInterval(async function () {
            //console.log('factory_startup: checking on progress WorkItems in "FactoryStage.Building"')
            await factoryState.dispatch({ type: WorkItemActionType.FactoryProcess })
        }, 5000)
    }


    const cont_token = factoryProcessor.processorState.last_incoming_processed
    console.log(`factory_startup (10):  start watch for new "inventory_spec" (startAfter=${cont_token})`)
    db.collection("inventory_spec").watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": connection.tenent.email }, { "fullDocument.status": 'Required' }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup", ...(cont_token && { ...cont_token }) }
    ).on('change', doc => {
        // doc._id == event document includes a resume token as the _id field
        // doc.clusterTime == 
        // doc.opertionType == "insert"
        // doc.ns.coll == "Collection"
        // doc.documentKey == A document that contains the _id of the document created or modified 
        factoryProcessor.initiateWorkflow({ trigger: { doc_id: doc.documentKey._id } }, { startAfter: doc._id })
    })


    return { factoryProcessor, factoryState }
}



//  ---- Factory Monitoring Websocket

//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()

async function commitEvents({ db, tenent }, state: { [key: string]: Array<StateUpdates> } /*, processor: any, label?: string*/): Promise<void> {

    //if (state || processor) {
    const res = await db.collection("factory_events").insertOne({
        sequence: ++event_seq,
        partition_key: tenent.email,
        ...state
        /*
        ...(label && { label }),
        ...(state && { state }),
        ...(processor && { processor }*/
    })

    if (state) {
        //            console.log(`sending state updates to ${ws_server_clients.size} clients`)
        if (state[stateFactoryName]) {
            for (let [key, ws] of ws_server_clients.entries()) {
                ws.send(JSON.stringify({ type: "events", state: state[stateFactoryName] }))
            }
        }
    }
    //}
}

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
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
                status: 'nack',
                error: `not found`
            }))
        }
    }

    const httpServer = http.createServer(httpTrigger).listen(port)
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
