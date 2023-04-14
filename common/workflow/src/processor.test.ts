
import { MongoClient } from 'mongodb'
import { Processor, ProcessorOptions, NextFunction, WorkFlowStepResult } from "./processor"
import { EventStoreConnection } from "@az-device-shop/eventing"
import { StateManager, Reducer, ReducerReturn, StateStoreValueType, UpdatesMethod, Control } from '../../eventing'



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
                        { method: 'UPDATE', path: 'simpleitems', filter: {_id } as {_id: number}, doc: { "$set" : doc} }
                    ]]
                default: 
                    return [null, null]
            }
        }
    }
}

export type SimpleState = Control & SimpleReducer

class TestStateManager extends StateManager<SimpleState, SimpleAction> {

    constructor(name: string, connection: EventStoreConnection) {
        super(name, connection, [
            simpleReducer(),
        ], [])
    }
}


describe('Workflow tests (jesttest_02)', () => {

    const murl : string = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev?replicaSet=rs0"
    const client = new MongoClient(murl);
    
    const esConnection = new EventStoreConnection(murl, 'jesttest_02')
    const testState = new TestStateManager('jesttest_02', esConnection)
    const processor = new Processor('jesttest_02', esConnection, { linkedStateManager: testState })
    
    // Add workflow steps, ALL STEPS MUST BE ITEMPOTENT

    async function sleepAndCtxTest(ctx: any, next: any) {
        console.log (`step1: for ctx=${JSON.stringify(ctx)}, sleep for 5 seconds, checking await works ok`)
        //sleep for 5 seconds
        await new Promise(resolve => setTimeout(resolve, 5 * 1000))

        const doc : SimpleObject = { name: 'test', status: 10 }
        console.log (`step1: insert new simple doc, add to key to "ctx", and workflow goes to sleep for 5 seconds`)

        return await next(
            // SimpleAction, to apply using the processor "statePlugin" StateManager in a !single transation! as the processor state
            { type: SimpleActionType.New, doc }, 
            // ProcessorOptions "update_ctx": add keys to the ctx object for following steps
            { update_ctx: { newctx_key: 'newCtxKey' }, sleep_until: Date.now() + 1000 * 5 }
        )
    }


    async function retryAndAddedTest (ctx: any, next: any) {
        console.log (`step2: result from linkedAction ctx._retry_count=${ctx._retry_count}, ctx.lastLinkedRes=${JSON.stringify(ctx.lastLinkedRes)}`)
        const s : SimpleObject = ctx.lastLinkedRes.simple.added as SimpleObject
        return await next(
            { type: SimpleActionType.Update, _id: s._id , doc: { status: 40} }, 
            { update_ctx: { simple_id: s._id }, retry_until: {isTrue: (ctx._retry_count || 0) === 3} })
    }

    async function finish (ctx: any, next: any) {
        console.log (`step3 done : ctx.linkedRes=${JSON.stringify(ctx.lastLinkedRes)}`)

        return await next()
    }


    processor.use(sleepAndCtxTest)
    processor.use(retryAndAddedTest)
    processor.use(finish)




    beforeAll(async () => {
        await client.connect();
        await esConnection.initFromDB(client.db(), null, {distoryExisting: false})
        await testState.stateStore.initStore({distoryExisting: true})
    })

    afterAll(async () => {
        esConnection.close()
        await client.close()
    })
        
//    setInterval(() => {
//        console.log(processor.processList)
//    },1000)


    test('Test basics', async () => {

        // Trigger first workflow
        const submitFn = await processor.listen()
        
        const po = await submitFn({ trigger: { doc: {message: "my first workflow"} } }, {})
        console.log (`test() : po=${JSON.stringify(po)}`)

        await new Promise(resolve => setTimeout(resolve, 10 * 1000))
        processor.debugState()
        //testState.stateStore.debugState()
        const po1 = await submitFn({ trigger: { doc: {message: "my second workflow"} } }, {})
        console.log (`test() : po=${JSON.stringify(po1)}`)
    })

})
