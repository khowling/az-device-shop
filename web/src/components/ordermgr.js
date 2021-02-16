import React, { useEffect } from 'react'
import { Link } from './router.js'
//import { _fetchit,  _suspenseFetch, _suspenseWrap } from '../utils/fetch'

import { ProgressIndicator, SelectionMode, DetailsList, DetailsListLayoutMode, Stack, Text, Separator, MessageBar, MessageBarType, Label } from '@fluentui/react'


// Replace array entry at index 'index' with 'val'
function imm_splice(array, index, val) { return [...(val ? [val] : []), ...array.slice(0, index), ...array.slice(index + 1)] }
function apply_incset({ method, doc }, val) {
    return {
        ...val, ...Object.keys(doc).map(k => {
            return {
                [k]: method === 'inc' ? doc[k] + val[k] : doc[k]
            }
        }).reduce((a, i) => { return { ...a, ...i } }, {})
    }
}
function stateReducer({ state, metadata }, action) {

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

            const statechanges = action.state
            const _control = statechanges._control

            console.assert(_control && _control.head_sequence === state._control.head_sequence, `applyToLocalState: Panic, cannot apply update head_sequence=${_control && _control.head_sequence} to state at head_sequence=${state._control.head_sequence}`)
            let newstate = { _control: { head_sequence: state._control.head_sequence + 1, lastupdated: _control.lastupdated } }

            for (let stateKey of Object.keys(statechanges)) {
                if (stateKey === '_control') continue
                // get the relevent section of the state
                let reducerKeyState = state[stateKey]

                for (let i = 0; i < statechanges[stateKey].length; i++) {
                    const update = statechanges[stateKey][i]
                    let pathKeyState = update.path ? reducerKeyState[update.path] : reducerKeyState

                    switch (update.method) {
                        case 'inc':
                        case 'set':
                            if (update.filter) { // array
                                console.assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                                const
                                    filter_key = Object.keys(update.filter)[0], filter_val = update.filter[filter_key],
                                    update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)
                                console.assert(update_idx >= 0, `applyToLocalState: Panic applying a "UpdatesMethod.Inc|UpdatesMethod.Set" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                                pathKeyState = imm_splice(pathKeyState, update_idx, apply_incset(update, pathKeyState[update_idx]))

                            } else { // object
                                pathKeyState = apply_incset(update, pathKeyState)
                            }
                            break
                        case 'add':
                            console.assert(Array.isArray(pathKeyState), `applyToLocalState: Cannot apply "UpdatesMethod.Add" to non-Array on "${stateKey}"`)
                            pathKeyState = [...pathKeyState, update.doc]
                            break
                        case 'rm':
                            console.assert(Array.isArray(pathKeyState), `applyToLocalState: Cannot apply "UpdatesMethod.Rm" to non-Array on "${stateKey}"`)
                            console.assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                            const
                                filter_key = Object.keys(update.filter)[0],
                                filter_val = update.filter[filter_key],
                                update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)
                            console.assert(update_idx >= 0, `applyToLocalState: Panic applying a "update" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                            pathKeyState = imm_splice(pathKeyState, update_idx, null)
                            break
                        case 'merge':
                            if (update.filter) { // array
                                console.assert(Object.keys(update.filter).length === 1, `applyToLocalState, filter provided requires exactly 1 key`)
                                const
                                    filter_key = Object.keys(update.filter)[0],
                                    filter_val = update.filter[filter_key],
                                    update_idx = pathKeyState.findIndex(i => i[filter_key] === filter_val)

                                console.assert(update_idx >= 0, `applyToLocalState: Panic applying a "update" on "${stateKey}" to a non-existant document (filter ${filter_key}=${filter_val})`)
                                const new_doc_updates = Object.keys(update.doc).map(k => {
                                    return {
                                        [k]:
                                            update.doc[k] && Object.getPrototypeOf(update.doc[k]).isPrototypeOf(Object) && pathKeyState[update_idx][k] && Object.getPrototypeOf(pathKeyState[update_idx][k]).isPrototypeOf(Object) ?
                                                { ...pathKeyState[update_idx][k], ...update.doc[k] } : update.doc[k]
                                    }
                                }).reduce((a, i) => { return { ...a, ...i } }, {})

                                const new_doc = { ...pathKeyState[update_idx], ...new_doc_updates }
                                pathKeyState = imm_splice(pathKeyState, update_idx, new_doc)
                            } else {
                                console.assert(false, 'applyToLocalState, "UpdatesMethod.Update" requires a filter (its a array operator)')
                            }
                            break
                        default:
                            console.assert(false, `applyToLocalState: Cannot apply update seq=${statechanges._apply.current_head}, unknown method=${update.method}`)
                    }

                    if (update.path) {
                        // if path, the keystate must be a object
                        reducerKeyState = { ...reducerKeyState, [update.path]: pathKeyState }
                    } else {
                        // keystate could be a object or value or array
                        reducerKeyState = pathKeyState
                    }
                }
                newstate[stateKey] = reducerKeyState
            }

            return { state: { ...state, ...newstate }, metadata }
        case 'closed':
            // socket closed, reset state
            return { state: {}, metadata: {} }
        default:
            throw new Error(`unknown action type ${action.type}`);
    }
}

