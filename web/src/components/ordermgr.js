import React, { useEffect } from 'react'

import { Link } from './router.js'
//import { _fetchit,  _suspenseFetch, _suspenseWrap } from '../utils/fetch'

import { SelectionMode, DetailsList, DetailsListLayoutMode, Stack, Text, Separator, MessageBar, MessageBarType, Label } from '@fluentui/react'


// Replace array entry at index 'index' with 'val'
function imm_splice(array, index, val) { return [val, ...array.slice(0, index), ...array.slice(index + 1)] }

function orderReducer(state, action) {

    switch (action.type) {
        case 'snapshot':
            // full ordering state
            // sequence: number;
            //  inventory: [{metadata:{}, status:{}}];
            //  orders: [{metadata:{}, status:{}}];
            //  picking_capacity: number;
            //  lastupdated: number;

            return action.state;
        case 'events':
            // array of changes:
            // kind: string;
            // metadata: {
            //     sequence: number
            //     type?: ChangeEventType;
            //     doc_id: string;
            // };
            // status: OrderStatus | InventoryStatus

            const { statechanges, sequence } = action.change
            let ret_state = { ...state, sequence }

            for (let i = 0; i < statechanges.length; i++) {
                const { kind, metadata, status } = statechanges[i]
                const { doc_id, type } = metadata

                switch (kind) {
                    case 'Order':

                        if (type === 1 /* ChangeEventType.UPDATE */) { // // got new Onhand value (replace)
                            const order_idx = ret_state.orders.findIndex(o => o.doc_id === doc_id)
                            if (order_idx >= 0) {
                                const existing_order = ret_state.orders[order_idx]
                                ret_state.orders = imm_splice(ret_state.orders, order_idx, { ...existing_order, status: { ...existing_order.status, ...status } })
                            } else {
                                console.error(`Cannot find existing ${kind} with doc_id=${doc_id}`)
                            }
                        } else if (type === 0 /* ChangeEventType.CREATE */) { // // got new Inventory onhand (additive)
                            ret_state.orders = ret_state.orders.concat({ doc_id, status })
                        }
                        break
                    case 'Inventory':
                        const existing_idx = ret_state.inventory.findIndex(i => i.doc_id === doc_id)

                        if (type === 1 /* ChangeEventType.UPDATE */) { // // got new Onhand value (replace)
                            if (existing_idx < 0) {
                                console.error(`Cannot find existing ${kind} with doc_id=${doc_id}`)
                            } else {
                                // got new Onhand value (replace)
                                ret_state.inventory = imm_splice(ret_state.inventory, existing_idx, { doc_id, status })
                            }
                        } else if (type === 0 /* ChangeEventType.CREATE */) { // // got new Inventory onhand (additive)
                            // got new Inventory onhand (additive)
                            if (existing_idx < 0) {
                                ret_state.inventory = ret_state.inventory.concat({ doc_id, status })
                            } else {
                                console.log(`got new inventory existing_idx=${existing_idx}`)
                                ret_state.inventory = imm_splice(ret_state.inventory, existing_idx, { doc_id, status: { onhand: (ret_state.inventory[existing_idx].status.onhand + status.onhand) } })
                            }
                        }
                        break
                    default:
                        console.warn(`Error, unknown kind ${kind}`)
                }
            }

            return ret_state
        case 'closed':
            // socket closed, reset state
            return { sequence: 0, inventory: [], orders: [] }
        default:
            throw new Error(`unknown action type ${action.type}`);
    }
}

