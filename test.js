/*
const Koa = require('koa');
const app = new Koa();

// response
app.use(ctx => {
  ctx.body = 'Hello Koa';
});

app.listen(3000);

*/
const delay = ms => new Promise(res => setTimeout(res, ms))

// https://github.com/DirtyHairy/async-mutex/blob/master/src/Semaphore.ts
class OneAtATime {

  constructor() {
    this._queue = [];
    this._currentReleaser;
    this._value = 1;
  }

  isLocked() {
    return this._value <= 0;
  }


  async aquire() {
    const locked = this.isLocked();
    const ticket = new Promise((r) => this._queue.push(r))
    if (!locked) this._dispatch()
    const [, releaser] = await ticket
    return releaser
  }

  _dispatch() {
    const nextConsumer = this._queue.shift();
    if (!nextConsumer) return;
    let released = false;
    this._currentReleaser = () => {
      if (released) return;

      released = true;
      this._value++;

      this._dispatch();
    };
    nextConsumer([this._value--, this._currentReleaser]);
  }

  release() {

    if (this._currentReleaser) {
      const releaser = this._currentReleaser;
      this._currentReleaser = undefined;

      releaser();
    }
  }

  async call(fn, param) {
    console.log('call')
    let release = await this.aquire()
    console.log('call - got access')
    await fn(param)
    console.log('call - done')
    release()
  }
}

class Processor extends OneAtATime {

  constructor(opts = {}) {
    super()
    this.middleware = []
    this._state = { proc_seq: 0, procs: {} }
  }

  get state() {
    return this._state
  }

  set state(s) {
    this._state = s
  }

  _apply(event) {
    this.state = { proc_seq: event[0].next_sequence, procs: { ...this.state.procs, [event[0].process_id]: event[0] } }
  }


  use(fn) {
    this.middleware.push(fn)
  }

  async apply(action) {

    let release = await this.aquire()

    // generate events from action
    const state_changes = []
    const next_sequence = this.state.proc_seq + 1
    switch (action.type) {
      case 'NEW': {
        state_changes.push({
          process_id: `P-${next_sequence}`,
          next_sequence,
          function_idx: 0,
          complete: false,
          options: action.state.options
        })
      }
      case 'UPDATE': {
        state_changes.push({
          process_id: action.process_id,
          next_sequence,
          function_idx: action.state.function_idx,
          complete: false
        })
      }
    }

    // write events
    await write_event(state_changes)

    // apply to local state
    this._apply(state_changes)
    release()
    return state_changes
  }

  launchHandler(trigger_process) {

    function compose(processref, start_idx, trigger_process) {

      let ctx = trigger_process.options.update_ctx

      return dispatch(start_idx)
      async function dispatch(i) {

        if (i > start_idx) {
          console.log('dispatch: creating process event')

          console.log('main: writing event and applying to state')
          processref.apply({
            type: 'UPDATE', process_id: trigger_process.process_id, state: {
              function_idx: i,
            }
          })
        }


        console.log(`dispatch: call middleware: ${i}`)
        let fn = processref.middleware[i]
        if (!fn) {
          return Promise.resolve(trigger_process.process_id)
        } else {
          return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1)))
        }
      }
    }

    return compose(this, 0, trigger_process).then(
      pid => console.log(`process successfullly finished id=${pid} `)
    ).catch(
      err => console.error(`Any error in the pipeline ends here: ${err}`)
    )
  }

}



async function write_event(state) {
  console.log(`wirte to eventstore ${JSON.stringify(state)}`)
  await delay(50)
  return state
}

async function newt(processor, d) {
  console.log('newt: creating process event')

  let p = await processor.apply({
    type: 'NEW', state: {
      options: { update_ctx: d }
    }
  })


  console.log('newt: launching process handler')
  processor.launchHandler(p[0])
  console.log('newt done')
}

async function main() {
  let processor = new Processor()

  processor.use(async function complete(ctx, next) {
    //console.log('m1 callout')
    await delay(100)
    //console.log('m1 calling next')
    next()
  })
  processor.use(async function complete(ctx, next) {
    //console.log('m2 callout')
    await delay(100)
    //console.log('m2 calling next')
    next()
  })


  newt(processor, { body: { inv_req: 1, sku: '001' } })
  newt(processor, { body: { inv_req: 2, sku: '001' } })
  newt(processor, { body: { inv_req: 3, sku: '001' } })


  console.log('main end')
}

main()
