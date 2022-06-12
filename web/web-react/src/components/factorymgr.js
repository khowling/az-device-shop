import React, { useState, useEffect } from 'react'
import { Link } from './router.js'

import { _fetchit, _suspenseFetch, _suspenseWrap } from '../utils/fetch.js'
import {  ProgressIndicator, Label, PrimaryButton, DefaultButton, Separator, MessageBar, MessageBarType, Panel, PanelType, Slider, Dropdown, Stack, Text } from '@fluentui/react'
import { stateReducer } from '../utils/stateStore.js'

function WorkItem({ resource, dismissPanel, refstores }) {
    const { status, result } = resource.read()
    console.log(status)


    const [error, setError] = useState(null)

    const [inventory, setInventory] = useState({
        
        'status': result.status || "Required",
        'product_ref': result.product_ref,
        'category_ref': result.category_ref,
        'warehouse': result.warehouse,
        'qty': result.qty
    })

    function _onChange(e, val) {
        setInventory({
            ...inventory,
            [e.target.name]: val
        })
    }

    function _save() {
        setError(null)
        _fetchit('/api/store/inventory', 'POST', {}, result._id ? { _id: result._id, ...inventory } : inventory).then(succ => {
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

            <Dropdown label="Category" defaultSelectedKey={inventory.category_ref && inventory.category_ref._id} onChange={(e, i) => _onChange({ target: { name: "category_ref" } }, {_id:i.key})} options={refstores.Category} />
            <Dropdown label="Product" defaultSelectedKey={inventory.product_ref && inventory.product_ref._id} onChange={(e, i) => _onChange({ target: { name: "product_ref" } }, {_id:i.key})} options={refstores.Product.filter(p => inventory.category_ref && p.category_ref && p.category_ref._id === inventory.category_ref._id)} />

            <Slider
                label="Number to build"
                min={1}
                max={20}
                step={1}
                defaultValue={inventory.qty}
                showValue={true}
                onChange={(val) => _onChange({ target: { name: "qty" } }, val)}
                snapToStep
            />

            <Dropdown label="Warehouse" defaultSelectedKey={inventory.warehouse} onChange={(e, i) => _onChange({ target: { name: "warehouse" } }, i.key)} options={[{ key: "emea", text: "EMEA" }, { key: "america", text: "Americas" }, { key: "asia", text: "ASIA" }]} />



            <Dropdown label="Status" defaultSelectedKey={inventory.status} onChange={(e, i) => _onChange({ target: { name: "status" } }, i.key)} options={[{ key: "Required", text: "Required" }, { key: "Draft", text: "Draft" }]} />

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


export function Inventory({ resource }) {

    const { status, result } = resource.read()
    //console.log(status)

    const inventory = result.data
    const { products } = result.refstores || {},
        refstores = {
            Category: products ? products.Category.map(c => { return { key: c._id, text: c.heading } }) : {},
            Product: products ? products.Product.map(c => { return { key: c._id, text: c.heading, category_ref: c.category_ref }}) : {}
        }

    const [{ state, metadata }, dispatchWorkitems] = React.useReducer(stateReducer, { state: {}, metadata: {} })

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
                const ws_url = process.env.REACT_APP_FACTORY_PORT ? `ws://${window.location.hostname}:${process.env.REACT_APP_FACTORY_PORT}/path` : `wss://${window.location.hostname}/ws/factory/`
                setMessage({ type: MessageBarType.info, msg: `Trying to Connect (${ws_url})....` })
                // async!
                ws = new WebSocket(ws_url)
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
                    //console.log(`dispatching message from server ${e.data}`);
                    var msg = JSON.parse(e.data)
                    dispatchWorkitems(msg)
                    //console.log(msg)
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

            <MessageBar messageBarType={message.type}>{message.msg}</MessageBar>
            <Separator></Separator>
            <h3>Inventory Request Status</h3>
            <Stack tokens={{ childrenGap: 5 /*, padding: 10*/ }}>


                <Stack horizontal tokens={{ childrenGap: 30, padding: 10 }} styles={{ root: { background: 'rgb(225, 228, 232)' } }}>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Event Sequence #</h4>
                        <Text variant="superLarge" >{state._control && state._control.head_sequence}</Text>
                        <Text >{state.workItems ? state.workItems.items.length : 0} workItems</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Factory Capacity</h4>
                        <Text variant="superLarge" >{state.factory && state.factory.factoryStatus.capacity_allocated}</Text>
                        <Text >available 5</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Workitem Throughput</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>

                </Stack>

                <Stack horizontal disableShrink tokens={{ childrenGap: 5, padding: 0 }}>
                    {[[[0, 1, 2], "Processing"], [[3, 4], "In Factory"], [[5], metadata.stage_txt && metadata.stage_txt[5]], [[6], metadata.stage_txt && metadata.stage_txt[6]]].map(([stages, desc], idx) =>

                        <Stack.Item key={idx} align="stretch" grow styles={{ root: { background: 'rgb(225, 228, 232)', padding: 5 } }}>
                            <h4>{desc}</h4>
                            {state.workItems && state.workItems.items.filter(i => stages.includes(i.status.stage)).map((o, i) =>
                                <Stack key={i} tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { margin: '5px 0', backgroundColor: "white" } }}>

                                    <Label variant="small">Workitem Number {o.identifier || "<TBC>"}</Label>
                                    {
                                        o.status.failed &&
                                        <MessageBar messageBarType={MessageBarType.severeWarning}>
                                            <Text variant="xSmall">{o.status.message}</Text>
                                        </MessageBar>
                                    }

                                    <Stack horizontal tokens={{ childrenGap: 3 }}>
                                        <Stack tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "40%", backgroundColor: "rgb(255, 244, 206)" } }}>
                                            <Text variant="xSmall">Id: {o.id}</Text>
                                            <Text variant="xSmall">Spec: <Link route="/o" urlid={'1'}><Text variant="xSmall">open</Text></Link></Text>
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
            <DefaultButton iconProps={{ iconName: 'Add' }} text="Create Intentory" styles={{ root: { width: 180 } }} onClick={() => openWorkItem()} />

            <Separator></Separator>
            <h3>Factory Status</h3>
            <Stack tokens={{ childrenGap: 5 /*, padding: 10*/ }}>
                <Stack horizontal tokens={{ childrenGap: 30, padding: 10 }} styles={{ root: { background: 'rgb(225, 228, 232)' } }}>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Items in Factory</h4>
                        <Text variant="superLarge" >{state.factory && state.factory.items.length}</Text>
                        <Text >waiting {state.factory && state.factory.items.filter(i => i.stage === 0).length}</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Factory Capacity</h4>
                        <Text variant="superLarge" >{5 - (state.factory && state.factory.factoryStatus.capacity_allocated || 0)}</Text>
                        <Text >Allocated {state.factory && state.factory.factoryStatus.capacity_allocated} </Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Factory Throughput</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >taget 5 WorkItems/Day</Text>
                    </Stack>

                </Stack>

                <Stack horizontal tokens={{ childrenGap: 5, padding: 0 }}>
                    {[[[0], metadata.factory_txt && metadata.factory_txt[0]], [[1], metadata.factory_txt && metadata.factory_txt[1]], [[2], metadata.factory_txt && metadata.factory_txt[2]]].map(([stages, desc], idx) =>

                        <Stack.Item key={idx} align="stretch" grow styles={{ root: { background: 'rgb(225, 228, 232)', padding: 5 } }}>
                            <h4>{desc}</h4>
                            {state.factory && state.factory.items.filter(i => stages.includes(i.stage)).map((o, i) =>
                                <Stack key={i} tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>

                                    <Label variant="small">picking id {o.identifier || "<TBC>"}</Label>
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


        </Stack>
    )
}
