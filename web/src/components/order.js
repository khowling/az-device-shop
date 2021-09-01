import React from 'react'
import { Link, navTo } from './router.js'

import { Stack } from '@fluentui/react'
import { SSRBreadcrumb } from './page'

export function ManageOrders({ resource }) {

    const { status, result } = resource.read()


    return (

        <Stack>

            <SSRBreadcrumb
                items={[
                    { text: 'Home', key: 'home', route: '/' },
                    { text: 'My Orders', key: 'myorder', route: '/myorders' }]} />

            <div className="c-table f-divided" data-f-loc-ascending="Sorted by {0} - ascending" data-f-loc-descending="Sorted by {0} - descending">

                <table data-f-sort="true">

                    <thead>
                        <tr>
                            <th scope="col" colSpan="1">Order#</th>
                            <th scope="col" colSpan="1">Order Date</th>
                            <th scope="col" colSpan="1">Status</th>
                            <th scope="col" className="f-sortable f-numerical" colSpan="1" aria-sort="none">
                                <button aria-label="Sort by Length">Shipping</button>
                            </th>

                        </tr>
                    </thead>
                    <tbody>
                        {status === 'success' && result.data && result.data.map((o, idx) => {
                            const odate = o.checkout_date && new Date(o.checkout_date)
                            const status = o.orderState
                            return (
                                <tr key={idx}>
                                    <td><Link route="/o" urlid={o._id}>{status ? status.orderId : '<processing>'}</Link></td>
                                    <td>{odate ? odate.toGMTString() : ''}</td>
                                    <td>{o.status && <strong className="c-badge f-small f-highlight">{status ? ['Draft', 'New', 'InventoryAllocated', 'PickingReady', 'PickingAccepted', 'PickingComplete', 'Shipped', 'Received'][status.stage] : 'Queued'}</strong>}
                                    </td>
                                    <td className="f-numerical f-sub-categorical">{o.shipping ? o.shipping.shipping : "default"}</td>
                                    <td className="f-numerical f-sub-categorical">{o.qty}</td>

                                </tr>
                            )
                        }
                        )}
                    </tbody>
                </table>
            </div>
        </Stack>
    )
}


export function Order({ resource }) {

    const { status, result } = resource.read()
    console.log(status)

    return (
        <div>
            <header className="m-heading-4">
                <h4 className="c-heading">Order Status</h4>
            </header>

            <section data-grid="container">

                <div data-grid="col-6">

                    <label className="c-label" >OrderID</label>
                    <div>{result.order_number}</div>

                    <label className="c-label" >Order Status</label>
                    <div>
                        {result.status && <strong className="c-badge f-small f-highlight">{result.status}</strong>}
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
                                            <meta itemProp="priceCurrency" content="USD" />
                                            <span>$</span>
                                            <span itemProp="price">1,000</span>
                                            <link itemProp="availability" href="https://schema.org/InStock" />
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <th scope="row">Charley</th>
                                    <td>Charley Description sentence.</td>
                                    <td className="f-numerical">
                                        <div className="c-price" itemProp="offers" itemScope="" itemType="https://schema.org/Offer">
                                            <meta itemProp="priceCurrency" content="USD" />
                                            <span>$</span>
                                            <span itemProp="price">900</span>
                                            <link itemProp="availability" href="https://schema.org/InStock" />
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                </div>
            </section>
        </div>
    )
}
