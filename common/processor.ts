const assert = require('assert')
const Emitter = require('events')
const { Timestamp } = require('mongodb')


export interface ProcessorOptions {
    update_ctx?: any;
    sleep_until?: {
        workItemId?: string;
        stage?: number; //OrderStage;
        time?: number;
    }
}

import { StateConnection } from './stateConnection'
import { StateStore, StateManager, StateManagerInterface, UpdatesMethod, ReducerReturn, ReducerInfo, Reducer, StateUpdates } from './flux'
import { EventEmitter } from 'events'

interface ProcessAction {
    type: ProcessActionType;
    flow_id?: string;
    function_idx?: number;
    complete: boolean;
    options?: ProcessorOptions;
    //failedMiddleware: boolean;
    trigger?: any;
}

enum ProcessActionType {
    New = 'workflow/New',
    Update = 'workflow/Update',
}

interface ProcessReducerState {
    processor_sequence: number;     // lateset processor_sequence # (one for each workflow event)
    flow_sequence: number;          // lateset flow_sequence # (one for each workflow)
    last_incoming_processed: {
        sequence: number;
        continuation: any;
    }
    proc_map: Array<ProcessObject>
}

interface ProcessObject {
    // Same value as "proc_map" key
    flow_id?: string;
    complete: boolean;
    // full process context, only used for 'ProcessingState', not event log
    context_object?: any;
    function_idx?: number;
    options?: ProcessorOptions;
}

function processorReducer(): Reducer<ProcessReducerState, ProcessAction> {

    return {
        sliceKey: 'processor',
        initState: { flow_sequence: 0, last_incoming_processed: { sequence: 0, continuation: null }, proc_map: [] } as ProcessReducerState,
        fn: async function (connection, state: ProcessReducerState, action: ProcessAction): Promise<ReducerReturn> {
            const { type, flow_id, function_idx, complete, trigger } = action
            // split 'action.options.update_ctx' out of event, and aggritate into state 'context_object'
            const { update_ctx, ...options } = action.options || {}

            switch (type) {
                case ProcessActionType.New:
                    let updates: Array<StateUpdates> = []
                    if (trigger) {
                        if (Number.isInteger(trigger.sequence)) {
                            assert(trigger.sequence === state.last_incoming_processed.sequence + 1, `processorReducer, cannot apply incoming new trigger.sequence=${trigger.sequence}, last_incoming_processed=${state.last_incoming_processed.sequence}`)
                            updates.push({ method: UpdatesMethod.Inc, path: 'last_incoming_processed', doc: { sequence: 1 } })
                        }
                        if (trigger.continuation) {
                            updates.push({ method: UpdatesMethod.Set, path: 'last_incoming_processed', doc: { continuation: trigger.continuation } })
                        }
                    }

                    const new_flow_id = `WF${state.flow_sequence}`
                    return [{ failed: false, id: new_flow_id }, [
                        { method: UpdatesMethod.Inc, doc: { flow_sequence: 1 } } as StateUpdates,
                        {
                            method: UpdatesMethod.Add, path: 'proc_map', doc: {
                                flow_id: new_flow_id,
                                function_idx: 0,
                                complete: false,
                                ...(Object.keys(options).length > 0 && { options }),
                                ...(update_ctx && { context_object: update_ctx })
                            } as ProcessObject
                        } as StateUpdates
                    ].concat(updates)]
                case ProcessActionType.Update:

                    return [{ failed: false }, [
                        {
                            method: UpdatesMethod.Merge, path: 'proc_map', filter: { flow_id }, doc: {
                                function_idx: function_idx,
                                complete /* || failedMiddleware*/,
                                options: Object.keys(options).length > 0 ? options : null, // if no options props, send a 'null' to overrite any existing options
                                ...(update_ctx && { context_object: update_ctx })
                            } as ProcessObject
                        }]]
                default:
                    assert.fail('Cannot apply processor actions, unknown ActionType')
            }
        }
    }
}

class ProcessorStateManager extends StateManager {

    constructor(name: string, connection: StateConnection) {
        super(name, connection, [
            processorReducer()
        ])
    }
}

///////////////////////////////////


export class Processor extends EventEmitter {

    private _name: string

    private _statePlugin: StateManagerInterface
    private _stateManager: ProcessorStateManager
    private _connection: StateConnection
    private _context: any
    private _middleware: Array<() => any> = []

    constructor(name: string, connection: StateConnection, opts: any = {}) {
        super()
        this._name = name
        this._connection = connection
        this._context = { processor: this.name }
        this._statePlugin = opts.statePlugin

        this._stateManager = new ProcessorStateManager(name, connection)
    }

    get stateStore(): StateStore {
        return this._stateManager.stateStore
    }

    get processorState(): ProcessReducerState {
        return this._stateManager.stateStore.state['processor']
    }

    get name(): string {
        return this._name
    }

    get context(): any {
        return this._context
    }

    initProcessors(checkSleepStageFn: (any) => boolean, seconds: number = 10): NodeJS.Timeout {
        this.restartProcessors(checkSleepStageFn, true)

        console.log(`Processor: Starting Interval to process 'sleep_until' workflows.`)
        return setInterval(() => {
            //console.log('factory_startup: check to restart "sleep_until" processes')
            this.restartProcessors(checkSleepStageFn, false)
        }, 1000 * seconds /* 10 seconds */)
    }


