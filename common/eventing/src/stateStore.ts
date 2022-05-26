import assert from 'assert'
import { StateStoreDefinition, StateStoreValueType } from './stateManager.js'


export interface StateUpdateControl {
    head_sequence: number;
    lastupdated: number;
}

export interface StateStore {
    name: string;
    stateDefinition: { [sliceKey: string]: StateStoreDefinition};
    getValue(reducerKey: string, path: string, idx?: number): any;
    debugState(): void;
    serializeState(): any;
    deserializeState(newstate: any): void
    apply(statechanges: { [key: string]: StateUpdateControl | Array<StateUpdates> }): ApplyReturnInfo
}


export interface StateUpdates {
    method: UpdatesMethod;
    path: string; // state path to process (optional)
    filter?: {
        _id: number
    }; // fiilter object
    doc?: any;
}
export enum UpdatesMethod {
    Inc = 'inc',
    Set = 'set',
    Rm = 'rm',
    Add = 'add',
    Update = 'update',
}

export interface ApplyReturnInfo {
    [reducerKey: string]: {}
}

export class JSStateStore implements StateStore {

    private _name: string
    private _stateDefinition: { [sliceKey: string]: StateStoreDefinition}

    private _state

    constructor(name: string, stateDefinition: { [sliceKey: string]: StateStoreDefinition}) {
        this._name = name
        this._stateDefinition = stateDefinition

        let state = {}


        for (let sliceKey of Object.keys(stateDefinition)) {
            for (let key of Object.keys(stateDefinition[sliceKey])) {
                const {type, values} = stateDefinition[sliceKey][key]
                if (type === StateStoreValueType.Hash) {
                    state = {...state, [`${sliceKey}:${key}`]: values}

                } else if (type == StateStoreValueType.Counter) {
                    state = {...state, [`${sliceKey}:${key}`]: 0}

                }else if (type === StateStoreValueType.List) {
                    state = {...state, [`${sliceKey}:${key}:_all_keys`]: []}
                    state = {...state, [`${sliceKey}:${key}:_next_sequence`]: 0}
                }
            }
        }

        console.log (`JSStateStore: name=${name}, state=${JSON.stringify(state)}`)
        this.state = state
    }

    get name() {
        return this._name
    }

    get stateDefinition() {
        return this._stateDefinition
    }

    private get state() {
        return this._state
    }

    private set state(newstate) {
        this._state = {...newstate}
    }

    debugState() {
        console.log(`debugState name=${this.name}: ${JSON.stringify(this.state, null, 2)}`)
    }

    getValue(reducerKey: string, path: string, idx?: number) {
        if (this._stateDefinition[reducerKey][path].type == StateStoreValueType.List) {
            if (isNaN(idx)) {
                // return all values in array
                return this.state[`${reducerKey}:${path}:_all_keys`].map(key => this.state[`${reducerKey}:${path}:${key}`])
            } else {
                return this.state[`${reducerKey}:${path}:${idx}`]
            }
        } else {
            return this.state[`${reducerKey}:${path}`]
        }
    }


    get serializeState(): any {

        let serializeState = {}

        for (let sliceKey of Object.keys(this._stateDefinition)) {

            serializeState = {...serializeState, [sliceKey]: {}}
            for (let key of Object.keys(this._stateDefinition[sliceKey])) {
                
                serializeState = {...serializeState, [sliceKey]: {...serializeState[sliceKey], [key]: this.getValue(sliceKey, key)}}
            }
        }

        return serializeState
    }

    deserializeState(newstate) {
        if (newstate) {
            this.state = { ...newstate }
        }
    }

