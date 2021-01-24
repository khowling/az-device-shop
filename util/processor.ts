const assert = require('assert')
const Emitter = require('events')
import { Atomic } from './atomic'

// This represents the 'state' of the processor (its hydrated from the ProcessorChange events)
export interface ProcessingState {
    processor_sequence: number;
    last_trigger: any;
    proc_map: Map<string, ProcessorObject>
}

interface ProcessorObject {
    // Same value as "proc_map" key
    process_id?: number;

    // full process context, only used for 'ProcessingState', not event log
    context_object?: any;
    function_idx?: number;
    options?: ProcessorOptions;
}

// this gets written to the eventlog for re-hybration
interface ProcessorChange {
    // only used for event log, its the Map key in 'ProcessingState'
    process_id?: string;
    next_sequence?: number;
    function_idx?: number;
    complete: boolean;
    options?: ProcessorOptions;
    trigger?: any // from trigger
}

export interface ProcessorOptions {
    update_ctx?: any;
    endIfFailed: boolean;
    sleep_until?: {
        doc_id?: string;
        stage?: number; //OrderStage;
        time?: number;
    }
}

// Perform Action on state
export interface ProcessorAction {
    type: ActionType;
    process_id?: string;
    status?: ProcessorChange;
    trigger?: any; // add trigger info to process
}
export enum ActionType { NEW, UPDATE }



export class Processor extends Atomic {

    private _name: string = "defaultProcessor"
    private processActionFn: (action: any) => [boolean, Array<any>]
    private commitEventsFn: (middlewareEvnts: Array<any>, processor: any, label: string) => void
    private applyEventsFn: (events: Array<any>) => void

    private _context: any
    middleware: Array<() => any> = []

    constructor(opts: any = {}) {
        super();
        this._name = opts.name
        this.processActionFn = opts.processActionFn
        this.commitEventsFn = opts.commitEventsFn
        this.applyEventsFn = opts.applyEventsFn
        this._context = { processor: this.name }
    }

    get name(): string {
        return this._name
    }

    get context(): any {
        return this._context
    }

    private _state = { processor_sequence: 0, last_trigger: {}, proc_map: new Map() }

    get state(): ProcessingState {
        return this._state;
    }

    set state(newstate: ProcessingState) {
        this._state = newstate
    }

    get serializeState() {
        return { ...this._state, proc_map: [...this._state.proc_map] }
    }

    deserializeState(newstate?): void {
        if (newstate) {
            this.state = { ...newstate, proc_map: new Map(newstate.proc_map) }
        }
    }

    applyEvents(val: ProcessorChange): ProcessorObject {

        assert(val.process_id, `applyEvents, Cannot apply ProcessorChange, no "process_id"`)
        assert(val.next_sequence && val.next_sequence === this.state.processor_sequence + 1, `applyEvents, Cannot apply change sequence ${val.next_sequence}, expecting ${this.state.processor_sequence + 1}`)

        const { process_id, next_sequence, options, complete, function_idx, trigger } = val // dont need to store process_id, its the key to the Map
        const newstate = { ...this.state, processor_sequence: val.next_sequence, proc_map: new Map(this.state.proc_map) } // a clone

        if (trigger) {
            newstate.last_trigger = { ...newstate.last_trigger, ...val.trigger }
        }

        let new_proc_object

        if (complete) {
            newstate.proc_map.delete(process_id)
        } else {

            // split 'update_ctx' out of event, and aggritate into 'context_object'
            const { update_ctx, ...other_options } = options || {}
            const current_proc_object: ProcessorObject = newstate.proc_map.get(process_id) || {}
            new_proc_object = { ...current_proc_object, process_id, function_idx, ...(other_options && { options: other_options as ProcessorOptions }), context_object: { ...current_proc_object.context_object, ...update_ctx } }
            newstate.proc_map.set(process_id, new_proc_object)
        }
        this.state = newstate
        return new_proc_object
    }

    restartProcessors(checkSleepStageFn, restartall) {

        // Restart required_state_processor_state
        for (let [process_id, p] of this.state.proc_map) {

            if (p.options && p.options.sleep_until) {

                if (p.options.sleep_until.stage) {
                    if (checkSleepStageFn(p.options.sleep_until.doc_id, p.options.sleep_until.stage)) {
                        continue
                    }
                } else if (p.options.sleep_until.time) {
                    if (p.options.sleep_until.time >= Date.now()) continue /* dont restart */
                } else {
                    continue /* dont restart */
                }

            } else if (!restartall) {
                continue /* dont restart */
            }
            console.log(`Re-inflating processor for context_id=${process_id}, fnidx=${p.function_idx}, sleep_unit=${JSON.stringify(p.options.sleep_until)}`)
            try {
                this.launchHandler(p)
            } catch (err) {
                console.error(`restartProcessors, failed to restart process ${process_id}, err=${err}`)
            }
        }
    }

