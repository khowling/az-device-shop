const assert = require('assert')

import { OrderStateManager } from '../../ordering/orderingState'
import { StateConnection } from '../../util/stateConnection'
import { snapshotState, restoreState } from '../../util/event_hydrate'

export async function order_state_startup({ db, tenent }) {

    console.log(`order_state_startup (1)`)
    const cs = await new StateConnection(null, 'order_events').initFromDB(db, tenent)

    const orderState = new OrderStateManager('emeaorder_v0', cs)

    // get db time, so we know where to continue the watch
    const admin = db.admin()
    const { lastStableCheckpointTimestamp } = await admin.replSetGetStatus()

    const chkdir = `${process.env.FILEPATH || '.'}/web_checkpoint`
    let [restore_sequence, last_checkpoint] = await restoreState(cs, chkdir, [
        orderState.stateStore
    ])
    cs.sequence = restore_sequence



    const LOOP_MINS = 10, LOOP_CHANGES = 100
    console.log(`order_state_startup (4): starting checkpointing loop (LOOP_MINS=${LOOP_MINS}, LOOP_CHANGES=${LOOP_CHANGES})`)
    // check every 5 mins, if there has been >100 transations since last checkpoint, then checkpoint
    setInterval(async (cs, chkdir) => {
        console.log(`Checkpointing check: seq=${cs.sequence}, #orders=${orderState.stateStore.state.orders.items.length}, #inv=${orderState.stateStore.state.inventory.length}`)
        if (cs.sequence > last_checkpoint + LOOP_CHANGES) {
            console.log(`do checkpoint`)
            last_checkpoint = await snapshotState(cs, chkdir, [
                orderState.stateStore
            ])
        }
    }, 1000 * 60 * LOOP_MINS, cs, chkdir)




    console.log(`order_state_startup (5): start watch for new new "order_events"`)
    var inventoryStreamWatcher = cs.db.collection(cs.collection).watch(
        [
            { $match: { $and: [{ "operationType": "insert" }, { "fullDocument.partition_key": cs.tenent.email }] } },
            { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
        ],
        { fullDocument: "updateLookup", startAtOperationTime: lastStableCheckpointTimestamp }
    ).on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)

        const changes = data.fullDocument[orderState.name]

        if (changes) {
            console.log(`inventoryStreamWatcher : got seq#=, processor= state=`)
            orderState.stateStoreApply(changes)
        }

    })
    console.log(`order_state_startup (6): done, returning orderState`)
    return orderState

}

