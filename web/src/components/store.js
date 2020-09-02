import React, { useEffect } from 'react';
import { Link } from './router.js'
import { Alert, MyImage } from '../utils/common'
import { Image, IImageProps, ImageFit } from '@fluentui/react/lib/Image'
import { Breadcrumb } from '@fluentui/react/lib/Breadcrumb'
import { Stack, IStackProps } from '@fluentui/react/lib/Stack'

export function Panes({ resource }) {

    const { status, result } = resource.read()

    if (status !== 'success') return null; else {
        const hero = result.data.Category.filter(c => c.position == "hero")
        const highlight = result.data.Category.filter(c => c.position == "highlight")

        return (

            <div className="m-panes" data-grid="col-12" style={{ "paddingTop": "0" }}>
                {hero.map(i =>

                    <section key={i._id} className="f-align-middle">
                        <div className="m-panes-product-placement-item">
                            <picture className="c-image" >
                                <MyImage styles={{ root: { margin: "0 auto;" } }} imageFit={ImageFit.CenterContain} width={450} image={i.image} alt="no pic" />
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
                                    <Link route="/p" urlid={i._id} className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
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
                                    <MyImage imageFit={ImageFit.CenterContain} width={300} image={i.image} alt="no pic" />
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
                                        <Link route="/p" urlid={i._id} className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
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
                        { text: 'Home', key: 'home', href: '/' },
                        { text: category.heading, key: category._id, href: '/' }]} />


                <div className="m-panes" data-grid="col-12">
                    {products.map(i =>
                        <section>
                            <div className="m-panes-product-placement-item">
                                <picture className="c-image">
                                    <MyImage imageFit={ImageFit.CenterContain} image={i.image} alt="no pic" />
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
                                        <Link route="/AddToCart" urlid={i._id} className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
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

