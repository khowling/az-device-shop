const assert = require('assert')

import { OrderStateManager } from '../../ordering/orderingState'
import { snapshotState, returnLatestSnapshot, rollForwardState } from '../../util/event_hydrate'

export async function order_state_startup({ db, tenent }) {

    console.log(`order_state_startup (1)`)
    const orderState = new OrderStateManager();

    console.log(`order_state_startup (2):  get latest checkpoint file, return event sequence #, state and processor snapshots`)
    const chkdir = `${process.env.FILEPATH || '.'}/web_checkpoint`
    const { sequence_snapshot, state_snapshot, processor_snapshop } = await returnLatestSnapshot({ tenent }, chkdir)

    // if there is no snapshot, build materialised view from scratch
    var event_seq = sequence_snapshot ? sequence_snapshot : 0
    let lastcheckpoint_seq: number = event_seq
    orderState.stateStore.deserializeState(state_snapshot)

    // get db time, so we know where to continue the watch
    const admin = db.admin()
    const { lastStableCheckpointTimestamp } = await admin.replSetGetStatus()

    console.log(`order_state_startup (3): read events since last checkpoint (seq#=${event_seq}), apply to orderState, ignore order_processor_state`)
    event_seq = await rollForwardState({ tenent, db }, "order_events", event_seq, null, ({ state, processor }) => {
        if (state) {
            process.stdout.write('s')
            orderState.stateStoreApply(state)
        }
    })



    const LOOP_MINS = 10, LOOP_CHANGES = 100
    console.log(`order_state_startup (4): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (c, chkdir) => {
        console.log(`Checkpointing check: seq=${event_seq}, #orders=${orderState.stateStore.state.orders.items.length}, #inv=${orderState.stateStore.state.inventory.length}`)
        if (event_seq > lastcheckpoint_seq + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            await snapshotState(c, chkdir, event_seq, orderState.stateStore.serializeState)
            lastcheckpoint_seq = event_seq
        }
    }, 1000 * 60 * LOOP_MINS, { db, tenent }, chkdir)




    console.log(`order_state_startup (5): start watch for new new "order_events"`)
    var inventoryStreamWatcher = db.collection("order_events").watch(
        [
            { $match: { $and: [{ "operationType": "insert" }, { "fullDocument.partition_key": tenent.email }] } },
            { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
        ],
        { fullDocument: "updateLookup", startAtOperationTime: lastStableCheckpointTimestamp }
    ).on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)

        // spec 
        const { sequence, processor, state } = data.fullDocument
        console.log(`inventoryStreamWatcher : got seq#=${sequence}, processor=${processor !== undefined} state=${state && state.length}`)
        assert(sequence === ++event_seq, `order_state_startup: watch ERROR, expected seq#=${event_seq} got seq=${sequence}`)
        if (state) {
            orderState.stateStoreApply(state)
        }

    })
    console.log(`order_state_startup (6): done, returning orderState`)
    return orderState

}

