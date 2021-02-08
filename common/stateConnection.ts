import { Atomic, AtomicInterface } from './atomic'
const { MongoClient, ObjectID } = require('mongodb')

export class StateConnection {
    private murl: URL;
    private _sequence: number;
    private _collection: string;
    private _db: any;
    private _tenent: {
        email: string;
    }
    private _updateMutex: AtomicInterface

    constructor(murl: URL, collection: string) {
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

    set sequence(sequence) {
        this._sequence = sequence
    }

    get sequence() {
        return this._sequence
    }

    get mutex() {
        return this._updateMutex
    }

    async initFromDB(db, tenent) {
        this._db = db

        if (!tenent) {
            while (true) {
                this._tenent = await this._db.collection("business").findOne({ _id: ObjectID("singleton001"), partition_key: "root" })
                if (this._tenent) break
                console.warn('StateConnection: No "singleton001" document in "business" collection, waiting until initialised...')
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } else {
            this._tenent = tenent
        }

        this._updateMutex = new Atomic()
        return this
    }

    async init() {
        const client = await MongoClient.connect(this.murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
        return await this.initFromDB(client.db(), null)
    }
}