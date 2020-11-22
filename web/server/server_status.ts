import { OrderStateManager } from '../../ordering/orderingState'

export async function order_state_startup({ db, tenent }) {

    console.log(`order_state_startup (1)`)

    const orderState = new OrderStateManager();
    const chkdir = `${process.env.FILEPATH || '.'}/order_checkpoint`
    await orderState.applyStateFromSnapshot({ tenent }, chkdir)

    const admin = db.admin()
    const { lastStableCheckpointTimestamp } = await admin.replSetGetStatus()


    await orderState.rollForwardState({ tenent, db })

    //console.log(JSON.stringify({ ...orderState.state.inventory }))


    const inventoryAggregationPipeline = [
        { $match: { $and: [{ "operationType": "insert" }, { "fullDocument.partition_key": tenent.email }] } },
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
    ]

    console.log(`order_state_startup (1)`)

    var inventoryStreamWatcher = db.collection("order_events").watch(
        inventoryAggregationPipeline,
        { fullDocument: "updateLookup", startAtOperationTime: lastStableCheckpointTimestamp }
    )

    console.log(`order_state_startup (1)`)

    inventoryStreamWatcher.on('change', data => {
        //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
        console.log(`inventoryStreamWatcher : ${JSON.stringify(data.fullDocument)}`)
        // spec 

        // data.fullDocument

        orderState.apply_change_events(data.fullDocument)

    })
    console.log(`order_state_startup : returning orderState`)
    return orderState

}

