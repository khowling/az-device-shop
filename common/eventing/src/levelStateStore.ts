import { strict as assert } from 'node:assert';

// https://github.com/Level/levelup
/*
    LevelDB is a simple key-value store built by Google.
    LevelDB supports arbitrary byte arrays as both keys and values, 
    singular get, put and delete operations, batched put and delete, 
    bi-directional iterators and simple compression using the very fast Snappy algorithm.

    LevelDB stores entries sorted lexicographically by keys. 
    This makes the streaming interface of levelup - which exposes LevelDB iterators 
    as Readable Streams - a very powerful query mechanism

    The most common store is 'leveldown' which provides a pure C++ binding to LevelDB
    The 'level' package is the recommended way to get started.
    It conveniently bundles levelup, leveldown and encoding-down. 
    Its main export is levelup
*/
import { rm } from 'node:fs/promises';
import { Level } from 'level'
import  type { AbstractSublevel, AbstractBatchOperation, AbstractBatchPutOperation, AbstractBatchDelOperation } from 'abstract-level'

import { StateStoreDefinition, StateStore, StateChanges, StateUpdate, ApplyInfo, UpdatesMethod, CalculatedValueDef } from './stateManager.js'



function imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), ...(val ? [val] : []), ...array.slice(index + 1)] }

function apply_incset({ method, doc } : {method: UpdatesMethod, doc: any}, val: any) {
    return {
        ...val, ...Object.keys(doc).map(k => {
            return {
                [k]: method === 'INC' ? doc[k] + val[k] : doc[k]
            }
        }).reduce((a, i) => { return { ...a, ...i } }, {})
    }
}


export class LevelStateStore<S> implements StateStore<S> {

    private _name: string
    private _stateDefinition: { [sliceKey: string]: StateStoreDefinition}
    private _db: Level | null = null 
    private _list_sublevels: {[key: string]: AbstractSublevel<Level<string, any>, string | Buffer | Uint8Array, number, any>} = {}
    private _storeDir: string

    constructor(name: string, stateDefinition: { [sliceKey: string]: StateStoreDefinition}) {
        this._name = name
        this._stateDefinition = stateDefinition
        this._storeDir = `./_leveldb.${name}`

    }

    get name() {
        return this._name
    }

    get stateDefinition() {
        return this._stateDefinition
    }

    async initStore(options?: {distoryExisting: boolean}) {

        if (this._db && options?.distoryExisting) {
            await this._db.close()
        }

        if (options?.distoryExisting) {
            try {
                await rm(this._storeDir, {recursive: true})
            } catch (e: any) {
                if (!(e.message as string).startsWith('ENOENT')) {
                    throw e
                }
            }
        }

        const db = this._db = new Level<string, any>(this._storeDir, {keyEncoding: 'utf8', valueEncoding: 'json'})

        for (let sliceKey of Object.keys(this.stateDefinition)) {
            for (let key of Object.keys(this.stateDefinition[sliceKey])) {
                const levelkey = `${sliceKey}:${key}`
                const {type, values} = this.stateDefinition[sliceKey][key]
                if (type === 'HASH' && values) {
                    if (options?.distoryExisting || !await db.get(levelkey)) {
                        await db.put (levelkey, values)
                    }
                } else if (type == 'METRIC') {
                    if (options?.distoryExisting || !await db.get(levelkey)) {
                        await db.put (levelkey, 0, {valueEncoding: 'binary'})
                    }
                } else if (type === 'LIST') {
                    const next_sequenceKey = `${levelkey}:_next_sequence`
                    if (options?.distoryExisting || !await db.get(next_sequenceKey)) {
                        await db.put (next_sequenceKey, 0, {valueEncoding: 'binary'})
                        this._list_sublevels[levelkey] = await db.sublevel<number, any>(levelkey, {keyEncoding: 'binary', valueEncoding: 'json'})
                    }
                }
            }
        }
    }
    
    async getValue(reducerKey: string, path: string, idx?: number) {
        assert (this._db, 'Store not initialized')
        const levelkey = `${reducerKey}:${path}`
        if (this._stateDefinition[reducerKey][path].type == 'LIST') {
            if (isNaN(idx as number)) {
                // return all values in array
                return await this._list_sublevels[levelkey].values().all() || []
            } else {
                return await this._list_sublevels[levelkey].get(idx as number)
            }
        } else if (this._stateDefinition[reducerKey][path].type == 'METRIC') { 
            return  parseInt(await this._db.get(levelkey))
        } else {
            return await this._db.get(levelkey)
        }

    }

    debugState(): void {
        console.log ('tbc')
    }

    get state() {
        return this._db
    }

    set state(newstate) {
        this._db = newstate
    }

