import React, {useState, useEffect, Suspense} from 'react'
import {Alert} from '../utils/common'
import {_fetchit } from '../utils/fetch.js'
//import { AppInsights } from 'applicationinsights-js'
import { Link } from './router.js'
import { DropdownMenuItemType, Dropdown } from 'office-ui-fabric-react/lib/Dropdown'


export function MyCart({resource}) {

  function _removeitem(cartline) {
    console.log (cartline)
    _fetchit('PUT','/api/delcartitem/'+cartline).then(succ => {
      window.location.reload()
      //navTo('/mycart')
    }, err => {
      console.error (`created failed : ${err}`)
      //setOrderState({state: "error", description: `POST ${err}`})
    })
  }

  function ShowCart({resource}) {
    //const [orderState, setOrderState] = useState({state: "enterdetails"})
  
    const {status, result } = resource.read()

    return [
      <header key="h1" className="m-heading-4">
        <h4 className="c-heading">Cart</h4>
      </header>,

      <div key="h2"  className="c-table f-divided" data-f-loc-ascending="Sorted by {0} - ascending" data-f-loc-descending="Sorted by {0} - descending">
        <table data-f-sort="true">
        
          <thead>
              <tr>
                  <th></th>
                  <th scope="col" className="f-sortable f-numerical" colSpan="1" aria-sort="none">
                      <button aria-label="Sort by Length">Product</button>
                  </th>
                  <th scope="col" className="f-sub-categorical" colSpan="1" aria-sort="none">
                      <button aria-label="Sort by Width">Qty</button>
                  </th>
                  <th scope="col" className="f-sortable f-numerical" colSpan="1" aria-sort="none">
                      <button aria-label="Sort by Price">Price</button>
                  </th>
              </tr>
          </thead>
          <tbody>
            { status === 'success' && result.items && result.items.map((i,idx) =>
              <tr key={"cart"+idx}>
                  <td><img src={i.item.image} height="250" alt="pic" ></img></td>
                  <td className="f-numerical f-sub-categorical">{i.item.heading} <br/>  {Object.keys(i.options).map(o => <div>{o} : {i.options[o].text}</div>)}</td>
                  <td className="f-sub-categorical">{i.qty} <br/> <button onClick={() => _removeitem(i._id)} className="c-button f-lightweight">delete</button></td>
                  <td className="f-numerical">
                      <div className="c-price" itemProp="offers" itemScope="" itemType="https://schema.org/Offer">
                          <meta itemProp="priceCurrency" content="GBP"/>
                          <span>£</span>
                          <span itemProp="price">{i.item.price}</span>
                          <link itemProp="availability" href="https://schema.org/InStock"/>
                      </div>
                  </td>
              </tr>
            )}
          </tbody>
      </table>
  </div>
    ]
  }

  return (
    <section data-grid="container">
      <Suspense fallback={<h4>Loading Cart...</h4>}>
        <ShowCart resource={resource} />
      </Suspense>
    </section>
  )
}

export function ManageOrders() { 
  const [orders, setOrders] = useState({status: "loading", orders: []})

  useEffect(() => {
    get()
  },[])


  function get() {
    _fetchit('GET','/api/orders').then(succ => {
      console.log (`got list success : ${JSON.stringify(succ)}`)
      setOrders({ status: "success", orders: succ});
    }, err => {
      setOrders({status: "error", message: `GET ${err}`})
    })
  }

  return (

    <div className="c-table f-divided" data-f-loc-ascending="Sorted by {0} - ascending" data-f-loc-descending="Sorted by {0} - descending">
      <table data-f-sort="true">
        
        <thead>
            <tr>
                <th scope="col" colSpan="1">Order#</th>
                <th scope="col" colSpan="1">Order Date</th>
                <th scope="col" colSpan="1">Status</th>
                <th scope="col" className="f-sortable f-numerical" colSpan="1" aria-sort="none">
                    <button aria-label="Sort by Length">Product</button>
                </th>
                <th scope="col" className="f-sortable f-numerical" colSpan="1" aria-sort="none">
                    <button aria-label="Sort by Width">Qty</button>
                </th>
                <th scope="col" className="f-sortable f-numerical" colSpan="1" aria-sort="none">
                    <button aria-label="Sort by Price">Price</button>
                </th>
            </tr>
        </thead>
        <tbody>
          { orders.orders.map((o,idx) =>
            <tr>
                <td><Link route="/OrderStatus" recordid={o.id}>ORD-{o.id.substr(0,13)}</Link></td>
                <td>{Date(o._ts).substr(0,24)}</td>
                <td>{o.status && <strong className="c-badge f-small f-highlight">{o.status}</strong>}
                </td>
                <td className="f-numerical f-sub-categorical">{o.heading}</td>
                <td className="f-numerical f-sub-categorical">{o.qty}</td>
                <td className="f-numerical">
                    <div className="c-price" itemProp="offers" itemScope="" itemType="https://schema.org/Offer">
                        <meta itemProp="priceCurrency" content="GBP"/>
                        <span>£</span>
                        <span itemProp="price">{o.price}</span>
                        <link itemProp="availability" href="https://schema.org/InStock"/>
                    </div>
                </td>
            </tr>
          )}
        </tbody>
    </table>
</div>


    )
}