export function OrderMgr({ resource }) {

    const { status, result } = resource.read()
    console.log(`Render: OrderMgr status=${status}`)

    //const inventory = result.data
    const { products } = result.refstores || {},
        refstores = {
            Category: products ? products.Category.map(c => { return { key: c._id, text: c.heading } }) : {},
            Product: products ? products.Product.map(c => { return { key: c._id, text: c.heading, category: c.category } }) : {}
        }


    const [{ state, metadata }, dispatchWorkitems] = React.useReducer(stateReducer, { state: {}, metadata: {} })

    const [message, setMessage] = React.useState({ type: MessageBarType.info, msg: "Not Connected to Order Controller" })


    useEffect(() => {
        // Update the document title using the browser API
        let ws, recordederror = false

        function ws_connect() {

            try {
                const ws_url = process.env.REACT_APP_SERVER_URL ? `ws://${window.location.hostname}:9090/path` : `wss://${window.location.hostname}/ws/ordering/`
                setMessage({ type: MessageBarType.info, msg: `Trying to Connect (${ws_url})....` })
                // async!
                ws = new WebSocket(ws_url)
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

    return (
        <Stack wrap tokens={{ childrenGap: 0, padding: 0 }}>
            <Separator></Separator>
            <h3>Order Operator</h3>
            <Stack tokens={{ childrenGap: 5 /*, padding: 10*/ }}>
                <MessageBar messageBarType={message.type}>{message.msg}</MessageBar>

                <Stack horizontal tokens={{ childrenGap: 30, padding: 10 }} styles={{ root: { background: 'rgb(225, 228, 232)' } }}>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Event Sequence #</h4>
                        <Text variant="superLarge" >{state._control && state._control.head_sequence}</Text>
                        <Text >{state.orders ? state.orders.items.length : 0} orders</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Picking Capacity</h4>
                        <Text variant="superLarge" >{state.picking && state.picking.capacity_allocated}</Text>
                        <Text >available 5</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Order Throughput</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>

                </Stack>

                <Stack horizontal tokens={{ childrenGap: 5, padding: 0 }}>

                    {[[[0, 1, 2], "Pre-Processing"], [[3, 4, 5], "Picking"], [[6], "Shipping"], [[7], "Complete"]].map(([stages, desc], idx) =>
                        <Stack.Item key={idx} align="stretch" grow styles={{ root: { background: 'rgb(225, 228, 232)', padding: 5 } }}>
                            <h4>{desc}</h4>
                            {state.orders && state.orders.items.filter(i => stages.includes(i.status.stage)).map((o, i) =>

                                <Stack key={`${i}-${idx}`} tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>

                                    <Label variant="small">Order Number {o.status.orderId || "<TBC>"}</Label>
                                    {
                                        o.status.failed &&
                                        <MessageBar messageBarType={MessageBarType.severeWarning}>
                                            <Text variant="xSmall">{o.status.message}</Text>
                                        </MessageBar>
                                    }

                                    <Stack horizontal tokens={{ childrenGap: 3 }}>
                                        <Stack tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "40%", backgroundColor: "rgb(255, 244, 206)" } }}>
                                            <Text variant="xSmall">Id: {o.id}</Text>
                                            <Text variant="xSmall">Spec: <Link route="/o" urlid={o.doc_id}><Text variant="xSmall">open</Text></Link></Text>
                                        </Stack>
                                        <Stack tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "59%", backgroundColor: "rgb(255, 244, 206)" } }} >
                                            <Text variant="xSmall">Stage: {metadata.stage_txt[o.status.stage]}</Text>
                                        </Stack>
                                    </Stack>
                                </Stack>
                            )}
                        </Stack.Item>
                    )}
                </Stack>
            </Stack>

            <Separator></Separator>
            <h3>Warehouse Picking</h3>
            <Stack tokens={{ childrenGap: 5 /*, padding: 10*/ }}>
                <Stack horizontal tokens={{ childrenGap: 30, padding: 10 }} styles={{ root: { background: 'rgb(225, 228, 232)' } }}>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Items being Picked</h4>
                        <Text variant="superLarge" >{state.picking && state.picking.items.length}</Text>
                        <Text >waiting {state.picking && state.picking.items.filter(i => i.stage === 0).length}</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Pickers</h4>
                        <Text variant="superLarge" >{state.picking && state.picking.capacity_allocated}</Text>
                        <Text >used {state.picking && state.picking.capacity_allocated} / available 5</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Throughput</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >taget 5 WorkItems/Day</Text>
                    </Stack>

                </Stack>

                <Stack horizontal tokens={{ childrenGap: 5, padding: 0 }}>
                    {[[[0], metadata.factory_txt && metadata.factory_txt[0]], [[1], metadata.factory_txt && metadata.factory_txt[1]], [[2], metadata.factory_txt && metadata.factory_txt[2]]].map(([stages, desc], idx) =>

                        <Stack.Item key={idx} align="stretch" grow styles={{ root: { background: 'rgb(225, 228, 232)', padding: 5 } }}>
                            <h4>{desc}</h4>
                            {state.picking && state.picking.items.filter(i => stages.includes(i.stage)).map((o, i) =>
                                <Stack tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>

                                    <Label variant="small">picking id {o.id || "<TBC>"}</Label>
                                    {
                                        o.failed &&
                                        <MessageBar messageBarType={MessageBarType.severeWarning}>
                                            <Text variant="xSmall">{o.message}</Text>
                                        </MessageBar>
                                    }

                                    <Stack horizontal tokens={{ childrenGap: 3 }}>
                                        <Stack tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "40%", backgroundColor: "rgb(255, 244, 206)" } }}>
                                            <Text variant="xSmall">Id: {o.id}</Text>
                                            <Text variant="xSmall">Stage: {metadata.factory_txt[o.stage]}</Text>
                                            <Text variant="xSmall">acceptedtime: {(new Date(o.acceptedtime)).toLocaleTimeString()}</Text>
                                        </Stack>
                                        <Stack tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "59%", backgroundColor: "rgb(255, 244, 206)" } }} >

                                            <Text variant="xSmall">Wait Time(s): {parseInt(o.waittime / 1000, 10)}</Text>
                                            <ProgressIndicator label={`Progress (${o.progress}%)`} percentComplete={o.progress / 100} barHeight={5} styles={{ itemName: { lineHeight: "noraml", padding: 0, fontSize: "10px" } }} />

                                        </Stack>
                                    </Stack>
                                </Stack>
                            )}
                        </Stack.Item>
                    )}
                </Stack>
            </Stack>

            { state.inventory &&
                [
                    <h3 key='stock'>Stock ({state.inventory.onhand.length})</h3>,
                    <DetailsList key='list'
                        columns={[
                            {
                                key: 'sku',
                                name: 'SKU',
                                fieldName: 'productId',
                                minWidth: 100, maxWidth: 250
                            },
                            {
                                key: 'heading',
                                name: 'Description',
                                fieldName: 'productId',
                                minWidth: 100, maxWidth: 250,
                                onRender: function (i) {
                                    return <div>{refstores.Product.find(x => x.key === i.productId).text}</div>
                                }
                            },
                            {
                                key: 'qty',
                                fieldName: 'qty',
                                name: 'Onhand Stock',
                                minWidth: 100, maxWidth: 250
                            }
                        ]}
                        compact={true}
                        selectionMode={SelectionMode.none}
                        items={state.inventory.onhand}
                        setKey="none"
                        layoutMode={DetailsListLayoutMode.justified}
                        isHeaderVisible={true}
                    />
                ]
            }

        </Stack >
    )
}
