import React, { useEffect } from 'react'
import { Link } from './router.js'
//import { _fetchit,  _suspenseFetch, _suspenseWrap } from '../utils/fetch'

import { ProgressIndicator, SelectionMode, DetailsList, DetailsListLayoutMode, Stack, Text, Separator, MessageBar, MessageBarType, Label } from '@fluentui/react'


// Replace array entry at index 'index' with 'val'
function imm_splice(array, index, val) { return [val, ...array.slice(0, index), ...array.slice(index + 1)] }

function stateReducer(current, action) {

    switch (action.type) {
        case 'snapshot':
            return { state: action.state, metadata: action.metadata }
        case 'events':
            // array of changes:
            // kind: string;
            // metadata: {
            //     sequence: number
            //     type?: ChangeEventType;
            //     doc_id: string;
            // };
            // status: OrderStatus | InventoryStatus

            const statechanges = action.change
            let newstate = { ...current.state, ordering_sequence: current.state.ordering_sequence + 1 }

            for (let i = 0; i < statechanges.length; i++) {
                const { kind, metadata, status } = statechanges[i]

                if (!(metadata.next_sequence && metadata.next_sequence === newstate.ordering_sequence)) {
                    throw new Error(`Cannot apply change sequence ${metadata.next_sequence}, expecting ${newstate.ordering_sequence}`)
                }

                switch (kind) {
                    case 'Order': {
                        const { doc_id, type } = metadata
                        if (type === 1 /* ChangeEventType.UPDATE */) { // // got new Onhand value (replace)
                            const order_idx = newstate.orders.findIndex(o => o.doc_id === doc_id)
                            if (order_idx >= 0) {
                                const existing_order = newstate.orders[order_idx]
                                newstate.orders = imm_splice(newstate.orders, order_idx, { ...existing_order, status: { ...existing_order.status, ...status } })
                            } else {
                                console.error(`Cannot find existing ${kind} with doc_id=${doc_id}`)
                            }
                        } else if (type === 0 /* ChangeEventType.CREATE */) { // // got new Inventory onhand (additive)
                            newstate.orders = newstate.orders.concat({ doc_id, status })
                        }
                        break
                    }
                    case 'Inventory': {
                        const { doc_id, type } = metadata
                        const existing_idx = newstate.inventory.findIndex(i => i.doc_id === doc_id)

                        if (type === 1 /* ChangeEventType.UPDATE */) { // // got new Onhand value (replace)
                            if (existing_idx < 0) {
                                console.error(`Cannot find existing ${kind} with doc_id=${doc_id}`)
                            } else {
                                // got new Onhand value (replace)
                                newstate.inventory = imm_splice(newstate.inventory, existing_idx, { doc_id, status })
                            }
                        } else if (type === 0 /* ChangeEventType.CREATE */) { // // got new Inventory onhand (additive)
                            // got new Inventory onhand (additive)
                            if (existing_idx < 0) {
                                newstate.inventory = newstate.inventory.concat({ doc_id, status })
                            } else {
                                console.log(`got new inventory existing_idx=${existing_idx}`)
                                newstate.inventory = imm_splice(newstate.inventory, existing_idx, { doc_id, status: { onhand: (newstate.inventory[existing_idx].status.onhand + status.onhand) } })
                            }
                        }
                        break
                    }
                    case "OrderingUpdate":
                        const { type } = metadata

                        if (status.sequence_update && type === 3 /*ChangeEventType.INC*/) {
                            newstate.order_sequence = newstate.order_sequence + status.sequence_update
                        } else if (status.allocated_update && type === 1 /*ChangeEventType.UPDATE*/) { // // got new Onhand value (replace)
                            newstate.picking_allocated = newstate.picking_allocated + status.allocated_update
                        } else {
                            throw new Error(`apply_change_events, Unsupported OrderingUpdate`)
                        }
                        break
                    default:
                        console.warn(`Error, unknown kind ${kind}`)
                }
            }

            return { state: newstate, metadata: current.metadata }
        case 'closed':
            // socket closed, reset state
            return { state: { ordering_sequence: 0, lastupdated: null, picking_allocated: 0, inventory: [], order_sequence: 0, orders: [] }, metadata: {} }
        default:
            throw new Error(`unknown action type ${action.type}`);
    }
}

export function OrderMgr({ resource }) {

    const { status, result } = resource.read()
    console.log(`Render: OrderMgr status=${status}`)

    //const inventory = result.data
    const { products } = result.refstores

    const [{ state, metadata }, dispatchWorkitems] = React.useReducer(stateReducer, { state: { ordering_sequence: 0, lastupdated: null, picking_allocated: 0, inventory: [], order_sequence: 0, orders: [] }, metadata: {} })

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


    function ItemDisplay({ o, i, idx, metadata }) {
        return (
            <Stack key={`${i}-${idx}`} tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>

                <Label variant="small">Order Number {o.status.order_number || "<TBC>"}</Label>
                {
                    o.status.failed &&
                    <MessageBar messageBarType={MessageBarType.severeWarning}>
                        <Text variant="xSmall">{o.status.message}</Text>
                    </MessageBar>
                }

                <Stack horizontal tokens={{ childrenGap: 3 }}>
                    <Stack tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "40%", backgroundColor: "rgb(255, 244, 206)" } }}>
                        <Text variant="xSmall">Spec: <Link route="/o" urlid={o.doc_id}><Text variant="xSmall">open</Text></Link></Text>
                    </Stack>
                    <Stack tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "59%", backgroundColor: "rgb(255, 244, 206)" } }} >

                        {idx !== 1 ?
                            <Text variant="xSmall">Stage: {metadata.stage_txt[o.status.stage]}</Text>
                            :
                            [
                                <Text variant="xSmall">Status: {["Waiting", "Picking", "Complete"][o.status.picking.status]}</Text>,
                                <Text variant="xSmall">Wait Time(s): {parseInt(o.status.picking.waittime / 1000, 10)}</Text>,
                                <ProgressIndicator label={`Progress (${o.status.picking.progress}%)`} percentComplete={o.status.picking.progress / 100} barHeight={5} styles={{ itemName: { lineHeight: "noraml", padding: 0, fontSize: "10px" } }} />
                            ]
                        }
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
                        <Text variant="superLarge" >{state.ordering_sequence}</Text>
                        <Text >tracked skus {state.inventory.length} / orders {state.orders.length}</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Picking Capacity</h4>
                        <Text variant="superLarge" >{state.picking_allocated}</Text>
                        <Text >used {state.picking_allocated} / available 5</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Order Throughput</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>

                </Stack>

                <Stack horizontal tokens={{ childrenGap: 5, padding: 0 }}>

                    {[[[0, 1, 2], "Processing"], [[3, 4], "Picking"], [[5], "Shipping"], [[6], "Complete"]].map(([stages, desc], idx) => {

                        return (
                            <Stack
                                key={idx}
                                tokens={{ childrenGap: 8, padding: 8 }}
                                styles={{
                                    root: {
                                        background: 'rgb(225, 228, 232)',
                                        width: '100%',
                                    }
                                }} >
                                <h4>{desc}</h4>
                                { state.orders && state.orders.filter(i => stages.includes(i.status.stage)).map((o, i) => <ItemDisplay o={o} i={i} idx={idx} metadata={metadata} />)}
                            </Stack>
                        )

                    })
                    }

                </Stack>
            </Stack>


            <h3>Stock ({state.inventory.length})</h3>
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
                items={state.inventory}
                setKey="none"
                layoutMode={DetailsListLayoutMode.justified}
                isHeaderVisible={true}
            />

        </Stack >
    )
}
