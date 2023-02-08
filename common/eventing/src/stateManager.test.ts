

import { StateManager, Reducer, ReducerReturn, StateStoreValueType, UpdatesMethod, Control } from './stateManager'
import { EventStoreConnection } from './eventStoreConnection'
import { MongoClient } from 'mongodb'



export interface SimpleObject {
    _id?: number
    name?: string;
    status?: number;
}

export interface SimpleAction {
    type: SimpleActionType;
    _id?: number;
    doc?: SimpleObject;
    status?: any;
}

export enum SimpleActionType {
    New ,
    Update
}

type SimpleReducer = {
    simple: {
        simpleitems: Array<SimpleObject>
    }
}

function simpleReducer(timeToProcess = 10 * 1000 /*3 seconds per item*/, factoryCapacity = 5): Reducer<SimpleState, SimpleAction> {
    return {
        sliceKey: 'simple',
        initState : {
            "simpleitems": { 
                type: 'LIST', 
            }
        },
        fn: async function (/*connection,*/ state, action): Promise<ReducerReturn> {
            const { type, _id, doc } = action
            switch (type) {
                case SimpleActionType.New:
                    return [{ failed: !(action.doc && action.doc.hasOwnProperty('_id') === false) }, [
                        { method: 'ADD', path: 'simpleitems', doc: doc }
                    ]]
                case SimpleActionType.Update:
                    return [{ failed: false }, [
                        { method: 'UPDATE', path: 'simpleitems', filter: {_id: _id as number}, doc: { "$set" : doc} }
                    ]]
                default: 
                    return [null, null]
            }
        }
    }
}

type SimpleState = Control & SimpleReducer

class TestStateManager extends StateManager<SimpleState, SimpleAction> {

    constructor(name: string, connection: EventStoreConnection) {
        super(name, connection, [
            simpleReducer(),
        ], [])
    }
}


test('simple store test', async () => {

    // Event Store Connection
    // Store data as an immutable series of events in a mongo container

    const murl : string = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev?replicaSet=rs0"
    const client = new MongoClient(murl);

    const esConnection = new EventStoreConnection(murl, 'test_events')
    const testState = new TestStateManager('emeatest_v0', esConnection)



    await client.connect();
    await esConnection.initFromDB(client.db(), null, false)

    var tsm = new TestStateManager('test', esConnection)
    var [rinfo, dinfo] = await tsm.dispatch({ type: SimpleActionType.New, doc: { name: 'test', status: 1 } })

    console.log('Reducer Info', rinfo)
    console.log('Dispatch Info', dinfo)

    var val = tsm.stateStore.getValue('simple', 'simpleitems')
    expect(val).toEqual([{ name: 'test', status: 1 }])

})
