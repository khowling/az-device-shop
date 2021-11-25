import React, { useState, Suspense } from 'react'
import { navTo /*, _encodeURL */ } from './router.js'
import { Alert, MyImage, EditImage, ModelPanel } from '../utils/common.js'
import { _fetchit, _suspenseFetch, _suspenseWrap } from '../utils/fetch.js'

import { Dropdown, ChoiceGroup, Panel, PanelType, Separator, mergeStyleSets, PrimaryButton, DefaultButton, Label, MessageBar, MessageBarType, Stack, Text, TextField, DetailsList, DetailsListLayoutMode, SelectionMode } from '@fluentui/react'

export function Product({ dismissPanel, resource, type, refstores }) {

  const { status, result } = resource.read()

  const [error, setError] = useState(null)

  const [input, handleInputChange] = useState({
    'type': result.type || type,
    'heading': result.heading,
    'position': result.position || "normal",
    'category_ref': result.category_ref,
    'description': result.description,
    'price': result.price,
    'image': result.image
  })


  function _onChange(e, val) {
    handleInputChange({
      ...input,
      [e.target.name]: val
    })
  }

  const columnProps = {
    tokens: { childrenGap: 15 },
    styles: { root: { width: 300 } }
  }

  function _save() {
    setError(null)
    _fetchit('/api/store/products', 'POST', {}, result._id ? { _id: result._id, ...input } : input).then(succ => {
      console.log(`created success : ${JSON.stringify(succ)}`)
      dismissPanel("/products")
      
    }, err => {
      console.error(`created failed : ${err}`)
      setError(`created failed : ${err}`)
    })
  }

  function _delete() {
    setError(null)
    _fetchit('/api/store/products/' + result._id, 'DELETE').then(succ => {
      console.log(`delete success : ${JSON.stringify(succ)}`)
      dismissPanel("/products")
    }, err => {
      console.error(`delete failed : ${err}`)
      setError(`delete failed : ${err}`)
    })
  }

  if (status === 'error')
    return <Alert txt={result} />
  else return (
    <Stack>
      <Separator></Separator>
      {/*<Stack horizontal tokens={{ childrenGap: 50 }} styles={{ root: { width: 650 } }}>*/}

      <Stack {...columnProps}>
        {input.type === "Product" ?
          <Dropdown label="Category" defaultSelectedKey={input.category_ref && input.category_ref._id} onChange={(e, i) => _onChange({ target: { name: "category_ref" } }, { _id: i.key })} options={refstores.Category} />
          :
          <ChoiceGroup label="Category Position" onChange={(e, i) => _onChange({ target: { name: "position" } }, i.key)} defaultSelectedKey={input.position} options={[
            { key: 'hero', text: 'Hero', iconProps: { iconName: 'FitWidth' } },
            { key: 'highlight', text: 'Highlight', iconProps: { iconName: 'Highlight' } },
            { key: 'normal', text: 'Normal', iconProps: { iconName: 'StackIndicator' } }]} />
        }

        <TextField label="Heading" name="heading" value={input.heading} onChange={_onChange} required />

        <TextField label="Description" name="description" value={input.description} onChange={_onChange} multiline rows={5} required />
        {input.type === "Product" &&
          <TextField label="Price" name="price" value={input.price} onChange={_onChange} required />
        }


        {/*</Stack>*/}

        {/*<Stack {...columnProps}>*/}

        {input.type === "Product" && [

          <Label key="features">Features</Label>,
          <DetailsList key="detaillist"
            styles={{ root: { margin: 0 } }}
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
        ]}

        <EditImage result_image={input.image} onChange={_onChange} />

        {error &&
          <MessageBar messageBarType={MessageBarType.error} isMultiline={false} truncated={true}>
            {error}
          </MessageBar>
        }
        <Stack horizontal tokens={{ childrenGap: 5 }}>
          <PrimaryButton text="Save" onClick={_save} allowDisabledFocus disabled={false} />
          <DefaultButton text="Cancel" /*href={_encodeURL("/ManageProducts")}*/ onClick={() => dismissPanel()} allowDisabledFocus disabled={false} />
          {result._id &&
            <DefaultButton text="Delete" onClick={_delete} allowDisabledFocus disabled={false} />
          }
        </Stack>
      </Stack>
      {/*</Stack>*/}
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



//  ----------------------------------------------------------------- ManageProducts
export function ManageProducts({ resource }) {
  const [panel, setPanel] = React.useState({ open: false })
  const { status, result } = resource.read()

  const { inventory } = result.refstores || {}

  console.log(`ManageProducts panel=${JSON.stringify(panel)}`)

  function openNewItem(type, editid) {
    console.log('openNewItem')
    const refstores = type === 'Product' ? { 'Category': result.data.Category.map(c => { return { key: c._id, text: c.heading } }) } : {}
    setPanel({ open: true, type, resource: editid ? _suspenseFetch('store/products', editid) : _suspenseWrap({}), refstores })
  }


  if (false) return <div></div>
  else
    return (
      <Stack>


        <ModelPanel
          headerText={"Create " + panel.type}
          isOpen={panel.open}
          onDismiss={() => setPanel({ open: false })}
          type={PanelType.custom}
          customWidth='360px'
          closeButtonAriaLabel="Close">
          {panel.open &&
            <Suspense fallback={<span></span>}>
              <Product type={panel.type} refstores={panel.refstores} dismissPanel={(nav) => {
                setPanel({ open: false })
                //if (nav) navTo(nav)
              }} resource={panel.resource} />
            </Suspense>
          }
        </ModelPanel>


        <DetailsList
          columns={[
            {
              key: 'heading',
              name: 'Categories',
              fieldName: 'heading',
              className: classNames.fileIconHeaderIcon,
              minWidth: 100, maxWidth: 250
            },
            {
              key: 'description',
              name: 'Description',
              fieldName: 'description',
              className: classNames.fileIconHeaderIcon,
              minWidth: 350, maxWidth: 500
            },
            {
              key: 'position',
              name: 'Position',
              fieldName: 'position',
              className: classNames.fileIconHeaderIcon,
              minWidth: 100, maxWidth: 250
            },
            {
              key: 'image',
              name: 'Image',
              fieldName: 'image',
              minWidth: 50, maxWidth: 50,
              onRender: (item) => {
                return <MyImage image={item.image} height={35} alt="no pic" />;
              }
            }
          ]}
          compact={false}
          items={result.data.Category || []}
          onItemInvoked={(i) => openNewItem("Category", i._id)}
          //onActiveItemChanged={(i) => openNewItem("Category", i._id)}
          selectionMode={SelectionMode.none}
          setKey="none"
          layoutMode={DetailsListLayoutMode.justified}
          isHeaderVisible={true}
        />

        <PrimaryButton
          text='Create New Category'
          iconProps={{ iconName: 'Add' }}
          onClick={() => openNewItem("Category")}
        />

        <DetailsList
          columns={[
            {
              key: 'heading',
              name: 'Products',
              fieldName: 'heading',
              className: classNames.fileIconHeaderIcon,
              minWidth: 50,
              maxWidth: 250
            },
            {
              key: 'category',
              name: 'Category',
              fieldName: 'category_ref',
              className: classNames.fileIconHeaderIcon,
              minWidth: 25,
              maxWidth: 150,
              onRender: (item) => {
                console.log(`ManageProducts: Category: ${item.category_ref}`)
                return <Text variant="medium">{item.category_ref && result.data.Category.find(i => item.category_ref._id === i._id).heading}</Text>;
              }
            },
            {
              key: 'description',
              name: 'Description',
              fieldName: 'description',
              className: classNames.fileIconHeaderIcon,
              minWidth: 150,
              maxWidth: 500
            },
            {
              key: 'image',
              name: 'Image',
              fieldName: 'image',
              minWidth: 75,
              maxWidth: 150,
              onRender: (item) => {
                return <MyImage image={item.image} height={40} alt="no pic" />;
              }
            },
            {
              key: 'price',
              name: 'Price',
              fieldName: 'price',
              className: classNames.fileIconHeaderIcon,
              minWidth: 50,
              maxWidth: 60
            },
            {
              key: 'features',
              name: 'Features',
              fieldName: 'features',
              className: classNames.fileIconHeaderIcon,
              minWidth: 150,
              maxWidth: 500,
              onRender: (item) => {
                return (
                  <div>{item.features && item.features.map((i) =>
                    <div>{i.name} : {JSON.stringify(i.values)}</div>
                  )}
                  </div>
                )
              }
            },
            {
              key: 'badge',
              name: 'On hand',
              fieldName: 'badge',
              className: classNames.fileIconHeaderIcon,
              minWidth: 100,
              maxWidth: 100,
              onRender: (item) => {
                const onhand = inventory && inventory.onhand.find(i => i.productId === item._id)
                return <Text variant="medium">{onhand ? onhand.qty : '0'}</Text>;
              }
            },
          ]}
          compact={false}
          items={result.data.Product || []}
          onItemInvoked={(i) => openNewItem("Product", i._id)}
          //onActiveItemChanged={(i) => openNewItem("Product", i._id)}
          selectionMode={SelectionMode.none}
          layoutMode={DetailsListLayoutMode.justified}
          isHeaderVisible={true}
        />

        <PrimaryButton
          text='Create New Product'
          iconProps={{ iconName: 'Add' }}
          onClick={() => openNewItem("Product")}
        />
      </Stack>
    )
}

