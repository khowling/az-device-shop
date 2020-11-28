const fs = require('fs')


export interface FactoryState {
    sequence: number;
    workitems: Array<WorkItemObject>;
    workitem_sequence: number;
    capacity_allocated: number;
    lastupdated: number;
}

export interface WorkItemObject {
    doc_id: string;
    //spec: any;
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

export interface ChangeEvent {
    statechanges: Array<StateChange>; // Required transational changes to state
    nextaction: boolean; // end of lifecycle?
    sequence?: number; // Set when statechanges are applied to state
    processor?: any; // {
    //    [processor name]: ProcessorInfo | Custom
    // }

}

export interface StateChange {
    kind: string;
    metadata: {
        type: ChangeEventType;
        doc_id?: string;
    };
    status: WorkItemStatus | FactoryUpdate;
}
export enum ChangeEventType {
    CREATE,
    UPDATE,
    DELETE,
    INC
}

/*
interface FactoryUpdate {
    workitem_updates: Array<WorkItemEvent>;
    capacity_allocated: number;
    lastupdated: number;
}


interface WorkItemEvent {
    type: WorkItemEventType;
    workitem: WorkItem;
}
enum WorkItemEventType { New, Complete, ProgressUpdate }


enum ActionType { Add, CheckInProgress, CheckWaiting, StatusUpdate, Sync }
interface FactoryAction {
    type: ActionType;
    inventory_spec?: any;
    workitem_idx?: number;
}
*/


export class FactoryStateManager {

    _state = { sequence: 0, lastupdated: null, capacity_allocated: 0, workitem_sequence: 0, workitems: [] } as FactoryState

    constructor(opts: any = {}) {
    }

    get state() {
        return this._state;
    }

    set state(newstate: FactoryState) {
        this._state = newstate
    }

    get serializeState() {
        return this._state // { ...this._state, inventory: [...this._state.inventory] }
    }

    static deserializeState(newstate): FactoryState {
        return newstate._state // { ...newstate, inventory: new Map(newstate.inventory) }
    }

    // Replace array entry at index 'index' with 'val'
    static imm_splice(array: Array<any>, index: number, val: any) { return [...array.slice(0, index), val, ...array.slice(index + 1)] }

    apply_change_events(change: ChangeEvent): ChangeEvent {

        if (change.statechanges && change.statechanges.length > 0) {

            let newstate: FactoryState = { ...this.state, sequence: this.state.sequence + 1, lastupdated: Date.now() }

            if (change.sequence && (change.sequence !== newstate.sequence)) {
                throw new Error(`apply_change_events, Cannot re-apply change sequence ${change.sequence}, expecting ${newstate.sequence}`)
            }

            for (let c of change.statechanges) {

                switch (c.kind) {
                    case "Workitem": {
                        const { doc_id, type } = c.metadata
                        const new_status = c.status as WorkItemStatus
                        if (type === ChangeEventType.UPDATE) {
                            const wi_idx = doc_id ? newstate.workitems.findIndex(o => o.doc_id === doc_id) : -1
                            if (wi_idx >= 0) {
                                const existing_wi = newstate.workitems[wi_idx]
                                const new_wi = { ...existing_wi, status: { ...existing_wi.status, ...new_status } }
                                newstate.workitems = FactoryStateManager.imm_splice(newstate.workitems, wi_idx, new_wi)
                            } else {
                                throw new Error(`apply_change_events, Cannot find existing ${c.kind} with doc_id=${doc_id}`)
                            }
                        } else if (type === ChangeEventType.CREATE) {
                            // using typescript "type assertion"
                            // https://www.typescriptlang.org/docs/handbook/advanced-types.html#type-guards-and-differentiating-types
                            newstate.workitems = newstate.workitems.concat([{ doc_id, status: new_status }])
                        }
                        break
                    }
                    case "FactoryUpdate": {
                        const { type } = c.metadata
                        const status = c.status as FactoryUpdate
                        if (status.sequence_update && type === ChangeEventType.INC) {
                            newstate.workitem_sequence = newstate.workitem_sequence + status.sequence_update
                        } else if (status.allocated_update && type === ChangeEventType.UPDATE) { // // got new Onhand value (replace)
                            newstate.capacity_allocated = newstate.capacity_allocated + status.allocated_update
                        } else {
                            throw new Error(`apply_change_events, only support updates on ${c.kind}`)
                        }
                        break
                    }
                    default:
                        throw new Error(`apply_change_events, Unsupported kind ${c.kind} in local state`)
                }
            }
            this._state = newstate
            return { ...change, sequence: newstate.sequence }
        }
        return change
    }

