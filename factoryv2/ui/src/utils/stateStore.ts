import type {  UpdatesMethod, WsMessage, StateUpdateControl, StateUpdates, StateStoreDefinition, FactoryMetaData, StateChangesUpdates} from '../../../server/index';
import type { FactoryState } from '../../../server/factoryState';
import { Reducer } from 'react';

export interface StateUpdates {
    method: UpdatesMethod;
    path: string; // state path to process (optional)
    filter: {
        _id: number
    }; // fiilter object
    doc?: any;
}



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


const effectiveStateValue = (state: FactoryState, newstate: FactoryState, reducerKey: keyof FactoryState , path: string)  => {
    //console.log(`effectiveStateValue reducerKey:${reducerKey} path:${path}`)
    return newstate && newstate[reducerKey] && newstate[reducerKey].hasOwnProperty(path) ? (newstate[reducerKey] as Record<string, any>)[path] : (state[reducerKey] as Record<string, any>)[path]
}

export function stateReducer({ state, metadata }: FactoryReducerState, action : WsMessage) : FactoryReducerState {

    console.log (state)
    console.log(action)

    switch (action.type) {
        case 'SNAPSHOT':
            return { state: action.snapshot, metadata: action.metadata }
        case 'EVENTS':
        
            if (state && metadata) {

                let newstate : FactoryState = {} as FactoryState

                const _control: StateUpdateControl = (action.statechanges as StateUpdateControl)._control 

                for (let reducerKey of Object.keys(action.statechanges) as Array<keyof FactoryState>) {

                    newstate = {...newstate, [reducerKey]: state[reducerKey] }

                    const stateKeyChanges = (action.statechanges as StateChangesUpdates<FactoryState>)[reducerKey]

                    for (let update of stateKeyChanges) {
                        console.assert (update.path, `applyToLocalState: State Updates for ${reducerKey} require a 'path'`)
                        const statestores = metadata.stateDefinition[reducerKey] as  StateStoreDefinition
                        const {type, identifierFormat} = statestores[update.path] 

                        switch (update.method) {
                            case 'SET':
                                console.assert (type === "HASH" || (type === "LIST" && update.filter && !isNaN(update.filter._id)) , `applyToLocalState: Can only apply "UpdatesMethod.Set" to "Hash" or "List" with a filter: "${reducerKey}.${update.path}"`)
                                if (type === "list") {
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
                                console.assert (type === "COUNTER", `applyToLocalState: Can only apply "UpdatesMethod.Inc" to a "Counter": "${reducerKey}.${update.path}"`)
                                
                                const inc = effectiveStateValue(state, newstate, reducerKey, update.path) + 1
        
                                newstate[reducerKey][update.path] = inc
        
                                break
                            default:
                                console.assert(false, `applyToLocalState: Cannot apply update seq=${_control.head_sequence}, unknown method=${update.method}`)
                        }
                    }
                }

                console.log(newstate)

                return { 
                    state: { ...state, ...newstate }, 
                    metadata 
                }
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

