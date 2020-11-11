
async function startup() {
    // Mongo require
    const { MongoClient, Binary, ObjectID } = require('mongodb'),
        MongoURL = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev"

    const murl = new URL(MongoURL)
    console.log(`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    const db = client.db()

    function callback(doc) {
        // doc._id == event document includes a resume token as the _id field
        // doc.clusterTime == 
        // doc.opertionType == "insert"
        // doc.ns.coll == "Collection"
        // doc.documentKey == A document that contains the _id of the document created or modified
        console.log(doc)
    }



    db.collection("events").watch(
        [], {
        startAfter: {
            _data: '825F847D50000000012B022C0100296E5A10041A97BB155140475FA61AEF9A52F8152346645F696400645F847D5042D397B65CFCFD810004'
        }
    }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', callback)
}

startup()