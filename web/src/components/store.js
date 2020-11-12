import React /*, { useEffect }*/ from 'react';
import { Link, navTo } from './router.js'
import { MyImage } from '../utils/common'

import { Stack, Breadcrumb } from '@fluentui/react'

export function Panes({ resource }) {

    const { status, result } = resource.read()

    if (status !== 'success') return null; else {
        const hero = result.data.Category.filter(c => c.position === "hero")
        const highlight = result.data.Category.filter(c => c.position === "highlight")

        return (

            <div className="m-panes" data-grid="col-12" style={{ "paddingTop": "0" }}>
                {hero.map(i =>

                    <section key={i._id} className="f-align-middle">
                        <div className="m-panes-product-placement-item">
                            <picture className="c-image" >
                                <MyImage width="450" image={i.image} alt="no pic" />
                            </picture>
                            <div>
                                <h3 className="c-heading">{i.heading}</h3>
                                <p className="c-paragraph">{i.description}</p>
                                <div className="c-price" >
                                    <span>Starting at&nbsp;</span>
                                    <meta content="USD" />
                                    <span>$</span>
                                    <span >1,000</span>
                                    <link href="https://schema.org/InStock" />
                                </div>
                                <div className="c-rating" data-value="3" data-max="5" >
                                    <p className="x-screen-reader" id="sr_">Community rating:
                            <span >3</span>out of
                            <span >5</span>
                                    </p>
                                    <div aria-hidden="true"></div>
                                </div>
                                <div>
                                    <Link route="/shop" urlid={i._id} className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                                        <span>Shop now</span>
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                <section className="f-stacked">
                    {highlight.map(i =>
                        <div key={i._id}>
                            <div className="m-panes-product-placement-item">
                                <picture className="c-image">
                                    <MyImage width="300" image={i.image} alt="no pic" />
                                </picture>
                                <div>
                                    <h3 style={{ padding: 0 }} className="c-heading">{i.heading}</h3>
                                    <p className="c-paragraph">{i.description}</p>
                                    <div className="c-price" >
                                        <span>Starting at&nbsp;</span>

                                        <span>$</span>
                                        <span >1,000</span>
                                        <link href="https://schema.org/InStock" />
                                    </div>
                                    <div className="c-rating" >
                                        <p className="x-screen-reader" id="sr_">Community rating:
                                <span >3</span>out of
                                <span >5</span>
                                        </p>
                                        <div aria-hidden="true"></div>
                                    </div>
                                    <div>
                                        <Link route="/shop" urlid={i._id} className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                                            <span>Shop now</span>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        )
    }
}

export function Panes3x({ resource }) {

    const { status, result } = resource.read()


    if (status !== 'success') return null; else {

        const products = result.data.Product
        const category = result.refstores.products.Category[0]

        return (

            <Stack>

                <Breadcrumb
                    items={[
                        { text: 'Home', key: 'home', href: '/', onClick: () => navTo('/') },
                        { text: category.heading, key: category._id, href: `/shop/${category._id}`, onClick: () => navTo('/shop', category._id) }]} />


                <div className="m-panes" data-grid="col-12">
                    {products.map(i =>
                        <section key={i._id}>
                            <div className="m-panes-product-placement-item">
                                <picture className="c-image">
                                    <MyImage image={i.image} style={{ "width": "100%", "maxWidth": "400px" }} />
                                </picture>
                                <div>
                                    <h3 className="c-heading">{i.heading}</h3>
                                    <p className="c-paragraph">{i.description}</p>
                                    <div className="c-price" >
                                        <span>Starting at&nbsp;</span>

                                        <span>$</span>
                                        <span >1,000</span>
                                        <link href="https://schema.org/InStock" />
                                    </div>
                                    <div className="c-rating" >
                                        <p className="x-screen-reader" id="sr_">Community rating:
                                <span >3</span>out of
                                <span >5</span>
                                        </p>
                                        <div aria-hidden="true"></div>
                                    </div>
                                    <div>
                                        <Link route="/a2c" urlid={i._id} className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                                            <span>Details</span>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </Stack>
        )
    }
}

