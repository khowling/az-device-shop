import { Processor, ProcessorOptions, ProcessingState } from '../ordering/processor'
import {
    ChangeEvent, StateChange, ChangeEventType,
    FactoryStateManager,
    FactoryStage, WorkItemStage, WorkItemObject, WorkItemStatus
} from './factoryState'


const StoreDef = {
    "inventory": {
        collection: "inventory",
        status: {
            Draft: "Draft",
            Required: "Required",
            Complete: "Complete"
        }
    },
    "business": { collection: "business" }
}




/*
    Update Factory State
    State is NOT in a database, its a real-time ?streaming? structure, maintained by this process.
    Pure function with immutable state - no hidden state mutation
    State:
        lastupdated: date
        capacity: factory capacity
        workitems: [{
            metadata: used to identify the workitem
            spec:  desired/required inventory specification 
            status:  current factory status {
                stage: 
                starttime: 
                waittime:
                capacity_allocated: 
            }
        }]
    Types: 
        NewOrUpdatedInventoryRequest (add new inventory requirement from 'wi' to factory)
        StatusUpdate (update 'workitem_idx' workitem status with wi )
        Sync
*/

const FACTORY_CAPACITY = 10000

// Perform Action on state
interface WorkItemAction {
    // wi actions
    type: ActionType;
    spec?: any;
    doc_id?: string;
    status?: any;
}
enum ActionType { NewOrUpdatedInventoryRequest, AllocateWINumber, StatusUpdate, CheckFactoryProgress, CheckWaiting, Sync }


function factory_operation({ stateManager }, action: WorkItemAction): ChangeEvent {

    const kind = "Workitem"
    switch (action.type) {

        case ActionType.NewOrUpdatedInventoryRequest: {
            const { spec } = action
            const new_wi_status: WorkItemStatus = { failed: false, stage: action.spec.status === 'Draft' ? WorkItemStage.Draft : WorkItemStage.WIValidated }


            return stateManager.apply_change_events({
                nextaction: true, statechanges: [{ kind, metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.CREATE }, status: new_wi_status }]
            })
        }
        case ActionType.AllocateWINumber: {
            const { spec } = action
            return stateManager.apply_change_events({
                nextaction: true, statechanges: [
                    { kind, metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE }, status: { stage: WorkItemStage.WINumberGenerated, workitem_number: 'WI' + String(stateManager.state.workitem_sequence + 1).padStart(5, '0') } },
                    { kind: "FactoryUpdate", metadata: { type: ChangeEventType.INC }, status: { sequence_update: 1 } }
                ]
            })
        }
        case ActionType.StatusUpdate: {
            const { spec, status } = action
            // Needs to be Idempotent
            // TODO: Check if state already has  Number 
            return stateManager.apply_change_events({ nextaction: true, statechanges: [{ kind, metadata: { doc_id: spec._id.toHexString(), type: ChangeEventType.UPDATE }, status: { failed: false, ...status } }] })
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
                statechanges.push({ kind, metadata: { doc_id, type: ChangeEventType.UPDATE }, status: { failed: false, ...factory_status_update } })
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
                statechanges.push({ kind, metadata: { doc_id, type: ChangeEventType.UPDATE }, status: { failed: false, ...factory_status_update } })
            }

            if (capacity_allocated_update !== 0) {
                statechanges.push({ kind: "FactoryUpdate", metadata: { type: ChangeEventType.UPDATE }, status: { allocated_update: capacity_allocated_update } })
            }
            if (statechanges.length > 0) {
                return stateManager.apply_change_events({ nextaction: null, statechanges: statechanges })
            }
            return null
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
            return null
    }
}


async function lookupSpec(ctx, next) {
    console.log(`lookupSpec forward, find id=${ctx.trigger.documentKey._id.toHexString()}, continuation=${ctx.trigger._id}`)
    const find_inv = { _id: ctx.trigger.documentKey._id, partition_key: ctx.tenent.email }
    // ctx - 'caches' information in the 'session' that will be required for the middleware operations, but not required in the state
    ctx.spec = await ctx.db.collection(StoreDef["inventory"].collection).findOne(find_inv)
    // pass in the required data, and perform transational operation on the state
    await next()

}

async function validateRequest(ctx, next) {
    console.log(`validateRequest forward, find id=${ctx.trigger.documentKey._id.toHexString()}, continuation=${ctx.trigger._id}`)
    // pass in the required data, and perform transational operation on the state
    const change = factory_operation(ctx, { type: ActionType.NewOrUpdatedInventoryRequest, spec: ctx.spec })
    await next(change, { endworkflow: !change.nextaction } as ProcessorOptions)
}

