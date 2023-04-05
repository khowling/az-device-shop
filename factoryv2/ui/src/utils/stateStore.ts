

import type { FactoryState, WsMessage, FactoryMetaData, StateChangesUpdates} from '../../../server/dist/index';
import type { StateChanges, ApplyInfo, StateUpdate, StateStoreDefinition } from '../../../../common/eventing/dist/stateManager';
export type { Control, UpdatesMethod, StateUpdate, StateStoreDefinition } from '@az-device-shop/eventing';

// Replace array entry at index 'index' with 'val'

function imm_splice(array: Array<any>, index: number, val?: any) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }
function apply_incset({ method, doc }: {method: string, doc: any}, val : any) {
    return {
        ...val, ...Object.keys(doc).map(k => {
            return {
                [k]: method === 'inc' ? doc[k] + val[k] : doc[k]
            }
        }).reduce((a, i) => { return { ...a, ...i } }, {})
    }
}

export type FactoryReducerState = {
    state: FactoryState,
    metadata: FactoryMetaData
}  | { state: null, metadata: null}

/*
const effectiveStateValue = (state: FactoryState, newstate: FactoryState, reducerKey: keyof FactoryState , path: string)  => {
    //console.log(`effectiveStateValue reducerKey:${reducerKey} path:${path}`)
    return newstate && newstate[reducerKey] && newstate[reducerKey]?.hasOwnProperty(path) ? (newstate[reducerKey] as Record<string, any>)[path] : (state[reducerKey] as Record<string, any>)[path]
}
*/

var assert = console.assert
function apply(state: any, _stateDefinition: {[reducerKey: string]: StateStoreDefinition}, sequence: number, statechanges:StateChanges): {newstate: {[statekey: string]: any}, returnInfo: {[slicekey: string]: ApplyInfo}} {

    /***************  START COPY ***************************/  
    
    //const _control = (statechanges as Control)._control 

    let returnInfo : {[slicekey: string]: ApplyInfo} = {}
    let newstate: {[statekey: string]: any} = {
        '_control:log_sequence': sequence
    } 
    
    //let delkeys = []

    // Returns effective state for key, taking into account, that the 'statechanges' array may have already modified the state
    const effectiveStateValue = (key: any): any => {
        return newstate.hasOwnProperty(key) ? newstate[key] : state[key]
    }


    for (let reducerKey of Object.keys(statechanges)) {
        returnInfo = {...returnInfo, [reducerKey]: {} }

        // get the relevent section of the state
        const stateKeyChanges: Array<StateUpdate> = statechanges[reducerKey] as Array<StateUpdate>


        for (let update of stateKeyChanges) {
            
            const {type, identifierFormat} = _stateDefinition[reducerKey][update.path]
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

                    newstate[`${levelkey}:_all_keys`] = imm_splice(all_keys_rm, rm_key_idx)
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

        }

    }


    /***************  END COPY ***************************/
    return {newstate, returnInfo}
}