export function Order({resource}) {

  function ShowProduct({resource}) {
    const [optColor, setOptColor] = useState()
    const [orderState, setOrderState] = useState({state: "enterdetails"})
  
    const {status, result } = resource.read()
  
    function addorder() {
      setOrderState ({state: "ordering"})
  //    AppInsights.trackEvent("Add Order", item, { line_count: 1 })
      _fetchit('POST','/api/cart', JSON.stringify({itemid: result._id, options: {"Colour": optColor}})).then(succ => {
        console.log (`created success : ${JSON.stringify(succ)}`)
        setOrderState ({state: "ordered", response: succ})
        //navTo("ManageOrders")
      }, err => {
        console.error (`created failed : ${err}`)
        setOrderState({state: "error", description: `POST ${err}`})
      })
    }

    if (status === 'error')
      return <Alert txt={result}/>
    else return [
      <div key="ShowProduct1" data-grid="col-6">
        <section className="m-product-placement-item context-device f-size-large" itemScope="" itemType="https://schema.org/Product">
          <div className="f-def ault-image">
              <picture>
                <img className="c-ima ge" src={result.image} alt="White frame with mountain landscape illustrated in white on a grey background"/>
              </picture>
          </div>
        </section>
      </div>,
  
      <div key="ShowProduct2" data-grid="col-6">
      
        <div>
          <strong className="c-badge f-small f-highlight">{result.badge}</strong>
          <h3 className="c-heading">{result.heading}</h3>
          <p className="c-paragraph">{result.description}</p>
  
          <div className="c-price" itemProp="offers" itemScope="" itemType="https://schema.org/Offer">
            <s><span className="x-screen-reader">Full price was</span>$1,500</s>
            <span>&nbsp;Now</span>
            <meta itemProp="priceCurrency" content="USD"/>
            <span>&nbsp;$</span>
            <span itemProp="price">{result.price}</span>
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
        { orderState.state === 'enterdetails'?
          <div className="c-group f-wrap-items" role="group" aria-labelledby="single-select-foo">
            <button className="c-select-button" name="example" role="checkbox" aria-checked="true" data-js-selected-text="choice one has been selected" onClick={addorder}>Add to Cart</button>
          </div>
          : orderState.state === 'ordering'? 
            <div className="c-progress f-indeterminate-local f-progress-small" role="progressbar" aria-valuetext="Loading..." tabIndex="0" aria-label="indeterminate local small progress bar">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
          </div>
          : orderState.state === 'error'?
            <div className="m-alert f-warning" role="alert">
              <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
              <div>
                  <div className="c-glyph glyph-warning" aria-label="Warning message"></div>
                  <p className="c-paragraph">{orderState.description}
                      <span className="c-group">
                          <Link className="c-action-trigger" >Link to action</Link>
                          <Link className="c-action-trigger">Link to action</Link>
                      </span>
                  </p>
              </div>
          </div>
          : orderState.state === 'ordered'?
            <div className="m-alert f-information" role="alert">
              <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
              <div>
                  <div className="c-glyph glyph-info" aria-label="Information message"></div>
                  <h1 className="c-heading">Order Created</h1>
                  <p className="c-paragraph">Click in the link to view your new order status: {orderState.response}.
                      <span className="c-group">
                          <Link className="c-action-trigger" role="button" component="ManageOrders">Link to action</Link>
                  
                      </span>
                  </p>
              </div>
          </div>
      : <div></div>
      }
      </div>
    ]
  }

  return (
    <section data-grid="container">
      <header className="m-heading-4">
          <h4 className="c-heading">Place Order</h4>
      </header>
      <Suspense fallback={<h1>Loading profile...</h1>}>
        <ShowProduct resource={resource} />
      </Suspense>
      <AdditionalDetails/>
    </section>
  )
}