    use(fn) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');

        //console.log('use %s', fn._name || fn.name || '-');
        this.middleware.push(fn);
        return this;
    }

    private processAction(action: ProcessorAction, failedMiddleware: boolean) {
        // generate events from action
        const next_sequence = this.state.processor_sequence + 1
        switch (action.type) {
            case ActionType.NEW:
                return {
                    process_id: `P${next_sequence}`,
                    next_sequence,
                    function_idx: 0,
                    complete: failedMiddleware && action.status.options.endIfFailed,
                    options: action.status.options,
                    ...(action.trigger && { trigger: action.trigger })
                }
            case ActionType.UPDATE:
                return {
                    process_id: action.process_id,
                    next_sequence,
                    function_idx: action.status.function_idx,
                    complete: failedMiddleware && action.status.options.endIfFailed,
                    options: action.status.options
                }
            default:
                assert.fail('Cannot apply processor actions, unknown ActionType')
        }
    }

    async apply(action: ProcessorAction, middlewareActions, event_label): Promise<ProcessorObject> {
        assert(this.commitEventsFn, 'Cannot apply processor actions, no "commitEventsFn" provided')
        assert(middlewareActions ? this.processActionFn && this.applyEventsFn : true, 'Cannot apply processor actions, got "middlewareActions" to ally, but no "processActionFn" or "applyEventsFn" provided')

        let release = await this.aquire()

        const [hasFailed, middleware_events] = middlewareActions ? this.processActionFn(middlewareActions) : [, null]

        const proc_events = this.processAction(action, hasFailed)

        // write events
        await this.commitEventsFn(middleware_events,
            { [this.name]: proc_events },
            event_label)

        // apply to local state
        let new_proc_object = this.applyEvents(proc_events)
        //apply events from middleware
        if (middleware_events) {
            this.applyEventsFn(middleware_events)
        }

        release()
        return new_proc_object
    }

    //  Initiate new processor workflow
    launchHandler(trigger: ProcessorObject) {

        function compose(processref, start_idx: number, trigger: ProcessorObject) {
            if (!trigger.process_id) {
                throw new Error('Error, launchHandler called without trigger.process_id')
            }

            const context = Object.create(processref.context)
            for (let k of Object.keys(trigger.context_object)) {
                context[k] = trigger.context_object[k]
            }
            context.process_id = trigger.process_id

            let index = -1

            return dispatch(start_idx, null, trigger.options, null)

            async function dispatch(i: number, middlewareActions: any, options: ProcessorOptions, event_label: string) {

                console.log(`Processor: dispatch called i=${i}, start_idx=${start_idx}, index=${index} (middleware.length=${processref.middleware.length})`)

                if (i <= index) return Promise.reject(new Error('next() called multiple times'))
                index = i

                // apply context updates from "update_ctx" to "context"
                if (options && options.update_ctx) {
                    for (let k of Object.keys(options.update_ctx)) {
                        context[k] = options.update_ctx[k]
                    }
                }

                let fn = processref.middleware[i]
                // Add processor details for processor hydration & call 'eventfn' to store in log
                if (i > start_idx) {

                    const proc: ProcessorObject = await processref.apply({
                        type: ActionType.UPDATE,
                        process_id: context.process_id,
                        status: {
                            function_idx: i,
                            options
                        } as ProcessorChange
                    }, middlewareActions, event_label)

                    // if !proc, that means its been marked as completed
                    if ((options && options.sleep_until) || !proc) return Promise.resolve()
                }

                try {
                    return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
                } catch (err) {
                    return Promise.reject(err)
                }
            }
        }

        return compose(this, 0, trigger).then(
            pid => console.log(`process successfullly finished id=${pid} `)
        ).catch(
            err => console.error(`Any error in the pipeline ends here: ${err}`)
        )


    }

    async initiateWorkflow(new_ctx, trigger): Promise<ProcessorObject> {
        console.log('initiateWorkflow: creating process event')

        const po = await this.apply({
            type: ActionType.NEW,
            status: {
                complete: false,
                options: {
                    update_ctx: new_ctx,
                    endIfFailed: true
                }
            },
            ...(trigger && { trigger })
        } as ProcessorAction, null, null)
        this.launchHandler(po)
        return po
    }

}
