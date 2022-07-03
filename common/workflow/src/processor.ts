import assert from 'assert'
import Emitter from 'events'
import mongodb from 'mongodb'
const { Timestamp } = mongodb


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

import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
import { StateManager, StateStore, StateUpdates, UpdatesMethod, StateManagerInterface, ReducerReturn, ReducerInfo, Reducer, StateStoreDefinition, StateStoreValueType } from '@az-device-shop/eventing/state'
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

function processorReducer(): Reducer<ProcessAction> {

    return {
        sliceKey: 'processor',
        initState: { 
            "processList": {
                type: StateStoreValueType.List,
            },
            "last_incoming_processed": {
                type: StateStoreValueType.Hash,
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
                    let updates: Array<StateUpdates> = [{
                        method: UpdatesMethod.Add, path: "processList", doc: {
                            function_idx: 0,
                            complete: false,
                            ...(Object.keys(options).length > 0 && { options }),
                            ...(update_ctx && { context_object: update_ctx })
                        }
                    }]

                    if (trigger) {
                        updates.push({ method: UpdatesMethod.Set, path: 'last_incoming_processed', doc: trigger })
                    }
                    return [{ failed: false }, updates]

                case ProcessActionType.RecordProcessStep:

                    return [{ failed: false }, [
                        {
                            method: UpdatesMethod.Update, path: 'processList', filter: { _id }, doc: {
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
                            method: UpdatesMethod.Update, path: 'processList', filter: { _id }, doc : {["$set"]: { lastLinkedRes }}
                        }]]
                default:
                    assert.fail('Cannot apply processor actions, unknown ActionType')
            }
        }
    }
}

class ProcessorStateManager extends StateManager<ProcessAction> {

    constructor(name: string, connection: EventStoreConnection, linkedStateManager: StateManagerInterface) {
        super(name, connection, [
            processorReducer()
        ],
        linkedStateManager)
    }
}

///////////////////////////////////

export interface WorkFlowStepResult {
    state: string | ProcessorOptions,
    _id: number
}

export interface NextFunction<T>  {
    (linkedStateActions: T, options: ProcessorOptions ) : Promise<WorkFlowStepResult>
}

// compose - returns a function that recusivly executes the middleware for each instance of the workflow.
function compose (middleware: Array<(context, next?, lastDispatchResult?) => any>, processorStateManager: StateManager<ProcessAction>) {
    if (!Array.isArray(middleware)) throw new TypeError('Middleware stack must be an array!')
    for (const fn of middleware) {
      if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
    }
  
    /**
     * @param {Object} context
     * @return {Promise}
     * @api public
     */
  
    return async function (context, /*next?,*/ initProcessorOptions?: ProcessorOptions) {
      // last called middleware #
      let index = -1
      return await dispatch(context._init_function_idx, null, initProcessorOptions)

      // i: number, initial set from processor.init_fuction (from new (0) or restart handleRequest), then from the recusive (i+1) bind value below
      // linkedStateActions: this is additional state actions from the stage to be applied to the state using the CombindDispatch function
      // ProcessorOptions: these are processor options, to instruct this function.
      async function dispatch (i: number, linkedStateActions: any, options: ProcessorOptions = null): Promise<WorkFlowStepResult> {
        if (i <= index && !options.retry_until) return Promise.reject(new Error('next() called multiple times'))
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

            const complete: boolean = (i >= middleware.length || (options && options.complete === true)) && !need_retry

            const [processorInfo, linkedStateInfo] = await processorStateManager.dispatch({
                type: ProcessActionType.RecordProcessStep,
                _id: context._id,
                function_idx: i,
                lastLinkedRes: null,
                complete,
                options: newOpts
            }, need_retry ? undefined : linkedStateActions/*, event_label*/)

            if (linkedStateActions && !need_retry) {
                // Store the linked state info in the processor state store! (capture any new id's that have been created)
                // any processor re-hydration will need to use this info to rehydrate the linked state
                const [addlinkedInfo, addlinkedInfoChanges] = await processorStateManager.rootReducer(null, {
                    type: ProcessActionType.RecordLinkedStateInfo,
                    _id: context._id,
                    lastLinkedRes: linkedStateInfo
                })
                await processorStateManager.stateStore.apply(addlinkedInfoChanges)
                context.lastLinkedRes = linkedStateInfo
            }

            if (complete) {
                return { state: 'complete', _id: context._id }
            } else if (need_retry) {
                if (i === context._init_function_idx) {
                    i--
                } else {
                    return { state: options, _id: context._id}

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


export class Processor<T> extends EventEmitter {

    private _name: string
    private _connection: EventStoreConnection
    private _stateManager: ProcessorStateManager
    private _linkedStateManager: StateManagerInterface
    private _context: any
    private _middleware: Array<(context: any, next: NextFunction<T> ) => Promise<WorkFlowStepResult>>
    private _fnMiddleware
    private _restartInterval: NodeJS.Timeout
    private _active: Set<number>

    constructor(name: string, connection: EventStoreConnection, opts: any = {}) {
        super()
        this._name = name
        this._connection = connection
        this._middleware = []
        this._linkedStateManager = opts.linkedStateManager
        this._context = { processor: this.name, linkedStore: this._linkedStateManager.stateStore }
        this._stateManager = new ProcessorStateManager(name, connection, this._linkedStateManager)
    }

    get connection(): EventStoreConnection {
        return this._connection 
    }

    get stateManager(): StateManagerInterface {
        return this._stateManager
    }

    get linkedStateManager(): StateManagerInterface {
        return this._linkedStateManager
    }

    get stateStore(): StateStore {
        return this._stateManager.stateStore
    }

    getProcessorState(path: string, idx?: number) {
        return this.stateStore.getValue('processor', path, idx)
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

    private restartProcessors(/*checkSleepStageFn, restartall*/) {
        // Restart required_state_processor_state
        for (let p of this.getProcessorState('processList').filter(p => !p.complete) as Array<ProcessObject>) {
            let restartP = null

            if (!this._active.has(p._id)) {

                if (p.options) {
                    // if options, check if still waiting for sleep_until time, or, if retry_until, check if retry value is true, or if its needs to go back a step
                    if (p.options.sleep_until && p.options.sleep_until < Date.now()) {
                        //
                        restartP = p
                    } else if (p.options.retry_until && !p.options.retry_until.isTrue) {
                        restartP = {...p, function_idx: p.function_idx-1,  options: {...p.options, retry_until: {...p.options.retry_until,  _retry_count: p.options.retry_until._retry_count+1}}}
                    } else {
                        restartP = p
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

    use(fn: (context: any, next: NextFunction<T> ) => Promise<WorkFlowStepResult>) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');
        //console.log('use %s', fn._name || fn.name || '-');
        this._middleware.push(fn);
        //return this;
    }
    

    async listen (/*checkSleepStageFn?: (arg: any) => boolean*/): Promise<(update_ctx, trigger) => Promise<ReducerInfo>> {
        const fn = this._fnMiddleware  = compose(this._middleware, this._stateManager)
    
        if (!this.listenerCount('error')) this.on('error', (err) => console.error(err.toString()))
    
        const handleRequest = async (update_ctx, trigger): Promise<ReducerInfo> => {
            //console.log ("processor.listen.handleRequest, new process started")
            // Add to processList
            const [{ processor }] = await this._stateManager.dispatch({
                type: ProcessActionType.New,
                options: { update_ctx },
                ...(trigger && { trigger })
            })

            // Launch the workflow
            if (!processor.failed) {
                this.handleRequest(processor.added, fn)
            }
            return processor
        }

        // re-hydrate the processor state store
        // TBC - Need to restore "linkedStateInfo" that is NOT stored in the message, its applyed AFTER to the processor state!
        await this.connection.rollForwardState([this.stateStore, this.linkedStateManager.stateStore], async (applyInfo) => {
            const processorStateInfo = applyInfo[this.stateStore.name]
            const linkedStateInfo = applyInfo[this.linkedStateManager.stateStore.name]
            if (processorStateInfo && linkedStateInfo) {
                // Store the linked state info in the processor state store! (capture any new id's that have been created)
                // any processor re-hydration will need to use this info to rehydrate the linked state
                const [addlinkedInfo, addlinkedInfoChanges] = await this._stateManager.rootReducer(null, {
                    type: ProcessActionType.RecordLinkedStateInfo,
                    _id: processorStateInfo['processor']['merged']._id,
                    lastLinkedRes: linkedStateInfo
                })
                await this._stateManager.stateStore.apply(addlinkedInfoChanges)
            }
        })
        console.log (`Processor: re-hydrated processor state store to sequence=${this.connection.sequence}`)
        this._active = new Set()

        // restart any processors that have been pre-loaded into the processor state store
        this.restartProcessors(/*checkSleepStageFn, true*/)

        // restart any processors that have been put into a sleeping state in the processor state store
        console.log(`Processor: Starting Interval to process 'sleep_until' workflows.`)
        this._restartInterval = setInterval(() => {
            //console.log('factory_startup: check to restart "sleep_until" processes')
            this.restartProcessors(/*checkSleepStageFn, false*/)
        }, 1000 * 1 )
    
        return handleRequest
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

    handleRequest (p: ProcessObject, fnMiddleware) {

        assert (!isNaN(p._id), 'ctx._id is required')
        this._active.add(p._id)

        const ctx = this.createContext(p)
        return fnMiddleware(ctx, p.options).then((r) => {
            this._active.delete(ctx._id)
            // NEED to return await next in workflow step to get "r"
            // console.log(`handleResponse r=${JSON.stringify(r)}`)
        }).catch((err) => {
            console.error(err)
        })
    }


    get processList()  : Array<ProcessObject>  {
        return this.getProcessorState('processList')
    }

    get stats(): {total: number, running: number, completed: number} {
        return this.processList.reduce((acc, p) => {return {total: acc.total + 1, running: acc.running + (p.complete ? 0:1), completed: acc.completed + (p.complete ? 1:0)}}, {total: 0, running: 0, completed: 0})
    }
}