    /* Convert state into a JSON structure, used to send snapshot to clients */
    async serializeState(): Promise<any>  {
        assert (this._db, 'Store not initialized')

        const stateDefinition = this._stateDefinition

        let sState : any = {}

        for (let reducerKey of Object.keys(stateDefinition)) {
            for (let path of Object.keys(stateDefinition[reducerKey])) {
                const levelkey = `${reducerKey}:${path}`
                const {type, values} = stateDefinition[reducerKey][path]
                if (type === 'LIST') {
                    const allsub = await this._list_sublevels[levelkey].iterator( {keyEncoding: 'binary', valueEncoding: 'json'}).all()
                    sState = {...sState, 
                        ...allsub.map(v => { return {[`${levelkey}:${v[0]}`]: v[1]} }).reduce((a, i) => { return {...a, ...i} }, { 
                            [`${levelkey}:_next_sequence`]: await this._db.get(`${levelkey}:_next_sequence`),
                            [`${levelkey}:_all_keys`]: allsub.map(v => { return parseInt(v[0] as any)}),
                        }),
                    }
                } else {
                    sState = {...sState, [levelkey]: await this._db.get(levelkey)}
                }

            }
        }
        return sState 
    }

    // deserializeState(newstate: {[statekey: string]: any}) {
    //     if (newstate) {
    //         await db.batch([{ type: 'put', key: 'b', value: 2 }])
    //         this._db = { ...newstate }
    //     }
    // }


