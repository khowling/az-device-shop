


import { EventStoreConnection } from './eventStoreConnection.js'
import { Processor } from './processor.js'
import { StateManagerInterface } from './flux.js'

// inventory_spec & order_spec, nether have 'sequence' fields, so order by '_ts' Timestamp
// TODO : need 'update' operation, to detect orders that change to status : 30 :(
export async function watchProcessorTriggerWithTimeStamp(cs: EventStoreConnection, watchCollection: string, processor: Processor, filter: any) {
    const pointer = processor.processorState.last_incoming_processed

    // No oplog continuation, so instead of starting the watch from the current position, read the collection from the sequence (or the start of the file)
    if (!pointer.continuation) {
        await readCollectionfromSequence(cs, watchCollection, '_ts', pointer['_ts'], filter, async function (doc, isLast: boolean) {
            await processor.initiateWorkflow({ trigger: { doc_id: doc._id } }, { continuation: { startAtOperationTime: doc._ts } })
        })
    }

    // now look for continuation again (as the statements above will have updated the processor state!)
    const { continuation } = processor.processorState.last_incoming_processed || {}
    console.log(`watchProcessorTriggerWithTimeStamp:  for [${processor.name}]: Start watch "${watchCollection}"  continuation=${continuation} (if continuation undefined, start watch from now)`)
    return cs.db.collection(watchCollection).watch(
        [
            { $match: { $and: [{ 'operationType': { $in: ['insert'].concat(process.env.USE_COSMOS ? ['update', 'replace'] : []) } }, { 'fullDocument.partition_key': cs.tenentKey }].concat(filter ? Object.keys(filter).reduce((acc, i) => { return { ...acc, ...{ [`fullDocument.${i}`]: filter[i] } } }, {}) as any : []) } }
            , { $project: { 'ns': 1, 'documentKey': 1, 'fullDocument.status': 1, 'fullDocument.partition_key': 1 } }
        ],
        { fullDocument: 'updateLookup', ...(continuation && { ...continuation }) }
        // By default, watch() returns the delta of those fields modified by an update operation, Set the fullDocument option to "updateLookup" to direct the change stream cursor to lookup the most current majority-committed version of the document associated to an update change stream event.
    ).on('change', async doc => {
        // doc._id == event document includes a resume token as the _id field
        // doc.clusterTime == 
        // doc.opertionType == "insert"
        // doc.ns.coll == "Collection"
        // doc.documentKey == A document that contains the _id of the document created or modified 
        await processor.initiateWorkflow({ trigger: { doc_id: doc.documentKey._id.toHexString() } }, { continuation: { /*startAfter*/ resumeAfter: doc._id } })
    })

}

// collection must have a continous 'sequence' field, starting at 1,
// stateSlice must have a reducer with managed  "last_incoming_processed: { sequence: 0, continuation: null }" structure
export async function watchDispatchWithSequence(cs: EventStoreConnection, stateManager: StateManagerInterface, stateSlice: string, collection: string, docIdPath: string, specPath: string, actiontype: string) {

    const { last_incoming_processed } = stateManager.stateStore.state[stateSlice]
    //const cont_inv_token = last_inventory_trigger
    //assert((orderState.state.inventory.size === 0) === (!last_inventory_trigger), 'Error, we we have inflated inventry, we need a inventory continuation token')

    // No oplog continuation, so instead of starting the watch from the current position, read the collection from the sequence (or the start of the file)
    if (!last_incoming_processed.continuation) {
        await readCollectionfromSequence(cs, collection, 'sequence', last_incoming_processed['sequence'], null, async function (doc, isLast: boolean) {
            await stateManager.dispatch({ type: actiontype, id: doc[docIdPath], spec: doc[specPath], trigger: { sequence: doc.sequence } })
        })
    }

    //assert(!(last_inventory_trigger && last_inventory_trigger.factory_events_sequence), `orderingProcessor (10):  start watch "collection" for NEWINV. resume cannot be a sequence`)
    const { continuation, sequence } = stateManager.stateStore.state.inventory.last_incoming_processed
    console.log(`watchDispatchWithSequence: For [${stateManager.name}]:  Start watch "${collection}" (filter watch to sequence>${sequence}) continuation=${continuation && JSON.stringify(continuation)} (if continuation undefined, start watch from now)`)

    var inventoryStreamWatcher = cs.db.collection(collection).watch([
        { $match: { $and: [{ 'operationType': { $in: ['insert'].concat(process.env.USE_COSMOS ? ['update', 'replace'] : []) } }, { 'fullDocument.partition_key': cs.tenentKey }].concat(sequence ? { 'fullDocument.sequence': { $gt: sequence } } as any : []) } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ],
        { fullDocument: "updateLookup", ...(continuation && { ...continuation }) }
    ).on('change', async doc => {
        const { sequence } = doc.fullDocument
        console.log(`watchDispatchWithSequence "${collection}": Got doc _id=${JSON.stringify(doc._id)} (sequence=${sequence})`)
        await stateManager.dispatch({ type: actiontype, id: doc.fullDocument[docIdPath], spec: doc.fullDocument[specPath], trigger: { sequence, continuation: { /*startAfter*/ resumeAfter: doc._id } } })
    })

}

async function readCollectionfromSequence(cs: EventStoreConnection, collection: string, sequenceField: string, sequenceValue: any, filter: any, callback: (doc: any, continuation: any) => Promise<void>): Promise<void> {

    console.log(`readCollectionfromSequence:  No continuation for "${collection}" so read all existing records from restored last_incoming_processed['${sequenceField}'] > ${sequenceValue} before starting new watch`)

    // get db time, so we know where to continue the watch
    //const admin = db.admin()
    //const continuation = { startAtOperationTime: (await admin.replSetGetStatus()).lastStableCheckpointTimestamp } // rs.status()

    if (sequenceField) {
        await cs.db.collection(collection).createIndex({ [sequenceField]: 1 })
    }
    const cursor = await cs.db.collection(collection).aggregate(
        [
            { $match: { $and: [{ 'partition_key': cs.tenentKey }].concat(filter || []).concat(sequenceValue ? { [sequenceField]: { $gt: sequenceValue } } as any : []) } },
        ].concat({ $sort: { [sequenceField]: 1 } } as any)
    )

    const gotRecords = await cursor.hasNext()
    while (gotRecords) {
        const doc /*{ _id, partition_key, sequence, ...spec }*/ = await cursor.next()
        const isLast = !await cursor.hasNext()
        callback(doc, isLast)
        //await stateManager.dispatch({ type: actiontype, id: _id.toHexString(), spec, trigger: { sequence, ...(isLast && { continuation }) } })
        if (isLast) {
            break
        }
    }
}