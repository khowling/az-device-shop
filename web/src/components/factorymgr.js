import React, { useState, useEffect } from 'react'
import { Link } from './router.js'

import { _fetchit, _suspenseFetch, _suspenseWrap } from '../utils/fetch'
import { /*DetailsListLayoutMode, SelectionMode, DetailsList,*/ ProgressIndicator, Label, PrimaryButton, DefaultButton, Separator, MessageBar, MessageBarType, Panel, PanelType, Slider, Dropdown, Stack, Text } from '@fluentui/react'

function WorkItem({ resource, dismissPanel, refstores }) {
    const { status, result } = resource.read()
    console.log(status)


    const [error, setError] = useState(null)

    const [input, handleInputChange] = useState({
        'qty': result.qty,
        'status': result.status || "Required",
        'category': result.category,
        'product': result.product,
        'price': result.price,
        'warehouse': result.warehouse
    })

    function _onChange(e, val) {
        handleInputChange({
            ...input,
            [e.target.name]: val
        })
    }

    function _save() {
        setError(null)
        _fetchit('/api/store/inventory', 'POST', {}, result._id ? { _id: result._id, ...input } : input).then(succ => {
            console.log(`created success : ${JSON.stringify(succ)}`)
            //navTo("/MyBusiness")
            dismissPanel()
        }, err => {
            console.error(`created failed : ${err}`)
            setError(`created failed : ${err}`)
        })
    }

    return (
        <Stack tokens={{ childrenGap: 15 }} styles={{ root: { width: 300 } }}>

            <Dropdown label="Category" defaultSelectedKey={input.category} onChange={(e, i) => _onChange({ target: { name: "category" } }, i.key)} options={refstores.Category} />
            <Dropdown label="Product" defaultSelectedKey={input.product} onChange={(e, i) => _onChange({ target: { name: "product" } }, i.key)} options={refstores.Product.filter(x => x.category === input.category)} />

            <Slider
                label="Number to build"
                min={0}
                max={1000}
                step={10}
                defaultValue={input.qty}
                showValue={true}
                onChange={(val) => _onChange({ target: { name: "qty" } }, val)}
                snapToStep
            />

            <Dropdown label="Warehouse" defaultSelectedKey={input.warehouse} onChange={(e, i) => _onChange({ target: { name: "warehouse" } }, i.key)} options={[{ key: "emea", text: "EMEA" }, { key: "america", text: "Americas" }, { key: "asia", text: "ASIA" }]} />



            <Dropdown label="Status" defaultSelectedKey={input.status} onChange={(e, i) => _onChange({ target: { name: "status" } }, i.key)} options={[{ key: "Required", text: "Required" }, { key: "Draft", text: "Draft" }]} />

            {error &&
                <MessageBar messageBarType={MessageBarType.error} isMultiline={false} truncated={true}>
                    {error}
                </MessageBar>
            }
            <Stack horizontal tokens={{ childrenGap: 5 }}>
                <PrimaryButton text="Save" onClick={_save} allowDisabledFocus disabled={false} />
                <DefaultButton text="Cancel" onClick={dismissPanel} allowDisabledFocus disabled={false} />
            </Stack>

        </Stack>
    )
}

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

            const statechanges = action.state
            let newstate = { ...current.state, factory_sequence: current.state.factory_sequence + 1 }

            for (let i = 0; i < statechanges.length; i++) {
                const { kind, metadata, status } = statechanges[i]

                if (!(metadata.next_sequence && metadata.next_sequence === newstate.factory_sequence)) {
                    throw new Error(`Cannot apply change sequence ${metadata.next_sequence}, expecting ${newstate.factory_sequence}`)
                }

                switch (kind) {
                    case 'Workitem': {
                        const { doc_id, type } = metadata
                        if (type === 1 /* ChangeEventType.UPDATE */) { // // got new Onhand value (replace)
                            const order_idx = newstate.workitems.findIndex(o => o.doc_id === doc_id)
                            if (order_idx >= 0) {
                                const existing_order = newstate.workitems[order_idx]
                                newstate.workitems = imm_splice(newstate.workitems, order_idx, { ...existing_order, status: { ...existing_order.status, ...status } })
                            } else {
                                console.error(`Cannot find existing ${kind} with doc_id=${doc_id}`)
                            }
                        } else if (type === 0 /* ChangeEventType.CREATE */) { // // got new Inventory onhand (additive)
                            newstate.workitems = newstate.workitems.concat({ doc_id, status })
                        }
                        break
                    }
                    case "FactoryUpdate": {
                        const { type } = metadata
                        if (status.sequence_update && type === 3 /*ChangeEventType.INC*/) {
                            newstate.workitem_sequence = newstate.workitem_sequence + status.sequence_update
                        } else if (status.allocated_update && type === 1 /*ChangeEventType.UPDATE*/) { // // got new Onhand value (replace)
                            newstate.capacity_allocated = newstate.capacity_allocated + status.allocated_update
                        } else {
                            throw new Error(`apply_change_events, only support updates on ${kind}`)
                        }
                        break
                    }
                    default:
                        console.warn(`Error, unknown kind ${kind}`)
                }
            }

            return { state: newstate, metadata: current.metadata }
        case 'closed':
            // socket closed, reset state
            return { state: { factory_sequence: 0, lastupdated: null, capacity_allocated: 0, workitem_sequence: 0, workitems: [] }, metadata: {} }
        default:
            throw new Error(`unknown action type ${action.type}`);
    }
}



