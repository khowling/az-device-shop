import { ApplyInfo, CalculatedValueDef, StateChanges, StateStoreDefinition, StateStoreValueType, StateUpdate } from './stateManager.js'


function imm_splice(array: Array<any>, index: number, val?: any) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }
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

export function getValue(state: any, _stateDefinition: {[reducerKey: string]: StateStoreDefinition}, reducerKey: string, path: string, idx?: number) {
    if (_stateDefinition[reducerKey][path].type == 'LIST') {
        if (isNaN(idx as number)) {
            // return all values in array
            return state[`${reducerKey}:${path}:_all_keys`].map((key: any) => state[`${reducerKey}:${path}:${key}`])
        } else {
            return state[`${reducerKey}:${path}:${idx}`]
        }
    } else {
        return state[`${reducerKey}:${path}`]
    }
}


export function applyGenerateChanges(assertfn: any, state: any, _stateDefinition: {[reducerKey: string]: StateStoreDefinition}, sequence: number, statechanges:StateChanges, linkedApplyInfo?: {[slice: string]: ApplyInfo}): {newstate: {[statekey: string]: any}, returnInfo: {[slicekey: string]: ApplyInfo}} {


    let returnInfo : {[slicekey: string]: ApplyInfo} = {}

    // record all the required calcuated field rules, this needs to be executed after all the ApplyInfo has been created
    const recordCalc : Array<{ levelUpdates_idx: string, setCalc: CalculatedValueDef}> = []


    let newstate: {[statekey: string]: any} = {
        '_control:log_sequence': sequence
    } 
    
    //let delkeys = []

    // Returns effective state for key, taking into account, that the 'statechanges' array may have already modified the state
    const effectiveStateValue = (key: string): any => {
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
                        assertfn(!isNaN(update.filter?._id as number) , `apply (SET), requires filter._id as a number, got ${update?.filter?._id}`)

                        newstate[`${levelkey}:${update.filter?._id}`] = update.doc

                    } else {
                        newstate[`${levelkey}`] = update.doc
                    }
                
                    break
                case 'ADD':
                    console.log (`adding ${type}`)
                    assertfn (type === 'LIST', `applyToLocalState: Can only apply "UpdatesMethod.Add" to "List": "${reducerKey}.${update.path}"`)
                    assertfn (typeof update.doc === "object" && !update.doc.hasOwnProperty('_id'), `applyToLocalState: "Add" requires a document object that doesnt contain a "_id" property": "${reducerKey}.${update.path}" doc=${JSON.stringify(update.doc)}`)

                    const next_sequenceKey = `${levelkey}:_next_sequence`
                    const _next_sequence = effectiveStateValue(next_sequenceKey)

                    // NOTE:: all keys needed for deletions!
                    const all_keys = effectiveStateValue(`${levelkey}:_all_keys`)

                    const added = {_id: _next_sequence, ...(identifierFormat && { identifier: `${identifierFormat.prefix || ''}${identifierFormat.zeroPadding ?  String(_next_sequence).padStart(identifierFormat.zeroPadding, '0') : _next_sequence}`}), ...update.doc}
                    
                    newstate[`${levelkey}:${_next_sequence}`] = added

                    newstate[`${levelkey}:_all_keys`] = all_keys.concat(_next_sequence)
                    newstate[next_sequenceKey] = _next_sequence + 1

                    returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], [update.path]: { added: returnInfo?.[reducerKey]?.[update.path]?.['added']?.concat(added) || [added] } }}
                    break
                case 'RM':

                    assertfn (type === 'LIST', `applyToLocalState: Can only apply "UpdatesMethod.Rm" to "List": "${reducerKey}.${update.path}"`)
                    assertfn (!isNaN(update.filter?._id as number), `applyToLocalState: "Rm" requires "filter._id", "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                    const all_keys_rm = effectiveStateValue(`${levelkey}:_all_keys`)
                    const rm_key_idx = all_keys_rm.indexOf(update.filter?._id)
                    assertfn (rm_key_idx >= 0, `applyToLocalState: "Rm", cannot find existing value, "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                    newstate[`${levelkey}:_all_keys`] = imm_splice(all_keys_rm, rm_key_idx)
                    //delkeys.push(`${levelkey}:${update.filter?._id}`)


                    break
                case 'UPDATE':
                    assertfn ((type === 'LIST' && !isNaN(update.filter?._id as number)) || (type === 'HASH' && !update.filter) , `applyToLocalState: Can only apply "UpdatesMethod.Update" to a "List" with a 'fliter', or a "Hash": "${reducerKey}.${update.path}", filter=${JSON.stringify(update.filter)}`)
                    assertfn (Object.keys(update.doc).reduce((a: number,i: string) => {
                            return   a >= 0 ? ((i === '$set' || i === '$merge') ? 1+a : -1) : a
                        }, 0) > 0, `applyToLocalState: Can only apply "UpdatesMethod.Update" doc with only '$merge' or '$set' keys: "${reducerKey}.${update.path}"`)

                    const value_key = type === 'LIST' ? `${levelkey}:${update.filter?._id}` : `${levelkey}`
                    const existing_doc = effectiveStateValue(value_key)

                    assertfn(existing_doc, `applyToLocalState: Panic applying a update on "${reducerKey}.${update.path}" to a non-existant document (key=${value_key})`)
                    
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

                    if (update.setCalc) {
                        recordCalc.push({ levelUpdates_idx: value_key, setCalc: update.setCalc})
                    }
                    //pathKeyState = JSStateStore.imm_splice(pathKeyState, update_idx, new_doc)
                    newstate[value_key] = merged

                    returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], [update.path]: { merged: returnInfo?.[reducerKey]?.[update.path]?.['merged']?.concat(merged) || [merged] }}}
                    break
                case 'INC':
                    assertfn (type === 'METRIC', `applyToLocalState: Can only apply "UpdatesMethod.Inc" to a "Counter": "${reducerKey}.${update.path}"`)
                    
                    const inc = effectiveStateValue(`${levelkey}`) + 1

                    returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], inc }}
                    newstate[`${levelkey}`] = inc

                    returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], [update.path]: { inc: [inc]}}}
                    break
                default:
                    assertfn(false, `applyToLocalState: Cannot apply update, unknown method=${update.method}`)
            }
        }
    }

    for (let {levelUpdates_idx, setCalc} of recordCalc) {
        if (setCalc) {
            // If update has a Calculated field (field dependent on Apply Info, mainly for new ADDED _ids)
            console.log ('applying calculated fields')

            let result : any=  setCalc.linkedApplyInfo? linkedApplyInfo : returnInfo

            if (setCalc.applyFilter) {
                const {sliceKey, path, operation, find, attribute} = setCalc.applyFilter 
                result= result?.[sliceKey]?.[path]?.[operation]?.find((i: any) => i[find.key] === find.value)
            }

            if (result) {
                setCalc.target.split('.').reduce((a,c,idx, all) => { if (idx === all.length-1) { a[c] = setCalc.applyFilter?.attribute? result[setCalc.applyFilter.attribute] : result; return idx } else return a[c]}, newstate[levelUpdates_idx])
            }
        }
    }
    
    return {newstate, returnInfo}
}