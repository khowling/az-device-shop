import React, {useState} from 'react'
import {Alert, MyImage} from '../utils/common'
import {_fetchit } from '../utils/fetch.js'
//import { AppInsights } from 'applicationinsights-js'
import { Link } from './router.js'
import { DropdownMenuItemType, Dropdown } from '@fluentui/react/lib/Dropdown'
import { PrimaryButton, MessageBarButton } from '@fluentui/react/lib/Button'
import { MessageBar, MessageBarType  } from '@fluentui/react/lib/MessageBar'
import { ChoiceGroup } from '@fluentui/react/lib/ChoiceGroup'
import { Label  } from '@fluentui/react/lib/Label'
import { Text  } from '@fluentui/react/lib/Text'
import { Spinner  } from '@fluentui/react/lib/Spinner'
import { Depths } from '@uifabric/fluent-theme/lib/fluent/FluentDepths'
import { mergeStyleSets, getTheme, getFocusStyle } from '@fluentui/react/lib/Styling';
import { List } from '@fluentui/react/lib/List'
import { Image, ImageFit } from '@fluentui/react/lib/Image'
import {FontWeights} from '@uifabric/styling'
import { Card } from '@uifabric/react-cards'
import { Icon } from '@fluentui/react/lib/Icon'
import { /* SharedColors, */ NeutralColors  } from '@uifabric/fluent-theme/lib/fluent/FluentColors';

const theme = getTheme()
const { palette, semanticColors, fonts } = theme

