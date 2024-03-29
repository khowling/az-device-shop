

// Replace array entry at index 'index' with 'val'
function imm_splice(array, index, val) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }
function apply_incset({ method, doc }, val) {
    return {
        ...val, ...Object.keys(doc).map(k => {
            return {
                [k]: method === 'inc' ? doc[k] + val[k] : doc[k]
            }
        }).reduce((a, i) => { return { ...a, ...i } }, {})
    }
}

export function stateReducer({ state, metadata }, action) {

    let newstate = {}

    const effectiveStateValue = (reducerKey, path) => {
        //console.log(`effectiveStateValue reducerKey:${reducerKey} path:${path}`)
        return newstate[reducerKey] && newstate[reducerKey].hasOwnProperty(path) ? newstate[reducerKey][path] : state[reducerKey][path]
    }

    console.log (state)
    console.log(action)

    switch (action.type) {
        case 'snapshot':
            return { state: action.state, metadata: action.metadata }
        case 'events':

            const statechanges = action.state
            for (let reducerKey of Object.keys(statechanges)) {

                newstate = {...newstate, [reducerKey]: state[reducerKey]}
                for (let update of statechanges[reducerKey]) {
                    console.assert (update.path, `applyToLocalState: State Updates for ${reducerKey} require a 'path'`)
                    const {type, identifierFormat} = metadata.stateDefinition[reducerKey][update.path]

                    switch (update.method) {
                        case 'set':
                            console.assert (type === "hash" || (type === "list" && update.filter && !isNaN(update.filter._id)) , `applyToLocalState: Can only apply "UpdatesMethod.Set" to "Hash" or "List" with a filter: "${reducerKey}.${update.path}"`)
                            if (type === "list") {
                                const idx = effectiveStateValue(reducerKey,update.path).findIndex(i => i._id === update.filter._id)
                                console.assert (idx >= 0 , `applyToLocalState: Could not find item with id "${update.filter._id}" in list "${reducerKey}.${update.path}"`)
                                newstate[reducerKey][update.path] = imm_splice(effectiveStateValue(reducerKey,update.path), idx, update.doc)
                            } else {
                                newstate[reducerKey][update.path] = update.doc
                            }
                            break
                        case 'add':
                            console.assert (type === "list", `applyToLocalState: Can only apply "UpdatesMethod.Add" to "List": "${reducerKey}.${update.path}"`)
                            console.assert (typeof update.doc === "object" && !update.doc.hasOwnProperty('_id'), `applyToLocalState: "Add" requires a document object that doesnt contain a "_id" property": "${reducerKey}.${update.path}" doc=${JSON.stringify(update.doc)}`)
                            
                            const next_seq = effectiveStateValue(reducerKey, `${update.path}:_next_sequence`)
                            const added = {_id: next_seq, ...(identifierFormat && { identifier: `${identifierFormat.prefix || ''}${identifierFormat.zeroPadding ?  String(next_seq).padStart(identifierFormat.zeroPadding, '0') : next_seq}`}),  ...update.doc}

                            newstate[reducerKey][update.path] = effectiveStateValue(reducerKey,update.path).concat(added)
                            newstate[reducerKey][`${update.path}:_next_sequence`] = next_seq + 1
                            break

                        case 'rm':

                            console.assert (type === "list", `applyToLocalState: Can only apply "UpdatesMethod.Rm" to "List": "${reducerKey}.${update.path}"`)
                            console.assert (update.filter && !isNaN(update.filter._id), `applyToLocalState: "Rm" requires "filter._id", "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                            const idx = effectiveStateValue(reducerKey,update.path).findIndex(i => i._id === update.filter._id)
                            console.assert (idx >= 0 , `applyToLocalState: Could not find item with id "${update.filter._id}" in list "${reducerKey}.${update.path}"`)


                            newstate[reducerKey][update.path] = imm_splice(effectiveStateValue(reducerKey,update.path), idx, null)
                            break
                        case 'update':

                            console.assert ((type === "list" && !isNaN(update.filter._id)) || (type === "hash" && !update.filter) , `applyToLocalState: Can only apply "UpdatesMethod.Update" to a "List" with a 'fliter', or a "Hash": "${reducerKey}.${update.path}", filter=${JSON.stringify(update.filter)}`)
                            console.assert (Object.keys(update.doc).reduce((a,i) => {
                                    return   a >= 0 ? ((i === '$set' || i === '$merge') ? 1+a : -1) : a
                                }, 0) > 0, `applyToLocalState: Can only apply "UpdatesMethod.Update" doc with only '$merge' or '$set' keys: "${reducerKey}.${update.path}"`)
    
                            const existingkeyval = effectiveStateValue(reducerKey,update.path)
                            const existing_idx = type === "list" ? existingkeyval.findIndex(i => i._id === update.filter._id) : -1
                            const existing_doc = type === "list" ? (existing_idx >=0 ? existingkeyval[existing_idx]: undefined) : existingkeyval
    
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

                            if (type === "list") {
                                newstate[reducerKey][update.path] = imm_splice(existingkeyval, existingkeyval.findIndex(i => i._id === update.filter._id), merged)
                            } else {
                                newstate[reducerKey][update.path] = merged
                            }

                            break
                        case 'inc':
                            console.assert (type === "counter", `applyToLocalState: Can only apply "UpdatesMethod.Inc" to a "Counter": "${reducerKey}.${update.path}"`)
                            
                            const inc = effectiveStateValue(reducerKey, update.path) + 1
    
                            newstate[reducerKey][update.path] = inc
    
                            break
                        default:
                            console.assert(false, `applyToLocalState: Cannot apply update seq=${statechanges._apply.current_head}, unknown method=${update.method}`)
                    }
                }
            }

            console.log(newstate)

            return { 
                state: { ...state, ...newstate }, 
                metadata 
            }

        case 'closed':
            // socket closed, reset state
            return { state: {}, metadata: {} }


        default:
            throw new Error(`unknown action type ${action.type}`);
    }
}

