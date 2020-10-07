import React, { useState, useEffect } from 'react'
import { Link, navTo } from './router.js'
import { Alert, MyImage, EditImage } from '../utils/common'
import { DetailsList, DetailsListLayoutMode, Selection, SelectionMode, IColumn } from '@fluentui/react'
import { CommandBar } from '@fluentui/react'
import { Stack, IStackProps } from '@fluentui/react'
import { DefaultPalette } from '@uifabric/styling'
import { Card } from '@uifabric/react-cards'
import { Text } from '@fluentui/react'
import { Image, ImageFit } from '@fluentui/react'
import { Separator } from '@fluentui/react'
import { Icon } from '@fluentui/react'
import { MessageBar, MessageBarType } from '@fluentui/react'
import { useConstCallback } from '@uifabric/react-hooks';
import { Panel, PanelType } from '@fluentui/react'
import { Slider } from '@fluentui/react'
import { ChoiceGroup, IChoiceGroupOption } from '@fluentui/react'
import { TextField, MaskedTextField } from '@fluentui/react'
import { _fetchit, _suspenseFetch, _suspenseWrap } from '../utils/fetch'
import { Dropdown } from '@fluentui/react'
import { PrimaryButton, Button, DefaultButton } from '@fluentui/react'
import { Label } from '@fluentui/react'
import { Checkbox } from '@fluentui/react'
import { Spinner } from '@fluentui/react';

import update from 'immutability-helper';



function orderReducer(state, action) {

    switch (action.type) {
        case 'snapshot':
            return action.state;
        case 'events':
            if (action.changes) {
                const order = action.changes[0]
                //console.log(`processing update : ${e.type}`)

                let existing_idx = state.findIndex((e) => e.spec._id === order.spec._id)
                if (existing_idx >= 0) {
                    return state.splice(existing_idx, 1, order)
                } else {
                    return state.concat(order)
                }
            } else {
                console.warn('error')
            }
            return state

        default:
            throw new Error(`unknown action type ${action.type}`);
    }
}

export function OrderMgr({ resource }) {

    const { status, result } = resource.read()

    const inventory = result.data
    const { products } = result.refstores,
        refstores = {
            Category: products.Category.map(c => { return { key: c._id, text: c.heading } }),
            Product: products.Product.map(c => { return { key: c._id, text: c.heading, category: c.category } })
        }

    const [orders, dispatchWorkitems] = React.useReducer(orderReducer, [])

    const [message, setMessage] = React.useState({ type: MessageBarType.info, msg: "Not Connected to Order Controller" })



    const capacityStyle = {
        alignItems: 'center',
        background: DefaultPalette.themePrimary,
        color: DefaultPalette.white,
        display: 'flex',
        height: 50,
        justifyContent: 'center',
        width: 50,
    }

    const workItemStyle = {
        alignItems: 'center',
        background: DefaultPalette.white,
        color: DefaultPalette.black,
        display: 'flex',
        height: 50,
        justifyContent: 'center',
        width: '100%'
    }


    useEffect(() => {
        // Update the document title using the browser API
        let ws, recordederror = false

        function ws_connect() {
            try {
                setMessage({ type: MessageBarType.info, msg: `Trying to Connect....` })
                // async!
                ws = new WebSocket(`ws://${window.location.hostname}:9090/path`)
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

                        <Text variant="xSmall">Full details: <Link route="/o" urlid={o.spec._id}><Text variant="xSmall">open</Text></Link></Text>
                        <Text variant="xSmall">Status: {o.spec.status}</Text>
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
            <Stack tokens={{ childrenGap: 5, padding: 10 }}>
                <MessageBar messageBarType={message.type}>{message.msg}</MessageBar>

                <Stack horizontal tokens={{ childrenGap: 30, padding: 10 }} styles={{ root: { background: 'rgb(225, 228, 232)' } }}>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Factory Capacity</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Waiting Factory Orders</h4>
                        <Text variant="superLarge" >0</Text>
                        <Text >available 40 / busy 300</Text>
                    </Stack>
                    <Stack styles={{ root: { width: '100%' } }}>
                        <h4>Factory Throughput</h4>
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
                                {orders && orders.filter(i => i.status.stage === stage_idx || (idx === 0 && i.status.stage < stage_idx)).map(OrderDisplay)}
                            </Stack>
                        )

                    })
                    }

                </Stack>
            </Stack>
        </Stack >
    )
}
