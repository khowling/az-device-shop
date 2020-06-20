import { ifError } from "assert";

export {};

// Mongo require
const {MongoClient, Binary, ObjectID} = require('mongodb'),
    MongoURL = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev",
    USE_COSMOS = false

    const StoreDef = {
        "orders": { collection: "orders", },
        "inventory": { collection: "inventory", }
    }

async function dbInit() {
    // ensure url encoded
    const murl = new URL (MongoURL)
    console.log (`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    const _db = client.db()
    // If Cosmos, need to pre-create the collections, becuse it enforces a partitioning strategy.
    if (USE_COSMOS) {
        for (let store of Object.keys(StoreDef)) {
            console.log (`ensuring partitioned collection created for [${store}]`)
            try { 
                const {ok, code, errMsg} = await _db.command({customAction: "CreateCollection", collection: StoreDef[store].collection, shardKey: "partition_key" })
                if (ok === 1) {
                    console.log ('success')
                } else {
                    throw new Error (errMsg)
                }
            } catch (err) {
                if (err.code !== 48) {
                    // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                    console.error (`Failed to create collection : ${err}`)
                    throw new Error (err.errMsg)
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
        { fullDocument: "updateLookup"
        //, ResumeAfter : bson.deserialize(Buffer.from("QwAAAAVfZGF0YQAyAAAAAFt7InRva2VuIjoiXCI0OVwiIiwicmFuZ2UiOnsibWluIjoiIiwibWF4IjoiRkYifX1dAA==", 'base64'))
        //, StartAfter : {_data: Binary(new Buffer.from('W3sidG9rZW4iOiJcIjI2XCIiLCJyYW5nZSI6eyJtaW4iOiIiLCJtYXgiOiJGRiJ9fV0=', 'base64'))}
        //, startAtOperationTime:   new Date()  
    });
    
    
    changeStreamIterator.on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
        console.log (`fullDocument : ${JSON.stringify(data.fullDocument)}`)
        fn(data.fullDocument)
    })
}

interface WorkItem_metadata {
    created_time: number ;
}

enum WorkItem_Stage {New, InProgress, Complete}
interface WorkItem_status {
    stage: WorkItem_Stage ;
    starttime?: number;
    
    last_update?: number;
    wait_time?: number;
    allocated_capacity?: number;
    progress?: number;
}

interface WorkItem {
    metadata: WorkItem_metadata;
    spec: any;
    status: WorkItem_status;
}


// current factory capacity
// NOT in a database, its a real-time streaming metric, maintained by this process.
let _factory_state : Array<WorkItem> = []
function factory_state() {
    return _factory_state
}
async function factory_startup() {

    // Init DB
    const db  = await dbInit()

    // need to read this from snapshot
    const factory_capacity = 1000

    

    function avail_capacity (): number {
        return factory_capacity - _factory_state.reduce ((tot, orders) => tot + orders.status.allocated_capacity, 0)
    }

    function update_workitem_state (new_state) {
        _factory_state = new_state
    }

    function add_workitem (invrequest) {
        // 2 things - reduce the factory_capacity && update the workorder status
            // these 2 things are transient, should be streamed?
              // = push updates to broker
              // = service to subscribe to the updates and keep the status!
            // How to implmenet ' Distributed transation??
        
        // spec == desired state
        // status == current state
        const newwi = {status: {stage: WorkItem_Stage.New, allocated_capacity: 0}, metadata: {created_time: Date.now()}, spec: invrequest}
        _factory_state.push(newwi)
        console.log (`add_workitem & emit`)
        ws_server_emit([newwi])
        //const res = await db.workitems.updateOne({_id: ObjectID(workitem._id), partition_key: "TEST"},{ $set: {status:  "InFactory"}}, {upsert: false, returnOriginal: false, returnNewDocument: false})
    }



    /////////////////////////////////////////////////////////
    // Factory Operator - Custom Resource -> "EventsFactory"
    // Operator Pattern  - Specify the Desired State (workitems), and have the controller implement it using a Control Loop
    // Factory Controller has deep knowledge on how to create Investory
    // 
    // Immutable


    // watch for new new Inventory
    watch(db, "inventory", (doc) => {
        if (doc.status === 'Required') {
            add_workitem(doc)
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

    async function  factory_control_loop()  {

        
        const now = Date.now()
        //  Free Factory capacity first

        // look at desired state ('spec')
            // look at 'Inventry' requirements (read Inventory Status == 'Required')
        // look at current state ('status')
            // look for existing workorders 
        // perform required actions to get to desired state.

        // are there any workitems complete? to free up capacity?
        console.log (`Factory Control Loop, looking for finished workitems ${_factory_state.length}.......`)
        update_workitem_state(_factory_state.map((wi: WorkItem)=> {

            if (wi.status.stage === WorkItem_Stage.InProgress) {
                const {status, spec, metadata} = wi,
                    MSEC_TO_COMPLETE_ALL = 25000,
                    timeleft = MSEC_TO_COMPLETE_ALL - (now - wi.status.starttime) 
                
                let update_wi
                if (timeleft > 0) {
                    console.log (`${MSEC_TO_COMPLETE_ALL} / 100.0) * ${timeleft}`)
                    const progress = 100 - ((MSEC_TO_COMPLETE_ALL / 100.0) * timeleft)
                    // emit progress
                    update_wi =  {status: {...status, last_update: now, progress }, spec, metadata} 
                } else {
                    // emit finished
                    update_wi = {status: {...status, last_update: now, stage: WorkItem_Stage.Complete, allocated_capacity: 0 }, spec, metadata}
                }
                ws_server_emit([update_wi])
                return update_wi

            } else {
                return wi
            }
        }))

        console.log (`Factory Control Loop, looking for new workitems ${_factory_state.length}.......`)
        update_workitem_state(_factory_state.map((wi: WorkItem)=> {

            if (wi.status.stage === WorkItem_Stage.New) {
                const {status, spec, metadata} = wi 
                
                let update_wi
                if (avail_capacity() >= wi.spec.qty) {
                    // we have capacity, move to inprogress
                    update_wi = {status: {...status, last_update: now, wait_time: now - wi.status.starttime, progress: 0, starttime: now, stage: WorkItem_Stage.InProgress }, spec, metadata} 
                } else {
                    // still need to wait
                    update_wi = {status: {...status, last_update: now,  wait_time: now - wi.status.starttime}, spec, metadata}
                }
                ws_server_emit([update_wi])
                return update_wi

            } else {
                return wi
            }
        }))


        const inventory = await db.collection("inventory").find({status : { $ne: "Available"}, partition_key: "TEST"}).toArray()
        
        console.log (`Factory Control Loop, looking for required Inventory ${inventory.length}.......`)
        let update_avaiable = []

        for (let inventory_spec of inventory) {
            const wi_status = _factory_state.find(wi => inventory_spec._id.toHexString() === wi.spec._id.toHexString())

            if (inventory_spec.status === 'Required') {
                console.log (`Found Required inventory`)
                if (!wi_status) {
                    console.log (` no eixting spec, creating`)
                    add_workitem(inventory_spec)
                } else if (wi_status.status.stage === WorkItem_Stage.Complete) {
                    console.log (` got eixting spec, finished processing, update Inventory`)
                    update_avaiable.push (ObjectID(inventory_spec._id))
                } else if (wi_status.status.stage === WorkItem_Stage.InProgress) {
                    console.log (` got eixting spec, still processing`)
                    // no change
                }
            } else if (inventory_spec.status === 'Cancel') {
                if (!wi_status) {
                    add_workitem(inventory_spec)
                } else if (wi_status.status.stage === WorkItem_Stage.Complete) {
                    update_avaiable.push (ObjectID(inventory_spec._id))
                } else if (wi_status.status.stage === WorkItem_Stage.InProgress) {
                    // no change
                }
            }
        }

        if (update_avaiable.length>0) {

            await db.collection("inventory").find({_id : { $in: update_avaiable}, partition_key: "TEST"}, {status: "Available"})
        }
    }
    
    setInterval (factory_control_loop,10000)

}

type WS_ServerClientType = Record<string, any>;
const ws_server_clients : WS_ServerClientType = new Map()
function ws_server_emit(msg) {
    console.log (`sending to ${ws_server_clients.size} clients`)
    for (let [key, ws] of ws_server_clients.entries()) {
        console.log (`${key}`)
        ws.send(JSON.stringify(msg))
    }
}
function ws_server_startup() {
    // -----------------------------------------------------------------------------------
    // ----------------------------------------------------------------- HTTP & WS Servers
    const WebSocket = require('ws'),
        http = require('http'),
    //    serveStatic = require('serve-static'),
    //    useragent = require('express-useragent'),
        port = process.env.PORT || 9090,
        httpServer = http.createServer().listen(port)


    console.log (`listening to port ${port}`)

    // Web Socket Server
    const wss = new WebSocket.Server({
        perMessageDeflate: false,
        server : httpServer
    });

    
    wss.on('connection', function connection(ws) {

        const client_id = ws_server_clients.size
        ws_server_clients.set(client_id, ws)

        ws.send (JSON.stringify(factory_state()))

        ws.on('close', function close() {
            if (ws_server_clients.has (client_id)) {
                // dont send any more messages
                ws_server_clients.delete (client_id)
                console.log(`disconnected ${client_id}`)
            }
        })

        //,
        //    ua = useragent.parse(headers['user-agent']),
        //    client_key = `${NOTIFICATION_KEYPREFIX}USERS:${proc_id}-${node_connections.size}`
        //console.log (`connected ${client_key}`)
    /*
        ws.on('message', (message) => {
            console.log(`received: ${JSON.stringify(message)}`);
            let mobj = JSON.parse(message)

            // user JOIN & keep-alive
            if (mobj.type == "JOIN") {

                let joined = new Date().getTime()
                if (node_connections.has(client_key)) { // already joined, its a keep alive
                    joined = node_connections.get(client_key).joined
                } else { // a new user!
                    node_connections.set (client_key, {ws: ws, joined: joined})
                }
                
                const KEEPALIVE_INTERVAL = 10

                var conn_info = { 
                    type: "JOINED",
                    interval: KEEPALIVE_INTERVAL,
                    name: mobj.name,
                    process_type: PROC_TYPE,
                    ping: new Date().getTime() - mobj.time,
                    server: proc_key,
                    connected_for: Math.round ( (new Date().getTime() - joined)/1000),
                    platform: `${ua.platform}/${ua.os}/${ua.browser}`, 
                    isMobile: ua.isMobile, 
                }

                // update redis hash
                redis.multi()
                .hmset (client_key, conn_info)
                .expire(client_key, KEEPALIVE_INTERVAL + 2)
                .exec((err, res) => {  // Executes all previously queued commands in a transaction
                    if (err) {
                    console.log (`error ${err}`)
                    }
                });

                ws.send (JSON.stringify(conn_info))
            }
        })
*/
    })
}



factory_startup()
ws_server_startup()
