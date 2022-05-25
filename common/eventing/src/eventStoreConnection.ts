import { Atomic, AtomicInterface } from './atomic.js'
import { StateStore } from './stateStore.js'

import mongodb from 'mongodb'
const { MongoClient } = mongodb

import { ObjectId } from 'bson'
import { EventEmitter } from 'events'

interface Tenent {
    _id: ObjectId; //typeof ObjectID;
    email: string;
}
export class EventStoreConnection extends EventEmitter {
    private murl: string;
    private _sequence: number;
    private _collection: string;
    private _db: any;
    private _tenent: Tenent;
    private _updateMutex: AtomicInterface

    constructor(murl: string, collection: string) {
        super()
        this.murl = murl
        this._collection = collection
        this._sequence = 0
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
        return this._tenent._id
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

    private tenentCheck;
    async initFromDB(db, tenent, reset?: boolean) {
        this._db = db

        if (!tenent) {
            while (true) {
                this._tenent = await this.db.collection("business").findOne({ type: "business", partition_key: "root" })
                if (this._tenent) break
                console.warn('EventStoreConnection: No type="business" document in "business" collection, waiting until initialised...')
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } else {
            this._tenent = tenent
        }

        this._updateMutex = new Atomic()

        // check every 10seconds if the tenent changes, if it does emit event
        this.tenentCheck = setInterval(async () => {
            const latest_tenent: Tenent = await this._db.collection("business").findOne({ type: "business", partition_key: "root" })
            if (!(latest_tenent && latest_tenent._id.equals(this._tenent._id))) {
                this.emit('tenent_changed', this._tenent._id)
            }
        }, 10000)

        if (reset) {
            await this.db.collection(this.collection).deleteMany({ partition_key: this.tenentKey })
        }
        return this
    }

    async init(reset?: boolean) {
        const client = await MongoClient.connect(this.murl)
        return await this.initFromDB(client.db(), null, reset)
    }

    async rollForwardState(stateStores: StateStore[], additionalFn?: (changedataResults) => Promise<void>): Promise<number> {

        let processed_seq = this.sequence
        console.log(`rollForwardState: reading "${this.collection}" from database from_sequence#=${processed_seq}`)
    
        const stateStoreByName: { [key: string]: StateStore } = stateStores.reduce((acc, i) => { return { ...acc, [i.name]: i } }, {})
    
        await this.db.collection(this.collection).createIndex({ sequence: 1 })
        const cursor = await this.db.collection(this.collection).aggregate([
            { $match: { $and: [{ "partition_key": this.tenentKey }, { sequence: { $gte: this.sequence } }] } },
            { $sort: { "sequence": 1 /* assending */ } }
        ])
    
        while (await cursor.hasNext()) {
            const { _id, partition_key, sequence, ...changedata } = await cursor.next()
            let applyReturnInfo = {}
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
}