import { ifError } from "assert";

export { };

// Mongo require
const { MongoClient, Binary, ObjectID } = require('mongodb'),
    MongoURL = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev",
    USE_COSMOS = false

const StoreDef = {
    "orders": { collection: "orders" },
    "inventory": { collection: "inventory" },
    "business": { collection: "business" }
}

async function dbInit() {
    // ensure url encoded
    const murl = new URL(MongoURL)
    console.log(`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    const _db = client.db()
    // If Cosmos, need to pre-create the collections, becuse it enforces a partitioning strategy.
    if (USE_COSMOS) {
        for (let store of Object.keys(StoreDef)) {
            console.log(`ensuring partitioned collection created for [${store}]`)
            try {
                const { ok, code, errMsg } = await _db.command({ customAction: "CreateCollection", collection: StoreDef[store].collection, shardKey: "partition_key" })
                if (ok === 1) {
                    console.log('success')
                } else {
                    throw new Error(errMsg)
                }
            } catch (err) {
                if (err.code !== 48) {
                    // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                    console.error(`Failed to create collection : ${err}`)
                    throw new Error(err.errMsg)
                }
            }
        }
    }
    return _db
}


async function watch(db: any, collection: string, fn: (doc: any) => void) {

    // introduced in 3.6 ReadRole user, access controll
    // documentKey uniquly identifies the document

    var changeStreamIterator = db.collection(collection).watch(
        [
            { $match: { "operationType": { $in: ["insert", "update"] } } },
            { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
        ],
        {
            fullDocument: "updateLookup"
            //, ResumeAfter : bson.deserialize(Buffer.from("QwAAAAVfZGF0YQAyAAAAAFt7InRva2VuIjoiXCI0OVwiIiwicmFuZ2UiOnsibWluIjoiIiwibWF4IjoiRkYifX1dAA==", 'base64'))
            //, StartAfter : {_data: Binary(new Buffer.from('W3sidG9rZW4iOiJcIjI2XCIiLCJyYW5nZSI6eyJtaW4iOiIiLCJtYXgiOiJGRiJ9fV0=', 'base64'))}
            //, startAtOperationTime:   new Date()  
        });


    changeStreamIterator.on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
        console.log(`fullDocument : ${JSON.stringify(data.fullDocument)}`)
        fn(data.fullDocument)
    })
}

interface WorkItem_metadata {
    created_time: number;
}

enum WorkItem_Stage { Draft, Waiting, InProgress, Complete }
interface WorkItem_status {
    stage: WorkItem_Stage;
    starttime?: number;

    last_update?: number;
    waittime?: number;
    allocated_capacity?: number;
    progress?: number;
}

interface WorkItem {
    metadata: WorkItem_metadata;
    spec: any;
    status: WorkItem_status;
}

interface FactoryState {
    workitems: Array<WorkItem>;
    allocated_capacity: number;
    lastupdated: number;
}

interface FactoryUpdate {
    workitem_updates: Array<WorkItemUpdate>;
    allocated_capacity: number;
    lastupdated: number;
}
enum WorkItemUpdateType { New, Complete, ProgressUpdate }
interface WorkItemUpdate {
    type: WorkItemUpdateType;
    workitem: WorkItem;
}

enum ActionType { Add, CheckInProgress, CheckWaiting, StatusUpdate, Sync }
interface FactoryAction {
    type: ActionType;
    inventory_spec?: any;
    workitem_idx?: number;
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
                allocated_capacity: 
            }
        }]
    Types: 
        Add (add new inventory requirement from 'inventory_spec' to factory)
        StatusUpdate (update 'workitem_idx' workitem status with inventory_spec )
        Sync
*/

const FACTORY_CAPACITY = 10000

var factory_state = { lastupdated: Date.now(), allocated_capacity: 0, workitems: [] }

function factory_op(action: FactoryAction): Array<WorkItemUpdate> {
    const [new_state, changes] = factory_operation(factory_state, action)
    factory_state = new_state
    return changes
}

function factory_operation(state: FactoryState, action: FactoryAction): [FactoryState, Array<WorkItemUpdate>] {

    const nownow = Date.now()
    let factory_update: Array<WorkItemUpdate> = [], new_capacity = 0

    switch (action.type) {

        case ActionType.Add:

            const new_wi = { status: { stage: action.inventory_spec.status === 'Draft' ? WorkItem_Stage.Draft : WorkItem_Stage.Waiting, allocated_capacity: 0, waittime: 0 }, metadata: { created_time: Date.now() }, spec: action.inventory_spec }
            return [
                { lastupdated: nownow, allocated_capacity: state.allocated_capacity, workitems: state.workitems.concat(new_wi) },
                [{ type: WorkItemUpdateType.New, workitem: new_wi }]
            ]
            break

        case ActionType.StatusUpdate:

            const update_wi = { ...state.workitems[action.workitem_idx].status, ...action.inventory_spec }
            return [
                { lastupdated: nownow, allocated_capacity: state.allocated_capacity, workitems: [...state.workitems.slice(0, action.workitem_idx), update_wi, ...state.workitems.slice(action.workitem_idx + 1, state.workitems.length)] },
                [{ type: WorkItemUpdateType.ProgressUpdate, workitem: update_wi }]
            ]
            break

        case ActionType.CheckInProgress:

            const update_complete = state.workitems.map((wi: WorkItem) => {
                const { status, spec, metadata } = wi
                if (status.stage === WorkItem_Stage.InProgress) {
                    const MSEC_TO_COMPLETE_ALL = 25000, timeleft = MSEC_TO_COMPLETE_ALL - (nownow - wi.status.starttime)

                    let update_wi: WorkItem
                    if (timeleft > 0) {
                        console.log(`${MSEC_TO_COMPLETE_ALL} / 100.0) * ${timeleft}`)
                        const progress = Math.floor(100 - ((timeleft / MSEC_TO_COMPLETE_ALL) * 100.0))
                        // in progress
                        new_capacity += status.allocated_capacity
                        update_wi = { status: { ...status, last_update: nownow, progress }, spec, metadata }

                        factory_update.push({ type: WorkItemUpdateType.ProgressUpdate, workitem: update_wi })
                    } else {
                        // finished
                        update_wi = { status: { ...status, last_update: nownow, progress: 100, stage: WorkItem_Stage.Complete, allocated_capacity: 0 }, spec, metadata }
                        factory_update.push({ type: WorkItemUpdateType.Complete, workitem: update_wi })
                    }
                    return update_wi

                } else {
                    return wi
                }
            })
            return [
                { lastupdated: nownow, allocated_capacity: new_capacity, workitems: update_complete },
                factory_update
            ]
            break

        case ActionType.CheckWaiting:

            const update_waiting = state.workitems.map((wi: WorkItem) => {
                const { status, spec, metadata } = wi

                if (status.stage === WorkItem_Stage.Waiting) {
                    let update_wi: WorkItem
                    const required_wi_capacity = wi.spec.qty
                    if ((FACTORY_CAPACITY - state.allocated_capacity) + new_capacity >= required_wi_capacity) {
                        // we have capacity, move to inprogress
                        new_capacity += required_wi_capacity
                        update_wi = { status: { ...status, last_update: nownow, waittime: nownow - wi.status.starttime, progress: 0, starttime: nownow, stage: WorkItem_Stage.InProgress, allocated_capacity: required_wi_capacity }, spec, metadata }
                    } else {
                        // still need to wait
                        update_wi = { status: { ...status, last_update: nownow, waittime: nownow - wi.status.starttime }, spec, metadata }
                    }
                    factory_update.push({ type: WorkItemUpdateType.ProgressUpdate, workitem: update_wi })
                    return update_wi
                } else {
                    return wi
                }
            })
            return [
                { lastupdated: nownow, allocated_capacity: (state.allocated_capacity + new_capacity), workitems: update_waiting },
                factory_update
            ]
            break

        case ActionType.Sync:

            const workitem_idx = state.workitems.findIndex(wi => action.inventory_spec._id.toHexString() === wi.spec._id.toHexString()),
                workitem = workitem_idx >= 0 ? state.workitems[workitem_idx] : null

            if (action.inventory_spec.status === 'Draft') {

                if (workitem_idx < 0) {
                    console.log(`factory_operation: Sync: No existing factory workitem for Draft Inventory, add one`)
                    return factory_operation(state, { type: ActionType.Add, inventory_spec: action.inventory_spec })

                } else if (workitem.status.stage === WorkItem_Stage.Waiting) {
                    console.log(`factory_operation: Sync: Eixting Waiting factory workitem, add one`)
                    return factory_operation(state, { type: ActionType.StatusUpdate, workitem_idx, inventory_spec: { stage: WorkItem_Stage.Draft } })

                } else if (workitem.status.stage === WorkItem_Stage.Complete) {
                    console.log(`Existing factory workitem already completed, cannot move status to Draft!`)

                } else if (workitem.status.stage === WorkItem_Stage.InProgress) {
                    console.log(`Workitem in progress, cannot move back to draft`)
                    // no change
                }
            } else if (action.inventory_spec.status === 'Required') {

                if (workitem_idx < 0) {
                    console.log(`factory_operation: Sync: No existing factory workitem for Required Inventory, add one`)
                    return factory_operation(state, { type: ActionType.Add, inventory_spec: action.inventory_spec })  //add_workitem(action.inventory_spec)
                } else if (workitem.status.stage === WorkItem_Stage.Complete) {
                    console.log(`workitem already completed, cannot accept any changes!`)
                    //update_avaiable.push (ObjectID(inventory_spec._id))
                } else if (workitem.status.stage === WorkItem_Stage.InProgress) {
                    console.log(` got eixting spec, still processing`)
                    // no change
                }
            } else if (action.inventory_spec.status === 'Cancel') {
                if (workitem_idx < 0) {
                    //add_workitem(inventory_spec)
                } else if (workitem.status.stage === WorkItem_Stage.Complete) {
                    //update_avaiable.push (ObjectID(inventory_spec._id))
                } else if (workitem.status.stage === WorkItem_Stage.InProgress) {
                    // no change
                }
            }
            return [state, factory_update]
        default:
            return [state, factory_update]
            break
    }
}



async function factory_startup() {

    // Init DB
    const db = await dbInit()
    const tenent = await db.collection(StoreDef["business"].collection).findOne({ _id: ObjectID("singleton001"), partition_key: "root" })

    /////////////////////////////////////////////////////////
    // Factory Operator - Custom Resource -> "EventsFactory"
    // Operator Pattern  - Specify the Desired State (workitems), and have the controller implement it using a Control Loop
    // Factory Controller has deep knowledge on how to create Investory
    // 
    // Immutable
    // Init state


    // watch for new new Inventory
    watch(db, StoreDef["inventory"].collection, (doc) => {
        if (doc.status === 'Required') {
            console.log(`Found new required Inventory`)
            const workitem_updates = factory_op({ type: ActionType.Add, inventory_spec: doc })
            if (workitem_updates.length > 0) {
                ws_server_emit({ lastupdated: factory_state.lastupdated, allocated_capacity: factory_state.allocated_capacity, workitem_updates })

            }
        }
    })

    // a control loop is a non-terminating loop that regulates the state of the system.
    // watches the shared state of the Factory
    // makes changes attempting to move the current state towards the desired state

    // ENHANCEMENT
    // only 1 running at a time, leader election - guarantees that only one instance is actively making decisions, all the other instances are inactive, but ready to take leadership if something happens to the active one.
    // election relies on endpoints
    // kubectl describe 'endpoints', Annotations:  control-plane.alpha.kubernetes.io/leader: {"holderIdentity": podid}, The duration of the lease (of the leadership) in seconds: “leaseDurationSeconds”: 15
    // The time the current lease (the current leadership) should be renewed: “renewTime”: “2018–01–19T13:13:54Z”, If this doesn’t happen for any reason, inactive instances are entitled to acquire the leadership.

    // plans for changing the leader election mechanism based on endpoints in favour of a similar approach based on config maps. This avoids continuously triggering “endpoint-changed”

    async function factory_control_loop() {


        const now = Date.now()

        //  Free Factory capacity first

        // look at desired state ('spec')
        // look at 'Inventry' requirements (read Inventory Status == 'Required')
        // look at current state ('status')
        // look for existing workorders 
        // perform required actions to get to desired state.

        let workitem_updates: Array<WorkItemUpdate> = []

        //console.log(`Factory Control Loop, looking for _InProgress_  workitems to update/complete.......`)
        workitem_updates = factory_op({ type: ActionType.CheckInProgress })

        let update_complete = []
        for (let action of workitem_updates) {
            if (action.type === WorkItemUpdateType.Complete) {
                update_complete.push(ObjectID(action.workitem.spec._id))
            }
        }

        //console.log(`Factory Control Loop, looking for _Waiting_ workitems to schedule.......`)
        workitem_updates = workitem_updates.concat(factory_op({ type: ActionType.CheckWaiting }))

        // Update Complete Inventory
        if (update_complete.length > 0) {
            await db.collection("inventory").updateMany({ _id: { $in: update_complete }, partition_key: tenent.email }, { $set: { status: "Available" } })
        }

        // Look for any changes to Required Inventory, and apply to the factory
        const inventory = await db.collection("inventory").find({ status: { $ne: "Available" }, partition_key: tenent.email }).toArray()
        //console.log(`Factory Control Loop, looking for Desired Inventory ${inventory.length}.......`)

        for (let inventory_record of inventory) {
            // check desired state (inventory) matches current state
            workitem_updates = workitem_updates.concat(factory_op({ type: ActionType.Sync, inventory_spec: inventory_record }))
        }
        if (workitem_updates.length > 0) {
            ws_server_emit({ lastupdated: factory_state.lastupdated, allocated_capacity: factory_state.allocated_capacity, workitem_updates })

        }
    }

    setInterval(factory_control_loop, 10000)

}


//  ---- Factory Monitoring Websocket

type WS_ServerClientType = Record<string, any>;
const ws_server_clients: WS_ServerClientType = new Map()
function ws_server_emit(factory_update: FactoryUpdate) {
    //if (factory_updates && factory_updates.length > 0) {
    console.log(`sending factory updates to ${ws_server_clients.size} clients`)
    for (let [key, ws] of ws_server_clients.entries()) {
        console.log(`${key}`)
        ws.send(JSON.stringify({ type: "update", factory_update }))
    }
    //}
}

function ws_server_startup() {

    const WebSocket = require('ws'),
        http = require('http'),
        //    serveStatic = require('serve-static'),
        //    useragent = require('express-useragent'),
        port = process.env.PORT || 9090,
        httpServer = http.createServer().listen(port)

    console.log(`listening to port ${port}`)

    // Web Socket Server
    const wss = new WebSocket.Server({
        perMessageDeflate: false,
        server: httpServer
    });

    wss.on('connection', function connection(ws) {

        const client_id = ws_server_clients.size
        ws_server_clients.set(client_id, ws)

        ws.send(JSON.stringify({ type: "snapshot", factory_state }))

        ws.on('close', function close() {
            if (ws_server_clients.has(client_id)) {
                // dont send any more messages
                ws_server_clients.delete(client_id)
                console.log(`disconnected ${client_id}`)
            }
        })
    })
}



factory_startup()
ws_server_startup()
