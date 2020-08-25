import React, { useState, useEffect } from 'react'
import { Link, navTo } from './router.js'
import { DetailsList, DetailsListLayoutMode, Selection, SelectionMode, IColumn } from '@fluentui/react/lib/DetailsList'
import { CommandBar } from '@fluentui/react/lib/CommandBar'
import { Stack, IStackProps } from '@fluentui/react/lib/Stack'
import { DefaultPalette } from '@uifabric/styling'
import { Card } from '@uifabric/react-cards'
import { Text } from '@fluentui/react/lib/Text'
import { Image, ImageFit } from '@fluentui/react/lib/Image'
import { Separator } from '@fluentui/react/lib/Separator';
import { initializeIcons } from '@uifabric/icons';
import { Icon } from '@fluentui/react/lib/Icon';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar'
import { useConstCallback } from '@uifabric/react-hooks';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Slider } from '@fluentui/react/lib/Slider';
import { ChoiceGroup, IChoiceGroupOption } from '@fluentui/react/lib/ChoiceGroup';
import { TextField, MaskedTextField } from '@fluentui/react/lib/TextField'
import { _fetchit, _suspenseFetch, _suspenseWrap } from '../utils/fetch'
import { Dropdown } from '@fluentui/react/lib/Dropdown';
import { PrimaryButton, Button, DefaultButton } from '@fluentui/react/lib/Button'
import { Label } from '@fluentui/react/lib/Label'
import { Checkbox } from '@fluentui/react/lib/Checkbox'

import update from 'immutability-helper';

initializeIcons();

function WorkItem({ resource, dismissPanel, refstores }) {
  const { status, result } = resource.read()
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
        <Button text="Cancel" onClick={dismissPanel} allowDisabledFocus disabled={false} />
      </Stack>

    </Stack>
  )
}

function workitemReducer(state, action) {

  switch (action.type) {
    case 'snapshot':
      return action.factory_state.workitems;
    case 'update':
      let newstate = state
      for (let wi_update of action.factory_update.workitem_updates) {
        console.log(`processing update : ${wi_update.type}`)
        switch (wi_update.type) {
          case 0: // New
            newstate = update(newstate, { $push: [wi_update.workitem] })
            break
          case 1: // Complete
          case 2: // ProgressUpdate4
            let existing_idx = state.findIndex((e) => e.spec._id === wi_update.workitem.spec._id)
            if (existing_idx >= 0) {
              // remove '1' item starting at 'existing_idx', and add
              newstate = update(newstate, { $splice: [[existing_idx, 1, wi_update.workitem]] })
            } else {
              throw new Error(`Cannot find existing workitem ${wi_update.workitem.spec._id}`);
            }
        }
        return newstate
      }
    default:
      throw new Error(`unknown action type ${action.type}`);
  }
}

