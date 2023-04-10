import { strict as assertnode } from 'node:assert';
import { ApplyInfo, StateChanges, StateStore, StateStoreDefinition } from './stateManager.js'
import {applyGenerateChanges, getValue} from './jsStateStoreFunctions.js'

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
        return getValue(this.state, this.stateDefinition, reducerKey, path, idx)
    }

     /* Convert state into a JSON structure, used to send snapshot to clients */
    async serializeState(): Promise<any> {
/*
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
    */
        return this._state
    }

    deserializeState(newstate : {[statekey: string]: any}) {
        if (newstate) {
            this.state = { ...newstate }
        }
    }

    async apply(sequence: number, statechanges:StateChanges): Promise<{[slicekey: string]: ApplyInfo}> {

        const {newstate, returnInfo} = applyGenerateChanges(assertnode, this.state, this._stateDefinition, sequence, statechanges)

        // swap into live
        this.state = { ...this.state, ...newstate }
        // TODO - Remove the keys from "Rm"
        return returnInfo
    }
}