const assert = require('assert')

import { OrderStateManager } from '../../ordering/orderingState'
import { EventStoreConnection } from '../../common/eventStoreConnection'
import { startCheckpointing, restoreState } from '../../common/event_hydrate'

export async function order_state_startup({ db, tenent }) {

    console.log(`orderingFollower (1): Create "EventStoreConnection" and "OrderStateManager"`)
    const cs = await new EventStoreConnection(null, 'order_events').initFromDB(db, tenent)
    const orderState = new OrderStateManager('ordemea_v01', cs)

    // get db time, so we know where to continue the watch
    //const admin = db.admin()
    //const continuation = { startAtOperationTime: (await admin.replSetGetStatus()).lastStableCheckpointTimestamp } // rs.status()


    const chkdir = `${process.env.FILEPATH || '.'}/web_checkpoint`
    let last_checkpoint = await restoreState(cs, chkdir, [
        orderState.stateStore
    ])
    console.log(`orderingProcessor (4): Restored "${cs.collection}" to sequence=${cs.sequence},  "orderState" restored state to head_sequence=${orderState.stateStore.state._control.head_sequence}  #orders=${orderState.stateStore.state.orders.items.length} #onhand=${orderState.stateStore.state.inventory.onhand.length}`)

    const cpInterval = startCheckpointing(cs, chkdir, last_checkpoint, [
        orderState.stateStore
    ])

    console.log(`orderingFollower (5):  start watch "${cs.collection}" (filter watch to sequence>${cs.sequence}) continuation=${/*continuation*/null}`)

    const continuation = cs.sequence && { startAtOperationTime: await db.collection(cs.collection).findOne({ sequence: cs.sequence })._ts }
    var inventoryStreamWatcher = cs.db.collection(cs.collection).watch(
        [
            // https://docs.microsoft.com/en-us/azure/cosmos-db/mongodb/change-streams?tabs=javascript#current-limitations
            { $match: { $and: [{ 'operationType': { $in: ['insert'].concat(process.env.USE_COSMOS ? ['update', 'replace'] : []) } }, { 'fullDocument.partition_key': cs.tenentKey }, { 'fullDocument.sequence': { $gt: cs.sequence } }] } },
            { $project: { '_id': 1, 'fullDocument': 1, 'ns': 1, 'documentKey': 1 } }
        ],
        { fullDocument: 'updateLookup', ...(continuation && { ...continuation }) }
    ).on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)

        const changes = data.fullDocument[orderState.name]

        if (changes) {
            console.log(`inventoryStreamWatcher : got seq#=, processor= state=`)
            orderState.stateStoreApply(changes)
        }

    })
    console.log(`orderingFollower (6): done, returning orderState`)
    return orderState

}

