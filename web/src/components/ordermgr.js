import React, { useEffect } from 'react'

import { Link } from './router.js'
//import { _fetchit,  _suspenseFetch, _suspenseWrap } from '../utils/fetch'

import { DetailsList, DetailsListLayoutMode, Stack, Text, Separator, MessageBar, MessageBarType, Label } from '@fluentui/react'


function apply(array, event) {
    const doc_id = event.metadata.doc_id
    const existing_idx = doc_id ? array.findIndex(o => o.metadata.doc_id === doc_id) : -1
    if (existing_idx >= 0) {
        return [...array.slice(0, existing_idx), event, ...array.slice(existing_idx + 1)]
    } else {
        return array.concat(event)
    }
}

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

            let ret_state = { ...state }

            if (action.changes && action.changes.length > 0) {

                for (let i = 0; i < action.changes.length; i++) {
                    const event = action.changes[0]
                    switch (event.kind) {
                        case 'Order':
                            ret_state.orders = apply(ret_state.orders, { metadata: event.metadata, status: event.status })
                            break
                        case 'Inventory':
                            ret_state.inventory = apply(ret_state.inventory, { metadata: event.metadata, status: event.status })
                            break
                        default:
                            console.warn(`Error, unknown kind ${event.kind}`)
                    }
                }
            } else {
                console.warn('error, got no events')
            }
            return ret_state
        case 'closed':
            // socket closed, reset state
            return { sequence: -1, inventory: [], orders: [] }
        default:
            throw new Error(`unknown action type ${action.type}`);
    }
}

export function OrderMgr({ resource }) {

    const { status, result } = resource.read()
    console.log(status)

    //const inventory = result.data
    const { products } = result.refstores,
        refstores = {
            Category: products.Category.map(c => { return { key: c._id, text: c.heading } }),
            Product: products.Product.map(c => { return { key: c._id, text: c.heading, category: c.category } })
        }

    const [order_state, dispatchWorkitems] = React.useReducer(orderReducer, { sequence: -1, inventory: [], orders: [] })

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
                    console.log(msg)
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
                        <Label >Spec:</Label>

                        <Text variant="xSmall">Full details: <Link route="/o" urlid={o.metadata.doc_id}><Text variant="xSmall">open</Text></Link></Text>

                    </Stack>
                    <Stack tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "rgb(255, 244, 206)" } }} >
                        <Label>Status:</Label>
                        <Text variant="xSmall">{stage_txt[o.status.stage]}</Text>
                        <Text variant="xSmall">Wait Time : {o.status.waittime / 1000}</Text>
                        <Text variant="xSmall">Progess (%) : {o.status.progress}</Text>
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
                        <h4>Picking Capacity</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
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

            <Separator></Separator>
            <h3>Stock ({order_state.inventory.length})</h3>
            <DetailsList
                columns={[
                    {
                        key: 'heading',
                        name: 'SKU',
                        fieldName: 'metadata',
                        minWidth: 100, maxWidth: 250,
                        onRender: (i) => <div>{products.Product.find(x => x._id === i.metadata.doc_id).heading}</div>
                    },
                    {
                        key: 'oh',
                        name: 'Available Units',
                        minWidth: 100, maxWidth: 250,
                        onRender: (i) => <div>{i.status.onhand}</div>
                    }
                ]}
                compact={false}
                items={order_state.inventory}
                setKey="none"
                layoutMode={DetailsListLayoutMode.justified}
                isHeaderVisible={true}
            />

        </Stack >
    )
}
