
// Mongo require
const {MongoClient, Binary, ObjectID} = require('mongodb'),
    bson = require ('bson'),
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


async function init() {
    // Init DB
    const db  = await dbInit()

    // introduced in 3.6 ReadRole user, access controll
    // documentKey uniquly identifies the document

    var changeStreamIterator = db.collection('orders').watch(
        [
            { $match: { "operationType": { $in: ["insert", "update", "replace"] } } },
            { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
        ],
        { fullDocument: "updateLookup"
        //, ResumeAfter : bson.deserialize(Buffer.from("QwAAAAVfZGF0YQAyAAAAAFt7InRva2VuIjoiXCI0OVwiIiwicmFuZ2UiOnsibWluIjoiIiwibWF4IjoiRkYifX1dAA==", 'base64'))
        //, StartAfter : {_data: Binary(new Buffer.from('W3sidG9rZW4iOiJcIjI2XCIiLCJyYW5nZSI6eyJtaW4iOiIiLCJtYXgiOiJGRiJ9fV0=', 'base64'))}
        //, startAtOperationTime:   new Date()  
    });
    
    
    changeStreamIterator.on('change', data => {
        console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
        console.log (`fullDocument : ${JSON.stringify(data.fullDocument)}`)
        //console.log(new Date(), data)
        if (data.fullDocument.status = 30) {
            //console.log ('processing the new order')

            // Find the nearest warehouse to the delivery location
            // Create a Stock picking 

            // Create a logistics order

            // emit telemetry
            

        }
    })



    //const next = await changeStreamIterator.next();
    //console.log (`got data ${JSON.stringify(next)}`)


    
    //if (changeStreamIterator.hasNext()) {
    //    console.log (JSON.stringify(await changeStreamIterator.next()))
    //}
        
    //while (!changeStreamIterator.cursor.h) {
    //    if (changeStreamIterator.cursor.hasNext()) {
    //        console.log (JSON.stringify(changeStreamIterator.cursor.next()))
    //    }
        
    //}

}



// Run Server
init()