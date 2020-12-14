const assert = require('assert')
const Emitter = require('events')

// This represents the 'state' of the processor (its hydrated from the ProcessorChange events)
export interface ProcessingState {
    processor_sequence: number;
    last_trigger: any;
    proc_map: Map<string, ProcessorObject>
}

interface ProcessorObject {
    // only used for 'ProcessingState', not event log
    context_object?: any;
    function_idx?: number;
    options?: ProcessorOptions;
}

// this gets written to the eventlog for re-hybration
interface ProcessorChange {
    // only used for event log, not 'ProcessingState'
    context_id: string;
    next_sequence: number;
    function_idx: number;
    complete: boolean;
    options?: ProcessorOptions;
}

export interface ProcessorOptions {
    update_ctx?: any;
    endworkflow: boolean;
    sleep_until?: {
        stage?: number; //OrderStage;
        time?: number;
    }
}

export class Processor extends Emitter {

    constructor(opts: any = {}) {
        super();
        this._name = opts.name || "defaultProcessor"
        this._state = {}
        this.context = { processor: this._name }
        this.middleware = [];
    }

    get state() {
        return this._state;
    }

    set state(newstate: ProcessingState) {
        this._state = newstate
    }

    get name() {
        return this._name;
    }

    get serializeState() {
        return { ...this._state, proc_map: [...this._state.proc_map] }
    }

    static deserializeState(newstate?): ProcessingState {
        if (newstate) {
            return { ...newstate, proc_map: new Map(newstate.proc_map) }
        } else {
            return { processor_sequence: 0, last_trigger: null, proc_map: new Map() }
        }
    }

    static processor_state_apply(state: ProcessingState, val: ProcessorChange): ProcessingState {
        const newstate = { ...state, processor_sequence: state.processor_sequence + 1, proc_map: new Map(state.proc_map) } // a clone
        const { context_id, next_sequence, options, complete, function_idx } = val // dont need to store context_id, its the key to the Map

        assert(context_id, `processor_state_apply, Cannot apply change sequence ${next_sequence}, no context_id`)
        assert(next_sequence && next_sequence === newstate.processor_sequence, `processor_state_apply, Cannot apply change sequence ${next_sequence}, expecting ${newstate.processor_sequence}`)

        if (complete) {
            newstate.proc_map.delete(context_id)
        } else {

            // split 'update_ctx' out of event, and aggritate into 'context_object'
            const { update_ctx, ...other_options } = options || {}
            const current_val: ProcessorObject = newstate.proc_map.get(context_id) || {}
            newstate.proc_map.set(context_id, { ...current_val, function_idx, ...(other_options && { options: other_options as ProcessorOptions }), context_object: { ...current_val.context_object, ...update_ctx } })
            if (update_ctx && update_ctx.trigger) newstate.last_trigger = update_ctx.trigger
        }
        return newstate
    }

