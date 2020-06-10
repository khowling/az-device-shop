import React, {useState, useEffect} from 'react'
import { Link , navTo} from './router.js'
import { DetailsList, DetailsListLayoutMode, Selection, SelectionMode, IColumn } from '@fluentui/react/lib/DetailsList'
import { CommandBar } from '@fluentui/react/lib/CommandBar'
import { Stack, IStackProps } from '@fluentui/react/lib/Stack'
import { DefaultPalette } from '@uifabric/styling'
import { Card } from '@uifabric/react-cards'
import { Text  } from '@fluentui/react/lib/Text'
import { Image, ImageFit } from '@fluentui/react/lib/Image'
import { Separator } from '@fluentui/react/lib/Separator';
import { initializeIcons } from '@uifabric/icons';
import { Icon } from '@fluentui/react/lib/Icon';
import { MessageBar, MessageBarType  } from '@fluentui/react/lib/MessageBar'
import { useConstCallback } from '@uifabric/react-hooks';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Slider } from '@fluentui/react/lib/Slider';
import { ChoiceGroup, IChoiceGroupOption } from '@fluentui/react/lib/ChoiceGroup';
import { TextField, MaskedTextField } from '@fluentui/react/lib/TextField'
import { _fetchit, _suspenseFetch, _suspenseWrap } from '../utils/fetch'
import { Dropdown } from '@fluentui/react/lib/Dropdown';
import { PrimaryButton, Button, DefaultButton } from '@fluentui/react/lib/Button'

initializeIcons();

function WorkItem({resource, dismissPanel, refstores}) {
  const {status, result } = resource.read()
  const [error, setError ] = useState (null)

  const [input, handleInputChange] = useState ({
    'qty': result.qty,
    'engineers': result.engineers,
    'status': "Planned",
    'category': result.category,
    'product': result.product,
    'price': result.price,
    'warehouse': result.warehouse
  })

  function _onChange (e, val) {
    handleInputChange({
      ...input,
      [e.target.name]: val
    })
 }

 function _save() {
    setError(null)
    _fetchit('POST','/api/store/workitems', result._id? {_id: result._id, ...input}: input).then(succ => {
      console.log (`created success : ${JSON.stringify(succ)}`)
      navTo("/MyBusiness")
      dismissPanel()
    }, err => {
      console.error (`created failed : ${err}`)
      setError (`created failed : ${err}`)
    })
 }

  return (
    <Stack tokens={{ childrenGap: 15 }}  styles={{ root: { width: 300 }}}>

    <Dropdown label="Category" defaultSelectedKey={input.category} onChange={(e,i) => _onChange({target: {name: "category"}}, i.key)} options={refstores.Category} />
    <Dropdown label="Product" defaultSelectedKey={input.product} onChange={(e,i) => _onChange({target: {name: "product"}}, i.key)} options={refstores.Product.filter(x => x.category === input.category)} />

    <Slider
      label="Number to build"
      min={0}
      max={1000}
      step={10}
      defaultValue={input.engineers}
      showValue={true}
      onChange={(val) => _onChange({target: {name: "qty"}}, val)}
      snapToStep
    />

    <Dropdown label="Warehouse" defaultSelectedKey={input.warehouse} onChange={(e,i) => _onChange({target: {name: "warehouse"}}, i.key)} options={[{key: "emea", text: "EMEA"}, {key: "america", text: "Americas"}, {key: "asia", text: "ASIA"}]} />
    <TextField label="Status" name="status" value={input.status}  disabled={true} />
    <TextField label="Quantity" value={input.qty}  disabled={true} />
    { error &&
      <MessageBar  messageBarType={MessageBarType.error} isMultiline={false} truncated={true}>
        {error}
      </MessageBar>
    }
    <Stack horizontal tokens={{ childrenGap: 5 }}>
            <PrimaryButton text="Save" onClick={_save} allowDisabledFocus disabled={false}  />
            <Button text="Cancel" onClick={dismissPanel} allowDisabledFocus disabled={false}  />
            </Stack>
  
  </Stack>
  )
}

