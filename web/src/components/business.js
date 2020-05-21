import React, {useState, useEffect} from 'react'
import { Link , navTo} from './router.js'
import { DetailsList, DetailsListLayoutMode, Selection, SelectionMode, IColumn } from '@fluentui/react/lib/DetailsList'
import { CommandBar } from '@fluentui/react/lib/CommandBar'
import { Stack, IStackProps } from '@fluentui/react/lib/Stack'
import { DefaultPalette } from '@uifabric/styling'
import { Card } from '@uifabric/react-cards'
import { Text  } from '@fluentui/react/lib/Text'
import { DefaultButton } from '@fluentui/react/lib/Button'
import { Image, ImageFit } from '@fluentui/react/lib/Image'
import { Separator } from '@fluentui/react/lib/Separator';
import { initializeIcons } from '@uifabric/icons';
import { Icon } from '@fluentui/react/lib/Icon';
import { useConstCallback } from '@uifabric/react-hooks';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { Slider } from '@fluentui/react/lib/Slider';
import { ChoiceGroup, IChoiceGroupOption } from '@fluentui/react/lib/ChoiceGroup';
import { TextField, MaskedTextField } from '@fluentui/react/lib/TextField'
import { _fetchit, _suspenseFetch, _suspenseWrap } from '../utils/fetch'
import { Dropdown } from '@fluentui/react/lib/Dropdown';

initializeIcons();

function WorkItem({resource, dismissPanel, refdata}) {
  const {status, result } = resource.read()
  

  const [input, handleInputChange] = useState ({
    'heading': result.heading,
    'engineers': 0,
    'category': result.category,
    'product': result.product,
    'description': result.description,
    'price': result.price,
    'image': result.image
  })

  function _onChange (e, val) {
    handleInputChange({
      ...input,
      [e.target.name]: val
    })
 }

  return (
    <Stack tokens={{ childrenGap: 15 }}  styles={{ root: { width: 300 }}}>

    <Dropdown label="Category" defaultSelectedKey={input.category} onChange={(e,i) => _onChange({target: {name: "category"}}, i.key)} options={refdata.Category} />
    <Dropdown label="Product" defaultSelectedKey={input.product} onChange={(e,i) => _onChange({target: {name: "product"}}, i.key)} options={refdata.Product.filter(x => x.category === input.category)} />

    <Slider
      label="Engineers to allocate"
      min={0}
      max={0}
      step={10}
      defaultValue={input.engineers}
      showValue={true}
      onChange={(val) => _onChange({target: {name: "engineers"}}, val)}
      snapToStep
    />
    <TextField label="Heading" name="heading" value={input.heading}  onChange={_onChange}  required />
    <TextField label="Category" name="category" value={input.category} onChange={_onChange} required />
    <TextField label="Description" name="description" value={input.description} onChange={_onChange}  multiline rows={5}  required />
    <TextField label="Price" name="price" value={input.price} onChange={_onChange}  required />

  
  </Stack>
  )
}

export function MyBusiness({resource}) { 

  const {status, result } = resource.read()
  const mybusiness = result.data
  

  const [panel, setPanel] = React.useState({open: false})

  const openWorkItem = useConstCallback((type, editid) => {
    const refdata = {
      'Category': result.refdata.Category.map(c => { return {key: c._id, text: c.heading}}), 
      'Product': result.refdata.Product.map(c => { return {key: c._id, text: c.heading, category: c.category}})}
    setPanel({open: true, refdata, resource:  _suspenseWrap({}) })
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
           <WorkItem dismissPanel={dismissPanel} refdata={panel.refdata} resource={panel.resource} />
        }
      </Panel>


      <h3>Warehouse Locations</h3>
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
      <h3>Build Inventory </h3>
      
      <Stack  horizontal  tokens={{ childrenGap: 5, padding: 10 }}>
       
        <Stack  
          tokens={{ childrenGap: 8, padding: 8 }}
          styles={{root: {
            background: 'rgb(225, 228, 232)',
            width: '100%',
          }}} >
          <h4>Planned</h4>
          <span style={workItemStyle}>1</span>
          <span style={workItemStyle}>2</span>
          <DefaultButton iconProps={{ iconName: 'Add' }}  text="Create Backlog Item" styles={{root: {margin: 10}}} onClick={openWorkItem} />
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