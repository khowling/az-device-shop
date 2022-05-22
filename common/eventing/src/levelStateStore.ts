import assert from 'assert'

import level from 'level'
import sub from 'subleveldown'

import { StateStore, StateUpdates, StateUpdateControl, ApplyReturnInfo } from './stateStore.js'
import { StateStoreDefinition, StateStoreValueType } from './stateManager.js'

export class LevelStateStore implements StateStore {

    private _name
    private _stateDefinition
    private _state


    constructor(name: string, stateDefinition: { [sliceKey: string]: StateStoreDefinition}) {
        this._name = name
        this._stateDefinition = stateDefinition

        const db = this._state = level(process.env.DBPATH || `./${name}.levelss`)


        // LevelDB doesn't support structured values, or partially updating a value.
            /* factory : initstate = 
                {
                    _control: {
                        head_sequence: 0,
                        lastupdated: null,
                    },

                    workItems: {
                        items: [
                        ],
                        workitem_sequence: 0,
                    },

                    factory: {
                        items: [
                        ],
                        capacity_allocated: 0,
                    },


                    inventory_complete: {
                        inventry_sequence: 0,
                    },
                }

                translates to 
                sublevel = _control
                  key = head_sequence
                  key = lastupdated

                
                key: workItems.next_sequence = =
                sublevel: workitems key = 0 val: workitem

                key: factory.capactiy_allocated = 0
                
                {
                "_control":
                    type: "Hash"
                    values: {
                        head_sequence: 0
                        lastupdated: null
                    }
                }
                "workItems": 
                    type: "List"
                 - values
                  -  counter_name = sum("object.field", where)
                  -  counter_name = count("object.field", where)
                 - operations
                  - append <oject> 
                  - set <key> <object>
                  - delete <key>
                  
            */
           

        for (let sliceKey of Object.keys(stateDefinition)) {
            for (let key of Object.keys(stateDefinition[sliceKey])) {
                const {type, values} = stateDefinition[sliceKey][key]
                if (type === StateStoreValueType.Hash) {
                    for (let hkey of Object.keys(values)) {
                        db.put (`${sliceKey}:${key}!${hkey}`, values[hkey])
                    }
                } else if (type === StateStoreValueType.List) {
                    db.put (`${sliceKey}:${key}:_next_sequence`, 0)
                    if (values) for (let hkey of Object.keys(values)) {
                        db.put (`${sliceKey}:${key}!${hkey}`, 0)
                    }
                }
            }
        }
    }

    get name() {
        return this._name
    }

    getValue(reducerKey: string, path: string, idx?: number) {

    }

    debugState(): void {
        console.log ('tbc')
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

    apply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): ApplyReturnInfo {

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
                            pathKeyState = LevelStateStore.imm_splice(pathKeyState, update_idx, LevelStateStore.apply_incset(update as any, pathKeyState[update_idx]))

                        } else { // object
                            pathKeyState = LevelStateStore.apply_incset(update as any, pathKeyState)
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
                        pathKeyState = LevelStateStore.imm_splice(pathKeyState, update_idx, null)
                        break
                    case 'update':
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
                            pathKeyState = LevelStateStore.imm_splice(pathKeyState, update_idx, new_doc)
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
        return {}
    }
}
