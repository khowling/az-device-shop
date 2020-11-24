import React, { useState, useContext, useEffect } from 'react'
import { Alert, MyImage } from '../utils/common'
import { _fetchit } from '../utils/fetch.js'
//import { AppInsights } from 'applicationinsights-js'
import { Link, navTo } from './router.js'
import { AddedCartCount } from '../GlobalContexts'

import { DefaultButton, Breadcrumb, Separator, Stack, Spinner, Text, Label, ChoiceGroup, MessageBar, MessageBarType, PrimaryButton, DropdownMenuItemType, Dropdown, List, mergeStyleSets, getTheme, getFocusStyle } from '@fluentui/react'

const theme = getTheme();

const { palette, fonts } = theme

const classNames = mergeStyleSets({
  itemCell: [
    getFocusStyle(theme, { inset: -1 }),
    {
      minHeight: 54,
      padding: 10,
      boxSizing: 'border-box',
      borderBottom: `1px solid rgb(237, 235, 233)`,
      display: 'flex',
      selectors: {
        '&:hover': { background: " rgb(237, 235, 233)" }
      }
    }
  ],
  itemImage: {
    flexShrink: 0
  },
  itemContent: {
    marginLeft: 20,
    overflow: 'hidden',
    flexGrow: 0,
    width: '80%'
  },
  itemName: [
    fonts.xLarge,
    {
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  ],
  itemIndex: {
    fontSize: fonts.small.fontSize,
    color: palette.neutralTertiary,
    marginBottom: 10
  },
  chevron: {
    alignSelf: 'center',
    marginLeft: 20,
    color: palette.neutralTertiary,
    fontSize: fonts.large.fontSize,
    flexShrink: 0
  }
})

function Summary({ cart, checkout, dismissPanel }) {

  const [state, setState] = useState({ state: "ready" })
  const [shipping, setShipping] = useState('A')

  const [itemsInCart, setItemsInCart] = useContext(AddedCartCount)




  function _checkout() {
    setState({ state: "wait" })
    //    AppInsights.trackEvent("Add Order", item, { line_count: 1 })
    _fetchit('/api/checkout', 'PUT').then(succ => {
      console.log(`created success : ${JSON.stringify(succ)}`)
      setState({ state: "created-success", response: succ })
      setItemsInCart({ ...itemsInCart, count: itemsInCart.count + 1 })
      // Poll for status

      //navTo("ManageOrders")
    }, err => {
      console.error(`created failed : ${err}`)
      setState({ state: "error", description: err })
    })
  }

  return (
    <Stack styles={{ root: { padding: 10, backgroundColor: palette.themeLight } }} tokens={{ childrenGap: 15 }}>


      <Stack.Item align={checkout ? "start" : "end"}>
        <Text variant="large" block={true}>
          Subtotal ({cart.items_count || 0} items):  <Text variant="large">£{Array.isArray(cart.items) ? cart.items.reduce((acc, l) => acc + l.line_total, 0) : 0.00}</Text>
        </Text>
      </Stack.Item>

      { checkout ? [
        <Stack.Item key="address">
          <Label block={true}>Delivery Address:</Label>
          <Text style={{ marginLeft: "40px" }} block={true}>999 The Good Street</Text>
          <Text style={{ marginLeft: "40px" }} block={true}>Great Town</Text>
          <Text style={{ marginLeft: "40px" }} block={true}>OneoftheShire</Text>
          <Text style={{ marginLeft: "40px" }} block={true}>PC1 TPC</Text>
        </Stack.Item>,

        <ChoiceGroup key="shipping" style={{ marginTop: "40px" }}
          label="Select Shipping option"
          onChange={(e, i) => setShipping(i.key)}
          defaultSelectedKey={shipping}
          options={[
            { key: 'A', text: 'Within 4 working days (free)' },
            { key: 'B', text: 'Next Day (£9.99)' },
            { key: 'C', text: 'Same Day (not avaiable)', disabled: true }
          ]}

        />,

        <Text key="ordertotal" style={{ marginTop: "20px" }} variant="large">
          Order Total: £{(shipping === 'B' ? 9.99 : 0) + (Array.isArray(cart.items) ? cart.items.reduce((acc, l) => acc + l.line_total, 0) : 0.00)}
        </Text>,

        <div key="containeronly">
          {state.state === 'ready' ?
            <PrimaryButton key="offerorder" text="Place Order" onClick={_checkout} allowDisabledFocus disabled={state.state === 'wait' || cart.items_count === 0 || typeof cart.items_count === 'undefined'} />

            : state.state === 'wait' ?
              <Spinner key="needtowait" label="Wait..." ariaLive="assertive" labelPosition="right" />

              : state.state === 'created-success' ?

                <div key="created-success" className="m-alert f-information" role="alert">
                  <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
                  <div>
                    <div className="c-glyph glyph-info" aria-label="Information message"></div>
                    <h1 className="c-heading">Order Created</h1>
                    <p className="c-paragraph">Click here to see your order status
                    <span className="c-group">
                        <Link route="/myorders" className="c-action-trigger" role="button" component="ManageOrders">My Orders</Link>
                      </span>
                    </p>
                  </div>
                </div>

                : state.state === 'error' ?
                  <MessageBar key="checkerror" messageBarType={MessageBarType.severeWarning}>
                    <Text variant="xSmall">Failed to create Order : {state.description}, <Link route="/checkout" className="c-action-trigger" >retry</Link></Text>
                  </MessageBar>

                  : <div>unknow state</div>
          }
        </div>

      ] :
        <Stack.Item align="end">
          <Link route="/checkout" onClick={() => dismissPanel && dismissPanel()} className="c-call-to-action c-glyph" style={{ border: 0 }} disabled={state.state === 'wait' || cart.items_count === 0 || typeof cart.items_count === 'undefined'}>Checkout</Link>
          <Text variant="small" nowrap={true} block={true} >or</Text>
          <DefaultButton onClick={() => dismissPanel && dismissPanel()} disabled={state.state === 'wait'} className="c-call-to-action c-glyph" style={{ padding: 3, border: 0, color: "#0067b8", background: "transparent" }}><Text >Continue Shopping</Text></DefaultButton>
        </Stack.Item>
      }

    </Stack >
  )
}

export function MyCart({ dismissPanel, panel, resource, checkout }) {

  const { status, result } = resource.read()
  console.log(`Render MyCart (${status})`)
  const [cart, setCart] = useState(result.data)

  const [cartItemsAdded, setCartItemsAdded] = useContext(AddedCartCount)

  async function _removeitem(cartline) {
    console.log(cartline)
    try {
      await _fetchit('/api/cartdelete/' + cartline, 'PUT')
      setCartItemsAdded({ ...cartItemsAdded, count: cartItemsAdded.count - 1 })
      const newcart = await _fetchit('/api/componentFetch/mycart')
      console.log(newcart.data)
      setCart(newcart.data)
    } catch (err) {
      console.error(`created failed : ${err}`)
      //setState({state: "error", description: `POST ${err}`})
    }
  }

  function _onRenderCell(line, index, isScrolling) {
    //console.log(`rendering ${line}`)
    return (
      <div className={classNames.itemCell} data-is-focusable={true}>
        <MyImage image={line.item.image} width={panel ? 100 : 150} />
        <div className={classNames.itemContent}>
          <div className={classNames.itemName}>{line.item.heading}</div>
          <div className={classNames.itemIndex}>{Object.keys(line.options).map(o => <span key={o}>{o} : {line.options[o].text}</span>)}</div>
          <div style={{ marginBottom: 10 }}>{line.item.description}</div>
          <div >
            <div style={{ display: "inline" }}>
              <button onClick={() => _removeitem(line._id)} className="c-button f-lightweight" style={{ minWidth: 0, margin: 0, padding: 0, border: 0 }}>delete</button>

            </div>
          </div>
        </div>
        <div style={{ marginLeft: 30, lineHeight: 2 }}>
          <Dropdown
            selectedKey={line.qty}
            disabled={true}
            //onChange={(e, item) => setOptColor(item)}
            label="Qty"
            options={[
              { key: 1, text: '1' },
              { key: 2, text: "2" },
              { key: 3, text: "3" },
              { key: 4, text: '4', },
              { key: 5, text: "5" },
              { key: 6, text: "6" },
              { key: 7, text: "7" },
              { key: 8, text: "8" },
              { key: 9, text: "9" },
              { key: 10, text: "10" }
            ]}
          //styles={{ dropdown: { width: 300 } }}
          />
          <Text nowrap={true} block={true}>£{line.line_total}</Text>
        </div>
      </div>
    )
  }

  return (
    <Stack>
      { /* 
      <Breadcrumb
        items={[
          { text: 'Home', key: 'home',  onClick: () => navTo('/') },
          { text: 'My Cart', key: cart._id,  onClick: () => navTo('/mycart') }]} />
      */ }
      <Separator />
      <Stack horizontal wrap tokens={{ childrenGap: 15 }}>
        <Stack.Item styles={{ root: { width: "700px" } }} grow={1}>
          <List items={cart.items} onRenderCell={_onRenderCell} />
        </Stack.Item>
        <Stack.Item styles={{ root: { width: "300px" } }} grow={1}>
          <Summary cart={cart} checkout={checkout} dismissPanel={dismissPanel} />
        </Stack.Item>
      </Stack>
    </Stack>
  )
}

export function AddToCart({ resource }) {

  const [optColor, setOptColor] = useState()
  const [state, setState] = useState({ state: "enterdetails" })
  const [inventory, setInventory] = useState({ message: "Please wait...", state: MessageBarType.info, allow: false })

  const { status, result } = resource.read()
  const product = result.data
  const category = result.refstores.products.Category[0]

  const [itemsInCart, setItemsInCart] = useContext(AddedCartCount)

  function addorder() {
    setState({ state: "adding" })
    //    AppInsights.trackEvent("Add Order", item, { line_count: 1 })
    _fetchit('/api/cartadd', 'POST', {}, { itemid: product._id, options: { "Colour": optColor } }).then(succ => {
      console.log(`created success : ${JSON.stringify(succ)},  setting cartItemsAdded ${itemsInCart.count}`)
      setItemsInCart({ ...itemsInCart, count: itemsInCart.count + 1 })
      setState({ state: "added", response: succ })

    }, err => {
      console.error(`created failed : ${err}`)
      setState({ state: "error", description: err })
    })
  }

  useEffect(() => {
    _fetchit(`/api/onhand/${product._id}`).then(succ => {
      console.log(`success : ${JSON.stringify(succ)}`)
      setInventory({ allow: succ.onhand > 0, message: succ.onhand > 0 ? `Stock: ${succ.onhand}` : "Sorry, no stock at the moment", state: succ.onhand > 5 ? MessageBarType.success : (succ.onhand > 0 ? MessageBarType.warning : MessageBarType.SevereWarning) })
    }, err => {
      setInventory({ message: `Error retreiving stock: ${err}, please try later`, state: MessageBarType.error, allow: false })
    })
  }, [product._id])

  if (status === 'error')
    return <Alert txt={result} />
  else return (
    <Stack>

      <Breadcrumb
        items={[
          { text: 'Home', key: 'home', /*href: '/', */ onClick: () => navTo('/') },
          { text: category.heading, key: category._id, /*href: `/shop/${category._id}`, */ onClick: () => navTo('/shop', category._id) },
          { text: product.heading, key: product._id, /*href: `/a2c/${product._id}`, */ onClick: () => navTo('/a2c', product._id) }]} />

      <Stack horizontal wrap tokens={{ childrenGap: 15 }} >
        <Stack.Item styles={{ root: { background: theme.palette.themeSecondar } }} grow={1}>

          <MyImage image={product.image} style={{ "width": "100%", "maxWidth": "400px" }} />

        </Stack.Item>
        <Stack.Item styles={{ root: { background: theme.palette.themeSecondar, width: '300px' } }} grow={1} >
          <Stack tokens={{ childrenGap: 15 }}>
            <Stack.Item>
              <strong className="c-badge f-small f-highlight">{product.badge}</strong>
              <h3 className="c-heading">{product.heading}</h3>
              <p className="c-paragraph">{product.description}</p>

              <div className="c-price">
                <s><span className="x-screen-reader">Full price was</span>$1,500</s>
                <span>&nbsp;Now</span>
                <meta itemProp="priceCurrency" content="USD" />
                <span>&nbsp;$</span>
                <span itemProp="price">{product.price}</span>
              </div>
            </Stack.Item>



            <Dropdown
              selectedKey={optColor ? optColor.key : undefined}
              onChange={(e, item) => setOptColor(item)}
              label="Colour"
              placeholder="Select an option"
              options={[
                { key: 'matalic', text: 'Matalic', itemType: DropdownMenuItemType.Header },
                { key: "silver", text: "Silver" },
                { key: "gold", text: "Gold" },
                { key: 'texture', text: 'Texture', itemType: DropdownMenuItemType.Header },
                { key: "blue", text: "Blue" }
              ]}
              styles={{ dropdown: { width: 300 } }}
            />


            {state.state === 'enterdetails' ? [
              <Stack.Item key="button">
                <PrimaryButton disabled={!inventory.allow} onClick={addorder} text="Add to Cart" />
              </Stack.Item>,
              <Stack.Item key="stock" align="start">
                <MessageBar messageBarType={inventory.state}>{inventory.message}</MessageBar>
              </Stack.Item>
            ]
              : state.state === 'adding' ?
                <div className="c-progress f-indeterminate-local f-progress-small" role="progressbar" aria-valuetext="Loading..." tabIndex="0" aria-label="indeterminate local small progress bar">
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                : state.state === 'error' ?
                  <div className="m-alert f-warning" role="alert">
                    <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
                    <div>
                      <div className="c-glyph glyph-warning" aria-label="Warning message"></div>
                      <p className="c-paragraph">{state.description}
                        <span className="c-group">
                          <button className="c-action-trigger" onClick={addorder}>Try Again</button>
                          <Link route="/" className="c-action-trigger">Go Home</Link>
                        </span>
                      </p>
                    </div>
                  </div>
                  : state.state === 'added' ?
                    <div className="m-alert f-information" role="alert">
                      <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
                      <div>
                        <div className="c-glyph glyph-info" aria-label="Information message"></div>
                        <h1 className="c-heading">Items Added</h1>
                        <p className="c-paragraph">Click to open your Cart
                          <span className="c-group">
                            <DefaultButton /*route="/mycart"*/ onClick={() => setItemsInCart({ ...itemsInCart, open: true })} className="c-call-to-action c-glyph" style={{ padding: 3, border: 0, color: "#0067b8", background: "transparent" }} text="Cart" />

                          </span>
                        </p>
                      </div>
                    </div>
                    : <div></div>
            }

          </Stack>
        </Stack.Item>
      </Stack>
    </Stack>

  )
}
