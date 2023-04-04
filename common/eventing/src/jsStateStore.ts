import { strict as assert } from 'node:assert';
import { ApplyInfo, StateChanges, StateStore, StateStoreDefinition, StateStoreValueType, StateUpdate } from './stateManager.js'



export class JSStateStore<S> implements StateStore<S> {

    private _name: string
    private _stateDefinition: { [sliceKey: string]: StateStoreDefinition}

    private _state : { [key: string]: any } = {}

    constructor(name: string, stateDefinition: { [sliceKey: string]: StateStoreDefinition}) {
        this._name = name
        this._stateDefinition = stateDefinition

    }

    get name() {
        return this._name
    }

    get stateDefinition() {
        return this._stateDefinition
    }

    async initStore({distoryExisting = false}: {distoryExisting: boolean}) {

        if (distoryExisting || this._state === null) {
            this._state = {}
        }

        let state = {}

        for (let sliceKey of Object.keys(this.stateDefinition)) {
            for (let key of Object.keys(this.stateDefinition[sliceKey])) {
                const {type, values} = this.stateDefinition[sliceKey][key]
                if (type === 'HASH') {
                    state = {...state, [`${sliceKey}:${key}`]: values}

                } else if (type == 'METRIC') {
                    state = {...state, [`${sliceKey}:${key}`]: 0}

                }else if (type === 'LIST') {
                    // _all_keys needed for deletes & itternations
                    state = {...state, [`${sliceKey}:${key}:_all_keys`]: []}
                    state = {...state, [`${sliceKey}:${key}:_next_sequence`]: 0}
                }
            }
        }

        //console.log (`JSStateStore: name=${this.name}, state=${JSON.stringify(state)}`)
        this._state = state

        return Promise.resolve()
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
        if (this._stateDefinition[reducerKey][path].type == 'LIST') {
            if (isNaN(idx as number)) {
                // return all values in array
                return this.state[`${reducerKey}:${path}:_all_keys`].map((key: any) => this.state[`${reducerKey}:${path}:${key}`])
            } else {
                return this.state[`${reducerKey}:${path}:${idx}`]
            }
        } else {
            return this.state[`${reducerKey}:${path}`]
        }
    }

     /* Convert state into a JSON structure, used to send snapshot to clients */
    async serializeState(): Promise<S> {

        let serializeState = {} as {[statekey: string]: any}

        for (let sliceKey of Object.keys(this._stateDefinition)) {

            serializeState = {...serializeState, [sliceKey]: {}}
            for (let key of Object.keys(this._stateDefinition[sliceKey])) {
                
                serializeState = {
                    ...serializeState, 
                    [sliceKey]: {
                        ...serializeState[sliceKey], 
                        [key]: this.getValue(sliceKey, key),
                        ...(this._stateDefinition[sliceKey][key].type == 'LIST' ? {[`${key}:_next_sequence`]: this.state[`${sliceKey}:${key}:_next_sequence`]} : {})
                    }
                }
            }
        }

        return serializeState as S
    }

    deserializeState(newstate : {[statekey: string]: any}) {
        if (newstate) {
            this.state = { ...newstate }
        }
    }

    static imm_splice(array: Array<any>, index: number, val?: any) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }
