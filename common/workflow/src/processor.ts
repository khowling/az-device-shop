import assert from 'assert'

export interface ProcessorOptions {
    complete?: boolean,
    update_ctx?: any;
    sleep_until?: number;
    retry_until?: {
        isTrue: boolean;
        interval?: number;
        _retry_count?: number;
    }
}

import { ApplyInfo, EventStoreConnection } from '@az-device-shop/eventing'
import { StateManager, StateStore, StateUpdate, StateManagerInterface, ReducerReturn, ReducerInfo, Reducer, StateStoreDefinition, type Control } from '@az-device-shop/eventing'
import { EventEmitter } from 'events'

interface ProcessAction {
    type: ProcessActionType;
    _id?: number;
    function_idx?: number;
    complete?: boolean;
    options?: ProcessorOptions;
    //failedMiddleware: boolean;
    trigger?: any;
    lastLinkedRes?: {[key: string]: ReducerInfo};
}

enum ProcessActionType {
    New,
    RecordProcessStep,
    RecordLinkedStateInfo
}

interface ProcessObject {
    // Same value as "proc_map" key
    _id?: number;
    complete: boolean;
    // full process context, only used for 'ProcessingState', not event log
    context_object?: any;
    function_idx?: number;
    options?: ProcessorOptions;
    lastLinkedRes?: {[key: string]: ReducerInfo};
}

type ProcessorSlice = {
    processor: {
        processList: Array<ProcessObject>;
        last_incoming_processed: any; // trigger???
    }
}

function processorReducer(): Reducer<ProcessorState, ProcessAction> {

    return {
        sliceKey: 'processor',
        initState: { 
            "processList": {
                type: 'LIST',
            },
            "last_incoming_processed": {
                type: 'HASH',
                values: {
                    sequence: 0,
                    continuation: null
                }
            }
        } as StateStoreDefinition,
        fn: async function (/*connection, */ state, action: ProcessAction): Promise<ReducerReturn> {
            const { type, _id, function_idx, complete, trigger, lastLinkedRes } = action
            // split 'action.options.update_ctx' out of event, and aggritate into state 'context_object'
            const { update_ctx, ...options } = action.options || {}

            switch (type) {
                case ProcessActionType.New:
                    let updates: Array<StateUpdate> = [{
                        method: 'ADD', path: "processList", doc: {
                            function_idx: 0,
                            complete: false,
                            ...(Object.keys(options).length > 0 && { options }),
                            ...(update_ctx && { context_object: update_ctx })
                        }
                    }]

                    if (trigger) {
                        updates.push({ method: 'SET', path: 'last_incoming_processed', doc: trigger })
                    }
                    return [{ failed: false }, updates]

                case ProcessActionType.RecordProcessStep:

                    return [{ failed: false }, [
                        {
                            method: 'UPDATE', path: 'processList', filter: { _id } as { _id: number}, doc: {
                                "$set": {
                                    function_idx,
                                    complete,
                                    options
                                },
                                ...(update_ctx && { "$merge": { context_object: update_ctx }})
                            }
                        }]]

                case ProcessActionType.RecordLinkedStateInfo:

                    return [{ failed: false }, [
                        {
                            method: 'UPDATE', path: 'processList', filter: { _id } as { _id: number}, doc : {["$set"]: { lastLinkedRes }}
                        }]]
                default:
                    assert.fail('Cannot apply processor actions, unknown ActionType')
            }
        }
    }
}

export type ProcessorState = Control & ProcessorSlice


class ProcessorStateManager<LS, LA> extends StateManager<ProcessorState, ProcessAction, LS, LA> {

    constructor(name: string, connection: EventStoreConnection, linkedStateManager: StateManagerInterface<LS, LA>) {
        super(
            name, 
            connection, 
            [ processorReducer() ],
            [],
            linkedStateManager
        )
    }
}

///////////////////////////////////

export interface WorkFlowStepResult {
    state: string | ProcessorOptions,
    _id: number
}

export interface NextFunction<T>  {
    (linkedStateActions: T, options?: ProcessorOptions ) : Promise<WorkFlowStepResult>
}

