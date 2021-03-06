import { Atomic, AtomicInterface } from './atomic'
const { MongoClient, ObjectID } = require('mongodb')
import { EventEmitter } from 'events'

interface Tenent {
    _id: typeof ObjectID;
    email: string;
}
export class StateConnection extends EventEmitter {
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
    async initFromDB(db, tenent) {
        this._db = db

        if (!tenent) {
            while (true) {
                this._tenent = await this._db.collection("business").findOne({ type: "business", partition_key: "root" })
                if (this._tenent) break
                console.warn('StateConnection: No type="business" document in "business" collection, waiting until initialised...')
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
        return this
    }

    async init() {
        const client = await MongoClient.connect(this.murl, { useNewUrlParser: true, useUnifiedTopology: true })
        return await this.initFromDB(client.db(), null)
    }
}