const assert = require('assert')
import { Atomic } from '../util/atomic'

export interface FactoryState extends FactoryStateSequences {
    factory_sequence: number;
    lastupdated: number;

    workitems: Array<WorkItemObject>;
}
export interface FactoryStateSequences {
    capacity_allocated?: number;
    workitem_sequence?: number;
    inventory_sequence?: number;
}

export interface WorkItemObject {
    doc_id: string;
    status: WorkItemStatus;
}


export interface WorkItemStatus extends DocStatus {
    stage?: WorkItemStage;

    // Factory status
    workitem_number?: string;
    factory_status?: {
        stage: FactoryStage;
        starttime?: number;
        waittime?: number;
        allocated_capacity?: number;
        progress?: number;
    }

    // Delivered Inventory (will be labeled with 'NEWINV')
    completed_sequence?: number;
    complete_item?: {
        qty: number;
        product: string;
        warehouse: string;
    }
}
export enum WorkItemStage { Draft, WIValidated, WINumberGenerated, InFactory, FactoryComplete, MoveToWarehouse, Complete }
export enum FactoryStage { Waiting, Building, Complete }

//export interface FactoryUpdate {
//    capacity_allocated_update?: number;
//    workitem_sequence_update?: number;
//    inventory_sequence_update?: number;
//}

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
    status: WorkItemStatus | FactoryStateSequences;
}
export enum ChangeEventType {
    CREATE,
    UPDATE,
    DELETE,
    INC
}

// Perform Action on state
export interface WorkItemAction {
    type: ActionType;
    spec?: any;
    doc_id?: string;
    status?: any;
}
export enum ActionType { NewOrUpdatedInventoryRequest, AllocateWINumber, StatusUpdate, CheckFactoryProgress, CheckWaiting, Sync, CompleteInventry }



export class FactoryStateManager extends Atomic {

    private _state = { factory_sequence: 0, lastupdated: null, capacity_allocated: 0, inventory_sequence: 0, workitem_sequence: 0, workitems: [] } as FactoryState
    private commitEventsFn