export function OrderMgr({ resource }) {

    const { status, result } = resource.read()
    console.log(`Render: OrderMgr status=${status}`)

    //const inventory = result.data
    const { products } = result.refstores

    const [order_state, dispatchWorkitems] = React.useReducer(orderReducer, { sequence: 0, inventory: [], orders: [] })

    const [message, setMessage] = React.useState({ type: MessageBarType.info, msg: "Not Connected to Order Controller" })


    useEffect(() => {
        // Update the document title using the browser API
        let ws, recordederror = false

        function ws_connect() {

            try {
                setMessage({ type: MessageBarType.info, msg: `Trying to Connect....` })
                // async!
                ws = new WebSocket(`ws://${window.location.hostname}:9090/path`)
                ws.onopen = (e) => {
                    setMessage({ type: MessageBarType.success, msg: `Connected to Order Controller` })
                }
                ws.onerror = (e) => {
                    recordederror = true
                    setMessage({ type: MessageBarType.error, msg: `Failed to connect to Order Controller` })
                    setTimeout(ws_connect, 5000)
                }
                ws.onclose = () => {
                    if (!recordederror) {
                        dispatchWorkitems({ type: "closed" })
                        setMessage({ type: MessageBarType.warning, msg: `Not Connected` })
                        setTimeout(ws_connect, 5000)
                    }
                }
                ws.onmessage = (e) => {
                    console.log(`dispatching message from server ${e.data}`);
                    var msg = JSON.parse(e.data)
                    dispatchWorkitems(msg)
                    //console.log(msg)
                }
            } catch (e) {
                setMessage({ type: MessageBarType.severeWarning, msg: `Cannot Connect to Order Controller : ${e}` })
            }
        }
        ws_connect()

        return function cleanup() {
            console.log(`cleaning up ws : ${ws}`)
            if (ws) ws.close()
        }
    }, [])

    const stage_txt = ['NewRequiredOrder', 'InventoryAllocated', 'OrderNumberGenerated', 'Picking', 'Shipping', 'Complete']

    function OrderDisplay(o, idx) {

        return (
            <Stack key={idx} tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>

                <Label variant="small">Order Number {o.status.order_number || "<TBC>"}</Label>
                {
                    o.status.failed &&
                    <MessageBar messageBarType={MessageBarType.severeWarning}>
                        <Text variant="xSmall">{o.status.message}</Text>
                    </MessageBar>
                }

                <Stack horizontal tokens={{ childrenGap: 3 }}>
                    <Stack tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "rgb(255, 244, 206)" } }}>


                        <Text variant="xSmall">Spec: <Link route="/o" urlid={o.doc_id}><Text variant="xSmall">open</Text></Link></Text>

                    </Stack>
                    <Stack tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "rgb(255, 244, 206)" } }} >

                        <Text variant="xSmall">Stage: {stage_txt[o.status.stage]}</Text>

                    </Stack>
                </Stack>
            </Stack>
        )
    }


    return (
        <Stack wrap tokens={{ childrenGap: 0, padding: 0 }}>
            <Separator></Separator>
            <h3>Order Operator</h3>
            <Stack tokens={{ childrenGap: 5 /*, padding: 10*/ }}>
                <MessageBar messageBarType={message.type}>{message.msg}</MessageBar>

                <Stack horizontal tokens={{ childrenGap: 30, padding: 10 }} styles={{ root: { background: 'rgb(225, 228, 232)' } }}>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Event Sequence #</h4>
                        <Text variant="superLarge" >{order_state.sequence}</Text>
                        <Text >tracked skus {order_state.inventory.length} / orders {order_state.orders.length}</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Waiting Orders</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Order Throughput</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>

                </Stack>

                <Stack horizontal tokens={{ childrenGap: 5, padding: 0 }}>

                    {[[2, "Processing"], [3, stage_txt[3]], [4, stage_txt[4]], [5, stage_txt[5]]].map(([stage_idx, desc], idx) => {
                        return (
                            <Stack
                                key={stage_idx}
                                tokens={{ childrenGap: 8, padding: 8 }}
                                styles={{
                                    root: {
                                        background: 'rgb(225, 228, 232)',
                                        width: '100%',
                                    }
                                }} >
                                <h4>{desc}</h4>
                                {order_state.orders && order_state.orders.filter(i => i.status.stage === stage_idx || (idx === 0 && i.status.stage < stage_idx)).map(OrderDisplay)}
                            </Stack>
                        )

                    })
                    }

                </Stack>
            </Stack>


            <h3>Stock ({order_state.inventory.length})</h3>
            <DetailsList
                columns={[
                    {
                        key: 'heading',
                        name: 'SKU',
                        fieldName: 'doc_id',
                        minWidth: 100, maxWidth: 250,
                        onRender: (i) => <div>{products.Product.find(x => x._id === i.doc_id).heading}</div>
                    },
                    {
                        key: 'oh',
                        name: 'Available Units',
                        minWidth: 100, maxWidth: 250,
                        onRender: (i) => <div>{i.status.onhand}</div>
                    }
                ]}
                compact={true}
                selectionMode={SelectionMode.none}
                items={order_state.inventory}
                setKey="none"
                layoutMode={DetailsListLayoutMode.justified}
                isHeaderVisible={true}
            />

        </Stack >
    )
}