function AdditionalDetails() {
  return (
    <section className="m-additional-information">
      <div data-grid="col-12 stack-2">
        <div data-grid="col-6">
            <div data-grid="col-6">
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Publisher</strong>
                    </li>
                    <li>Electronic Arts</li>
                    <li>Copyright &copy; 2016</li>
                </ul>
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Release date</strong>
                    </li>
                    <li>11/4/15</li>
                </ul>
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Approximate size</strong>
                    </li>
                    <li>00.00 GB</li>
                </ul>
            </div>
            <div data-grid="col-6">
                <div className="c-age-rating">
                    <img className="c-image" src="https://placehold.it/56x56" alt="Placeholder with grey background"/>
                    <p className="c-label">Teen</p>
                    <p className="c-paragraph">Suitable for 13+</p>
                    <div className="c-content-toggle">
                        <ul className="c-list f-bare f-lean" id="learn-more" data-f-expanded="false">
                            <li>Blood and gore</li>
                            <li>Adult themes</li>
                        </ul>
                        <button data-f-more="More" data-f-less="Less" data-f-show="0">More</button>
                    </div>
                </div>
                <div className="c-content-toggle">
                    <p id="content-toggle-target" data-f-expanded="false">
                        <strong>Permissions</strong>
                        <br/>Uses your location
                        <br/>Uses your webcam
                        <br/>Uses your microphone
                        <br/>
                    </p>
                    <button data-f-more="Show more" data-f-less="Show less" data-f-show="3">Show more</button>
                </div>
            </div>
        </div>
        <div data-grid="col-6">
            <div data-grid="col-6">
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Multiplayer</strong>
                    </li>
                    <li>Online and local</li>
                </ul>
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Coop</strong>
                    </li>
                    <li>Online and local</li>
                </ul>
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>In-app purchases</strong>
                    </li>
                    <li>$0.99-$9.99</li>
                </ul>
            </div>
            <div data-grid="col-6">
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Installation</strong>
                    </li>
                    <li>This game can be installed on up to 10 Windows 10 devices</li>
                </ul>
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Languages supported</strong>
                    </li>
                    <li>English (United States)</li>
                </ul>
                <ul className="c-list f-bare f-lean">
                    <li>
                        <strong>Additional terms</strong>
                    </li>
                    <li>
                        <a href="https://www.getmwf.com" className="c-hyperlink">Store terms of use</a>
                    </li>
                </ul>
                <a href="https://www.getmwf.com" className="c-hyperlink">Report this app to Microsoft</a>
            </div>
        </div>
      </div>
    </section>
  )
}

export function OrderStatus ({recordid}) {
  const [order, setOrder] = useState({status: "loading", order: {}})

  useEffect((recordid) => {
    get(recordid)
  }, [recordid])



  function get(recordid) {
    _fetchit('GET',`/api/order/${recordid}`).then(succ => {
      console.log (`got list success : ${JSON.stringify(succ)}`)
      setOrder({ status: "success", order: succ});
    }, err => {
      setOrder({status: "error", message: `GET ${err}`})
    })
  }

  if (order.status === "loading") {
    return (
      <div className="c-progress f-indeterminate-local f-progress-small" role="progressbar" aria-valuetext="Loading..." tabIndex="0" aria-label="indeterminate local small progress bar">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
      </div>
  )} else if (order.status === "success") {
    return (
      <div>
        <header className="m-heading-4">
            <h4 className="c-heading">Order Status</h4>
        </header>

        <section data-grid="container">
         
          <div data-grid="col-6">
          
            <label className="c-label" >OrderID</label>
            <div>{`ORD-${order.order.id.substr(0,13)}`}</div>

            <label className="c-label" >Order Status</label>
            <div>
            {order.order.status && <strong className="c-badge f-small f-highlight">{order.order.status}</strong>}
            </div>

          </div>
          <div data-grid="col-6">
            <div className="c-table" data-f-loc-ascending="Sorted by {0} - ascending" data-f-loc-descending="Sorted by {0} - descending">
              <table>
                  
                  <thead>
                      <tr>
                          <th scope="col">Date</th>
                          <th id="defaultDesc" scope="col" colspan="1">Description</th>
                          <th id="defaultPrice" scope="col" className="f-numerical" colspan="1">Status</th>
                      </tr>
                  </thead>
                  <tbody>
                      <tr>
                          <th scope="row">Bravo</th>
                          <td>Bravo Description sentence.</td>
                          <td className="f-numerical">
                              <div className="c-price" itemProp="offers" itemScope="" itemType="https://schema.org/Offer">
                                  <meta itemProp="priceCurrency" content="USD"/>
                                  <span>$</span>
                                  <span itemProp="price">1,000</span>
                                  <link itemProp="availability" href="https://schema.org/InStock"/>
                              </div>
                          </td>
                      </tr>
                      <tr>
                          <th scope="row">Charley</th>
                          <td>Charley Description sentence.</td>
                          <td className="f-numerical">
                              <div className="c-price" itemProp="offers" itemScope="" itemType="https://schema.org/Offer">
                                  <meta itemProp="priceCurrency" content="USD"/>
                                  <span>$</span>
                                  <span itemProp="price">900</span>
                                  <link itemProp="availability" href="https://schema.org/InStock"/>
                              </div>
                          </td>
                      </tr>
                  </tbody>
              </table>
          </div>

        </div>
        </section>
      </div>
  )}
}
