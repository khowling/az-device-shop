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

// Watch for new Inventory from the Factory!
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

var inventory_state = { lastupdated: Date.now(), allocated_capacity: 0, inventory: [] }
interface InventoryState {
    workitems: Array<WorkItem>;
    allocated_capacity: number;
    lastupdated: number;
}

enum ActionType { NewInventory, NewOrder }
interface InventoryAction {
    type: ActionType;
    sku: String;
    qty: number;
}


function inventory_operation(state: InventoryState, action: InventoryAction): [InventoryState, Array<WorkItemUpdate>] {

    const nownow = Date.now()

    switch (action.type) {

        case ActionType.NewInventory:

    }
}

async function inventory_startup() {

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
}



// Provide a syncronous API to
- Allocate Inventory


    - Return Avaiable Inventory

