import React, { useState, } from 'react'
import { Link } from './router.js'
import { EditImage } from '../utils/common.js'
import { _fetchit /*, _suspenseFetch, _suspenseWrap */ } from '../utils/fetch.js'

//import { Card } from '@fluentui/react-cards'
import { DocumentCardTitle, DocumentCard, DocumentCardImage, DocumentCardPreview, DocumentCardDetails, DocumentCardActivity, Text, Image, FontIcon, ImageFit, mergeStyles, TextField, Stack, PrimaryButton, Label, Checkbox, Spinner, ChoiceGroup, Separator } from '@fluentui/react'


const iconClass = mergeStyles({
  fontSize: 110,
  //height: 50,
  //width: 150,
  color: 'grey',
  //margin: '15px 50px',
});

export function StartBusiness() {

  const [input, handleInputChange] = useState({
    'name': 'Keith\'s Store',
    'email': '',
    'image': { url: 'https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png' },
    'catalog': 'bike',
    'inventory': true
  })
  const [validation, setValidation] = useState({
    'name': null,
    'email': 'Required',
    'catalog': null
  })
  const [state, setState] = useState({ state: 'reset', description: '' })

  function _onChange(e, val) {
    handleInputChange({ ...input, [e.target.name]: val })

    if (e.target.name === "email") {
      setValidation({ ...validation, [e.target.name]: /^\w+@[a-zA-Z_]+?\.[a-zA-Z]{2,3}$/.test(val) ? false : 'needs to be email format' })
    } else if (e.target.name === "name") {
      setValidation({ ...validation, [e.target.name]: !val ? 'Required' : null })
    } else if (e.target.name === "catalog") {
      setValidation({ ...validation, [e.target.name]: !val ? 'Required' : null })
    }
  }

  function _createBusiness(a) {
    setState({ state: 'resetting' })
    _fetchit(`/api/createtenent`, 'POST', {}, input).then(succ => {
      console.log(`created success : ${JSON.stringify(succ)}`)
      setState({ state: 'success' })

    }, err => {
      console.error(`created failed : ${err}`)
      setState({ state: 'error', description: err })
    })
  }

  return (

    <Stack tokens={{ childrenGap: 30 }}>
      <Separator></Separator>
      <Text variant="xxLarge">Setup Shop</Text>
      <Stack horizontal tokens={{ childrenGap: 30 }}>
        <Stack tokens={{ childrenGap: 20 }}>
          <Text variant="large">Create your product catalogue, assign a Warehouse, build Inventory, and open your online business</Text>
          <Text variant="large" >Create a tenent for your business:</Text>


          <Stack.Item>
            <TextField required label="Store Name" name="name" value={input.name} onChange={_onChange} errorMessage={validation.name} />
            <TextField required label="Store Admin email (validated when you create user)" name="email" value={input.email} onChange={_onChange} errorMessage={validation.email} />
          </Stack.Item>

          <Stack.Item styles={{ root: { maxWidth: '500px' } }}>
            <Label>Store Logo (on nav bar)</Label>
            <EditImage result_image={input.image} root={true} onChange={_onChange} />
          </Stack.Item>


          <Label >Choose your product catalogue:</Label>

          <Stack horizontal style={{ marginTop: "5px" }} tokens={{ childrenGap: 30 }}>

            <DocumentCard
              onClick={() => _onChange({ target: { name: "catalog" } }, "bike")}
              tokens={{ childrenMargin: 12 }}
            >

              <DocumentCardImage imageSrc="https://freesvg.org/img/clipartjunky218-Cyclist-on-Bike.png" height={150} imageFit={ImageFit.centerContain} />

              <DocumentCardDetails styles={{ root: { padding: "8px 16px", position: "relative" } }}>
                <ChoiceGroup selectedKey={input.catalog} options={[{ key: 'bike', text: 'Cycling product calalogue', styles: { root: { fontWeight: input.catalog === 'bike' ? '500' : 'normal' } } }]} />
              </DocumentCardDetails>

              <DocumentCardTitle title="Getting started cycling product calalogue" showAsSecondaryTitle shouldTruncate />

              <DocumentCardDetails styles={{ root: { padding: "8px 16px", position: "relative" } }}>

                <Checkbox label="Create Inventry Workorders" checked={input.inventory && input.catalog === 'bike'} onChange={(e, v) => _onChange({ target: { name: "inventory" } }, v)} />
              </DocumentCardDetails>

              <DocumentCardActivity activity="Modified March, 2021" people={[{ name: 'Keith Howling', profileImageSrc: '', initials: 'KH' }]} />

            </DocumentCard>

            <DocumentCard
              onClick={() => _onChange({ target: { name: "catalog" } }, "none")}
              tokens={{ childrenMargin: 12 }}
            >

              <DocumentCardPreview previewImages={[{
                previewIconProps: {
                  iconName: 'Manufacturing', className: iconClass
                }, height: 150
              },]} />

              <DocumentCardDetails styles={{ root: { padding: "8px 16px", position: "relative" } }}>
                <ChoiceGroup selectedKey={input.catalog} options={[{ key: 'none', text: 'Empty Catalogue', styles: { root: { fontWeight: input.catalog === 'none' ? '500' : 'normal' } } }]} />
              </DocumentCardDetails>

              <DocumentCardTitle title="I will create my own Products" showAsSecondaryTitle shouldTruncate />
              <DocumentCardDetails styles={{ root: { marginTop: "30px" } }} />


              <DocumentCardActivity activity="Modified March, 2021" people={[{ name: 'Keith Howling', profileImageSrc: '', initials: 'KH' }]} />
            </DocumentCard>

          </Stack>


          <Label >Initialise your tenent:</Label>

          <Stack.Item styles={{ root: { margin: '200px 0' } }}>
            {state.state === 'reset' ?
              <PrimaryButton text={`Initialise (Warning: Will override all current tenent data)`} onClick={_createBusiness} allowDisabledFocus disabled={Object.entries(validation).reduce((a, c) => a || c[1], null)} />
              : state.state === 'resetting' ?
                <Spinner label="Please Wait, will take a few seonds..." ariaLive="assertive" labelPosition="right" />
                : state.state === 'error' ?
                  <div className="m-alert f-warning" role="alert">
                    <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
                    <div>
                      <div className="c-glyph glyph-warning" aria-label="Warning message"></div>
                      <p className="c-paragraph">{state.description}
                        <span className="c-group">
                          <button className="c-action-trigger" onClick={() => setState({ state: 'reset' })}>Try Again</button>

                        </span>
                      </p>
                    </div>
                  </div>
                  : state.state === 'success' ?
                    <div className="m-alert f-information" role="alert">
                      <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
                      <div>
                        <div className="c-glyph glyph-info" aria-label="Information message"></div>
                        <h1 className="c-heading">Done</h1>
                        <p className="c-paragraph">Click here to open your Store (may take a few seconds)
                          <span className="c-group">
                            <a className="c-action-trigger" href="/">Store</a>

                          </span>
                        </p>
                      </div>
                    </div>
                    : <div></div>
            }

          </Stack.Item>
        </Stack>
        <Image imageFit={ImageFit.CenterContain} width={'500px'} src="https://3er1viui9wo30pkxh1v2nh4w-wpengine.netdna-ssl.com/wp-content/uploads/2014/09/Satya_smiling-print-1024x683.jpg" />

      </Stack>
    </Stack>


  )
}