const classNames  = mergeStyleSets({
  itemCell: [
    getFocusStyle(theme, { inset: -1 }),
    {
      minHeight: 54,
      padding: 10,
      boxSizing: 'border-box',
      borderBottom: `1px solid rgb(237, 235, 233)`,
      display: 'flex',
      selectors: {
        '&:hover': { background:" rgb(237, 235, 233)"}
      }
    }
  ],
  itemImage: {
    flexShrink: 0
  },
  itemContent: {
    marginLeft: 10,
    overflow: 'hidden',
    flexGrow: 1
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


export function MyCart({resource, checkout}) {
  const [state, setState] = useState({state: "ready"})

  const {status, result } = resource.read()
  const cart = result.data

  function _removeitem(cartline) {
    console.log (cartline)
    _fetchit('PUT','/api/cartdelete/'+cartline).then(succ => {
      window.location.reload()
      //navTo('/mycart')
    }, err => {
      console.error (`created failed : ${err}`)
      //setState({state: "error", description: `POST ${err}`})
    })
  }

  function _checkout() {
    setState ({state: "wait"})
//    AppInsights.trackEvent("Add Order", item, { line_count: 1 })
    _fetchit('PUT','/api/checkout').then(succ => {
      console.log (`created success : ${JSON.stringify(succ)}`)
      setState ({state: "ordered", response: succ})
      //navTo("ManageOrders")
    }, err => {
      console.error (`created failed : ${err}`)
      setState({state: "error", description: err})
    })
  }

  

  function  _onRenderCell(line, index, isScrolling) {
    console.log (`rendering ${line}`)
    return (
      <div className={classNames.itemCell} data-is-focusable={true}>
        <MyImage image={line.item.image} width={250} imageFit={ImageFit.cover}/>
        <div className={classNames.itemContent}>
          <div className={classNames.itemName}>{line.item.heading}</div>
          <div className={classNames.itemIndex}>{Object.keys(line.options).map(o => <span key={o}>{o} : {line.options[o].text}</span>)}</div>
          <div style={{ marginBottom: 10}}>{line.item.description}</div>
          <div >
            <div style={{ display: "inline"}}>
              <button  onClick={() => _removeitem(line._id)} className="c-button f-lightweight" style={{minWidth: 0, margin: 0, padding: 0, border: 0}}>delete</button>
             
            </div>
          </div>
        </div>
        <div style={{marginLeft: 30, lineHeight: 2}}>
          <Dropdown
            selectedKey={line.qty}
            disabled={true}
            //onChange={(e, item) => setOptColor(item)}
            label="Qty"
            options={[
              { key: 1, text: '1'},
              { key: 2, text: "2" },
              { key: 3, text: "3" },
              { key: 4, text: '4',},
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
        <Icon className={classNames.chevron} iconName={'ChevronRight'} />
      </div>
    )
  }

  return (
    <section data-grid="container">
      <header key="carth1" className="m-heading-4">
        <h4 className="c-heading" style={{float: "left"}}>Cart</h4>
        { status === 'success' &&

          <Card horizontal tokens={{childrenMargin: 20}} style={{float: "right"}}>

            <Card.Section styles={{root: {width: "700px"}}}>
              <Text  styles={{root: { color: '#025F52', fontWeight: FontWeights.semibold}}}>
                Checkout shopping Cart
              </Text>
              { state.state === 'error' ?
                <MessageBar  messageBarType={MessageBarType.error} isMultiline={false} truncated={true} styles={{root: {maxWidth: "300px"}}}>
                  <b>Faild to Checkout, please retry.</b>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; {state.description}</MessageBar>
                : state.state === 'success' ?
                <MessageBar styles={{root: {maxWidth: "350px"}}} actions={<div>
                      <MessageBarButton>Goto Order</MessageBarButton>
                    </div>} messageBarType={MessageBarType.success} isMultiline={false}>Order Created</MessageBar>
                : 
                <Text  >
                  Checkout to Order the items in your cart
                </Text>
              }
              <Card.Section horizontal tokens={{childrenGap: 10}}>
                <Text  >
                  Cart Total ({cart.items_count || 0} items)  : £{Array.isArray(cart.items) ? cart.items.reduce((acc,l) => acc+l.line_total,0) : 0.00}
                </Text>
              </Card.Section>

            </Card.Section>
      

            <Card.Section styles={{root: {width: "600px"}}}>
              
                { checkout ? 
                  <Card.Item >
                    <ChoiceGroup
                            label="Select Shipping option"
                            defaultSelectedKey="B"
                            options={[
                              { key: 'A', text: 'Nominated Day (£9.99)' },
                              { key: 'B', text: 'Next Day (£9.99)' },
                              { key: 'C', text: 'Same Day', disabled: true }
                            ]}
                         
                          />

                  <Text  style={{ marginTop: "40px"}} >
                    Order Total ({cart.items_count || 0} items)  : £{9.99+(Array.isArray(cart.items) ? cart.items.reduce((acc,l) => acc+l.line_total,0) : 0.00)}
                  </Text>

                    <PrimaryButton text="Place Order"  onClick={_checkout} allowDisabledFocus disabled={state.state === 'wait' || cart.items_count === 0 ||  typeof cart.items_count === 'undefined'} />
                  </Card.Item>
                :
                  <Card.Item >
                    <Link route="/checkout" className="c-call-to-action c-glyph" style={{ border: 0}} disabled={state.state === 'wait' || cart.items_count === 0 ||  typeof cart.items_count === 'undefined'}>Checkout cart</Link>
                    <Text variant="small" nowrap={true} block={true} >or</Text>
                    <Link route="/" disabled={state.state === 'wait'} className="c-call-to-action c-glyph" style={{padding: 3, border: 0, color: "#0067b8", background: "transparent"}}><Text >Continue Shopping</Text></Link>  
                  </Card.Item>
                }
              
              { state.state === 'wait' &&
                <Card.Item >
                  <Spinner label="Wait..." ariaLive="assertive" labelPosition="right" />
                </Card.Item>
              }
            </Card.Section>
          </Card>

        
        }
        <div style={{clear: "both", marginBottom: 20}}></div>
      </header>

      <List items={cart.items} onRenderCell={_onRenderCell} />

    </section>  
  )
}

export function AddToCart({resource}) {

  const [optColor, setOptColor] = useState()
  const [state, setState] = useState({state: "enterdetails"})

  const {status, result } = resource.read()
  const product = result.data

  function addorder() {
    setState ({state: "adding"})
//    AppInsights.trackEvent("Add Order", item, { line_count: 1 })
    _fetchit('POST','/api/cartadd', {itemid: product._id, options: {"Colour": optColor}}).then(succ => {
      console.log (`created success : ${JSON.stringify(succ)}`)
      setState ({state: "added", response: succ})
      //navTo("ViewOrder")
    }, err => {
      console.error (`created failed : ${err}`)
      setState({state: "error", description: err})
    })
  }

  if (status === 'error')
    return <Alert txt={result}/>
  else return (
    <section data-grid="container">
      <header className="m-heading-4">
          <h4 className="c-heading">Place Order</h4>
      </header>

      <div key="ShowProduct1" data-grid="col-6">
        <section className="m-product-placement-item context-device f-size-large" itemScope="" itemType="https://schema.org/Product">
          <div className="f-def ault-image">
              <picture>
                <MyImage className="c-image" image={product.image} alt="White frame with mountain landscape illustrated in white on a grey background"/>
              </picture>
          </div>
        </section>
      </div>
  
      <div key="ShowProduct2" data-grid="col-6">
      
        <div>
          <strong className="c-badge f-small f-highlight">{product.badge}</strong>
          <h3 className="c-heading">{product.heading}</h3>
          <p className="c-paragraph">{product.description}</p>
  
          <div className="c-price" itemProp="offers" itemScope="" itemType="https://schema.org/Offer">
            <s><span className="x-screen-reader">Full price was</span>$1,500</s>
            <span>&nbsp;Now</span>
            <meta itemProp="priceCurrency" content="USD"/>
            <span>&nbsp;$</span>
            <span itemProp="price">{product.price}</span>
            <link itemProp="availability" href="https://schema.org/InStock"/>
          </div>
        </div>
        <br/>
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
  
        <label className="c-label"></label>
        { state.state === 'enterdetails'?
          <div className="c-group f-wrap-items" role="group" aria-labelledby="single-select-foo">
            <button className="c-select-button" name="example" role="checkbox" aria-checked="true" data-js-selected-text="choice one has been selected" onClick={addorder}>Add to Cart</button>
          </div>
          : state.state === 'adding'? 
            <div className="c-progress f-indeterminate-local f-progress-small" role="progressbar" aria-valuetext="Loading..." tabIndex="0" aria-label="indeterminate local small progress bar">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
          </div>
          : state.state === 'error'?
            <div className="m-alert f-warning" role="alert">
              <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
              <div>
                  <div className="c-glyph glyph-warning" aria-label="Warning message"></div>
                  <p className="c-paragraph">{state.description}
                      <span className="c-group">
                          <button className="c-action-trigger"  onClick={addorder}>Try Again</button>
                          <Link route="/" className="c-action-trigger">Go Home</Link>
                      </span>
                  </p>
              </div>
          </div>
          : state.state === 'added'?
            <div className="m-alert f-information" role="alert">
              <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
              <div>
                  <div className="c-glyph glyph-info" aria-label="Information message"></div>
                  <h1 className="c-heading">Items Added</h1>
                  <p className="c-paragraph">Click here to open your Cart
                      <span className="c-group">
                          <Link route="/mycart" className="c-action-trigger" role="button" component="ManageOrders">Cart</Link>
                  
                      </span>
                  </p>
              </div>
          </div>
      : <div></div>
      }
      </div>
    </section>
  )
}