export function Inventory({ resource }) {

    const { status, result } = resource.read()
    console.log(status)

    const inventory = result.data
    const { products } = result.refstores,
        refstores = {
            Category: products.Category.map(c => { return { key: c._id, text: c.heading } }),
            Product: products.Product.map(c => { return { key: c._id, text: c.heading, category: c.category } })
        }

    const [{ state, metadata }, dispatchWorkitems] = React.useReducer(stateReducer, { state: { factory_sequence: 0, lastupdated: null, capacity_allocated: 0, workitem_sequence: 0, workitems: [] }, metadata: {} })

    const [panel, setPanel] = React.useState({ open: false })
    const [message, setMessage] = React.useState({ type: MessageBarType.info, msg: "Not Connected to Factory Controller" })

    function openWorkItem(editid) {
        setPanel({ open: true, refstores, resource: editid ? _suspenseFetch('store/inventory', editid) : _suspenseWrap({}) })
    }
    function dismissPanel() {
        setPanel({ open: false })
    }


    useEffect(() => {
        // Update the document title using the browser API
        let ws, recordederror = false

        function ws_connect() {
            try {
                setMessage({ type: MessageBarType.info, msg: `Trying to Connect....` })
                // async!
                ws = new WebSocket(`ws://${window.location.hostname}:9091/path`)
                ws.onopen = (e) => {
                    setMessage({ type: MessageBarType.success, msg: `Connected to Factory Controller` })
                }
                ws.onerror = (e) => {
                    recordederror = true
                    setMessage({ type: MessageBarType.error, msg: `Failed to connect to Factory Controller` })
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
                setMessage({ type: MessageBarType.severeWarning, msg: `Cannot Connect to Factory Controller : ${e}` })
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
            <Stack tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>

                <Label variant="small">Workitem Number {o.status.workitem_number || "<TBC>"}</Label>
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
                                <Text variant="xSmall">Status: {metadata.factory_txt[o.status.factory_status.stage]}</Text>,
                                <Text variant="xSmall">Wait Time(s): {parseInt(o.status.factory_status.waittime / 1000, 10)}</Text>,
                                <ProgressIndicator label={`Progress (${o.status.factory_status.progress}%)`} percentComplete={o.status.factory_status.progress / 100} barHeight={5} styles={{ itemName: { lineHeight: "noraml", padding: 0, fontSize: "10px" } }} />
                            ]
                        }
                    </Stack>
                </Stack>
            </Stack>
        )
    }


    return (
        <Stack wrap tokens={{ childrenGap: 0, padding: 0 }}>

            <Panel
                headerText="New Inventory Request"
                isOpen={panel.open}
                onDismiss={dismissPanel}
                type={PanelType.medium}
                // You MUST provide this prop! Otherwise screen readers will just say "button" with no label.
                closeButtonAriaLabel="Close"
            >
                {panel.open &&
                    <WorkItem dismissPanel={dismissPanel} refstores={panel.refstores} resource={panel.resource} />
                }
            </Panel>


            <Separator></Separator>
            <h3>Factory Operator</h3>
            <Stack tokens={{ childrenGap: 5 /*, padding: 10*/ }}>
                <MessageBar messageBarType={message.type}>{message.msg}</MessageBar>

                <Stack horizontal tokens={{ childrenGap: 30, padding: 10 }} styles={{ root: { background: 'rgb(225, 228, 232)' } }}>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Event Sequence #</h4>
                        <Text variant="superLarge" >{state.factory_sequence}</Text>
                        <Text >workitems {state.workitems.length}</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Factory Capacity</h4>
                        <Text variant="superLarge" >{state.capacity_allocated}</Text>
                        <Text >used {state.capacity_allocated} / available 5</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Workitem Throughput</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>

                </Stack>

                <Stack horizontal tokens={{ childrenGap: 5, padding: 0 }}>

                    {[[[0, 1, 2], "Processing"], [[3, 4], "In Factory"], [[5], metadata.stage_txt && metadata.stage_txt[5]], [[6], metadata.stage_txt && metadata.stage_txt[6]]].map(([stages, desc], idx) => {

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
                                { state.workitems && state.workitems.filter(i => stages.includes(i.status.stage)).map((o, i) => <ItemDisplay key={i} o={o} i={i} idx={idx} metadata={metadata} />)}
                            </Stack>
                        )

                    })
                    }

                </Stack>
            </Stack>
            <DefaultButton iconProps={{ iconName: 'Add' }} text="Create Intentory" styles={{ root: { width: 180 } }} onClick={() => openWorkItem()} />

        </Stack>
    )
}