    private restartProcessors(checkSleepStageFn, restartall) {

        // Restart required_state_processor_state
        for (let pobj of this.processorState.proc_map.filter(p => !p.complete)) {

            if (pobj.options && pobj.options.sleep_until) {

                if (pobj.options.sleep_until.stage) {
                    if (checkSleepStageFn(pobj.options.sleep_until)) {
                        continue
                    }
                } else if (pobj.options.sleep_until.time) {
                    if (pobj.options.sleep_until.time >= Date.now()) continue /* dont restart */
                } else {
                    continue /* dont restart */
                }

            } else if (!restartall) {
                continue /* dont restart */
            }
            console.log(`processor.restartProcessors pid=${pobj.flow_id}, fidx=${pobj.function_idx}, sleep_unit=${pobj.options && JSON.stringify(pobj.options.sleep_until)}`)
            try {
                this.launchHandler(pobj.flow_id)
            } catch (err) {
                console.error(`restartProcessors, failed to restart process ${pobj.flow_id}, err=${err}`)
            }
        }
    }

    use(fn) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');
        //console.log('use %s', fn._name || fn.name || '-');
        this._middleware.push(fn);
        return this;
    }


    // requires custom dispatch, because need to see if stateActions have failed, if so, stop the workflow.
    async combindDispatch(action: ProcessAction, stateActions: any/*, event_label*/): Promise<boolean /*{ [key: string]: ReducerInfo }*/> {
        assert(this._connection, 'dispatch: Cannot apply processor actions, no "Connection" details provided')
        const cs = this._connection

        assert(stateActions ? this._statePlugin : true, 'Cannot apply processor actions, got "stateActions" to apply, but no "statePlugin" class provided')

        let release = await cs.mutex.aquire()
        const [stateInfo, stateChanges] = stateActions ? await this._statePlugin.processAction(stateActions) : [{}, null]

        // if any of the state reducers return failed, then stop the workflow
        if (Object.keys(stateInfo).reduce((acc, i) => stateInfo[i].failed || acc, false)) {
            action.complete = true
        }


        const [info, changes] = await this._stateManager.processAction(action)
        //console.log(`processor.apply: action: pid=${action.flow_id} fidx=${action.function_idx}  complete=${action.complete}. Event: next_seq=${proc_events.next_sequence} pid=${proc_events.flow_id} fidx=${proc_events.function_idx}  complete=${proc_events.complete} `)

        // write events
        const msg = {
            sequence: cs.sequence + 1,
            _ts: new Timestamp(), // Emptry timestamp will be replaced by the server to the current server time
            partition_key: cs.tenentKey,
            ...(stateChanges && { [this._statePlugin.name]: stateChanges }),
            [this.name]: changes
        }

        const res = await cs.db.collection(cs.collection).insertOne(msg)
        this.emit('changes', msg)
        cs.sequence = cs.sequence + 1

        // applyEvents to local state
        if (changes) {
            this._stateManager.stateStoreApply(changes)
        }
        //applyEvents events from middleware
        if (stateChanges) {
            this._statePlugin.stateStoreApply(stateChanges)
        }

        release()
        return action.complete
    }


    //  Initiate new processor workflow
    launchHandler(id: string) {

        function compose(trigger: ProcessObject) {
            if (!trigger.flow_id) {
                throw new Error('Error, launchHandler called without trigger.flow_id')
            }

            const context = Object.create(this.context)
            for (let k of Object.keys(trigger.context_object)) {
                context[k] = trigger.context_object[k]
            }
            context.flow_id = trigger.flow_id

            let index = -1

            return dispatch.bind(this, trigger.function_idx, null, trigger.options, null)()

            async function dispatch(i: number, stateActions: any, options: ProcessorOptions = null /*, event_label: string*/) {

                //console.log(`Processor: dispatch called i=${i}, trigger.function_idx=${trigger.function_idx}, index=${index} (middleware.length=${this.middleware.length})`)

                if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                index = i

                // apply context updates from "update_ctx" to "context"
                if (options && options.update_ctx) {
                    for (let k of Object.keys(options.update_ctx)) {
                        context[k] = options.update_ctx[k]
                    }
                }

                // Add processor details for processor hydration & call 'eventfn' to store in log
                if (i > trigger.function_idx) {

                    const complete: boolean = i >= this._middleware.length

                    //const proc: ProcessorObject = await this.combindDispatch({
                    const iscomplete = await this.combindDispatch({
                        type: ProcessActionType.Update,
                        flow_id: trigger.flow_id,
                        function_idx: i,
                        complete,
                        options
                    }, stateActions/*, event_label*/)


                    if (iscomplete) {
                        return Promise.resolve({ state: 'complete', flow_id: trigger.flow_id })
                    } else if (options && options.sleep_until) {
                        return Promise.resolve({ state: 'sleep_until', flow_id: trigger.flow_id })
                    }
                }

                try {
                    return Promise.resolve(this._middleware[i](context, dispatch.bind(this, i + 1)));
                } catch (err) {
                    return Promise.reject(err)
                }

            }
        }

        const pobj = this.processorState.proc_map.find(i => i.flow_id === id)
        return (compose.bind(this)(pobj)).then(result =>
            console.log(`process successfullly finished pid=${JSON.stringify(result)} `)
        )//.catch(err =>
        //     console.error(`Any error in the pipeline ends here: ${err}`)
        // )


    }

    async initiateWorkflow(new_ctx, trigger): Promise<ReducerInfo> {
        console.log('initiateWorkflow: creating process event')

        const { processor } = await this._stateManager.dispatch({
            type: ProcessActionType.New,
            options: { update_ctx: new_ctx },
            ...(trigger && { trigger })
        })
        this.launchHandler(processor.id)//.then(r => console.log(r))
        return processor
    }

}