export function MyBusiness({ resource }) {

  const { status, result } = resource.read()

  const inventory = result.data
  const { products } = result.refstores,
    refstores = {
      Category: products.Category.map(c => { return { key: c._id, text: c.heading } }),
      Product: products.Product.map(c => { return { key: c._id, text: c.heading, category: c.category } })
    }

  const [workitems, dispatchWorkitems] = React.useReducer(workitemReducer, [])
  const [panel, setPanel] = React.useState({ open: false })
  const [message, setMessage] = React.useState({ type: MessageBarType.info, msg: "Not Connected to Factory Controller" })

  const openWorkItem = useConstCallback((editid) => {
    setPanel({ open: true, refstores, resource: editid ? _suspenseFetch('store/inventory', editid) : _suspenseWrap({}) })
  })
  const dismissPanel = useConstCallback(() => setPanel({ open: false }));



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



      <h3>Order Processing</h3>
      <Stack tokens={{ childrenGap: 5, padding: 10 }}>

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

          <Stack
            tokens={{ childrenGap: 8, padding: 8 }}
            styles={{
              root: {
                background: 'rgb(225, 228, 232)',
                width: '100%',
              }
            }} >
            <h4>Waiting</h4>

          </Stack>


          <Stack
            tokens={{ childrenGap: 8, padding: 8 }}
            styles={{
              root: {
                background: 'rgb(225, 228, 232)',
                width: '100%',
              }
            }} >
            <h4>In Progress</h4>

          </Stack>

          <Stack
            tokens={{ childrenGap: 8, padding: 8 }}
            styles={{
              root: {
                background: 'rgb(225, 228, 232)',
                width: '100%',
              }
            }} >
            <h4>Complete</h4>

          </Stack>

        </Stack>

        <DefaultButton iconProps={{ iconName: 'Add' }} text="Hire Staff" styles={{ root: { width: 150 } }} />
      </Stack>


      <Separator></Separator>


      <h3>Factory Operator</h3>
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

          <Stack
            tokens={{ childrenGap: 8, padding: 8 }}
            styles={{
              root: {
                background: 'rgb(225, 228, 232)',
                width: '100%',
              }
            }} >
            <h4>Planned</h4>
            {workitems && workitems.filter(i => i.status.stage <= 1).map((i, idx) =>

              <Card tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>
                <Card.Item>
                  <Text variant="small">Factory</Text>
                </Card.Item>
                <Card.Section horizontal tokens={{ childrenGap: 3 }}>
                  <Card.Section tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "#CCCC00" } }}>
                    <a onClick={() => openWorkItem(i.spec._id)}><Text variant="small">Inventory Spec:</Text></a>
                    <Text variant="xSmall">Product: {products.Product.find(p => p._id === i.spec.product).heading}</Text>
                    <Text variant="xSmall">Qty: {i.spec.qty}</Text>
                    <Text variant="xSmall">Status: {i.spec.status}</Text>
                  </Card.Section>
                  <Card.Section tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "#DDDD00" } }}>
                    <Text variant="small">Inventory Build Status</Text>
                    <Text variant="xSmall">Stage: {i.status.stage === 0 ? 'Draft' : 'Waiting'}</Text>
                    <Text variant="xSmall">Wait Time (Seconds) : {i.status.waittime / 1000}</Text>
                    <Text variant="xSmall">Progess (%) : {i.status.progress}</Text>
                  </Card.Section>
                </Card.Section>
              </Card>

            )}


          </Stack>


          <Stack
            tokens={{ childrenGap: 8, padding: 8 }}
            styles={{
              root: {
                background: 'rgb(225, 228, 232)',
                width: '100%',
              }
            }} >
            <h4>In Progress</h4>
            {workitems && workitems.filter(i => i.status.stage === 2).map((i, idx) =>
              <Card tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>
                <Card.Item>
                  <Text variant="small">Factory</Text>
                </Card.Item>
                <Card.Section horizontal tokens={{ childrenGap: 3 }}>
                  <Card.Section tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "#CCCC00" } }}>
                    <Text variant="small">Inventory Spec:</Text>
                    <Text variant="xSmall">Product: {products.Product.find(p => p._id === i.spec.product).heading}</Text>
                    <Text variant="xSmall">Qty: {i.spec.qty}</Text>
                    <Text variant="xSmall">Status: {i.spec.status}</Text>
                  </Card.Section>
                  <Card.Section tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "#DDDD00" } }}>
                    <Text variant="small">Inventory Build Status</Text>
                    <Text variant="xSmall">Stage: {i.status.stage === 0 ? 'Draft' : 'Waiting'}</Text>
                    <Text variant="xSmall">Wait Time (Seconds) : {i.status.waittime / 1000}</Text>
                    <Text variant="xSmall">Progess (%) : {i.status.progress}</Text>
                  </Card.Section>
                </Card.Section>
              </Card>
            )}
          </Stack>

          <Stack
            tokens={{ childrenGap: 8, padding: 8 }}
            styles={{
              root: {
                background: 'rgb(225, 228, 232)',
                width: '100%',
              }
            }} >
            <h4>Complete</h4>
            {workitems && workitems.filter(i => i.status.stage === 3).map((i, idx) =>
              <Card tokens={{ minWidth: "100%", childrenGap: 0, childrenMargin: 3 }} styles={{ root: { backgroundColor: "white" } }}>
                <Card.Item>
                  <Text variant="small">Factory</Text>
                </Card.Item>
                <Card.Section horizontal tokens={{ childrenGap: 3 }}>
                  <Card.Section tokens={{ childrenGap: 1, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "#CCCC00" } }}>
                    <Text variant="small">Inventory Spec:</Text>
                    <Text variant="xSmall">Product: {products.Product.find(p => p._id === i.spec.product).heading}</Text>
                    <Text variant="xSmall">Qty: {i.spec.qty}</Text>
                    <Text variant="xSmall">Status: {i.spec.status}</Text>
                  </Card.Section>
                  <Card.Section tokens={{ minWidth: "50%", childrenGap: 0, padding: 2 }} styles={{ root: { minWidth: "49%", backgroundColor: "#DDDD00" } }}>
                    <Text variant="small">Inventory Build Status</Text>
                    <Text variant="xSmall">Stage: {i.status.stage === 0 ? 'Draft' : 'Waiting'}</Text>
                    <Text variant="xSmall">Wait Time (Seconds) : {i.status.waittime / 1000}</Text>
                    <Text variant="xSmall">Progess (%) : {i.status.progress}</Text>
                  </Card.Section>
                </Card.Section>
              </Card>
            )}
          </Stack>


        </Stack>
        <DefaultButton iconProps={{ iconName: 'Add' }} text="Create Intentory" styles={{ root: { width: 180 } }} onClick={openWorkItem} />
      </Stack>


      <Separator></Separator>

      <h3>Warehouses</h3>
      <Stack tokens={{ childrenGap: 5, padding: 10 }}>
        <Stack horizontal tokens={{ childrenGap: 30, padding: 0 }}>
          <Stack styles={{ root: { width: '100%' } }} >

            <Separator ><Text variant="xLarge">EMEA</Text></Separator>

            <h4>Inventory</h4>


            <div style={{ width: "100%", height: "300px", backgroundColor: "white", border: "1px dotted black" }}>
              {inventory && inventory.filter(i => i.status === "Available").map((i, idx) =>
                <div style={{ height: "20px", backgroundColor: "lightGrey" }}>{refstores.Product.find(p => p.key === i.product).text} ({i.qty} {i.status})</div>
              )}
            </div>

            <Stack horizontal >
              <span style={capacityStyle}>1</span>
              <span style={capacityStyle}>2</span>
              <span style={capacityStyle}>3</span>
            </Stack>
            <Text>Capacity (cores)</Text>
          </Stack>

          <Stack styles={{ root: { width: '100%' } }}>
            <Separator><Text variant="xLarge">Americas</Text></Separator>
            <Text>DC Space (m2)</Text>
            <Stack horizontal >
              <span style={capacityStyle}>1</span>
            </Stack>
            <Text>Capacity (cores)</Text>
          </Stack>

          <Stack styles={{ root: { width: '100%' } }}>
            <Separator><Text variant="xLarge">Asia</Text></Separator>
            <Text>DC Space (m2)</Text>
            <Stack >
              <span style={capacityStyle}>1</span>
            </Stack>
            <Text>Capacity (cores)</Text>
          </Stack>

        </Stack>

        <h5>Key</h5>
        <DefaultButton iconProps={{ iconName: 'Add' }} text="Purchase Space" styles={{ root: { width: 200 } }} />
      </Stack>
      <Separator></Separator>


    </Stack>
  )
}


