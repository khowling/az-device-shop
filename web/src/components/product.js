import React, {useState, useEffect} from 'react'
import { Link, navTo } from './router.js'
import { DetailsList, DetailsListLayoutMode, Selection, SelectionMode, IColumn } from '@fluentui/react/lib/DetailsList'
import { CommandBar } from '@fluentui/react/lib/CommandBar'
import { TextField, MaskedTextField } from '@fluentui/react/lib/TextField'
import {Toggle} from '@fluentui/react/lib/Toggle'
import { Stack, IStackProps } from '@fluentui/react/lib/Stack'
import { Image, IImageProps, ImageFit } from '@fluentui/react/lib/Image'
import { MessageBar, MessageBarType  } from '@fluentui/react/lib/MessageBar'
import {Alert, MyImage} from '../utils/common'
import { Label } from '@fluentui/react/lib/Label'
import { PrimaryButton, Button, DefaultButton } from '@fluentui/react/lib/Button'
import { mergeStyleSets, getTheme, getFocusStyle } from '@fluentui/react/lib/Styling';
import { _fetchit } from '../utils/fetch'
import { putBlob, listFiles} from '../utils/azureBlob.js'





export function Product({resource}) {

  const {status, result } = resource.read()
  //console.log (`Product: result.image : ${JSON.stringify(result.image)}`)
  const [error, setError ] = useState (null)
  const [imageTypeUrl, setImageTypeUrl ] = useState (result.image? result.image.hasOwnProperty('url') : false)
  const [imageUrl, setImageUrl ] = useState (imageTypeUrl && result.image && result.image.url? result.image.url : '')
  const [input, handleInputChange] = useState ({
    'heading': result.heading,
    'category': result.category,
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


  // Picture
  const fileInputRef = React.createRef()
  
  function _onImageUrlChange(e) {
    
    if (imageTypeUrl) {
      console.log (`_onImageUrlChange: update image ${e.currentTarget.value}`)
    _onChange({target: {name: "image"}}, {"url": e.currentTarget.value})
    }
  }

  function _clickFile() {
    fileInputRef.current.click()
  }
  
  function _fileuploadhtml5(e) {
    var file = e.currentTarget.files[0];

    if (file) {
      console.log(' _fileuploadhtml5 : ' + file.name);
      putBlob(file, progressEvt => {
        console.log ('progress ' + progressEvt.loaded);
        if (progressEvt.lengthComputable) {
          //this.line.animate(Math.round(progressEvt.loaded / progressEvt.total));
        } else {
          //this.line.animate(0.5);
        }
      }, err => {
        alert (`_fileuploadhtml5 Upload failed: ${err}`)
      }).then (attachment => {

        //this.line.animate(1, () => this.line.set(0));
        console.log (`_fileuploadhtml5 Got : ${JSON.stringify (attachment)}`)

        _onChange({target: {name: "image"}}, attachment)

      //data.documents[field.name] = evt.target.responseText;
    }, err => {
      // console.log ("There was an error attempting to upload the file:" + JSON.stringify(errEvt));
      alert (`Upload failed: ${err}`)
      //this.line.set(0);
    })
  } else {
    console.log ('pressed cancel')
  }
   return false;
  }

  const columnProps = {
    tokens: { childrenGap: 15 },
    styles: { root: { width: 300 } }
  }


  function _save () {
    setError(null)
    _fetchit('POST','/api/store/products', result._id? {_id: result._id, ...input}: input).then(succ => {
      console.log (`created success : ${JSON.stringify(succ)}`)
      navTo("/ManageProducts")
    }, err => {
      console.error (`created failed : ${err}`)
      setError (`created failed : ${err}`)
    })
  }

  function _delete () {
    setError(null)
    _fetchit('DELETE','/api/store/products/' + result._id).then(succ => {
      console.log (`delete success : ${JSON.stringify(succ)}`)
      navTo("/ManageProducts")
    }, err => {
      console.error (`delete failed : ${err}`)
      setError (`delete failed : ${err}`)
    })
  }

  function _cancel () {
    navTo("/ManageProducts")
  }

  let previewsrc = !input.image? "http://placehold.it/100x100" :  imageTypeUrl? input.image.url : input.image.container_url + "/" + input.image.filename
  return (
    <Stack horizontal tokens={{ childrenGap: 50 }} styles={{ root: { width: 650 } }}>
      <Stack {...columnProps}>
        <TextField label="Heading" name="heading" value={input.heading}  onChange={_onChange}  required />
        <TextField label="Category" name="category" value={input.category} onChange={_onChange} required />
        <TextField label="Description" name="description" value={input.description} onChange={_onChange}  multiline rows={5}  required />
        <TextField label="Price" name="price" value={input.price} onChange={_onChange}  required />

        

      </Stack>

      <Stack {...columnProps}>

      <Label>Features</Label>
        <DetailsList
          styles={{root: {margin: 0}}}
          items={[
            { key: 'mem-512', label: '512GB' },
            { key: 'mem-1G', label: '1GB' },
            { key: 'col-silver', label: 'Silver' },
            { key: 'col-black', label: 'Black' },
            { key: 'col-grey', label: 'Grey' },
          ]}
          groups={[
            { key: 'memory', name: 'Memory', startIndex: 0, count: 2, level: 0 },
            { key: 'color', name: 'Colour', startIndex: 2, count: 3, level: 0 },
            { key: 'gpu', name: 'GPU', startIndex: 0, count: 0, level: 0 },
          ]}
          columns={[
            { key: 'key', name: 'Feature', fieldName: 'key', minWidth: 100, maxWidth: 200, isResizable: true },
            { key: 'label', name: 'Label', fieldName: 'label', minWidth: 100, maxWidth: 200 },
          ]}
          ariaLabelForSelectAllCheckbox="Toggle selection for all items"
          ariaLabelForSelectionColumn="Toggle selection"
          checkButtonAriaLabel="Row checkbox"
          groupProps={{
            showEmptyGroups: true,
          }}
          compact={true}
        />

        <Toggle label="Image location" inlineLabel onText="external Url"  offText="File Upload" defaultChecked={imageTypeUrl} onChange={(e, val) => {console.log (`setImageTypeUrl ${val}`); setImageTypeUrl(val)} } />
        <input type="file" ref={fileInputRef} name="file" style={{display: "none"}} accept="image/*" onChange={_fileuploadhtml5} />
        <TextField  prefix="Full Url" name="imageUrl" value={imageUrl} onBlur={_onImageUrlChange} onChange={(e,val) => setImageUrl(val)} required={imageTypeUrl} styles={{root: {display: imageTypeUrl? "block": "none"}}}  />
        <DefaultButton iconProps={{ iconName: 'upload' }} styles={{root: {display: imageTypeUrl? "none": "block"}}} onClick={_clickFile} >Upload file</DefaultButton>
        <a href={previewsrc} target="_won"><Image
            imageFit={ImageFit.Contain}
            width={350}
            height={150}
            src= {previewsrc}
            imageFit={ImageFit.centerContain}
            alt="Example implementation of the property image fit using the none value on an image smaller than the frame."
          /></a>

        { error &&
          <MessageBar  messageBarType={MessageBarType.error} isMultiline={false} truncated={true}>
            {error}
          </MessageBar>
        }
        <Stack horizontal tokens={{ childrenGap: 5 }}>
          <PrimaryButton text="Save" onClick={_save} allowDisabledFocus disabled={false}  />
          <Button text="Cancel" onClick={_cancel} allowDisabledFocus disabled={false}  />
          <Button text="Delete" onClick={_delete} allowDisabledFocus disabled={false}  />
        </Stack>
      </Stack>
    </Stack>
  )
}

const classNames = mergeStyleSets({
  fileIconHeaderIcon: {
    padding: 0,
    fontSize: '14px',
    fontWeight: 400,
    fontFamily: ["Segoe UI", "Segoe UI Web (West European)", "Segoe UI", "-apple-system", "BlinkMacSystemFont", "Roboto", "Helvetica Neue", "sans-serif"]
  }
})
export function ManageProducts({resource}) { 
    
  const {status, result } = resource.read()

  return (
    <div>
      <CommandBar
        items={[{
          key: 'addRow',
          text: 'New Product',
          iconProps: { iconName: 'Add' },
          href: "/Product"
        }]}
      />


      <DetailsList
        columns={[
            {
              key: 'heading',
              name: 'Heading',
              fieldName: 'heading',
              className: classNames.fileIconHeaderIcon,
              minWidth: 100,
              maxWidth: 250,
              onColumnClick: () => console.log('click'),
              onRender: (item) => {
                return <Link route="/Product" recordid={item._id}>{item.heading}</Link>;
              }
            }, 
            {
                key: 'category',
                name: 'Category',
                fieldName: 'category',
                className: classNames.fileIconHeaderIcon,
                minWidth: 50,
                maxWidth: 150,
                onColumnClick: () => console.log('click'),
            },
            {
                key: 'description',
                name: 'Description',
                fieldName: 'description',
                className: classNames.fileIconHeaderIcon,
                minWidth: 350,
                maxWidth: 500,
                onColumnClick: () => console.log('click'),
            },
            {
              key: 'image',
              name: 'Image',
              fieldName: 'image',
              minWidth: 150,
              maxWidth: 150,
              onRender: (item) => {
                return <MyImage width="50" image={item.image} alt="no pic"/> ;
              },
              onColumnClick: () => console.log('click'),
          },
            {
                key: 'price',
                name: 'Price',
                fieldName: 'price',
                className: classNames.fileIconHeaderIcon,
                minWidth: 50,
                maxWidth: 100,
                onColumnClick: () => console.log('click'),
            },
            {
                key: 'features',
                name: 'Features',
                fieldName: 'features',
                className: classNames.fileIconHeaderIcon,
                minWidth: 350,
                maxWidth: 500,
                onRender: (item) => {
                  return (
                    <div>{item.features && item.features.map((i) => 
                      <div>{i.name} : {JSON.stringify(i.values)}</div>
                    )}
                    </div>
                  )
                },
                onColumnClick: () => console.log('click'),
            },
            {
                key: 'badge',
                name: 'Badge',
                fieldName: 'badge',
                className: classNames.fileIconHeaderIcon,
                minWidth: 50,
                maxWidth: 100,
                onColumnClick: () => console.log('click'),
            },
        ]}
        compact={false}
        items={result}
        selectionMode={SelectionMode.none}
        setKey="none"
        layoutMode={DetailsListLayoutMode.justified}
        isHeaderVisible={true}
      />

      
    </div>
  )
}