    async apply(sequence: number, statechanges:StateChanges, linkedApplyInfo?: {[slice: string]: ApplyInfo}): Promise<{[slicekey: string]: ApplyInfo}> {

        assert (this._db, 'Store not initialized')

        let returnInfo : {[slicekey: string]:  ApplyInfo} = {}

        let levelUpdates: AbstractBatchOperation<Level<string, string>, any, any>[]=  []
        let cacheUpdates: {[key: string]: any} = {}

        // record all the required calcuated field rules, this needs to be executed after all the ApplyInfo has been created
        const recordCalc : Array<{ levelUpdates_idx: number, setCalc: CalculatedValueDef}> = []

        // Store the log sequence into the level state for rolling forward
        levelUpdates.push({
            type: 'put',
            key: '_control:log_sequence',
            valueEncoding: 'binary',
            value: sequence
        })

        for (let reducerKey of Object.keys(statechanges)) {

            const stateKeyChanges = statechanges[reducerKey] as Array<StateUpdate>
            ///let reducerKeyState = this._db[stateKey]

            for (let update of stateKeyChanges) {

                const {type, identifierFormat} = this._stateDefinition[reducerKey][update.path]
                const levelkey = `${reducerKey}:${update.path}`

                //let pathKeyState = update.path ? reducerKeyState[update.path] : reducerKeyState

                switch (update.method) {
                    case 'SET':
                        if (type === 'LIST') {
                            assert(!isNaN(update.filter?._id as number) , `apply (SET), requires filter._id as a number, got ${update?.filter?._id}`)

                            cacheUpdates = {...cacheUpdates, [`${levelkey}:${update?.filter?._id}`]: update.doc}

                            levelUpdates = levelUpdates.concat({
                                type: 'put',
                                sublevel: this._list_sublevels[levelkey],
                                key: update?.filter?._id,
                                keyEncoding: 'binary',
                                value: update.doc
                            } as AbstractBatchPutOperation<Level<string, string>, any, any>)
                                
                        } else { // object

                            cacheUpdates = {...cacheUpdates, [levelkey]: update.doc}

                            levelUpdates = levelUpdates.concat({
                                type: 'put',
                                key: levelkey,
                                value: update.doc
                            })
                        }
                        break

                    case 'ADD':
                        assert (type === 'LIST', `apply (ADD): Can only apply to "List": "${reducerKey}.${update.path}"`)
                        assert (typeof update.doc === "object" && !update.doc.hasOwnProperty('_id'), `applyToLocalState: "Add" requires a document object that doesnt contain a "_id" property": "${reducerKey}.${update.path}" doc=${JSON.stringify(update.doc)}`)
                        const next_sequenceKey = `${levelkey}:_next_sequence`
                        const _next_sequence = cacheUpdates.hasOwnProperty(next_sequenceKey) ? cacheUpdates[next_sequenceKey] :  parseInt(await this._db.get(next_sequenceKey))
                        
                        const added = {_id: _next_sequence, ...(identifierFormat && { identifier: `${identifierFormat.prefix || ''}${identifierFormat.zeroPadding ?  String(_next_sequence).padStart(identifierFormat.zeroPadding, '0') : _next_sequence}`}), ...update.doc}
                        
                        cacheUpdates = {...cacheUpdates, [`${levelkey}:${_next_sequence}`]: added}
                        cacheUpdates = {...cacheUpdates, [next_sequenceKey]: _next_sequence + 1}

                        levelUpdates = levelUpdates.concat([{
                            type: 'put',
                            sublevel: this._list_sublevels[levelkey],
                            key: _next_sequence,
                            keyEncoding: 'binary',
                            value: added
                        }, {
                            type: 'put',
                            key: next_sequenceKey,
                            value: _next_sequence + 1
                        }])


                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], [update.path]: { added: returnInfo?.[reducerKey]?.[update.path]?.['added']?.concat(added) || [added] } }}
                        break

                    case 'RM':
                        assert (type === 'LIST', `apply (RM): Can only apply  to "List": "${reducerKey}.${update.path}"`)
                        assert (!isNaN(update.filter?._id as number), `apply (RM): requires "filter._id", "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        const id = update.filter?._id as number
                        const existing = this._list_sublevels[levelkey].get(id)
                        assert (existing, `apply (RM): Cannot find existing value, "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        
                        cacheUpdates = {...cacheUpdates, [`${levelkey}:${id}`]: null}

                        levelUpdates = levelUpdates.concat({
                            type: 'del',
                            sublevel: this._list_sublevels[levelkey],
                            keyEncoding: 'binary',
                            key: id
                        } as AbstractBatchDelOperation<Level<string, string>, any>)

                        break
                    case 'UPDATE':
                        assert ((type === 'LIST' && !isNaN(update.filter?._id as number)) || (type === 'HASH' && !update.filter) , `apply (UPDATE): Can only apply to a "List" with a 'fliter', or a "Hash": "${reducerKey}.${update.path}", filter=${JSON.stringify(update.filter)}`)
                        assert (Object.keys(update.doc).reduce((a: number,i: string) => {
                                return   a >= 0 ? ((i === '$set' || i === '$merge') ? 1+a : -1) : a
                            }, 0) > 0, `applyToLocalState: Can only apply "UpdatesMethod.Update" doc with only '$merge' or '$set' keys: "${reducerKey}.${update.path}"`)

                       
                        const existing_doc = type === 'LIST' ?
                            cacheUpdates.hasOwnProperty(`${levelkey}:${update.filter?._id}`) ? cacheUpdates[`${levelkey}:${update.filter?._id}`] :  await this._list_sublevels[levelkey].get(update.filter?._id as number)
                            :
                            cacheUpdates.hasOwnProperty(levelkey) ? cacheUpdates[levelkey] :  await this._db.get(levelkey) 

                        assert(existing_doc, `apply (UPDATE): Applying a update on "${reducerKey}.${update.path}" to a non-existant document (key=)`)
                        
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
                            recordCalc.push({ levelUpdates_idx: levelUpdates.length, setCalc: update.setCalc})
                        }

                        cacheUpdates = {...cacheUpdates, ...(type === 'LIST' ? {
                            [`${levelkey}:${update.filter?._id}`]: merged} : {[levelkey]: merged}
                        )}

                        levelUpdates = levelUpdates.concat( type === 'LIST' ? {
                            type: 'put',
                            sublevel: this._list_sublevels[levelkey],
                            key: update.filter?._id as number,
                            keyEncoding: 'binary',
                            value: merged
                        } : {
                            type: 'put',
                            key: levelkey,
                            value: merged
                        })
                        
                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], [update.path]: { merged: returnInfo?.[reducerKey]?.[update.path]?.['merged']?.concat(merged) || [merged] }}}
                        break
                    case 'INC':
                        assert (type === 'METRIC', `apply (INC): Can only apply to a "Counter": "${reducerKey}.${update.path}"`)
                        
                        const inc = cacheUpdates.hasOwnProperty(levelkey) ? cacheUpdates[levelkey] + 1 :  parseInt(await this._db.get(levelkey))  + 1

                        cacheUpdates = {...cacheUpdates, [levelkey]: inc}

                        levelUpdates = levelUpdates.concat({
                            type: 'put',
                            key: levelkey,
                            valueEncoding: 'binary',
                            value: inc
                        })

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], [update.path]: { inc: [inc]}}}
                        break
                    default:
                        assert(false, `apply: Cannot apply update, unknown method=${update.method}`)
                }
            }
        }

        for (let {levelUpdates_idx, setCalc} of recordCalc) {
            if (setCalc) {
                // If update has a Calculated field (field dependent on Apply Info, mainly for new ADDED _ids)

                let result : any=  setCalc.linkedApplyInfo? linkedApplyInfo : returnInfo

                if (setCalc.applyFilter) {
                    const {sliceKey, path, operation, find, attribute} = setCalc.applyFilter 
                    result= result?.[sliceKey]?.[path]?.[operation]?.find((i: any) => i[find.key] === find.value)
                }
                if (result) {
                    setCalc.target.split('.').reduce((a,c,idx, all) => { if (idx === all.length-1) { a[c] = setCalc.applyFilter?.attribute? result[setCalc.applyFilter.attribute] : result; return idx } else return a[c]}, (levelUpdates[levelUpdates_idx] as AbstractBatchPutOperation<Level<string, string>, any, any>).value)
                }
            }
        }
        await this._db.batch(levelUpdates)
        return returnInfo
    }
}