    restartProcessors(checkSleepStage/*state: OrderingState */, required_state: ProcessingState = null) {

        let restartall = false
        if (required_state) {
            restartall = true
            this.state = required_state
        }
        //const init_boot = required_state !== null

        // Restart required_state_processor_state
        for (let [context_id, p] of this.state.proc_map) {

            if (p.options && p.options.sleep_until) {

                if (p.options.sleep_until.stage) {
                    if (checkSleepStage(context_id, p.options.sleep_until.stage)) {
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
            console.log(`Re-inflating processor for context_id=${context_id}, fnidx=${p.function_idx}, sleep_unit=${JSON.stringify(p.options.sleep_until)}`)
            this.callback()({ _restartProcessors: true, ...p })
        }
    }

    use(fn) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');

        //console.log('use %s', fn._name || fn.name || '-');
        this.middleware.push(fn);
        return this;
    }

    //  Initiate new processor workflow
    callback() {

        function compose(that, middleware) {

            return function (context, start_idx: number, update_opts: any, restart: boolean, next) {

                console.log(`Processor: callback compose return function start_idx=${start_idx} next=${next}`)
                // last called middleware #
                let index = -1
                return dispatch(start_idx, null, update_opts, null)

                function dispatch(i: number, state_changes: any, options: ProcessorOptions, event_label: string) {

                    console.log(`Processor: dispatch called i=${i}, start_idx=${start_idx}, index=${index} (middleware.length=${middleware.length})`)
                    if (i <= index) return Promise.reject(new Error('next() called multiple times'))

                    const from_restart = index === -1 && restart

                    index = i
                    let fn = middleware[i]
                    if (i === middleware.length) fn = next

                    // apply context updates
                    if (options && options.update_ctx) {
                        for (let k of Object.keys(options.update_ctx)) {
                            context[k] = options.update_ctx[k]
                        }
                    }

                    // Add processor details for processor hydration & call 'eventfn' to store in log
                    if ((!from_restart) && context.eventfn && (state_changes || options)) {
                        const p: ProcessorChange = {
                            next_sequence: that.state.processor_sequence + 1,
                            context_id: context.trigger.documentKey._id.toHexString(),
                            function_idx: i,
                            complete: (options && options.endworkflow) || !fn,
                            options
                        }
                        // update processor state snapshot, used for re-starting sleeping contexts
                        that.state = Processor.processor_state_apply(that.state, p)

                        // write state and processor events to event log
                        context.eventfn(context, state_changes, { [that.name]: p }, event_label)

                        // kill the current context
                        if (options && options.sleep_until) return Promise.resolve()
                    }

                    if ((options && options.endworkflow) || !fn) return Promise.resolve()
                    try {
                        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
                    } catch (err) {
                        return Promise.reject(err)
                    }
                }
            }
        }

        //console.log(`Processor: callback, composing fnMiddleware`)
        // create function lanbda to process all the middlwares for this trigger
        const fn = compose(this, this.middleware);

        // returned by callback()
        // called from watch with just 'doc' param & from 'restartProcessors', with ProcessorChange
        // doc._id == event document includes a resume token as the _id field
        // doc.clusterTime == 
        // doc.opertionType == "insert"
        // doc.ns.coll == "Collection"
        // doc.documentKey == A document that contains the _id of the document created or modified 

        const handleRequest = (doc) => {

            const ctx = Object.create(this.context);

            if (doc._restartProcessors) {
                assert(doc.hasOwnProperty('context_object') && doc.context_object.hasOwnProperty('trigger'), "Processor, callback, handleRequest : Restart requested, but no context trigger")
                assert(doc.hasOwnProperty('function_idx') && doc.function_idx >= 0, "Processor, callback, handleRequest : Restart requested, but no function_idx")
                assert(!doc.complete, "Processor, callback, handleRequest : Restart requested on complete process")

                console.log(`Processor, callback, handleRequest(RESTART from _idx=${doc.function_idx}), create new ctx and call  Processor.handleRequest`)

                //for (let k of Object.keys(doc.context_object)) {
                //    ctx[k] = doc.context_object[k]
                //}
                return this.handleRequest(ctx, fn, doc.function_idx, { ...doc.options, update_ctx: doc.context_object } as ProcessorOptions, doc._restartProcessors)
            } else {
                return this.handleRequest(ctx, fn, 0, { endworkflow: false, update_ctx: { trigger: doc } } as ProcessorOptions, false);
            }
        }

        //console.log(`Processor: callback, returning function handleRequest - that will be trigged on each new doc`)
        return handleRequest
    }

    handleRequest(ctx, fnMiddleware, start_fn_idx, update_opts, restart) {
        console.log(`Processor.handlerequest(ctx, fnMiddleware, start_fn_idx=${start_fn_idx}),  return  fnMiddleware(ctx, start_fn_idx) `)
        const handleResponse = () => console.log(`done`)
        const onerror = err => console.error(`Any error in the pipeline ends here: ${err}`)
        return fnMiddleware(ctx, start_fn_idx, update_opts, restart).then(handleResponse).catch(onerror)
    }

}