    async applyStateFromSnapshot(ctx, chkdir: string): Promise<any> {
        const dir = `${chkdir}/${ctx.tenent.email}`
        await fs.promises.mkdir(dir, { recursive: true })
        let latestfile = { fileseq: null, filedate: null, filename: null }
        const checkpoints = await fs.promises.readdir(dir)
        const filename_re = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})-(\\d{2})-(\\d{2})-(\\d).json`)
        for (let dir_entry of checkpoints) {
            const entry_match = dir_entry.match(filename_re)
            if (entry_match) {
                const [filename, year, month, day, hour, minute, second, fileseq] = entry_match

                if (latestfile.fileseq === null || latestfile.fileseq < fileseq) {
                    latestfile = { fileseq, filedate: new Date(year, month - 1, day, hour, minute, second), filename }
                }
            }
        }
        if (latestfile.filename) {
            console.log(`Loading checkpoint seq#=${latestfile.fileseq} from=${latestfile.filename}`)
            const { state_snapshot, ...rest } = await JSON.parse(fs.promises.readFile(dir + '/' + latestfile.filename, 'UTF-8'))

            this.state = FactoryStateManager.deserializeState(state_snapshot)
            return rest
        } else {
            console.log(`No checkpoint found, start from 0`)
            return {}

        }
    }

    async rollForwardState(ctx): Promise<Array<any>> {

        console.log(`rollForwardState: reading 'factory_events' from database from seq#=${this.state.sequence}`)

        await ctx.db.collection("factory_events").createIndex({ sequence: 1 })
        const inflate_events = await ctx.db.collection("factory_events").aggregate(
            [
                { $match: { $and: [{ "partition_key": ctx.tenent.email }, { sequence: { $gt: this.state.sequence } }] } },
                { $sort: { "sequence": 1 } }
            ]
        ).toArray()

        if (inflate_events && inflate_events.length > 0) {
            console.log(`rollForwardState: replaying from seq#=${inflate_events[0].sequence}, to seq#=${inflate_events[inflate_events.length - 1].sequence}  to state`)
            const ret_processor = []
            // HOW??? TODO
            for (let i = 0; i < inflate_events.length; i++) {
                const { _id, partition_key, processor, ...change } = inflate_events[i]
                this.apply_change_events(change)

                if (processor) {
                    ret_processor.push(processor)
                } else {
                    // its find to have a workitem state change that is not controlled by the processor (ie picking)
                    //throw new Error(`Error re-hydrating event record seq#=${change.sequence}, no processor info. Exiting...`)
                }
            }
            return ret_processor
        }
        return null
    }

    async snapshotState(ctx, chkdir: string, processor_snapshot: any): Promise<number> {
        const now = new Date()
        const filename = `${chkdir}/${ctx.tenent.email}/${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${('0' + now.getDate()).slice(-2)}-${('0' + now.getHours()).slice(-2)}-${('0' + now.getMinutes()).slice(-2)}-${('0' + now.getSeconds()).slice(-2)}--${this.state.sequence}.json`
        console.log(`writing movement ${filename}`)
        await fs.promises.writeFile(filename, JSON.stringify({
            state_snapshot: this.serializeState,
            processor_snapshot: processor_snapshot
        }))
        return this.state.sequence
    }
}