// compose - returns a function that recusivly executes the middleware for each instance of the workflow.
function compose<LS, LA> (middleware: Array<(context:  { [ctxParam: string]: any}, next: NextFunction<LA>, lastDispatchResult?: any) => any>, processorStateManager: ProcessorStateManager<LS, LA>) {
    if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')
    for (const fn of middleware) {
      if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
    }
  
    /**
     * @param {Object} context
     * @return {Promise}
     * @api public
     */
  
    return async function (context :  { [ctxParam: string]: any}, /*next?,*/ initProcessorOptions?: ProcessorOptions) {
      // last called middleware #
      let index = -1
      return await dispatch(context._init_function_idx, null, initProcessorOptions)

      // i: number, initial set from processor.init_fuction (from new (0) or restart handleRequest), then from the recusive (i+1) bind value below
      // linkedStateActions: this is additional state actions from the stage to be applied to the state using the CombindDispatch function
      // ProcessorOptions: these are processor options, to instruct this function.
      async function dispatch (i: number, linkedStateActions: any, options?: ProcessorOptions): Promise<WorkFlowStepResult> {
        if (i <= index && !options?.retry_until) return Promise.reject(new Error('next() called multiple times'))
        index = i

        const need_retry = options?.retry_until && !options.retry_until.isTrue || false

        // apply context updates from "update_ctx" to "context"
        if (options) {
            if(options.update_ctx) {
                for (let k of Object.keys(options.update_ctx)) {
                    context[k] = options.update_ctx[k]
                }
            }
        }

        //console.log (`Processor: i=${i} > context._init_function_idx=${context._init_function_idx}, context._retry_count=${context._retry_count} need_retry=${need_retry}`)
        //To prevent duplicate dispatch when a process is restarted from sleep, or when initially started or worken up
        if (i > context._init_function_idx) {

            // add "_retry_count" key to options object to track number of retries
            const newOpts = options?.retry_until && options.retry_until._retry_count !==  context._retry_count ? {...options, retry_until: {...options.retry_until, _retry_count: context._retry_count}}  : options

            const complete: boolean = (i >= middleware.length || (options && options.complete === true)) as boolean && !need_retry 

            const [sequence, processorInfo, linkedStateInfo] = await processorStateManager.dispatch({
                type: ProcessActionType.RecordProcessStep,
                _id: context._id,
                function_idx: i,
                //lastLinkedRes: null,
                complete,
                options: newOpts
            }, need_retry ? undefined : linkedStateActions/*, event_label*/)

            if (linkedStateActions && !need_retry) {
                // Store the linked state info in the processor state store! (capture any new id's that have been created)
                // any processor re-hydration will need to use this info to rehydrate the linked state
                const [addlinkedInfo, addlinkedInfoChanges] = await processorStateManager.rootReducer(processorStateManager.stateStore, {
                    type: ProcessActionType.RecordLinkedStateInfo,
                    _id: context._id,
                    lastLinkedRes: linkedStateInfo
                })
                await processorStateManager.stateStore.apply(sequence, addlinkedInfoChanges)
                context.lastLinkedRes = linkedStateInfo
            }

            if (complete) {
                return { state: 'complete', _id: context._id }
            } else if (newOpts && newOpts.sleep_until) {
                return { state: 'sleep_until',  _id: context._id  }
            } else if (need_retry) {
                if (i === context._init_function_idx) {
                    i--
                } else {
                    return { state: options as ProcessorOptions, _id: context._id}

                }
            }
        }

        let fn = middleware[i]
        //if (i === middleware.length) fn = next
        if (!fn) return {state: 'last fn', _id: context._id}
        try {
          return Promise.resolve(fn(context, dispatch.bind(null, i + 1)))
        } catch (err) {
          return Promise.reject(err)
        }
      }
    }
  }

export type  ProcessorListenFn = Promise<(input: any, trigger:{ [triggerParams: string]: any}) => Promise<ReducerInfo & ApplyInfo>>


export class Processor<LS = {}, LA = {}> extends EventEmitter {

    private _name: string
    private _connection: EventStoreConnection
    private _stateManager: ProcessorStateManager<LS, LA>
    private _linkedStateManager: StateManagerInterface<LS, LA>
    private _context: any
    private _middleware: Array<(context: { [ctxParam: string]: any}, next: NextFunction<LA> ) => Promise<WorkFlowStepResult>> = []
    private _fnMiddleware: any
    private _restartInterval: NodeJS.Timeout | null = null
    private _active: Set<number> = new Set()

    constructor(name: string, connection: EventStoreConnection, opts: any = {}) {
        super()
        this._name = name
        this._connection = connection
        this._middleware = []
        this._linkedStateManager = opts.linkedStateManager
        this._context = { processor: this.name, linkedStore: this._linkedStateManager.stateStore }
        this._stateManager = new ProcessorStateManager<LS, LA>(name, connection, this._linkedStateManager)
    }

    get connection(): EventStoreConnection {
        return this._connection 
    }

    get stateManager(): ProcessorStateManager<LS, LA> {
        return this._stateManager
    }

    get linkedStateManager(): StateManagerInterface<LS, LA> {
        return this._linkedStateManager
    }

    get stateStore(): StateStore<ProcessorState> {
        return this._stateManager.stateStore
    }

    async getProcessorState(path: string, idx?: number) {
        return await this.stateStore.getValue('processor', path, idx)
    }

    debugState() {
        return this.stateStore.debugState()
    }

    get name(): string {
        return this._name
    }

    get context(): any {
        return this._context
    }

/*
    initProcessors(checkSleepStageFn: (any) => boolean, seconds: number = 10): NodeJS.Timeout {
        this.restartProcessors(checkSleepStageFn, true)

        console.log(`Processor: Starting Interval to process 'sleep_until' workflows.`)
        return setInterval(() => {
            //console.log('factory_startup: check to restart "sleep_until" processes')
            this.restartProcessors(checkSleepStageFn, false)
        }, 1000 * seconds )
    }
*/

