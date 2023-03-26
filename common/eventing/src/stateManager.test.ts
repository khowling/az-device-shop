
import {describe, expect, test, beforeAll, afterAll} from '@jest/globals';

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

const VALUE_TYPES = {
    NEW: 'new',
    UPDATE: 'udpate'
}
export type SimpleActionType = keyof typeof VALUE_TYPES

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
                identifierFormat: {prefix: 'S_', zeroPadding: 5}
            },
            "workflow": {
                type: 'HASH',
                values: {
                    keyStage: 'stage1'
                }
            }
        },
        fn: async function (/*connection,*/ state, action): Promise<ReducerReturn> {
            const { type, _id, doc } = action
            switch (type) {
                case 'NEW':
                    return [{ failed: !(action.doc && action.doc.hasOwnProperty('_id') === false) }, [
                        { method: 'ADD', path: 'simpleitems', doc: doc }
                    ]]
                case 'UPDATE':
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


describe('Test Data Types (jesttest_01)', () => {

    // Event Store Connection
    // Store data as an immutable series of events in a mongo container

    const murl : string = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev?replicaSet=rs0"
    
    const client = new MongoClient(murl);
    
    const esConnection = new EventStoreConnection(murl, 'jesttest_collection_01')
    const testState = new TestStateManager('jesttest_level_01', esConnection)
    //const testState02 = new TestStateManager('jesttest_level_02', esConnection)


    beforeAll(async () => {
        await client.connect();
        await esConnection.initFromDB(client.db(), null, {distoryExisting: true})
        await testState.stateStore.initStore({distoryExisting: true})
        //await testState02.stateStore.initStore({distoryExisting: true})
    })

    afterAll(async () => {
        esConnection.close()
        await client.close()
    });

    
    test('Test LIST', async () => {


        // level store is initiallised with no data, so no changes should be applied
        expect(await testState.stateStore.getValue('_control', 'change_count')).toBe(0)

        // level store is initiallised with no data, so no mongo collection logs should be applied
        expect(await testState.getLogSequenece()).toBe(0)

        expect(
            await testState.stateStore.getValue('simple', 'simpleitems')
        ).toHaveLength(0)

        var [sequece, rinfo, dinfo] = await testState.dispatch({ type: 'NEW', doc: { name: 'test', status: 1 } })

        console.log('Reducer Info', rinfo)
        console.log('Dispatch Info', dinfo)

        // Ensure the _id field is set to 0
        expect(rinfo).toHaveProperty('simple.added._id', 0)
        expect(rinfo).toHaveProperty('simple.added.identifier', 'S_00000')
    

        var [sequence, rinfo, dinfo] = await testState.dispatch({ type: 'NEW', doc: { name: 'test10', status: 10 } })

        console.log('Reducer Info', rinfo)
        console.log('Dispatch Info', dinfo)

        // Ensure the _id field is set to 1
        expect(rinfo).toHaveProperty('simple.added._id', 1)
        expect(rinfo).toHaveProperty('simple.added.identifier', 'S_00001')

        // Make 2 state changes, so expect change_count=2, and 2 collection documents recorded, log_sequence=2
        expect(await testState.stateStore.getValue('_control', 'change_count')).toBe(2)
        expect(await testState.getLogSequenece()).toBe(2)

        // Return full array of simpleitems
        expect(
            await testState.stateStore.getValue('simple', 'simpleitems')
        ).toHaveLength(2)

        expect(
            await testState.stateStore.getValue('simple', 'simpleitems', 1)
        ).toHaveProperty('_id', 1)
    
    })
     
    test('Test HASH dafult value', async () => {
        expect(
            await testState.stateStore.getValue('simple', 'workflow')
        ).toHaveProperty('keyStage', 'stage1')
    })

    test('Rollforward level store', async () => {

        console.log ('init leveldb log collection')
        await testState.stateStore.initStore({distoryExisting: true})

        console.log ('check its initialised')
        expect(await testState.stateStore.getValue('_control', 'change_count')).toBe(0)
        expect (await testState.getLogSequenece()).toBe(0)

        console.log ('roll forward state')
        await esConnection.rollForwardState([testState.stateStore])
        expect(await testState.stateStore.getValue('_control', 'change_count')).toBe(2)
        expect (await testState.getLogSequenece()).toBe(2)

        expect(
            await testState.stateStore.getValue('simple', 'simpleitems', 1)
        ).toHaveProperty('_id', 1)
    })

    
})

