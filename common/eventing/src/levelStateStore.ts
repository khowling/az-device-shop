import assert, { throws } from 'assert'

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

import { Level } from 'level'

import { StateStoreDefinition, StateStoreValueType, Control, StateStore, StateChanges, StateUpdate, ApplyInfo, UpdatesMethod } from './stateManager.js'



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
    private _db: Level
    private _list_sublevels: {[key: string]: Level} = {}


    constructor(name: string, stateDefinition: { [sliceKey: string]: StateStoreDefinition}) {
        this._name = name
        this._stateDefinition = stateDefinition

        const db = this._db = new Level<string, any>(process.env.DBPATH || `./${name}.levelss`)

        for (let sliceKey of Object.keys(stateDefinition)) {
            for (let key of Object.keys(stateDefinition[sliceKey])) {
                const {type, values} = stateDefinition[sliceKey][key]
                if (type === 'HASH' && values) {
                    db.put (`${sliceKey}:${key}`, values)
                } else if (type == 'COUNTER') {
                    db.put (`${sliceKey}:${key}`, 0)
                } else if (type === 'LIST') {
                    db.put (`${sliceKey}:${key}:_next_sequence`, 0)
                    this._list_sublevels[`${sliceKey}:${key}`] = db.sublevel<Number, any>(`${sliceKey}:${key}`, {keyEncoding: 'number', valueEncoding: 'json'})
                }
            }
        }
    }

    get name() {
        return this._name
    }

    get stateDefinition() {
        return this._stateDefinition
    }
    
    async getValue(reducerKey: string, path: string, idx?: number) {
        if (this._stateDefinition[reducerKey][path].type == 'LIST') {
            if (isNaN(idx as number)) {
                // return all values in array
                return await this._list_sublevels[`${reducerKey}:${path}`].values().all()
            } else {
                return await this._list_sublevels[`${reducerKey}:${path}`].get(idx)
            }
        } else {
            return await this._db.get(`${reducerKey}:${path}`)
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
    get async serializeState(): Promise<S>  {
        
        const stateDefinition = this._stateDefinition

        let sState : any = {}

        for (let reducerKey of Object.keys(stateDefinition)) {
            for (let path of Object.keys(stateDefinition[reducerKey])) {
                const {type, values} = stateDefinition[reducerKey][path]
                sState = {...sState, ...{ [reducerKey]: {...sState[reducerKey] , ...{ [path]: await this.getValue(reducerKey, path)}}}}
            }
        }
        return sState as Promise<S>
    }

    // deserializeState(newstate: {[statekey: string]: any}) {
    //     if (newstate) {
    //         await db.batch([{ type: 'put', key: 'b', value: 2 }])
    //         this._db = { ...newstate }
    //     }
    // }


    apply(statechanges:StateChanges): {[slicekey: string]: ApplyInfo} {

        const state = this._db
        const _control = (statechanges as Control)._control 


        //assert(_control && _control.head_sequence === state._control.head_sequence, `applyToLocalState: Panic, cannot apply update head_sequence=${_control && _control.head_sequence} to state at head_sequence=${state._control.head_sequence}`)
        //let newstate = { _control: { head_sequence: state._control.head_sequence + 1, lastupdated: _control.lastupdated } }
        let returnInfo : {[slicekey: string]: ApplyInfo} = {}
        let levelUpdates: Array<{
            type: 'put' | 'del';
            sublevel?: string;
            key: string | number;
            value?: any;
        }> =  []

        //console.log(`[${this.name}] apply(): change._control.head_sequence=${_control.head_sequence} to state._control.head_sequence=${state._control.head_sequence}`)

        for (let reducerKey of Object.keys(statechanges)) {
            //if (reducerKey === '_control') continue
            // get the relevent section of the state
            const stateKeyChanges = statechanges[reducerKey] as Array<StateUpdate>
            ///let reducerKeyState = this._db[stateKey]

            for (let i = 0; i < stateKeyChanges.length; i++) {
                const update: StateUpdate = stateKeyChanges[i]
                const {type, identifierFormat} = this._stateDefinition[reducerKey][update.path]
                const levelkey = `${reducerKey}:${update.path}`

                //let pathKeyState = update.path ? reducerKeyState[update.path] : reducerKeyState

                switch (update.method) {
                    case 'SET':
                        if (type === 'LIST') {
                            assert(!isNaN(update.filter?._id as number) , `apply (SET), requires filter._id as a number, got ${update?.filter?._id}`)

                            levelUpdates = levelUpdates.concat({
                                type: 'put',
                                sublevel: levelkey,
                                key: update?.filter?._id as number,
                                value: update.doc
                            })
                                
                        } else { // object
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
                        const seqKey = `${levelkey}:_next_sequence`
                        const _next_sequence = levelUpdates.find(lu => lu.type === 'put' && lu.key === seqKey)?.value || this._db.get(seqKey) as number
                        
                        const added = {_id: _next_sequence, ...(identifierFormat && { identifier: `${identifierFormat.prefix || ''}${identifierFormat.zeroPadding ?  String(_next_sequence).padStart(identifierFormat.zeroPadding, '0') : _next_sequence}`}), ...update.doc}
                        
                        levelUpdates = levelUpdates.concat([{
                            type: 'put',
                            sublevel: levelkey,
                            key: _next_sequence,
                            value: added
                        }, {
                            type: 'put',
                            key: seqKey,
                            value: _next_sequence + 1
                        }])

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], added }}
                        break

                    case 'RM':
                        assert (type === 'LIST', `apply (RM): Can only apply  to "List": "${reducerKey}.${update.path}"`)
                        assert (!isNaN(update.filter?._id as number), `apply (RM): requires "filter._id", "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        const id = update.filter?._id as number
                        const existing = this._list_sublevels[levelkey].get(id)
                        assert (existing, `apply (RM): Cannot find existing value, "${reducerKey}.${update.path}" update.filter=${JSON.stringify(update.filter)}`)

                        levelUpdates = levelUpdates.concat({
                            type: 'del',
                            sublevel: levelkey,
                            key: id
                        })

                        break
                    case 'UPDATE':
                        assert ((type === 'LIST' && !isNaN(update.filter?._id as number)) || (type === 'HASH' && !update.filter) , `apply (UPDATE): Can only apply to a "List" with a 'fliter', or a "Hash": "${reducerKey}.${update.path}", filter=${JSON.stringify(update.filter)}`)
                        assert (Object.keys(update.doc).reduce((a: number,i: string) => {
                                return   a >= 0 ? ((i === '$set' || i === '$merge') ? 1+a : -1) : a
                            }, 0) > 0, `applyToLocalState: Can only apply "UpdatesMethod.Update" doc with only '$merge' or '$set' keys: "${reducerKey}.${update.path}"`)

                       
                        const existing_doc = type === 'LIST' ?
                            levelUpdates.find(lu => lu.type === 'put' && lu.sublevel === levelkey && lu.key === update.filter?._id as number)?.value || this._list_sublevels[levelkey].get(update.filter?._id as number)
                            :
                            levelUpdates.find(lu => lu.type === 'put' && lu.key === levelkey)?.value || this._db.get(levelkey) as number

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

                        levelUpdates = levelUpdates.concat( type === 'LIST' ? {
                            type: 'put',
                            sublevel: levelkey,
                            key: update.filter?._id as number,
                            value: merged
                        } : {
                            type: 'put',
                            key: levelkey,
                            value: merged
                        })

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], merged }}
                        

                        
                        break
                    case 'INC':
                        assert (type === 'COUNTER', `apply (INC): Can only apply to a "Counter": "${reducerKey}.${update.path}"`)
                        
                        const inc = levelUpdates.find(lu => lu.type === 'put' && lu.key === levelkey)?.value || this._db.get(levelkey) as number + 1

                        levelUpdates = levelUpdates.concat({
                            type: 'put',
                            key: levelkey,
                            value: inc
                        })

                        returnInfo = {...returnInfo, [reducerKey]: { ...returnInfo[reducerKey], inc }}
                        break
                    default:
                        assert(false, `apply: Cannot apply update, unknown method=${update.method}`)
                }
            }
        }
        this._db.batch(levelUpdates)
        return returnInfo
    }
}
