

import type { FactoryState, WsMessage, FactoryMetaData } from '../../../server/dist/index';
import { applyGenerateChanges } from '@az-device-shop/eventing/jsfunc';
export type { Control, UpdatesMethod, StateUpdate, StateStoreDefinition } from '@az-device-shop/eventing';
import { getValue } from '@az-device-shop/eventing/jsfunc';


export type FactoryReducerState = {
    state: FactoryState,
    metadata: FactoryMetaData
}  | { state: null, metadata: null}


var assertfn = console.assert

export function stateReducer({ state, metadata }: FactoryReducerState, action : WsMessage) : FactoryReducerState {


    switch (action.type) {
        case 'SNAPSHOT':
            return { state: action.snapshot, metadata: action.metadata }
        case 'EVENTS':
        
            if (state && metadata) {

                console.log ("current state (sequence)", state !== null ? getValue(state, metadata?.stateDefinition, '_control', 'log_sequence'): 'undefined')
                console.log("incoming action", action.sequence)

                const {newstate, returnInfo} =  applyGenerateChanges(assertfn, state, metadata.stateDefinition, action.sequence,  action.statechanges)
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