async function generateWINo(ctx, next) {
    console.log(`generateWINo forward, spec: ${JSON.stringify(ctx.trigger)}`)

    const change = factory_operation(ctx, { type: ActionType.AllocateWINumber, spec: ctx.spec })
    await next(change, { endworkflow: !change.nextaction } as ProcessorOptions)
}

async function inFactory(ctx, next) {
    console.log(`inFactory forward, trigger: ${JSON.stringify(ctx.trigger)}`)
    await next(
        factory_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.InFactory, factory_status: { starttime: Date.now(), stage: FactoryStage.Waiting, waittime: 0, progress: 0 } } }),
        { sleep_until: { stage: WorkItemStage.FactoryComplete } } as ProcessorOptions)
}

async function moveToWarehouse(ctx, next) {
    console.log(`complete forward`)
    await next(factory_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.MoveToWarehouse } }),
        { sleep_until: { time: Date.now() + 1000 * 60 * 1 /* 3mins */ } } as ProcessorOptions)
}


async function complete(ctx, next) {
    console.log(`complete forward`)
    await next(factory_operation(ctx, { type: ActionType.StatusUpdate, spec: ctx.spec, status: { stage: WorkItemStage.Complete } }))
}


// Mongo require
const { MongoClient, Binary, ObjectID } = require('mongodb'),
    MongoURL = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev",
    USE_COSMOS = false



async function factory_startup() {

    const murl = new URL(MongoURL)

    console.log(`factory_startup (1):  connecting to: ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string

    const factoryProcessor = new Processor({ name: "fctProcv1" })

    factoryProcessor.use(lookupSpec)
    factoryProcessor.use(validateRequest)
    factoryProcessor.use(generateWINo)
    factoryProcessor.use(inFactory)
    factoryProcessor.use(moveToWarehouse)
    factoryProcessor.use(complete)


    const db = factoryProcessor.context.db = client.db()
    factoryProcessor.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
    console.log(`factory_startup (2):  got context tenent=${factoryProcessor.context.tenent.email}`)

    // Setup action on next()
    factoryProcessor.context.eventfn = ws_server_emit

    const factoryState = new FactoryStateManager();
    factoryProcessor.context.stateManager = factoryState


    console.log(`factory_startup (3): restore 'factory state', seq=${factoryState.state.sequence}, #orders=${factoryState.state.workitems.length}}`)

    function checkRestartStage(doc_id, stage) {
        const state = factoryState.state.workitems.find(o => o.doc_id === doc_id)
        if (!state) {
            throw new Error(`factory_startup: Got a processor state without the state: doc_id=${doc_id}`)
        } else if (stage !== state.status.stage) {
            return true
        }
        return false
    }

    //const processorState: ProcessingState = required_processor_state[orderProcessor.name]
    //console.log(`factory_startup (4): re-applying active processor state, order#=${order_process_state.proc_map.size}`)
    //factoryProcessor.restartProcessors(checkRestartStage, order_process_state)

    console.log(`factory_startup (4): loop to re-inflate 'sleep_until' processes..`)
    setInterval(() => {
        // check to restart 'sleep_until' processes
        factoryProcessor.restartProcessors(checkRestartStage)//, orderProcessor.state, false)
    }, 1000 * 5 /* 5 seconds */)


    console.log(`factory_startup (5): starting factory control loop (5 seconds)`)
    setInterval(function (ctx) {
        const change = factory_operation(ctx, { type: ActionType.CheckFactoryProgress })
        if (change) {
            ws_server_emit(ctx, change)
        }
    }, 5000, factoryProcessor.context)


    console.log(`factory_startup (6):  start watch for new "inventory" (startAfter=)`)

    // watch for new new Inventory
    db.collection(StoreDef["inventory"].collection).watch(
        [
            { $match: { $and: [{ "operationType": { $in: ["insert", "update"] } }, { "fullDocument.partition_key": factoryProcessor.context.tenent.email }, { "fullDocument.status": StoreDef["inventory"].status.Required }] } }
            , { $project: { "ns": 1, "documentKey": 1, "fullDocument.status": 1, "fullDocument.partition_key": 1 } }
        ],
        { fullDocument: "updateLookup" }
    ).on('change', factoryProcessor.callback())


    return factoryProcessor.context
}



//  ---- Factory Monitoring Websocket

//  ---- Factory Monitoring Websocket & API
type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()
function ws_server_emit(ctx, change: ChangeEvent) {
    //if (factory_updates && factory_updates.length > 0) {

    //const res = ctx.db.collection("factory_events").insertOne({ partition_key: ctx.tenent.email, ...change })

    console.log(`sending factory updates to ${ws_server_clients.size} clients`)
    for (let [key, ws] of ws_server_clients.entries()) {
        //console.log(`${key}`)
        const { processor, ...changewoprocessor } = change
        ws.send(JSON.stringify({ type: "events", change: changewoprocessor }))
    }
    //}
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