/*
    static apply_incset({ method, doc }, val) {
        return {
            ...val, ...Object.keys(doc).map(k => {
                return {
                    [k]: method === 'inc' ? doc[k] + val[k] : doc[k]
                }
            }).reduce((a, i) => { return { ...a, ...i } }, {})
        }
    }
*/
    async apply(sequence: number, statechanges:StateChanges): Promise<{[slicekey: string]: ApplyInfo}> {

        
        //const _control = (statechanges as Control)._control 

        let returnInfo : {[slicekey: string]: ApplyInfo} = {}
        let newstate: {[statekey: string]: any} = {
            '_control:log_sequence': sequence
        } 
        
        //let delkeys = []

        // Returns effective state for key, taking into account, that the 'statechanges' array may have already modified the state
        const effectiveStateValue = (key: string): any => {
            return newstate.hasOwnProperty(key) ? newstate[key] : this.state[key]
        }


        for (let reducerKey of Object.keys(statechanges)) {
            returnInfo = {...returnInfo, [reducerKey]: {} }

            // get the relevent section of the state
            const stateKeyChanges: Array<StateUpdate> = statechanges[reducerKey] as Array<StateUpdate>


            for (let update of stateKeyChanges) {
                
                const {type, identifierFormat} = this._stateDefinition[reducerKey][update.path]
                const levelkey = `${reducerKey}:${update.path}`

                switch (update.method) {
                    case 'SET':
                        if (type === 'LIST') {
                            assert(!isNaN(update.filter?._id as number) , `apply (SET), requires filter._id as a number, got ${update?.filter?._id}`)

                            newstate[`${levelkey}:${update.filter?._id}`] = update.doc

                        } else {
                            newstate[`${levelkey}`] = update.doc
                        }
                       
                        break
                    case 'ADD':
                        console.log (`adding ${type}`)
                        assert (type === 'LIST', `applyToLocalState: Can only apply "UpdatesMethod.Add" to "List": "${reducerKey}.${update.path}"`)
                        assert (typeof update.doc === "object" && !update.doc.hasOwnProperty('_id'), `applyToLocalState: "Add" requires a document object that doesnt contain a "_id" property": "${reducerKey}.${update.path}" doc=${JSON.stringify(update.doc)}`)

                        const next_sequenceKey = `${levelkey}:_next_sequence`
                        const _next_sequence = effectiveStateValue(next_sequenceKey)

                        // NOTE:: all keys needed for deletions!
                        const all_keys = effectiveStateValue(`${levelkey}:_all_keys`)

                        const added = {_id: _next_sequence, ...(identifierFormat && { identifier: `${identifierFormat.prefix || ''}${identifierFormat.zeroPadding ?  String(_next_sequence).padStart(identifierFormat.zeroPadding, '0') : _next_sequence}`}), ...update.doc}
                        
                        newstate[`${levelkey}:${_next_sequence}`] = added

                        newstate[`${levelkey}:_all_keys`] = all_keys.concat(_next_sequence)
                        newstate[next_sequenceKey] = _next_sequence + 1

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], added }}


                        break
                    case 'RM':

                        assert (type === 'LIST', `applyToLocalState: Can only apply "UpdatesMethod.Rm" to "List": "${reducerKey}.${update.path}"`)
                        assert (!isNaN(update.filter?._id as number), `applyToLocalState: "Rm" requires "filter._id", "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        const all_keys_rm = effectiveStateValue(`${levelkey}:_all_keys`)
                        const rm_key_idx = all_keys_rm.indexOf(update.filter?._id)
                        assert (rm_key_idx >= 0, `applyToLocalState: "Rm", cannot find existing value, "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        newstate[`${levelkey}:_all_keys`] = JSStateStore.imm_splice(all_keys_rm, rm_key_idx)
                        //delkeys.push(`${levelkey}:${update.filter?._id}`)


                        break
                    case 'UPDATE':
                        assert ((type === 'LIST' && !isNaN(update.filter?._id as number)) || (type === 'HASH' && !update.filter) , `applyToLocalState: Can only apply "UpdatesMethod.Update" to a "List" with a 'fliter', or a "Hash": "${reducerKey}.${update.path}", filter=${JSON.stringify(update.filter)}`)
                        assert (Object.keys(update.doc).reduce((a: number,i: string) => {
                                return   a >= 0 ? ((i === '$set' || i === '$merge') ? 1+a : -1) : a
                            }, 0) > 0, `applyToLocalState: Can only apply "UpdatesMethod.Update" doc with only '$merge' or '$set' keys: "${reducerKey}.${update.path}"`)

                        const value_key = type === 'LIST' ? `${levelkey}:${update.filter?._id}` : `${levelkey}`
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
                    case 'INC':
                        assert (type === 'METRIC', `applyToLocalState: Can only apply "UpdatesMethod.Inc" to a "Counter": "${reducerKey}.${update.path}"`)
                        
                        const inc = effectiveStateValue(`${levelkey}`) + 1

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], inc }}
                        newstate[`${levelkey}`] = inc

                        break
                    default:
                        assert(false, `applyToLocalState: Cannot apply update, unknown method=${update.method}`)
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