export function MyBusiness({resource}) { 

  const {status, result } = resource.read()
  const mybusiness = result.data
  const {products, workitems } = result.refstores
  

  const [panel, setPanel] = React.useState({open: false})

  const openWorkItem = useConstCallback((type, editid) => {
    const refstores = {
      'Category': products.Category.map(c => { return {key: c._id, text: c.heading}}), 
      'Product': products.Product.map(c => { return {key: c._id, text: c.heading, category: c.category}})}
    setPanel({open: true, refstores, resource:  _suspenseWrap({}) })
  })
  const dismissPanel = useConstCallback(() => setPanel({open: false}));


 
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



  return (
    <Stack  wrap tokens={{ childrenGap: 0, padding: 0 }}>

      <Panel
        headerText="Create WorkItem"
        isOpen={panel.open}
        onDismiss={dismissPanel}
        type={PanelType.medium}
        // You MUST provide this prop! Otherwise screen readers will just say "button" with no label.
        closeButtonAriaLabel="Close"
      >
        { panel.open &&
           <WorkItem dismissPanel={dismissPanel} refstores={panel.refstores} resource={panel.resource} />
        }
      </Panel>



      <h3>Staff</h3>
      <Stack tokens={{ childrenGap: 5, padding: 10 }}>
        <Stack  horizontal  tokens={{ childrenGap: 30, padding: 10 }} styles={{root: {background: 'rgb(225, 228, 232)'}}}>
          <Stack styles={{root: {  width: '100%'}}}> 
            <h4>Engineers</h4>
            <Text variant="superLarge" >0</Text>
            <Text >available 40 / busy 300</Text>
          </Stack>
          <Stack styles={{root: {  width: '100%'}}}> 
            <h4>Warehouse Workers</h4>
            <Text variant="superLarge" >0</Text>
            <Text >available 40 / busy 300</Text>
          </Stack>
          <Stack styles={{root: {  width: '100%'}}}> 
            <h4>Logistics Workers</h4>
            <Text variant="superLarge" >0</Text>
            <Text >available 40 / busy 300</Text>
          </Stack>        
         
        </Stack>
        <DefaultButton iconProps={{ iconName: 'Add' }}  text="Hire Staff" styles={{root: {width: 150}}}  />
      </Stack>

      
      <Separator></Separator>


      <h3>Factory</h3>
      <Stack  horizontal  tokens={{ childrenGap: 5, padding: 10 }}>
      
        <Stack  
          tokens={{ childrenGap: 8, padding: 8 }}
          styles={{root: {
            background: 'rgb(225, 228, 232)',
            width: '100%',
          }}} >
          <h4>Planned</h4>
          { workitems.map (i => 
            <span style={workItemStyle}>{products.Product.find(p => p._id === i.product).heading} - {i.qty}</span>
          )}
          
          <DefaultButton iconProps={{ iconName: 'Add' }}  text="Create Factory Order" styles={{root: {margin: 10}}} onClick={openWorkItem} />
        </Stack>
      
        <Stack  
          tokens={{ childrenGap: 8, padding: 8 }}
          styles={{root: {
            background: 'rgb(225, 228, 232)',
            width: '100%',
          }}} >
          <h4>In Progress</h4>
          <span style={workItemStyle}>1</span>
          <span style={workItemStyle}>2</span>
        </Stack>
  
        <Stack  
          tokens={{ childrenGap: 8, padding: 8 }}
          styles={{root: {
            background: 'rgb(225, 228, 232)',
            width: '100%',
          }}} >
          <h4>Complete</h4>
          <span style={workItemStyle}>1</span>
          <span style={workItemStyle}>2</span>
        </Stack>


      </Stack>

      <Separator></Separator>
      <h3>Warehouses</h3>
      <Stack tokens={{ childrenGap: 5, padding: 10 }}>
        <Stack  horizontal tokens={{ childrenGap: 30, padding: 0 }}>
          <Stack styles={{root: {  width: '100%'}}} > 
            
            <Separator ><Text variant="xLarge">EMEA</Text></Separator>

            <h4>Inventory</h4>

            <div style={{width: "100%", height: "300px", backgroundColor: "white", border: "1px dotted black"}}>
              <div style={{width: "15%", height: "20px", backgroundColor: "lightGrey", background: 'url("http://i.stack.imgur.com/lOtMo.png") repeat'}}><Icon iconName="Server"  /></div>
            </div>

            <Stack horizontal >
              <span style={capacityStyle}>1</span>
              <span style={capacityStyle}>2</span>
              <span style={capacityStyle}>3</span>
            </Stack>
            <Text>Capacity (cores)</Text>
          </Stack>

          <Stack styles={{root: {  width: '100%'}}}> 
          <Separator><Text variant="xLarge">Americas</Text></Separator>
            <Text>DC Space (m2)</Text>
            <Stack horizontal >
              <span style={capacityStyle}>1</span>
            </Stack>
            <Text>Capacity (cores)</Text>
          </Stack>

          <Stack styles={{root: {  width: '100%'}}}> 
            <Separator><Text variant="xLarge">Asia</Text></Separator>
            <Text>DC Space (m2)</Text>
            <Stack >
              <span style={capacityStyle}>1</span>
            </Stack>
            <Text>Capacity (cores)</Text>
          </Stack>
          
        </Stack>

        <h5>Key</h5>
        <DefaultButton iconProps={{ iconName: 'Add' }}  text="Purchase Space" styles={{root: {width: 200}}} />
      </Stack>
      <Separator></Separator>

     
    </Stack>
  )
}