    private async restartProcessors(/*checkSleepStageFn, restartall*/) {
        // Restart required_state_processor_state
        for (let p of (await this.getProcessorState('processList')).filter((p: ProcessObject) => !p.complete)) {
            let restartP = null

            if (!this._active.has(p._id as number)) {

                if (p.options) {
                    console.log (`[${Date.now()}] restartProcessors: checking to restart ${p._id} with ${JSON.stringify(p.options)}`)
                    // if options, check if still waiting for sleep_until time, or, if retry_until, check if retry value is true, or if its needs to go back a step
                    if (p.options.sleep_until && p.options.sleep_until < Date.now()) {
                        //
                        restartP = p
                    } else if (p.options.retry_until && !p.options.retry_until.isTrue) {
                        restartP = {...p, function_idx: p.function_idx as number -1,  options: {...p.options, retry_until: {...p.options.retry_until,  _retry_count: p.options.retry_until._retry_count+1}}}
                    } else {
                        //restartP = p
                    }
                    
                } else {
                    restartP = p
                }
            }

            if (restartP) {
                //console.log(`processor.restartProcessors _id=${restartP._id}, function_idx=${restartP.function_idx}, options=${JSON.stringify(restartP.options)}`)
                try {
                    this.handleRequest(restartP, this._fnMiddleware)
                } catch (err) {
                    console.error(`restartProcessors, failed to restart process _id=${restartP._id}, err=${err}`)
                }
            }
        }
    }

    use(fn: (context: any, next: NextFunction<LA> ) => Promise<WorkFlowStepResult>) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');
        //console.log('use %s', fn._name || fn.name || '-');
        this._middleware.push(fn);
        //return this;
    }
    

    async listen (options :  {rollforwadStores: boolean, restartInterval: number} = {rollforwadStores: true, restartInterval: 1000}) {
        const fn = this._fnMiddleware  = compose<LS, LA>(this._middleware, this._stateManager)
    
        if (!this.listenerCount('error')) this.on('error', (err) => console.error(err.toString()))

        if (options.rollforwadStores) {
            // re-hydrate the processor state store
            // TBC - Need to restore "linkedStateInfo" that is NOT stored in the message, its applyed AFTER to the processor state!
            await this.connection.rollForwardState([this.stateStore, this.linkedStateManager.stateStore], async (sequence, applyInfo) => {
                const processorStateInfo = applyInfo[this.stateStore.name]
                const linkedStateInfo = applyInfo[this.linkedStateManager.stateStore.name]
                if (processorStateInfo && linkedStateInfo) {
                    // Store the linked state info in the processor state store! (capture any new id's that have been created)
                    // any processor re-hydration will need to use this info to rehydrate the linked state
                    const [addlinkedInfo, addlinkedInfoChanges] = await this._stateManager.rootReducer(this._stateManager.stateStore, {
                        type: ProcessActionType.RecordLinkedStateInfo,
                        _id: processorStateInfo['processor']['merged']._id,
                        lastLinkedRes: linkedStateInfo
                    })
                    await this._stateManager.stateStore.apply(sequence, addlinkedInfoChanges)
                }
            })
            console.log (`Processor: re-hydrated processor state store(s) to sequence=${this.connection.sequence}`)
        }
        this._active = new Set()

        // restart any processors that have been pre-loaded into the processor state store
        await this.restartProcessors(/*checkSleepStageFn, true*/)

        // restart any processors that have been put into a sleeping state in the processor state store
        if (options.restartInterval > 0) {
            console.log(`Processor: Starting Interval to process 'sleep_until' workflows.`)
            this._restartInterval = setInterval(async () => {
                //console.log('factory_startup: check to restart "sleep_until" processes')
                await this.restartProcessors(/*checkSleepStageFn, false*/)
            }, options.restartInterval )
        }
    
        return async (input: any, trigger: { [triggerParams: string]: any}) => {
            //console.log ("processor.listen.handleRequest, new process started")
            // Add to processList
            const [sequence,  { processor } ] = await this._stateManager.dispatch({
                type: ProcessActionType.New,
                options: { update_ctx: { input } },
                ...(trigger && { trigger })
            })

            // Launch the workflow
            if (!processor.failed) {
                const processItem = processor?.processList?.added?.[0]
                this.handleRequest(processItem, fn)
            }
            return processor
        }
      }

    createContext(p: ProcessObject) {
        // Create the workflow context object for the workflow steps
        const ctx = Object.create(this.context)

        ctx._id = p._id
        ctx._init_function_idx = p.function_idx || 0
        ctx._retry_count = p.options?.retry_until?._retry_count || 0
        ctx.lastLinkedRes = p.lastLinkedRes

        for (let k of Object.keys(p.context_object)) {
            ctx[k] = p.context_object[k]
        }

        return ctx
    }

    handleRequest (p: ProcessObject, fnMiddleware: any) {

        assert (!isNaN(p._id as number), 'ctx._id is required')
        this._active.add(p._id as number)

        const ctx = this.createContext(p)
        return fnMiddleware(ctx, p.options).then((r: any) => {
            this._active.delete(ctx._id)
            // NEED to return await next in workflow step to get "r"
            // console.log(`handleResponse r=${JSON.stringify(r)}`)
        }).catch((err: any) => {
            console.error(err)
        })
    }

}
