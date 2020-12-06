import { Processor, ProcessorOptions, ProcessingState } from '../util/processor'
import {
    StateChange, ChangeEventType,
    FactoryStateManager,
    FactoryStage, WorkItemStage, WorkItemObject, WorkItemStatus
} from './factoryState'

export enum OperationLabel { NEWINV = "NEWINV" }

// Perform Action on state
interface WorkItemAction {
    type: ActionType;
    spec?: any;
    doc_id?: string;
    status?: any;
}
enum ActionType { NewOrUpdatedInventoryRequest, AllocateWINumber, StatusUpdate, CheckFactoryProgress, CheckWaiting, Sync }

function factory_operation({ stateManager }, action: WorkItemAction): [boolean, Array<StateChange>] {

    const kind = "Workitem"
    const next_sequence = stateManager.state.factory_sequence + 1
    switch (action.type) {

        case ActionType.NewOrUpdatedInventoryRequest: {
            const { spec } = action
            const new_wi_status: WorkItemStatus = { failed: false, stage: action.spec.status === 'Draft' ? WorkItemStage.Draft : WorkItemStage.WIValidated }

            return stateManager.apply_change_events([{ kind, metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.CREATE, next_sequence }, status: new_wi_status }])
        }
        case ActionType.AllocateWINumber: {
            const { spec } = action
            return stateManager.apply_change_events([
                { kind, metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE, next_sequence }, status: { stage: WorkItemStage.WINumberGenerated, workitem_number: 'WI' + String(stateManager.state.workitem_sequence + 1).padStart(5, '0') } },
                { kind: "FactoryUpdate", metadata: { type: ChangeEventType.INC, next_sequence }, status: { sequence_update: 1 } }
            ])
        }
        case ActionType.StatusUpdate: {
            const { spec, status } = action
            // Needs to be Idempotent
            // TODO: Check if state already has  Number 
            return stateManager.apply_change_events([{ kind, metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...status } }])
        }
        case ActionType.CheckFactoryProgress: {

            // A simulation for factory_status,
            // In a real implementation, this may be implemented in another process, with this process listenting for updates
            const MAX_FACTORY_CAPACITY = 5
            const TIME_TO_PROCESS_A_WI = 30 * 1000 //3 seconds per item

            let capacity_allocated_update = 0// state.capacity_allocated
            const workitems_in_factory: Array<WorkItemObject> = stateManager.state.workitems.filter(s => s.status.stage === WorkItemStage.InFactory)
            const now = Date.now()

            const statechanges: Array<StateChange> = []

            // check wi in factory_status status look for for completion to free up capacity
            for (let ord of workitems_in_factory.filter(o => o.status.factory_status.stage === FactoryStage.Building)) {
                // all wi in Picking status
                const { doc_id, status } = ord
                let factory_status_update = {}

                const timeleft = (TIME_TO_PROCESS_A_WI /* * qty */) - (now - status.factory_status.starttime)

                if (timeleft > 0) { // not finished, just update progress
                    factory_status_update = { factory_status: { ...status.factory_status, progress: Math.floor(100 - ((timeleft / TIME_TO_PROCESS_A_WI) * 100.0)) } }
                } else { // finished
                    capacity_allocated_update = capacity_allocated_update - status.factory_status.allocated_capacity
                    factory_status_update = { factory_status: { ...status.factory_status, stage: FactoryStage.Complete, progress: 100, allocated_capacity: 0 }, stage: WorkItemStage.FactoryComplete }
                }
                statechanges.push({ kind, metadata: { doc_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
            }

            // check wi in factory_status status look for for completion to free up capacity
            for (let ord of workitems_in_factory.filter(o => o.status.factory_status.stage === FactoryStage.Waiting)) {
                // all wi in Picking status
                const { doc_id, status } = ord
                let factory_status_update = {}
                const required_capacity = 1

                if ((MAX_FACTORY_CAPACITY - (stateManager.state.capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                    // we have capacity, move to inprogress
                    factory_status_update = { factory_status: { ...status.factory_status, stage: FactoryStage.Building, allocated_capacity: required_capacity, progress: 0, waittime: now - status.factory_status.starttime } }
                    capacity_allocated_update = capacity_allocated_update + required_capacity
                } else {
                    // still need to wait
                    factory_status_update = {
                        factory_status: { ...status.factory_status, waittime: now - status.factory_status.starttime }
                    }

                }
                statechanges.push({ kind, metadata: { doc_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
            }

            if (capacity_allocated_update !== 0) {
                statechanges.push({ kind: "FactoryUpdate", metadata: { type: ChangeEventType.UPDATE, next_sequence }, status: { allocated_update: capacity_allocated_update } })
            }
            if (statechanges.length > 0) {
                return stateManager.apply_change_events(statechanges)
            }
            return [false, null]
        }

        /*
                case ActionType.Sync:
        
                    const workitem_idx = state.workitems.findIndex(wi => action.wi._id.toHexString() === wi.spec._id.toHexString()),
                        workitem = workitem_idx >= 0 ? state.workitems[workitem_idx] : null
        
                    if (action.wi.status === 'Draft') {
        
                        if (workitem_idx < 0) {
                            console.log(`factory_operation: Sync: No existing factory workitem for Draft Inventory, add one`)
                            return factory_operation(state, { type: ActionType.NewOrUpdatedInventoryRequest, wi: action.wi })
        
                        } else if (workitem.status.stage === WorkItemStage.Waiting) {
                            console.log(`factory_operation: Sync: Eixting Waiting factory workitem, add one`)
                            return factory_operation(state, { type: ActionType.StatusUpdate, workitem_idx, wi: { stage: WorkItemStage.Draft } })
        
                        } else if (workitem.status.stage === WorkItemStage.Complete) {
                            console.log(`Existing factory workitem already completed, cannot move status to Draft!`)
        
                        } else if (workitem.status.stage === WorkItemStage.InFactory) {
                            console.log(`Workitem in progress, cannot move back to draft`)
                            // no change
                        }
                    } else if (action.wi.status === 'Required') {
        
                        if (workitem_idx < 0) {
                            console.log(`factory_operation: Sync: No existing factory workitem for Required Inventory, add one`)
                            return factory_operation(state, { type: ActionType.NewOrUpdatedInventoryRequest, wi: action.wi })  //add_workitem(action.wi)
                        } else if (workitem.status.stage === WorkItemStage.Complete) {
                            console.log(`workitem already completed, cannot accept any changes!`)
                            //update_avaiable.push (ObjectID(wi._id))
                        } else if (workitem.status.stage === WorkItemStage.InFactory) {
                            console.log(` got eixting spec, still processing`)
                            // no change
                        }
                    } else if (action.wi.status === 'Cancel') {
                        if (workitem_idx < 0) {
                            //add_workitem(wi)
                        } else if (workitem.status.stage === WorkItemStage.Complete) {
                            //update_avaiable.push (ObjectID(wi._id))
                        } else if (workitem.status.stage === WorkItemStage.InFactory) {
                            // no change
                        }
                    }
                    return [state, factory_update]
        */
        default:
            return [false, null]
    }
}

async function validateRequest(ctx, next) {
    console.log(`validateRequest forward, find id=${ctx.trigger.documentKey._id.toHexString()}`)
    const spec = await ctx.db.collection("inventory_spec").findOne({ _id: ctx.trigger.documentKey._id, partition_key: ctx.tenent.email })
    // pass in the required data, and perform transational operation on the state
    const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.NewOrUpdatedInventoryRequest, spec })
    await next(changes, { endworkflow: containsfailed, update_ctx: { spec } } as ProcessorOptions)
}

async function generateWINo(ctx, next) {
    console.log(`generateWINo forward, spec: ${JSON.stringify(ctx.spec)}`)
    const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.AllocateWINumber, spec: ctx.spec })
    await next(changes, { endworkflow: containsfailed } as ProcessorOptions)
}

async function inFactory(ctx, next) {
    console.log(`inFactory forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.InFactory, factory_status: { starttime: Date.now(), stage: FactoryStage.Waiting, waittime: 0, progress: 0 } } })
    await next(changes, { endworkflow: containsfailed, sleep_until: { stage: WorkItemStage.FactoryComplete } } as ProcessorOptions)
}

async function moveToWarehouse(ctx, next) {
    console.log(`moveToWarehouse forward`)
    const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.MoveToWarehouse } })
    await next(changes, { endworkflow: containsfailed, sleep_until: { time: Date.now() + 1000 * 30 /* 30 secs */ } } as ProcessorOptions)
}


async function complete(ctx, next) {
    console.log(`complete forward`)
    const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.Complete } })
    await next(changes, { endworkflow: containsfailed }, OperationLabel.NEWINV)
}


// Mongo require
const { MongoClient, ObjectID } = require('mongodb'),
    assert = require('assert').strict,
    MongoURL = process.env.MONGO_DB

import { snapshotState, returnLatestSnapshot, rollForwardState } from '../util/event_hydrate'

var event_seq = 0

async function factory_startup() {

    const murl = new URL(MongoURL)

    console.log(`factory_startup (1):  connecting to: ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string

    const factoryProcessor = new Processor({ name: "fctProcv1" })

    factoryProcessor.use(validateRequest)
    factoryProcessor.use(generateWINo)
    factoryProcessor.use(inFactory)
    factoryProcessor.use(moveToWarehouse)
    factoryProcessor.use(complete)


    const db = factoryProcessor.context.db = client.db()
    factoryProcessor.context.tenent = await db.collection("business").findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
    console.log(`factory_startup (2):  got context tenent=${factoryProcessor.context.tenent.email}`)

    // Setup action on next()
    factoryProcessor.context.eventfn = ws_server_emit

    const factoryState = new FactoryStateManager();
    factoryProcessor.context.stateManager = factoryState

    console.log(`factory_startup (3):  get latest checkpoint file, apply to factoryState immediately, and just return processor_snapshop `)
    const chkdir = `${process.env.FILEPATH || '.'}/factory_checkpoint`
    const { sequence_snapshot, state_snapshot, processor_snapshop } = await returnLatestSnapshot(factoryProcessor.context, chkdir)


    event_seq = sequence_snapshot ? sequence_snapshot : event_seq
    let lastcheckpoint_seq: number = event_seq
    factoryState.state = FactoryStateManager.deserializeState(state_snapshot)
    let factory_processor_state: ProcessingState = Processor.deserializeState(processor_snapshop && processor_snapshop[factoryProcessor.name])

    console.log(`factory_startup (4):  read events since last checkpoint (seq#=${event_seq}), apply to factoryState immediately, and apply to factory_processor_state `)
    await rollForwardState(factoryProcessor.context, event_seq, ({ state, processor }) => {
        if (state) {
            process.stdout.write('s')
            factoryState.apply_change_events(state)
        }
        if (processor) {
            if (processor[factoryProcessor.name]) {
                process.stdout.write('p')
                factory_processor_state = Processor.processor_state_apply(factory_processor_state, processor[factoryProcessor.name])
            }
        }
    })
    factoryProcessor.state = factory_processor_state

    console.log(`factory_startup (5): restored factory to seq=${factoryState.state.factory_sequence}, #workitems=${factoryState.state.workitems.length}}`)

    console.log(`factory_startup (6): re-start processor state @ seq=${factory_processor_state.processor_sequence}, wi count=${factory_processor_state.proc_map.size}`)
    function checkRestartStage(doc_id, stage) {
        const state = factoryState.state.workitems.find(o => o.doc_id === doc_id)
        if (!state) {
            throw new Error(`factory_startup: Got a processor state without the state: doc_id=${doc_id}`)
        } else if (stage !== state.status.stage) {
            return true
        }
        return false
    }
    factoryProcessor.restartProcessors(checkRestartStage, factory_processor_state)

    console.log(`factory_startup (7): loop to re-start 'sleep_until' processes..`)
    setInterval(() => {
        // check to restart 'sleep_until' processes
        factoryProcessor.restartProcessors(checkRestartStage)//, orderProcessor.state, false)
    }, 1000 * 5 /* 5 seconds */)




    const LOOP_MINS = 1, LOOP_CHANGES = 100
    console.log(`factory_startup (8): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (ctx, chkdir) => {
        console.log(`Checkpointing check: seq=${event_seq},  Processing size=${factoryProcessor.state.proc_map.size}`)
        if (event_seq > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            await snapshotState(ctx, chkdir, event_seq,
                factoryState.serializeState, {
                [ctx.processor]: factoryProcessor.serializeState()
            }
            )
            lastcheckpoint_seq = event_seq
        }
    }, 1000 * 60 * LOOP_MINS, factoryProcessor.context, chkdir)



    console.log(`factory_startup (9): starting factory control loop (5 seconds)`)
    setInterval(function (ctx) {
        const [containsfailed, changes] = factory_operation(ctx, { type: ActionType.CheckFactoryProgress })
        ws_server_emit(ctx, changes, null)
    }, 5000, factoryProcessor.context)

    const cont_token = factory_processor_state.last_trigger
    assert((factoryState.state.workitems.length === 0) === (!cont_token), 'Error, we we have inflated orders, we need a order continuation token')
    console.log(`factory_startup (10):  start watch for new "inventory_spec" (startAfter=${cont_token && cont_token._id})`)
    db.collection("inventory_spec").watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": factoryProcessor.context.tenent.email }, { "fullDocument.status": 'Required' }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup", ...(cont_token && { startAfter: cont_token._id }) }
    ).on('change', factoryProcessor.callback())


    return factoryProcessor.context
}



//  ---- Factory Monitoring Websocket

//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()
function ws_server_emit(ctx, state: Array<StateChange>, processor: any, label?: string) {

    if (state || processor) {
        const res = ctx.db.collection("factory_events").insertOne({
            sequence: event_seq++,
            partition_key: ctx.tenent.email,
            ...(label && { label }),
            ...(state && { state }),
            ...(processor && { processor })
        })

        console.log(`sending state updates to ${ws_server_clients.size} clients`)
        if (state) {
            for (let [key, ws] of ws_server_clients.entries()) {
                ws.send(JSON.stringify({ type: "events", state }))
            }
        }
    }
}

function ws_server_startup({ stateManager }) {

    const WebSocket = require('ws'),
        http = require('http'),
        //    serveStatic = require('serve-static'),
        //    useragent = require('express-useragent'),
        port = process.env.PORT || 9091


    const httpServer = http.createServer().listen(port)
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
            }, state: stateManager.state
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
    const ctx = await factory_startup()
    ws_server_startup(ctx)

    //} catch (e) {
    //    console.error(e)
    //    process.exit(1)
    //}
}

init()
