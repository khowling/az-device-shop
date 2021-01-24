import { Processor, ProcessorOptions, ProcessingState } from '../util/processor'
import {
    StateChange, ActionType,
    FactoryStateManager,
    FactoryStage, WorkItemStage
} from './factoryState'

export enum OperationLabel { NEWINV = "NEWINV" }



async function validateRequest(ctx, next) {

    let spec = ctx.trigger && ctx.trigger.doc
    if (ctx.trigger && ctx.trigger.doc_id) {
        console.log(`validateRequest forward, find id=${ctx.trigger.doc_id}`)
        let inv_spec = await ctx.db.collection("inventory_spec").findOne({ _id: ctx.trigger.documentKey._id, partition_key: ctx.tenent.email })
        spec = { ...inv_spec, _id: inv_spec._id.toHexString() }

    }
    console.log(`middleware "validateRequest", spec=${JSON.stringify(spec)}`)
    // pass in the required data, and perform transational operation on the state
    //const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.NewOrUpdatedInventoryRequest, spec })
    await next({ type: ActionType.NewOrUpdatedInventoryRequest, spec }, { endIfFailed: true, update_ctx: { spec } } as ProcessorOptions)
}

async function generateWINo(ctx, next) {
    console.log(`generateWINo forward, spec: ${JSON.stringify(ctx.spec)}`)
    //const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.AllocateWINumber, spec: ctx.spec })
    await next({ type: ActionType.AllocateWINumber, spec: ctx.spec }, { endIfFailed: true } as ProcessorOptions)
}

async function inFactory(ctx, next) {
    console.log(`inFactory forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    //const [containsfailed, changes] = factory_operation(ctx,  })
    await next({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.InFactory, factory_status: { starttime: Date.now(), stage: FactoryStage.Waiting, waittime: 0, progress: 0 } } }, { endIfFailed: true, sleep_until: { doc_id: ctx.spec._id, stage: WorkItemStage.FactoryComplete } } as ProcessorOptions)
}

async function moveToWarehouse(ctx, next) {
    console.log(`moveToWarehouse forward`)
    //const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.MoveToWarehouse } })
    await next({ type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.MoveToWarehouse } }, { endIfFailed: true, sleep_until: { time: Date.now() + 1000 * 30 /* 30 secs */ } } as ProcessorOptions)
}


async function complete(ctx, next) {
    console.log(`complete forward`)
    //const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.CompleteInventry, spec: ctx.spec })
    await next({ type: ActionType.CompleteInventry, spec: ctx.spec }, { endIfFailed: true }, OperationLabel.NEWINV)
}



// Mongo require
const { MongoClient, ObjectID } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB

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


    console.log(`factory_startup (2):  create factory state manager "factoryState"`)
    const factoryState = new FactoryStateManager({ commitEventsFn: commitEvents.bind(null, connection) })

    console.log(`factory_startup (3):  create factory workflow manager "factoryProcessor", and use middleware`)
    const factoryProcessor = new Processor({
        name: "fctProcv1",
        processActionFn: factoryState.processAction.bind(factoryState),
        applyEventsFn: factoryState.applyEvents.bind(factoryState),
        commitEventsFn: commitEvents.bind(null, connection)
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
    function checkRestartStage(doc_id, stage) {
        const state = factoryState.state.workitems.find(o => o.doc_id === doc_id)
        if (!state) {
            throw new Error(`factory_startup: Got a processor state without the state: doc_id=${doc_id}`)
        } else if (stage !== state.status.stage) {
            return true
        }
        return false
    }
    factoryProcessor.restartProcessors(checkRestartStage, true)

    if (false) {
        console.log(`factory_startup (7): loop to re-start 'sleep_until' processes..`)
        setInterval(() => {
            // check to restart 'sleep_until' processes
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


    if (false) {
        console.log(`factory_startup (9): starting factory control loop (5 seconds)`)
        setInterval(async function () {
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
            console.log(`sending state updates to ${ws_server_clients.size} clients`)
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
                console.log(`http trigger got: ${body}`)
                try {
                    const po = await factoryProcessor.initiateWorkflow({ trigger: { doc: JSON.parse(body) } })
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'ack',
                        processorObject: po,
                        status_url: `/query/${po.process_id}`
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