    static imm_splice(array: Array<any>, index: number, val?: any) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }

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

        
        const _control: StateUpdateControl = statechanges._control as StateUpdateControl

        let returnInfo = {}
        //assert(_control && _control.head_sequence === state._control.head_sequence, `applyToLocalState: Panic, cannot apply update head_sequence=${_control && _control.head_sequence} to state at head_sequence=${state._control.head_sequence}`)
        let newstate = {} // { _control: { head_sequence: state._control.head_sequence + 1, lastupdated: _control.lastupdated } }
        let delkeys = []
        //console.log(`[${this.name}] apply(): change._control.head_sequence=${_control.head_sequence} to state._control.head_sequence=${state._control.head_sequence}`)

        // Returns effective state for key, taking into account, that the 'statechanges' array may have already modified the state
        const effectiveStateValue = (key: string): any => {
            return newstate.hasOwnProperty(key) ? newstate[key] : this.state[key]
        }


        for (let reducerKey of Object.keys(statechanges)) {
            returnInfo = {...returnInfo, [reducerKey]: {} }
            if (reducerKey === '_control') continue

            // get the relevent section of the state
            const stateKeyChanges: Array<StateUpdates> = statechanges[reducerKey] as Array<StateUpdates>


            for (let update of stateKeyChanges) {
                assert (update.path, `applyToLocalState: State Updates for ${reducerKey} require a 'path'`)
                const valueType = this._stateDefinition[reducerKey][update.path].type

                switch (update.method) {
                    case UpdatesMethod.Set:
                        assert (valueType === StateStoreValueType.Hash || (valueType === StateStoreValueType.List && update.filter) , `applyToLocalState: Can only apply "UpdatesMethod.Set" to "Hash" or "List" with a filter: "${reducerKey}.${update.path}"`)
                        if (valueType === StateStoreValueType.List) {
                            newstate[`${reducerKey}:${update.path}:${update.filter._id}`] = update.doc
                        } else {
                            newstate[`${reducerKey}:${update.path}`] = update.doc
                        }
                       
                        break
                    case UpdatesMethod.Add:
                        
                        assert (valueType === StateStoreValueType.List, `applyToLocalState: Can only apply "UpdatesMethod.Add" to "List": "${reducerKey}.${update.path}"`)
                        assert (typeof update.doc === "object" && !update.doc.hasOwnProperty('_id'), `applyToLocalState: "Add" requires a document object that doesnt contain a "_id" property": "${reducerKey}.${update.path}" doc=${JSON.stringify(update.doc)}`)

                        const next_seq = effectiveStateValue(`${reducerKey}:${update.path}:_next_sequence`)
                        const all_keys = effectiveStateValue(`${reducerKey}:${update.path}:_all_keys`)

                        const added = {_id: next_seq, ...update.doc}
                        newstate[`${reducerKey}:${update.path}:${next_seq}`] = added
                        newstate[`${reducerKey}:${update.path}:_all_keys`] = all_keys.concat(next_seq)

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], added }}

                        newstate[`${reducerKey}:${update.path}:_next_sequence`] = next_seq + 1

                        break
                    case UpdatesMethod.Rm:

                        assert (valueType === StateStoreValueType.List, `applyToLocalState: Can only apply "UpdatesMethod.Rm" to "List": "${reducerKey}.${update.path}"`)
                        assert (!isNaN(update.filter._id), `applyToLocalState: "Rm" requires "filter._id", "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        const all_keys1 = effectiveStateValue(`${reducerKey}:${update.path}:_all_keys`)
                        const rm_key_idx = all_keys1.indexOf(update.filter._id)
                        assert (rm_key_idx >= 0, `applyToLocalState: "Rm", cannot find existing value, "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        newstate[`${reducerKey}:${update.path}:_all_keys`] = JSStateStore.imm_splice(all_keys1, rm_key_idx)
                        delkeys.push(`${reducerKey}:${update.path}:${update.filter._id}`)


                        break
                    case UpdatesMethod.Update:
                        assert ((valueType === StateStoreValueType.List && !isNaN(update.filter._id)) || (valueType === StateStoreValueType.Hash && !update.filter) , `applyToLocalState: Can only apply "UpdatesMethod.Update" to a "List" with a 'fliter', or a "Hash": "${reducerKey}.${update.path}", filter=${JSON.stringify(update.filter)}`)
                        assert (Object.keys(update.doc).reduce((a: number,i: string) => {
                                return   a >= 0 ? ((i === '$set' || i === '$merge') ? 1+a : -1) : a
                            }, 0) > 0, `applyToLocalState: Can only apply "UpdatesMethod.Update" doc with only '$merge' or '$set' keys: "${reducerKey}.${update.path}"`)

                        const value_key = valueType === StateStoreValueType.List ? `${reducerKey}:${update.path}:${update.filter._id}` : `${reducerKey}:${update.path}`
                        const existing_doc = effectiveStateValue(value_key)

                        assert(existing_doc, `applyToLocalState: Panic applying a update on "${reducerKey}.${update.path}" to a non-existant document (key=${value_key})`)
                        
                        // For each key in update doc, create new key, and set value
                            // if value is !null & its a Object -- If existing doc has the key, and its a Object, MERGE the 2 objects, Otherwise, just use the update doc value

                        const merge_keys = update.doc['$merge']
                        const new_merge_updates = merge_keys ? Object.keys(merge_keys).filter(f => f !== '_id').map(k => {
                            return {
                                [k]:
                                    merge_keys[k] && Object.getPrototypeOf(merge_keys[k]).isPrototypeOf(Object) && existing_doc[k] && Object.getPrototypeOf(existing_doc[k]).isPrototypeOf(Object) ?
                                            { ...existing_doc[k], ...merge_keys[k] } 
                                        : 
                                            merge_keys[k]
                            }
                        }).reduce((a, i) => { return { ...a, ...i } }, {}) : {}

                        // Add the rest of the existing doc to the new doc
                        const merged = { ...existing_doc, ...new_merge_updates, ...update.doc['$set'] }

                        //pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, new_doc)
                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], merged }}
                        newstate[value_key] = merged

                        
                        break
                    case UpdatesMethod.Inc:
                        assert (valueType === StateStoreValueType.Counter, `applyToLocalState: Can only apply "UpdatesMethod.Inc" to a "Counter": "${reducerKey}.${update.path}"`)
                        
                        const inc = effectiveStateValue(`${reducerKey}:${update.path}`) + 1

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], inc }}
                        newstate[`${reducerKey}:${update.path}`] = inc

                        break
                    default:
                        assert(false, `applyToLocalState: Cannot apply update seq=${_control.head_sequence}, unknown method=${update.method}`)
                }
/*
                if (update.path) {
                    // if path, the keystate must be a object
                    reducerKeyState = { ...reducerKeyState, [update.path]: pathKeyState }
                } else {
                    // keystate could be a object or value or array
                    reducerKeyState = pathKeyState
                }
*/
            }
/*
            newstate[stateKey] = reducerKeyState
*/
        }
        // swap into live
        this.state = { ...this.state, ...newstate }
        // TODO - Remove the keys from "Rm"
        return returnInfo
    }
}