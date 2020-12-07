const assert = require('assert')



export interface FactoryState {
    factory_sequence: number;
    workitems: Array<WorkItemObject>;
    workitem_sequence: number;
    capacity_allocated: number;
    lastupdated: number;
}

export interface WorkItemObject {
    doc_id: string;
    status: WorkItemStatus;
}


export interface WorkItemStatus extends DocStatus {
    stage?: WorkItemStage;
    workitem_number?: string;
    factory_status?: {
        stage: FactoryStage;
        starttime?: number;
        waittime?: number;
        allocated_capacity?: number;
        progress?: number;
    }
    complete_item?: {
        qty: number;
        product: string;
        warehouse: string;
    }
}
export enum WorkItemStage { Draft, WIValidated, WINumberGenerated, InFactory, FactoryComplete, MoveToWarehouse, Complete }
export enum FactoryStage { Waiting, Building, Complete }

export interface FactoryUpdate {
    allocated_update?: number;
    sequence_update?: number;
}

interface DocStatus {
    failed: boolean;
    message?: string;
}

export interface StateChange {
    kind: string;
    metadata: {
        type: ChangeEventType;
        doc_id?: string;
        next_sequence: number;
    };
    status: WorkItemStatus | FactoryUpdate;
}
export enum ChangeEventType {
    CREATE,
    UPDATE,
    DELETE,
    INC
}


export class FactoryStateManager {

    _state = { factory_sequence: 0, lastupdated: null, capacity_allocated: 0, workitem_sequence: 0, workitems: [] } as FactoryState

    constructor(opts: any = {}) {
    }

    get state() {
        return this._state;
    }

    set state(newstate: FactoryState) {
        this._state = newstate
    }

    get serializeState() {
        return { ...this._state }
    }

    static deserializeState(newstate): FactoryState {
        if (newstate) {
            return { ...newstate }
        } else {
            return { factory_sequence: 0, lastupdated: null, capacity_allocated: 0, workitem_sequence: 0, workitems: [] } as FactoryState
        }
    }

    static getWorkitem(thisstate: FactoryState, spec_id: string): [number, WorkItemObject] {
        const wi_idx = spec_id ? thisstate.workitems.findIndex(o => o.doc_id === spec_id) : -1
        if (wi_idx >= 0) {
            return [wi_idx, thisstate.workitems[wi_idx]]
        }
        return [null, null]
    }

    // Replace array entry at index 'index' with 'val'
    static imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), val, ...array.slice(index + 1)] }

    apply_change_events(statechanges: Array<StateChange>): [boolean, Array<StateChange>] {

        assert(statechanges && statechanges.length > 0, "No changes provided")

        let newstate: FactoryState = { ...this.state, factory_sequence: this.state.factory_sequence + 1, lastupdated: Date.now() }
        let contains_failed = false

        for (let { kind, metadata, status } of statechanges) {

            assert(metadata.next_sequence && metadata.next_sequence === newstate.factory_sequence, `apply_change_events, Cannot apply change sequence ${metadata.next_sequence}, expecting ${newstate.factory_sequence}`)


            switch (kind) {
                case "Workitem": {
                    const { doc_id, type } = metadata
                    const new_status = status as WorkItemStatus

                    if (new_status.failed) { contains_failed = true }
                    if (type === ChangeEventType.UPDATE) {
                        const [wi_idx, existing_wi] = FactoryStateManager.getWorkitem(newstate, doc_id)
                        if (existing_wi) {
                            const new_wi = { ...existing_wi, status: { ...existing_wi.status, ...new_status } }
                            newstate.workitems = FactoryStateManager.imm_splice(newstate.workitems, wi_idx, new_wi)
                        } else {
                            throw new Error(`apply_change_events, Cannot find existing ${kind} with doc_id=${doc_id}`)
                        }
                    } else if (type === ChangeEventType.CREATE) {
                        // using typescript "type assertion"
                        // https://www.typescriptlang.org/docs/handbook/advanced-types.html#type-guards-and-differentiating-types
                        newstate.workitems = newstate.workitems.concat([{ doc_id, status: new_status }])
                    }
                    break
                }
                case "FactoryUpdate": {
                    const { type } = metadata
                    const new_status = status as FactoryUpdate

                    if (new_status.sequence_update && type === ChangeEventType.INC) {
                        newstate.workitem_sequence = newstate.workitem_sequence + new_status.sequence_update
                    } else if (new_status.allocated_update && type === ChangeEventType.UPDATE) { // // got new Onhand value (replace)
                        newstate.capacity_allocated = newstate.capacity_allocated + new_status.allocated_update
                    } else {
                        throw new Error(`apply_change_events, only support updates on ${kind}`)
                    }
                    break
                }
                default:
                    throw new Error(`apply_change_events, Unsupported kind ${kind} in local state`)
            }
        }
        this._state = newstate
        return [contains_failed, statechanges]
    }
}