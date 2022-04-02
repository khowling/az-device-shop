import assert from 'assert'

export interface StateUpdateControl {
    head_sequence: number;
    lastupdated: number;
}

export interface StateStore {
    name: string;
    state: any;
    serializeState(): any;
    deserializeState(newstate: any): void
    apply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): void
}


export interface StateUpdates {
    method: UpdatesMethod;
    path?: string; // state path to process (optional)
    filter?: any; // fiilter object
    doc?: any;
}
export enum UpdatesMethod {
    Inc = 'inc',
    Rm = 'rm',
    Add = 'add',
    Merge = 'merge',
    Set = 'set'
}

export class JSStateStore implements StateStore {

    private _name
    private _state

    constructor(name, initstate) {
        this._name = name
        this._state = initstate
    }

    get name() {
        return this._name
    }

    get state() {
        return this._state
    }

    set state(newstate) {
        this._state = newstate
    }

    get serializeState() {
        return { ...this._state }
    }

    deserializeState(newstate) {
        if (newstate) {
            this.state = { ...newstate }
        }
    }

    static imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }

    static apply_incset({ method, doc }, val) {
        return {
            ...val, ...Object.keys(doc).map(k => {
                return {
                    [k]: method === 'inc' ? doc[k] + val[k] : doc[k]
                }
            }).reduce((a, i) => { return { ...a, ...i } }, {})
        }
    }

    apply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): void {

        const state = this._state
        const _control: StateUpdateControl = statechanges._control as StateUpdateControl


        assert(_control && _control.head_sequence === state._control.head_sequence, `applyToLocalState: Panic, cannot apply update head_sequence=${_control && _control.head_sequence} to state at head_sequence=${state._control.head_sequence}`)
        let newstate = { _control: { head_sequence: state._control.head_sequence + 1, lastupdated: _control.lastupdated } }

        console.log(`[${this.name}] apply(): change._control.head_sequence=${_control.head_sequence} to state._control.head_sequence=${state._control.head_sequence}`)

        for (let stateKey of Object.keys(statechanges)) {
            if (stateKey === '_control') continue
            // get the relevent section of the state
            const stateKeyChanges: Array<StateUpdates> = statechanges[stateKey] as Array<StateUpdates>
            let reducerKeyState = this._state[stateKey]

            for (let i = 0; i < stateKeyChanges.length; i++) {
                const update: StateUpdates = stateKeyChanges[i]
                let pathKeyState = update.path ? reducerKeyState[update.path] : reducerKeyState

                switch (update.method) {
                    case 'inc':
                    case 'set':
                        if (update.filter) { // array
                            assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                            const
                                filter_key = Object.keys(update.filter)[0], filter_val = update.filter[filter_key],
                                update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)
                            assert(update_idx >= 0, `applyToLocalState: Panic applying a "UpdatesMethod.Inc|UpdatesMethod.Set" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                            pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, JSStateStore.apply_incset(update as any, pathKeyState[update_idx]))

                        } else { // object
                            pathKeyState = JSStateStore.apply_incset(update as any, pathKeyState)
                        }
                        break
                    case 'add':
                        assert(Array.isArray(pathKeyState), `applyToLocalState: Cannot apply "UpdatesMethod.Add" to non-Array on "${stateKey}"`)
                        pathKeyState = [...pathKeyState, update.doc]
                        break
                    case 'rm':
                        assert(Array.isArray(pathKeyState), `applyToLocalState: Cannot apply "UpdatesMethod.Rm" to non-Array on "${stateKey}"`)
                        assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                        const
                            filter_key = Object.keys(update.filter)[0],
                            filter_val = update.filter[filter_key],
                            update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)
                        assert(update_idx >= 0, `applyToLocalState: Panic applying a "update" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                        pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, null)
                        break
                    case 'merge':
                        if (update.filter) { // array
                            assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                            const
                                filter_key = Object.keys(update.filter)[0],
                                filter_val = update.filter[filter_key],
                                update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)

                            assert(update_idx >= 0, `applyToLocalState: Panic applying a "update" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                            const new_doc_updates = Object.keys(update.doc).map(k => {
                                return {
                                    [k]:
                                        update.doc[k] && Object.getPrototypeOf(update.doc[k]).isPrototypeOf(Object) && pathKeyState[update_idx][k] && Object.getPrototypeOf(pathKeyState[update_idx][k]).isPrototypeOf(Object) ?
                                            { ...pathKeyState[update_idx][k], ...update.doc[k] } : update.doc[k]
                                }
                            }).reduce((a, i) => { return { ...a, ...i } }, {})
                            const new_doc = { ...pathKeyState[update_idx], ...new_doc_updates }
                            pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, new_doc)
                        } else {
                            assert(false, 'applyToLocalState, "UpdatesMethod.Update" requires a filter (its a array operator)')
                        }
                        break
                    default:
                        assert(false, `applyToLocalState: Cannot apply update seq=${_control.head_sequence}, unknown method=${update.method}`)
                }

                if (update.path) {
                    // if path, the keystate must be a object
                    reducerKeyState = { ...reducerKeyState, [update.path]: pathKeyState }
                } else {
                    // keystate could be a object or value or array
                    reducerKeyState = pathKeyState
                }
            }
            newstate[stateKey] = reducerKeyState
        }
        this._state = { ...this._state, ...newstate }
        //console.log(`apply: ${JSON.stringify(this._state)}`)
    }
}