const Emitter = require('events')


interface ProcessingState {
    last_trigger: any;
    proc_map: Map<string, ProcessorInfo>
}

interface ProcessorInfo {
    trigger_doc_id?: string;
    function_idx?: number;
    trigger_full?: object;
    complete?: boolean;
    options?: ProcessorOptions;
}

export interface ProcessorOptions {
    nextaction: boolean;
    sleep_until?: {
        stage?: number; //OrderStage;
        time?: number;
    }
}

export class Processor extends Emitter {

    constructor(opts: any = {}) {
        super();
        this._name = opts.name || "defaultProcessor"
        this._state = { last_trigger: null, proc_map: new Map() }
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
            return { last_trigger: null, proc_map: new Map() }
        }
    }

    static processor_state_apply(state: ProcessingState, val: ProcessorInfo): ProcessingState {
        const ret_state = { ...state, proc_map: new Map(state.proc_map) }
        const { trigger_doc_id, ...rest } = val

        if (val.complete) {
            ret_state.proc_map.delete(trigger_doc_id)
        } else {
            const current_val: ProcessorInfo = ret_state.proc_map.get(trigger_doc_id)
            ret_state.proc_map.set(trigger_doc_id, { ...current_val, ...rest })

            if (val.trigger_full) {
                ret_state.last_trigger = val.trigger_full
            }
        }
        return ret_state
    }

    restartProcessors(checkSleepStage/*state: OrderingState */, required: ProcessingState = null) {
        const init_boot = required !== null

        // Restart required_processor_state
        for (let [doc_id, p] of init_boot ? required.proc_map : this.state.proc_map) {
            if (!p.complete) {

                if (p.options && p.options.sleep_until) {

                    if (p.options.sleep_until.stage) {
                        if (checkSleepStage(doc_id, p.options.sleep_until.stage)) {
                            continue
                        }
                    } else if (p.options.sleep_until.time) {
                        if (p.options.sleep_until.time >= Date.now()) continue /* dont restart */
                    } else {
                        continue /* dont restart */
                    }

                } else if (!init_boot) {
                    continue /* dont restart */
                }
                console.log(`Re-inflating processor for doc_id=${doc_id}, fnidx=${p.function_idx}, sleep_unit=${JSON.stringify(p.options.sleep_until)}`)
                this.callback()(p.trigger_full, p.function_idx)
            }
        }
    }

    use(fn) {
        if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');

        console.log('use %s', fn._name || fn.name || '-');
        this.middleware.push(fn);
        return this;
    }

    //  Initiate new processor workflow
    callback() {

        function compose(that, middleware) {

            return function (context, start_idx, next) {

                console.log(`Processor: callback compose return function start_idx=${start_idx} next=${next}`)
                // last called middleware #
                let index = -1
                return dispatch(0, null, null)

                function dispatch(i: number, change: any, opts: ProcessorOptions = null) {

                    console.log(`Processor: dispatch called i=${i}, start_idx=${start_idx}, index=${index} (middleware.length=${middleware.length}) seq=${change && change.sequence} `)
                    if (i <= index) return Promise.reject(new Error('next() called multiple times'))

                    if (start_idx > i) {
                        console.log(`Processor: dispatch, got a start_idx, so running idx=0 (to inflate ctx), then, skipping to ${start_idx} fnMiddleware`)
                        if (i > 0) {
                            i = start_idx
                        }
                    }
                    index = i
                    let fn = middleware[i]
                    if (i === middleware.length) fn = next

                    // Add processor details for processor hydration & call 'eventfn' to store in log
                    if (context.eventfn && change) {
                        const p: ProcessorInfo = {
                            trigger_doc_id: context.trigger.documentKey._id.toHexString(),
                            function_idx: i,
                            complete: (!opts.nextaction) || !fn,
                            options: opts
                        }
                        if (!that.state.proc_map.has(p.trigger_doc_id)) {
                            // send full trigger info on 1st processor for this doc_id
                            p.trigger_full = context.trigger
                        }

                        that.state = Processor.processor_state_apply(that.state, p)

                        // write to event log
                        context.eventfn(context, { ...change, processor: { [that.name]: p } })

                        // kill the current context
                        if (p.options && p.options.sleep_until) return Promise.resolve()
                    }

                    if ((opts && !opts.nextaction) || !fn) return Promise.resolve()
                    try {
                        return Promise.resolve(fn(context, dispatch.bind(null, i + 1)));
                    } catch (err) {
                        return Promise.reject(err)
                    }
                }
            }
        }

        console.log(`Processor: callback, composing fnMiddleware`)
        // create function lanbda to process all the middlwares for this trigger
        const fn = compose(this, this.middleware);

        const handleRequest = (doc, restart_idx) => {
            // doc._id == event document includes a resume token as the _id field
            // doc.clusterTime == 
            // doc.opertionType == "insert"
            // doc.ns.coll == "Collection"
            // doc.documentKey == A document that contains the _id of the document created or modified
            console.log(`Processor, callback, handleRequest(doc, restart_idx=${restart_idx}), create new ctx and call  Processor.handleRequest`)
            const ctx = this.createContext(doc)
            return this.handleRequest(ctx, fn, restart_idx);
        }

        console.log(`Processor: callback, returning function handleRequest - that will be trigged on each new doc`)
        return handleRequest
    }

    handleRequest(ctx, fnMiddleware, restart_idx) {
        console.log(`Processor.handlerequest(ctx, fnMiddleware, restart_idx=${restart_idx}),  return  fnMiddleware(ctx, restart_idx) `)
        const handleResponse = () => console.log(`done spec: ${JSON.stringify(ctx.status)}`)
        const onerror = err => console.error(`Any error in the pipeline ends here: ${err}`)
        return fnMiddleware(ctx, restart_idx).then(handleResponse).catch(onerror)
    }

    createContext(doc) {
        // Duplicate The static contexts (tenent, db, etc), into a 'session' ctx
        // Object.create creates a new object, using an existing object as the prototype
        const context = Object.create(this.context);
        context.trigger = doc
        return context
    }

}