    constructor(opts: any = {}) {
        super()
        this.commitEventsFn = opts.commitEventsFn
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

    deserializeState(newstate) {
        if (newstate) {
            this.state = { ...newstate }
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

    applyEvents(statechanges: Array<StateChange>) {

        assert(statechanges && statechanges.length > 0, "No changes provided")

        let newstate: FactoryState = { ...this.state, factory_sequence: this.state.factory_sequence + 1, lastupdated: Date.now() }

        for (let { kind, metadata, status } of statechanges) {

            assert(metadata.next_sequence && metadata.next_sequence === newstate.factory_sequence, `applyEvents, Cannot apply change sequence ${metadata.next_sequence}, expecting ${newstate.factory_sequence}`)

            switch (kind) {
                case "Workitem": {
                    const { doc_id, type } = metadata
                    const new_status = status as WorkItemStatus

                    if (type === ChangeEventType.UPDATE) {
                        const [wi_idx, existing_wi] = FactoryStateManager.getWorkitem(newstate, doc_id)
                        if (existing_wi) {
                            const new_wi = { ...existing_wi, status: { ...existing_wi.status, ...new_status } }
                            newstate.workitems = FactoryStateManager.imm_splice(newstate.workitems, wi_idx, new_wi)
                        } else {
                            throw new Error(`applyEvents, Cannot find existing ${kind} with doc_id=${doc_id}`)
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
                    const new_status = status as FactoryStateSequences
                    newstate = { ...newstate, ...Object.keys(new_status).map(k => { return { [k]: new_status[k] + (type === ChangeEventType.INC ? newstate[k] : 0) } }).reduce((a, i) => { return { ...a, ...i } }, {}) }
                    break
                }
                default:
                    throw new Error(`applyEvents, Unsupported kind ${kind} in local state`)
            }
        }
        this._state = newstate
    }

    // Convert 'action' on existing 'staateManager' into 'StateChanges[]' events
    processAction(action: WorkItemAction): [boolean, Array<StateChange>] {

        const kind = "Workitem"
        const next_sequence = this.state.factory_sequence + 1
        switch (action.type) {

            case ActionType.NewOrUpdatedInventoryRequest: {
                const { spec } = action
                if (spec.hasOwnProperty('_id') && spec.hasOwnProperty('product') && spec.hasOwnProperty('qty') && spec.hasOwnProperty('status')) {
                    const new_wi_status: WorkItemStatus = { failed: false, stage: action.spec.status === 'Draft' ? WorkItemStage.Draft : WorkItemStage.WIValidated }
                    if (this.state.workitems.findIndex(w => w.doc_id === spec._id) < 0) {
                        return [false, [{ kind, metadata: { doc_id: spec._id, type: ChangeEventType.CREATE, next_sequence }, status: new_wi_status }]]
                    } else {
                        return [true, [{ kind, metadata: { doc_id: spec._id || 'none', type: ChangeEventType.CREATE, next_sequence }, status: { failed: true, message: 'Require properties missing' } }]]
                    }
                } else {

                    return [true, [{ kind, metadata: { doc_id: spec._id || 'none', type: ChangeEventType.CREATE, next_sequence }, status: { failed: true, message: 'Require properties missing' } }]]
                }

            }
            case ActionType.AllocateWINumber: {
                const { spec } = action
                return [false, [
                    { kind, metadata: { doc_id: spec._id, type: ChangeEventType.UPDATE, next_sequence }, status: { stage: WorkItemStage.WINumberGenerated, workitem_number: 'WI' + String(this.state.workitem_sequence + 1).padStart(5, '0') } as WorkItemStatus },
                    { kind: "FactoryUpdate", metadata: { type: ChangeEventType.INC, next_sequence }, status: { workitem_sequence: 1 } as FactoryStateSequences }
                ]]
            }
            case ActionType.CompleteInventry: {
                const { spec } = action
                return [false, [
                    { kind, metadata: { doc_id: spec._id, type: ChangeEventType.UPDATE, next_sequence }, status: { stage: WorkItemStage.Complete, completed_sequence: this.state.inventory_sequence + 1, complete_item: { qty: spec.qty, product: spec.product, warehouse: spec.warehouse } } as WorkItemStatus },
                    { kind: "FactoryUpdate", metadata: { type: ChangeEventType.INC, next_sequence }, status: { intentory_sequence: 1 } as FactoryStateSequences }
                ]]
            }
            case ActionType.StatusUpdate: {
                const { spec, status } = action
                // Needs to be Idempotent
                // TODO: Check if state already has  Number 
                return [false, [
                    { kind, metadata: { doc_id: spec._id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...status } }
                ]]
            }
            case ActionType.CheckFactoryProgress: {

                // A simulation for factory_status,
                // In a real implementation, this may be implemented in another process, with this process listenting for updates
                const MAX_FACTORY_CAPACITY = 5
                const TIME_TO_PROCESS_A_WI = 30 * 1000 //3 seconds per item

                let capacity_allocated_update = 0// state.capacity_allocated
                const workitems_in_factory: Array<WorkItemObject> = this.state.workitems.filter(s => s.status.stage === WorkItemStage.InFactory)
                const now = Date.now()

                const statechanges: Array<StateChange> = []

                // check wi in factory_status status look for for completion to free up capacity
                for (let ord of workitems_in_factory.filter(o => o.status.factory_status.stage === FactoryStage.Building)) {
                    // all wi in Picking status
                    const { doc_id, status } = ord
                    let factory_status_update = {}

                    const timeleft = (TIME_TO_PROCESS_A_WI /* * qty */) - (now - status.factory_status.starttime)

                    if (timeleft > 0) { // not finished, just update progress
                        factory_status_update = { factory_status: { ...status.factory_status, progress: Math.floor(100 - ((timeleft / TIME_TO_PROCESS_A_WI) * 100.0)) } }
                    } else { // finished
                        capacity_allocated_update = capacity_allocated_update - status.factory_status.allocated_capacity
                        factory_status_update = { factory_status: { ...status.factory_status, stage: FactoryStage.Complete, progress: 100, allocated_capacity: 0 }, stage: WorkItemStage.FactoryComplete }
                    }
                    statechanges.push({ kind, metadata: { doc_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                }

                // check wi in factory_status status look for for completion to free up capacity
                for (let ord of workitems_in_factory.filter(o => o.status.factory_status.stage === FactoryStage.Waiting)) {
                    // all wi in Picking status
                    const { doc_id, status } = ord
                    let factory_status_update = {}
                    const required_capacity = 1

                    if ((MAX_FACTORY_CAPACITY - (this.state.capacity_allocated + capacity_allocated_update)) >= required_capacity) {
                        // we have capacity, move to inprogress
                        factory_status_update = { factory_status: { ...status.factory_status, stage: FactoryStage.Building, allocated_capacity: required_capacity, progress: 0, waittime: now - status.factory_status.starttime } }
                        capacity_allocated_update = capacity_allocated_update + required_capacity
                    } else {
                        // still need to wait
                        factory_status_update = {
                            factory_status: { ...status.factory_status, waittime: now - status.factory_status.starttime }
                        }

                    }
                    statechanges.push({ kind, metadata: { doc_id, type: ChangeEventType.UPDATE, next_sequence }, status: { failed: false, ...factory_status_update } })
                }

                if (capacity_allocated_update !== 0) {
                    statechanges.push({ kind: "FactoryUpdate", metadata: { type: ChangeEventType.INC, next_sequence }, status: { capacity_allocated: capacity_allocated_update } as FactoryStateSequences })
                }
                if (statechanges.length > 0) {
                    return [false, statechanges]
                }
                return [false, null]
            }

            /*
                    case ActionType.Sync:
            
                        const workitem_idx = state.workitems.findIndex(wi => action.wi._id === wi.spec._id),
                            workitem = workitem_idx >= 0 ? state.workitems[workitem_idx] : null
            
                        if (action.wi.status === 'Draft') {
            
                            if (workitem_idx < 0) {
                                console.log(`factory_operation: Sync: No existing factory workitem for Draft Inventory, add one`)
                                return factory_operation(state, { type: ActionType.NewOrUpdatedInventoryRequest, wi: action.wi })
            
                            } else if (workitem.status.stage === WorkItemStage.Waiting) {
                                console.log(`factory_operation: Sync: Eixting Waiting factory workitem, add one`)
                                return factory_operation(state, { type: ActionType.StatusUpdate, workitem_idx, wi: { stage: WorkItemStage.Draft } })
            
                            } else if (workitem.status.stage === WorkItemStage.Complete) {
                                console.log(`Existing factory workitem already completed, cannot move status to Draft!`)
            
                            } else if (workitem.status.stage === WorkItemStage.InFactory) {
                                console.log(`Workitem in progress, cannot move back to draft`)
                                // no change
                            }
                        } else if (action.wi.status === 'Required') {
            
                            if (workitem_idx < 0) {
                                console.log(`factory_operation: Sync: No existing factory workitem for Required Inventory, add one`)
                                return factory_operation(state, { type: ActionType.NewOrUpdatedInventoryRequest, wi: action.wi })  //add_workitem(action.wi)
                            } else if (workitem.status.stage === WorkItemStage.Complete) {
                                console.log(`workitem already completed, cannot accept any changes!`)
                                //update_avaiable.push (ObjectID(wi._id))
                            } else if (workitem.status.stage === WorkItemStage.InFactory) {
                                console.log(` got eixting spec, still processing`)
                                // no change
                            }
                        } else if (action.wi.status === 'Cancel') {
                            if (workitem_idx < 0) {
                                //add_workitem(wi)
                            } else if (workitem.status.stage === WorkItemStage.Complete) {
                                //update_avaiable.push (ObjectID(wi._id))
                            } else if (workitem.status.stage === WorkItemStage.InFactory) {
                                // no change
                            }
                        }
                        return [state, factory_update]
            */
            default:
                return [false, null]
        }
    }

    async apply(action: WorkItemAction) {
        // Needs to be Atomic!
        let release = await this.aquire()

        // This generated events to be applied to the state based on the action & current state.   
        // NOTE: Nothing else shoud perform a action on a state until this is applied.
        const [hasFailed, events] = this.processAction(action)

        if (events) {
            // persist events
            await this.commitEventsFn(events, null, null)

            // apply events to local state
            this.applyEvents(events)
        }
        release()

    }
}