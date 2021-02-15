
const delay = ms => new Promise(res => setTimeout(res, ms))

async function oneatatime() {
    console.log('call delay')
    await delay(2000)
}

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
        if (this._maxConcurrency > 1) {
            throw new Error(
                'this method is unavailable on semaphores with concurrency > 1; use the scoped release returned by acquire instead'
            );
        }

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

async function main() {
    let one = new OneAtATime()

    //console.log('call')

    one.call(oneatatime, 2000)
    //console.log('done')

    //console.log('call')
    one.call(oneatatime, 2000)
    //console.log('done')


}

main()