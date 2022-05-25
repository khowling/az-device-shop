

import { Processor, ProcessorOptions, NextFunction, WorkFlowStepResult } from "./processor.js"
import { EventStoreConnection } from './eventStoreConnection.js'
import { StateManager, Reducer, ReducerReturn, StateStoreValueType, UpdatesMethod } from './stateManager.js'



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

function simpleReducer(timeToProcess = 10 * 1000 /*3 seconds per item*/, factoryCapacity = 5): Reducer<SimpleAction> {

    return {
        sliceKey: 'simple',
        initState : {
            "simpleitems": { 
                type: StateStoreValueType.List, 
            }
        },
        fn: async function (/*connection,*/ state, action): Promise<ReducerReturn> {
            const { type, _id, doc } = action
            switch (type) {
                case SimpleActionType.New:
                    return [{ failed: !(action.doc && action.doc.hasOwnProperty('_id') === false) }, [
                        { method: UpdatesMethod.Add, path: 'simpleitems', doc: doc }
                    ]]
                case SimpleActionType.Update:
                    return [{ failed: false }, [
                        { method: UpdatesMethod.Update, path: 'simpleitems', filter: {_id}, doc: { "$set" : doc} }
                    ]]
                default: 
                    return [null, null]
            }
        }
    }
}

class TestStateManager extends StateManager<SimpleAction> {

    constructor(name: string, connection: EventStoreConnection) {
        super(name, connection, [
            simpleReducer(),
        ])
    }
}


async function test() {

    // Event Store Connection
    // Store data as an immutable series of events in a mongo container
    const murl = process.env.MONGO_DB
    console.log(`Initilise EventStoreConnection with 'test_events' (MONGO_DB=${murl})`)

    const esConnection = new EventStoreConnection(murl, 'test_events')
    
    const testState = new TestStateManager('emeafactory_v0', await esConnection.init(false))

    // Create state machine
    // statePlugin, allows you to pass in actions into the processor next() function
    const processor = new Processor<SimpleActionType>('test_v001', esConnection,  { linkedStateManager: testState })
//    setInterval(() => {
//        console.log(processor.processList)
//    },1000)

    // Add workflow steps, ALL STEPS MUST BE ITEMPOTENT

    async function sleepAndCtxTest(ctx, next) {
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


    async function retryAndAddedTest (ctx, next) {
        console.log (`step2: result from linkedAction ctx._retry_count=${ctx._retry_count}, ctx.lastLinkedRes=${JSON.stringify(ctx.lastLinkedRes)}`)
        const s : SimpleObject = ctx.lastLinkedRes.simple.added as SimpleObject
        return await next(
            { type: SimpleActionType.Update, _id: s._id , doc: { status: 40} }, 
            { update_ctx: { simple_id: s._id }, retry_until: {isTrue: (ctx._retry_count || 0) === 3} })
    }

    async function finish (ctx, next) {
        console.log (`step3 done : ctx.linkedRes=${JSON.stringify(ctx.lastLinkedRes)}`)

        return await next()
    }


    processor.use(sleepAndCtxTest)
    processor.use(retryAndAddedTest)
    processor.use(finish)


    // Trigger first workflow
    const submitFn = await processor.listen()
    
    
    
    const po = await submitFn({ trigger: { doc: {message: "my first workflow"} } }, null)
    console.log (`test() : po=${JSON.stringify(po)}`)

    //await new Promise(resolve => setTimeout(resolve, 10 * 1000))
    //processor.debugState()
    //testState.stateStore.debugState()
    //const po1 = await processor.initiateWorkflow({ trigger: { doc: {message: "my second workflow"} } }, null)
    //console.log (`test() : po=${JSON.stringify(po1)}`)

}

test()