export function StartBusiness({ resource }) {

  const [email, setEmail] = useState({ val: null, error: 'needs to be email format' })
  const [inventry, setInventry] = useState(false)
  const [products, setProducts] = useState()
  const { status, result } = resource.read()

  function _createBusiness(a) {
    alert(a)
  }

  return (
    <Stack horizontal wrap tokens={{ childrenGap: 30, padding: 'l2' }}>

      <Stack styles={{ root: { width: "45%" } }} tokens={{ childrenGap: 30 }}>
        <Text variant="xxLarge"  >Build a retail business like a BOSS</Text>
        <Text variant="large">develop your product catalogue, assign a warehouse, build inventory, and open your online business</Text>




        <Stack.Item>
          <Text variant="large" >Create a tenent for your business:</Text>
        </Stack.Item>
        <Stack.Item>
          <TextField required label="Enter your email address (not validated)" value={email.val} onChange={({ target }) => {
            console.log(target.value)
            console.log(/^\w+@[a-zA-Z_]+?\.[a-zA-Z]{2,3}$/.test(target.value))
            setEmail({ val: target.value, error: /^\w+@[a-zA-Z_]+?\.[a-zA-Z]{2,3}$/.test(target.value) ? false : 'needs to be email format' })
          }} errorMessage={email.error} />

        </Stack.Item>
        <Stack.Item>
          <Label >Choose your product catalogue:</Label>
        </Stack.Item>
        <Stack.Item>
          <Stack horizontal tokens={{ childrenGap: 30 }}>

            <Card
              aria-label="Clickable vertical card with image bleeding at the top of the card"
              onClick={() => setProducts('bike')}
              tokens={{ childrenMargin: 12, boxShadowFocused: 'red' }}
              styles={products === 'bike' ? { root: { border: '1px solid red' } } : {}}
            >
              <Card.Item styles={{ root: { height: "160px" } }}>
                <Image imageFit={ImageFit.centerContain} styles={{ root: { height: "100%" } }} src="https://freesvg.org/img/clipartjunky218-Cyclist-on-Bike.png" />
              </Card.Item>
              <Card.Section>
                <Label >Getting started cycling product calalogue</Label>
              </Card.Section>

              <Card.Section horizontal tokens={{ childrenGap: 10 }}>
                <Text>12 products</Text>
                <Text>3 categories</Text>
                <Text>3 Declined</Text>
              </Card.Section>

              <Card.Section>
                <Checkbox label="Create Inventry Workorders" onChange={() => setInventry(true)} />
              </Card.Section>

            </Card>

            <Card
              aria-label="Clickable vertical card with image bleeding at the top of the card"
              onClick={() => setProducts('no')}
              tokens={{ childrenMargin: 12 }}
              styles={products === 'no' ? { root: { border: '1px solid red' } } : {}}
            >

              <Card.Item styles={{ root: { height: "160px" } }}>
                <Image imageFit={ImageFit.centerContain} styles={{ root: { height: "100%" } }} src="https://placehold.it/160x160?text=none" />
              </Card.Item>

              <Card.Section>
                <Label>I will manage my own products</Label>
              </Card.Section>

              <Card.Item grow={1}>
                <span />
              </Card.Item>
              <Card.Section horizontal tokens={{ childrenGap: 10 }}>
                <Text>0 products</Text>
                <Text>0 categories</Text>
                <Text>0 Declined</Text>
              </Card.Section>
              <Card.Section>
                <Checkbox label="Create Inventry Workorders" disabled={true} />
              </Card.Section>

            </Card>

          </Stack>

        </Stack.Item>

        <Stack.Item>
          <PrimaryButton text={`Create My Business`} onClick={_createBusiness} allowDisabledFocus disabled={email.error || !products} />
        </Stack.Item>


      </Stack>


      <Stack styles={{ root: { width: "45%" } }}>
        <Image src="https://3er1viui9wo30pkxh1v2nh4w-wpengine.netdna-ssl.com/wp-content/uploads/2014/09/Satya_smiling-print-1024x683.jpg" />
      </Stack>

    </Stack>
  )
}