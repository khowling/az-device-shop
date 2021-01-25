const assert = require('assert')
const Emitter = require('events')

// This represents the 'state' of the processor (its hydrated from the ProcessorChange events)
export interface ProcessingState {
    processor_sequence: number;     // lateset processor_sequence # (one for each workflow event)
    flow_sequence: number;          // lateset flow_sequence # (one for each workflow)
    last_trigger: any;
    proc_map: Map<string, ProcessorObject>
}

interface ProcessorObject {
    // Same value as "proc_map" key
    flow_id?: string;

    // full process context, only used for 'ProcessingState', not event log
    context_object?: any;
    function_idx?: number;
    options?: ProcessorOptions;
}

// this gets written to the eventlog for re-hybration
interface ProcessorChange {
    // only used for event log, its the Map key in 'ProcessingState'
    flow_id?: string;
    next_sequence?: number;
    flow_sequence_inc?: number;
    function_idx?: number;
    complete: boolean;
    options?: ProcessorOptions;
    trigger?: any // from trigger
}

export interface ProcessorOptions {
    update_ctx?: any;
    sleep_until?: {
        workItemId?: string;
        stage?: number; //OrderStage;
        time?: number;
    }
}

// Perform Action on state
export interface ProcessorAction {
    type: ActionType;
    flow_id?: string;
    function_idx: number;
    complete: boolean;
    options: ProcessorOptions;
    trigger?: any; // add trigger info to process
}
export enum ActionType { NEW, UPDATE }



export class Processor {

    private _name: string = "defaultProcessor"
    private processActionFn: (action: any) => [boolean, Array<any>]
    private commitEventsFn: (middlewareEvnts: Array<any>, processor: any, label: string) => void
    private applyEventsFn: (events: Array<any>) => void
    private _stateMutex

    private _state = { processor_sequence: 0, flow_sequence: 0, last_trigger: {}, proc_map: new Map() }
    private _context: any
    private _middleware: Array<() => any> = []

    constructor(opts: any = {}) {
        this._stateMutex = opts.stateMutex
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

        assert(val.flow_id, `applyEvents, Cannot apply ProcessorChange, no "flow_id"`)
        assert(val.next_sequence && val.next_sequence === this.state.processor_sequence + 1, `applyEvents, Cannot apply change sequence ${val.next_sequence}, expecting ${this.state.processor_sequence + 1}`)

        const { flow_id, next_sequence, options, complete, function_idx, trigger } = val // dont need to store flow_id, its the key to the Map
        const newstate = { ...this.state, ...(val.flow_sequence_inc && { flow_sequence: this.state.flow_sequence + val.flow_sequence_inc }), processor_sequence: val.next_sequence, proc_map: new Map(this.state.proc_map) } // a clone

        if (trigger) {
            newstate.last_trigger = { ...newstate.last_trigger, ...val.trigger }
        }

        let new_proc_object

        if (complete) {
            newstate.proc_map.delete(flow_id)
        } else {

            // split 'update_ctx' out of event, and aggritate into 'context_object'
            const { update_ctx, ...other_options } = options || {}
            const current_proc_object: ProcessorObject = newstate.proc_map.get(flow_id) || {}
            new_proc_object = { ...current_proc_object, flow_id, function_idx, ...(other_options && { options: other_options as ProcessorOptions }), context_object: { ...current_proc_object.context_object, ...update_ctx } }
            newstate.proc_map.set(flow_id, new_proc_object)
        }
        this.state = newstate
        return new_proc_object
    }

    restartProcessors(checkSleepStageFn, restartall) {

        // Restart required_state_processor_state
        for (let [flow_id, p] of this.state.proc_map) {

            if (p.options && p.options.sleep_until) {

                if (p.options.sleep_until.stage) {
                    if (checkSleepStageFn(p.options.sleep_until)) {
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
            console.log(`processor.restartProcessors pid=${flow_id}, fidx=${p.function_idx}, sleep_unit=${JSON.stringify(p.options.sleep_until)}`)
            try {
                this.launchHandler(p)
            } catch (err) {
                console.error(`restartProcessors, failed to restart process ${flow_id}, err=${err}`)
            }
        }
    }

    use(fn) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');

        //console.log('use %s', fn._name || fn.name || '-');
        this._middleware.push(fn);
        return this;
    }

    private processAction(action: ProcessorAction, failedMiddleware: boolean): ProcessorChange {
        // generate events from action
        const next_sequence = this.state.processor_sequence + 1
        switch (action.type) {
            case ActionType.NEW:
                return {
                    flow_id: `WF${this.state.flow_sequence}`,
                    flow_sequence_inc: 1,
                    next_sequence,
                    function_idx: 0,
                    complete: false,
                    options: action.options,
                    ...(action.trigger && { trigger: action.trigger })
                }
            case ActionType.UPDATE:
                return {
                    flow_id: action.flow_id,
                    next_sequence,
                    function_idx: action.function_idx,
                    complete: action.complete || failedMiddleware,
                    options: action.options
                }
            default:
                assert.fail('Cannot apply processor actions, unknown ActionType')
        }
    }

    async apply(action: ProcessorAction, middlewareActions, event_label): Promise<ProcessorObject> {
        assert(this.commitEventsFn, 'Cannot apply processor actions, no "commitEventsFn" provided')
        assert(middlewareActions ? this.processActionFn && this.applyEventsFn : true, 'Cannot apply processor actions, got "middlewareActions" to ally, but no "processActionFn" or "applyEventsFn" provided')

        let release = await this._stateMutex.aquire()

        const [hasFailed, middleware_events] = middlewareActions ? this.processActionFn(middlewareActions) : [, null]

        const proc_events = this.processAction(action, hasFailed)
        console.log(`processor.apply: action: pid=${action.flow_id} fidx=${action.function_idx}  complete=${action.complete}. Event: next_seq=${proc_events.next_sequence} pid=${proc_events.flow_id} fidx=${proc_events.function_idx}  complete=${proc_events.complete} `)

        // write events
        await this.commitEventsFn(middleware_events,
            { [this.name]: proc_events },
            event_label)

        // applyEvents to local state
        let new_proc_object = this.applyEvents(proc_events)
        //applyEvents events from middleware
        if (middleware_events) {
            this.applyEventsFn(middleware_events)
        }

        release()
        return new_proc_object
    }

    //  Initiate new processor workflow
    launchHandler(trigger: ProcessorObject) {

        function compose(trigger: ProcessorObject) {
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

            async function dispatch(i: number, middlewareActions: any, options: ProcessorOptions, event_label: string) {

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

                    const proc: ProcessorObject = await this.apply({
                        type: ActionType.UPDATE,
                        flow_id: trigger.flow_id,
                        function_idx: i,
                        complete,
                        options
                    }, middlewareActions, event_label)


                    if (!proc) {  // if !proc, that means its been marked as completed, thus removed from "proc_map" ProcessingState
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

        return (compose.bind(this, trigger)()).then(result =>
            console.log(`process successfullly finished pid=${JSON.stringify(result)} `)
        )//.catch(err =>
        //     console.error(`Any error in the pipeline ends here: ${err}`)
        // )


    }

    async initiateWorkflow(new_ctx, trigger): Promise<ProcessorObject> {
        console.log('initiateWorkflow: creating process event')

        const po = await this.apply({
            type: ActionType.NEW,
            complete: false,
            options: {
                update_ctx: new_ctx
            },
            ...(trigger && { trigger })
        } as ProcessorAction, null, null)
        this.launchHandler(po)//.then(r => console.log(r))
        return po
    }

}
