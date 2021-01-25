import { Processor, ProcessorOptions } from '../util/processor'
import {
    StateChange, ActionType, WorkItemAction,
    FactoryStateManager,
    FactoryStage, WorkItemStage
} from './factoryState'

export enum OperationLabel { NEWINV = "NEWINV" }



async function validateRequest({ connection, trigger, flow_id }, next: (action: WorkItemAction, options: ProcessorOptions, event_label?: string) => any) {

    let spec = trigger && trigger.doc
    if (trigger && trigger.doc_id) {
        spec = await connection.db.collection("inventory_spec").findOne({ _id: trigger.doc_id, partition_key: connection.tenent.email })
    }

    await next({ type: ActionType.NewOrUpdatedInventoryRequest, flow_id, spec }, { update_ctx: { spec } } as ProcessorOptions)
}

async function generateWINo({ flow_id, spec }, next) {
    await next({ type: ActionType.AllocateWINumber, flow_id, spec })
}

async function inFactory({ flow_id, spec }, next) {
    await next({ type: ActionType.StatusUpdate, flow_id, spec, status: { stage: WorkItemStage.InFactory, factory_status: { starttime: Date.now(), stage: FactoryStage.Waiting, waittime: 0, progress: 0 } } }, { sleep_until: { flow_id, stage: WorkItemStage.FactoryComplete } } as ProcessorOptions)
}

async function moveToWarehouse({ flow_id, spec }, next) {
    await next({ type: ActionType.StatusUpdate, flow_id, spec, status: { stage: WorkItemStage.MoveToWarehouse } }, { sleep_until: { time: Date.now() + 1000 * 30 /* 30 secs */ } } as ProcessorOptions)
}


async function complete({ flow_id, spec }, next) {
    await next({ type: ActionType.CompleteInventry, flow_id, spec }, null, OperationLabel.NEWINV)
}



// Mongo require
const { MongoClient, ObjectID } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB

import { Atomic } from '../util/atomic'
import { snapshotState, returnLatestSnapshot, rollForwardState } from '../util/event_hydrate'

var event_seq: number
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
    const factoryState = new FactoryStateManager({
        commitEventsFn: commitEvents.bind(null, connection),
        stateMutex,
    })

    console.log(`factory_startup (3):  create factory workflow manager "factoryProcessor", and use middleware`)
    const factoryProcessor = new Processor({
        name: "fctProcv1",
        processActionFn: factoryState.processAction.bind(factoryState),
        applyEventsFn: factoryState.applyEvents.bind(factoryState),
        commitEventsFn: commitEvents.bind(null, connection),
        stateMutex
    })
    // add connection to ctx, to allow middleware access, (maybe not required!)
    factoryProcessor.context.connection = connection

    factoryProcessor.use(validateRequest)
    factoryProcessor.use(generateWINo)
    factoryProcessor.use(inFactory)
    factoryProcessor.use(moveToWarehouse)
    factoryProcessor.use(complete)

    console.log(`factory_startup (3):  get latest checkpoint file, deserialize to "factoryState" & "factoryProcessor"`)
    const chkdir = `${process.env.FILEPATH || '.'}/factory_checkpoint`
    const { sequence_snapshot, state_snapshot, processor_snapshop } = await returnLatestSnapshot(connection, chkdir)
    factoryState.deserializeState(state_snapshot)
    factoryProcessor.deserializeState(processor_snapshop && processor_snapshop[factoryProcessor.name])

    // Set "event_seq" & "lastcheckpoint_seq" to value from snapshop
    event_seq = sequence_snapshot ? sequence_snapshot : 0
    let lastcheckpoint_seq: number = event_seq

    console.log(`factory_startup (4):  read events since last checkpoint (seq#=${event_seq}), apply to factoryState and factoryProcessor`)
    event_seq = await rollForwardState(connection, "factory_events", event_seq, null, ({ state, processor }) => {
        if (state) {
            process.stdout.write('s')
            factoryState.applyEvents(state)
        }
        if (processor) {
            if (processor[factoryProcessor.name]) {
                process.stdout.write('p')
                factoryProcessor.applyEvents(processor[factoryProcessor.name])
            }
        }
    })

    console.log(`factory_startup (5): restored factory seq=${factoryState.state.factory_sequence}, factory #workitems=${factoryState.state.workitems.length}}`)

    console.log(`factory_startup (6): re-start workflow engine state @ seq=${factoryProcessor.state.processor_sequence}, active flows count=${factoryProcessor.state.proc_map.size}`)
    function checkRestartStage({ flow_id, stage }) {
        const widx = factoryState.state.workitems.findIndex(o => o.flow_id === flow_id)
        if (widx < 0) {
            throw new Error(`factory_startup: Got a processor state without the state: flow_id=${flow_id}`)
        } else if (stage !== factoryState.state.workitems[widx].status.stage) {
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
        console.log(`Checkpointing check: seq=${event_seq},  Processing size=${factoryProcessor.state.proc_map.size}`)
        if (event_seq > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            await snapshotState(c, chkdir, event_seq,
                factoryState.serializeState, {
                [factoryProcessor.name]: factoryProcessor.serializeState
            })
            lastcheckpoint_seq = event_seq
        }
    }, 1000 * 60 * LOOP_MINS, connection, chkdir)


    if (true) {
        console.log(`factory_startup (9): starting factory control loop (5 seconds)`)
        setInterval(async function () {
            //console.log('factory_startup: checking on progress WorkItems in "FactoryStage.Building"')
            await factoryState.apply({ type: ActionType.CheckFactoryProgress })
        }, 5000)
    }
    const cont_token = factoryProcessor.state.last_trigger['inventory_spec']

    console.log(`factory_startup (10):  start watch for new "inventory_spec" (startAfter=${cont_token})`)
    db.collection("inventory_spec").watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": connection.tenent.email }, { "fullDocument.status": 'Required' }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup", ...(cont_token && { startAfter: cont_token.startAfter }) }
    ).on('change', doc => {
        // doc._id == event document includes a resume token as the _id field
        // doc.clusterTime == 
        // doc.opertionType == "insert"
        // doc.ns.coll == "Collection"
        // doc.documentKey == A document that contains the _id of the document created or modified 
        factoryProcessor.initiateWorkflow({ trigger: { doc_id: doc.documentKey._id } }, { [doc.ns.coll]: { startAfter: doc._id } })
    })


    return { factoryProcessor, factoryState }
}



//  ---- Factory Monitoring Websocket

//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()

async function commitEvents({ db, tenent }, state: Array<StateChange>, processor: any, label?: string) {

    if (state || processor) {
        const res = await db.collection("factory_events").insertOne({
            sequence: ++event_seq,
            partition_key: tenent.email,
            ...(label && { label }),
            ...(state && { state }),
            ...(processor && { processor })
        })

        if (state) {
            //            console.log(`sending state updates to ${ws_server_clients.size} clients`)
            if (state) {
                for (let [key, ws] of ws_server_clients.entries()) {
                    ws.send(JSON.stringify({ type: "events", state }))
                }
            }
        }
    }
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
                        processorObject: po,
                        status_url: `/query/${po.flow_id}`
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
                stage_txt: ['Draft', 'WIValidated', 'WINumberGenerated', 'InFactory', 'FactoryComplete', 'MoveToWarehouse', 'Complete']
            }, state: factoryState.serializeState
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
