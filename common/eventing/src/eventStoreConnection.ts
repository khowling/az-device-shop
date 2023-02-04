import { Atomic, AtomicInterface } from './atomic.js'
import { ApplyInfo, StateStore } from './stateManager.js'

import mongodb, { ChangeStream, ChangeStreamInsertDocument, Db } from 'mongodb'
const { MongoClient } = mongodb

import { ObjectId } from 'bson'
import { EventEmitter } from 'events'
import assert from 'assert'

interface Tenent {
    _id: ObjectId; //typeof ObjectID;
    email: string;
}
export class EventStoreConnection extends EventEmitter {
    private murl: string;
    private _sequence = 0;
    private _collection: string;
    private _db: Db | undefined;
    private _tenent: Tenent | undefined;
    private _updateMutex = new Atomic()

    constructor(murl: string, collection: string) {
        super()
        this.murl = murl
        this._collection = collection
    }

    get db() {
        return this._db
    }

    get collection() {
        return this._collection
    }

    get tenent() {
        return this._tenent
    }

    get tenentKey() {
        return this._tenent?._id
    }

    set sequence(sequence) {
        this._sequence = sequence
    }

    get sequence() {
        return this._sequence
    }

    get mutex() {
        return this._updateMutex
    }

    async initFromDB(db: Db, tenent : Tenent | null, reset?: boolean) {
        this._db = db

        if (!tenent) {
            while (true) {
                this._tenent = await db.collection("business").findOne({ type: "business", partition_key: "root" }) as Tenent
                if (this._tenent) break
                console.warn('EventStoreConnection: No type="business" document in "business" collection, waiting until initialised...')
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } else {
            this._tenent = tenent
        }

        // check every 10seconds if the tenent changes, if it does emit event
        const tenentCheck = setInterval(async (t) => {
            const latest_tenent: Tenent = await db.collection("business").findOne({ type: "business", partition_key: "root" }) as Tenent
            if (!(latest_tenent && latest_tenent._id.equals(t._id))) {
                this.emit('tenent_changed', (this._tenent as Tenent)._id)
            }
        }, 10000, this._tenent as Tenent)

        if (reset) {
            await db.collection(this.collection).deleteMany({ partition_key: this.tenentKey })
        }
        return this
    }

    async init(reset?: boolean) {
        const client = await MongoClient.connect(this.murl)
        return await this.initFromDB(client.db(), null, reset)
    }

    // rollForwardState
    // This function will hydrate the state of the passed in stateStores from the event store
    async rollForwardState(stateStores: StateStore<any>[], additionalFn?: (changedataResults : any) => Promise<void>): Promise<number> {

        assert (this.db, "EventStoreConnection: rollForwardState: db not initialised")

        let processed_seq = this.sequence
        console.log(`rollForwardState: reading "${this.collection}" from database from_sequence#=${processed_seq}`)
    
        const stateStoreByName: { [key: string]: StateStore<any> } = stateStores.reduce((acc, i) => { return { ...acc, [i.name]: i } }, {})
    
        await this.db.collection(this.collection).createIndex({ sequence: 1 })
        const cursor = await this.db.collection(this.collection).aggregate([
            { $match: { $and: [{ "partition_key": this.tenentKey }, { sequence: { $gte: this.sequence } }] } },
            { $sort: { "sequence": 1 /* assending */ } }
        ])
    
        while (await cursor.hasNext()) {
            const { _id, partition_key, sequence, ...changedata } = await cursor.next() as any
            let applyReturnInfo: { [slicekey: string]: ApplyInfo} = {}
            for (let key of Object.keys(changedata)) {
    
                if (stateStoreByName.hasOwnProperty(key)) {
                    applyReturnInfo[key] = await stateStoreByName[key].apply(changedata[key])
                }
            }
            this.sequence = sequence

            if (additionalFn) {
                await additionalFn(applyReturnInfo)
            }
            
        }
        return this.sequence
    
    }

    // stateFollower
    // ONLY use this function to provide an upto-date ReadOnly Cache of the passed in state store
    stateFollower(stateStores: StateStore<any>[]) : ChangeStream {

        assert (this.db, "EventStoreConnection: rollForwardState: db not initialised")

        const stateStoreByName: { [key: string]: StateStore<any> } = stateStores.reduce((acc, i) => { return { ...acc, [i.name]: i } }, {})
        
        return this.db.collection(this.collection).watch([
            { $match: { $and: [{ 'operationType': { $in: ['insert'].concat(process.env.USE_COSMOS ? ['update', 'replace'] : []) } }, { "fullDocument.partition_key": this.tenentKey }, { "fullDocument.sequence": { $gt: this.sequence } }] } },
            { $project: { '_id': 1, 'fullDocument': 1, 'ns': 1, 'documentKey': 1 } }
        ],
        { fullDocument: 'updateLookup' }
        ).on('change', async (change: ChangeStreamInsertDocument): Promise<void> => {
            //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
            const eventCompleteDoc = change.fullDocument
            const { _id, partition_key, sequence, ...changedata } = eventCompleteDoc
            
            for (let key of Object.keys(changedata)) {
    
                if (stateStoreByName.hasOwnProperty(key)) {
                    await stateStoreByName[key].apply(changedata[key])
                }
            }

        }) as ChangeStream
    }
}