export function stateReducer({ state, metadata }: FactoryReducerState, action : WsMessage) : FactoryReducerState {

    console.log (state)
    console.log(action)

    switch (action.type) {
        case 'SNAPSHOT':
            return { state: action.snapshot, metadata: action.metadata }
        case 'EVENTS':
        
            if (state && metadata) {

                const {newstate, returnInfo} =  apply(state, metadata.stateDefinition, action.sequence,  action.statechanges)
                return { 
                    state: { ...state, ...newstate }, 
                    metadata 
                }

                /*
                let newstate : FactoryState = {} as FactoryState

                //const _control: Control = (action.statechanges as Control)._control 

                for (let reducerKey of Object.keys(action.statechanges) as Array<keyof FactoryState>) {

                    newstate = {...newstate, [reducerKey]: state[reducerKey] }

                    const stateKeyChanges = (action.statechanges as StateChangesUpdates<FactoryState>)[reducerKey]

                    for (let update of stateKeyChanges) {
                        //console.assert ((update as StateUpdate).path, `applyToLocalState: State Updates for ${reducerKey} require a 'path'`)
                        const statestores = metadata.stateDefinition[reducerKey] as  StateStoreDefinition
                        const {type, identifierFormat} = statestores[update.path] 

                        switch (update.method) {
                            case 'SET':
                                console.assert (type === "HASH" || (type === "LIST" && update.filter && !isNaN(update.filter._id)) , `applyToLocalState: Can only apply "UpdatesMethod.Set" to "Hash" or "List" with a filter: "${reducerKey}.${update.path}"`)
                                if (type === "LIST") {
                                    const idx = effectiveStateValue(state, newstate, reducerKey,update.path).findIndex((i: { _id: any }) => i._id === update.filter._id)
                                    console.assert (idx >= 0 , `applyToLocalState: Could not find item with id "${update.filter._id}" in list "${reducerKey}.${update.path}"`)
                                    (newstate[reducerKey] as Record<string, any>)[update.path] = imm_splice(effectiveStateValue(state, newstate, reducerKey,update.path), idx, update.doc)
                                } else {
                                    newstate[reducerKey][update.path] = update.doc
                                }
                                break
                            case 'ADD':
                                console.assert (type === "LIST", `applyToLocalState: Can only apply "UpdatesMethod.Add" to "List": "${reducerKey}.${update.path}"`)
                                console.assert (typeof update.doc === "object" && !update.doc.hasOwnProperty('_id'), `applyToLocalState: "Add" requires a document object that doesnt contain a "_id" property": "${reducerKey}.${update.path}" doc=${JSON.stringify(update.doc)}`)
                                
                                const next_seq = effectiveStateValue(state, newstate, reducerKey, `${update.path}:_next_sequence`)
                                const added = {_id: next_seq, ...(identifierFormat && { identifier: `${identifierFormat.prefix || ''}${identifierFormat.zeroPadding ?  String(next_seq).padStart(identifierFormat.zeroPadding, '0') : next_seq}`}),  ...update.doc}

                                newstate[reducerKey][update.path] = effectiveStateValue(state, newstate, reducerKey,update.path).concat(added)
                                newstate[reducerKey][`${update.path}:_next_sequence`] = next_seq + 1
                                break

                            case 'RM':

                                console.assert (type === "LIST", `applyToLocalState: Can only apply "UpdatesMethod.Rm" to "List": "${reducerKey}.${update.path}"`)
                                console.assert (update.filter && !isNaN(update.filter._id), `applyToLocalState: "Rm" requires "filter._id", "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                                const idx = effectiveStateValue(state, newstate, reducerKey,update.path).findIndex((i: { _id: any }) => i._id === update.filter._id)
                                console.assert (idx >= 0 , `applyToLocalState: Could not find item with id "${update.filter._id}" in list "${reducerKey}.${update.path}"`)


                                newstate[reducerKey][update.path] = imm_splice(effectiveStateValue(state, newstate, reducerKey,update.path), idx, null)
                                break
                            case 'UPDATE':

                                console.assert ((type === "LIST" && !isNaN(update.filter._id)) || (type === "HASH" && !update.filter) , `applyToLocalState: Can only apply "UpdatesMethod.Update" to a "List" with a 'fliter', or a "Hash": "${reducerKey}.${update.path}", filter=${JSON.stringify(update.filter)}`)
                                console.assert (Object.keys(update.doc).reduce((a,i) => {
                                        return   a >= 0 ? ((i === '$set' || i === '$merge') ? 1+a : -1) : a
                                    }, 0) > 0, `applyToLocalState: Can only apply "UpdatesMethod.Update" doc with only '$merge' or '$set' keys: "${reducerKey}.${update.path}"`)
        
                                const existingkeyval = effectiveStateValue(state, newstate, reducerKey,update.path)
                                const existing_idx = type === "LIST" ? existingkeyval.findIndex((i: { _id: any }) => i._id === update.filter._id) : -1
                                const existing_doc = type === "LIST" ? (existing_idx >=0 ? existingkeyval[existing_idx]: undefined) : existingkeyval
        
                                console.assert(existing_doc, `applyToLocalState: Panic applying a update on "${reducerKey}.${update.path}" to a non-existant document (filter=${update.filter})`)
                                

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

                                if (type === "LIST") {
                                    newstate[reducerKey][update.path] = imm_splice(existingkeyval, existingkeyval.findIndex((i: { _id: any }) => i._id === update.filter._id), merged)
                                } else {
                                    newstate[reducerKey][update.path] = merged
                                }

                                break
                            case 'INC':
                                console.assert (type === "METRIC", `applyToLocalState: Can only apply "UpdatesMethod.Inc" to a "Counter": "${reducerKey}.${update.path}"`)
                                
                                const inc = effectiveStateValue(state, newstate, reducerKey, update.path) + 1
        
                                newstate[reducerKey][update.path] = inc
        
                                break
                            default:
                                console.assert(false, `applyToLocalState: Cannot apply update seq=${_control.head_sequence}, unknown method=${update.method}`)
                        }
                    }
                }

                console.log(newstate)
                */
                
            } else {
                throw new Error(`Got events before SNAPSHOT`);
            }

        case 'CLOSED':
            // socket closed, reset state
            return {state: null, metadata: null}


        default:
            throw new Error(`unknown action type`);
    }
}