export function BusinessHome({resource}) { 
    
    const {status, result } = resource.read()

    const cardTokens = { childrenMargin: 12 }
    const headerTxtstyle = {
      root: {
        color: '#505050',
        fontWeight: 600,
      }
    }

    return (
      <Stack>
        
        <Stack horizontal  wrap tokens={{ childrenGap: 30, padding: 'l2' }}>
        
          <Stack styles={{root: {width: "45%"}}} tokens={{ childrenGap: 30}}>
          <Text variant="xxLarge"  >Build a hyper-scale cloud business like a BOSS</Text>
            <Text variant="large">Get Funded, hire the best engineering team, purchase land for the data centers, operate with excellence, hire the field army, beat the competition</Text>

            <Text variant="xLarge">First:</Text>

            <Card aria-label="Basic vertical card" tokens={{...cardTokens}} >
              <Card.Section>
                <Text styles={headerTxtstyle} variant="large" >Login to Get Funded</Text>
              </Card.Section>
              <Card.Item>
                <Text>Apply for your 1st round of funding</Text>
              </Card.Item>
            </Card>

            <Text variant="xLarge">Then:</Text>

            <Card aria-label="Basic vertical card" tokens={cardTokens} onClick={() => navTo('/')}>
            <Card.Section>
                <Text styles={headerTxtstyle} variant="large" >Visit the Store</Text>
              </Card.Section>
              <Card.Item>
                <Text>Purchase equipment and hire the team</Text>
              </Card.Item>
            </Card>


            <Card aria-label="Basic vertical card" tokens={cardTokens} onClick={() => navTo('/MyBusiness')}>
            <Card.Section>
              <Text styles={headerTxtstyle} variant="large" >Manage my Business Assets</Text>
            </Card.Section>
            <Card.Item>
              <Text>View my companies assets and programs</Text>
            </Card.Item>
          </Card>



          <Card aria-label="Basic vertical card" tokens={cardTokens}>
            <Card.Section>
              <Text styles={headerTxtstyle} variant="large" >Results</Text>
            </Card.Section>
            <Card.Item>
              <Text>Time to report your financials</Text>
            </Card.Item>
          </Card>

          
          
          </Stack>
          <Stack styles={{root: {width: "45%"}}}>
            <Image  src="https://3er1viui9wo30pkxh1v2nh4w-wpengine.netdna-ssl.com/wp-content/uploads/2014/09/Satya_smiling-print-1024x683.jpg"/>
          </Stack>
        </Stack>
        <Stack horizontal  wrap tokens={{ childrenGap: 30, padding: 'l2' }}>

          
          
        </Stack>
      </Stack>
    )
}