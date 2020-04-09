import React from 'react';
import {Link} from './router.js'

export function Panes () {
    return (
    <div className="m-panes" data-grid="col-12" style={{"paddingTop": "0"}}>
        <section className="f-align-middle">
            <div className="m-panes-product-placement-item">
                <picture className="c-image">
                    <img alt="" src="https://statics-mwf-eus-ms-com.akamaized.net/_h/mwfhash2/mwf.app/images/components/panes/Panes_Large_Image_VP1-4.jpg"/>
                </picture>
                <div>
                    <h3 className="c-heading">Surface Book</h3>
                    <p className="c-paragraph">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla nec justo tincidunt, mattis dui non, ultrices massa. Nulla eleifend, eros sed laoreet auctor, turpis purus aliquet ligula, sit amet facilisis enim dolor nec nisl. Aliquam erat
                        volutpat.</p>
                    <div className="c-price" >
                        <span>Starting at&nbsp;</span>
                        <meta  content="USD"/>
                        <span>$</span>
                        <span >1,000</span>
                        <link  href="https://schema.org/InStock"/>
                    </div>
                    <div className="c-rating" data-value="3" data-max="5" >
                        <p className="x-screen-reader" id="sr_">Community rating:
                            <span >3</span>out of
                            <span >5</span>
                        </p>
                        <div aria-hidden="true"></div>
                    </div>
                    <div>
                        <Link route="/AddToCart" recordid={'050000000000000000000100'}  className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                            <span>Buy now</span>
                        </Link>
                    </div>
                </div>
            </div>
        </section>
        <section className="f-stacked">
            <div>
                <div className="m-panes-product-placement-item">
                    <picture className="c-image">
                        <img alt="" src="https://statics-mwf-eus-ms-com.akamaized.net/_h/mwfhash2/mwf.app/images/components/panes/Panes_Small_Image1_VP4.jpg"/>
                    </picture>
                    <div>
                        <h3 className="c-heading">Xbox One S</h3>
                        <p className="c-paragraph">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla nec justo tincidunt, mattis dui non, ultrices massa. Nulla eleifend, eros sed laoreet auctor, turpis purus aliquet ligula, sit amet facilisis enim dolor nec nisl. Aliquam
                            erat volutpat.</p>
                        <div className="c-price" >
                            <span>Starting at&nbsp;</span>
                           
                            <span>$</span>
                            <span >1,000</span>
                            <link href="https://schema.org/InStock"/>
                        </div>
                        <div className="c-rating" >
                            <p className="x-screen-reader" id="sr_">Community rating:
                                <span >3</span>out of
                                <span >5</span>
                            </p>
                            <div aria-hidden="true"></div>
                        </div>
                        <div>
                            <Link route="gete"  className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                                <span>Call To Action</span>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
            <div>
                <div className="m-panes-product-placement-item">
                    <picture className="c-image">
                        <img alt="" src="https://statics-mwf-eus-ms-com.akamaized.net/_h/mwfhash2/mwf.app/images/components/panes/Panes_Small_Image2_VP4.jpg" />
                    </picture>
                    <div>
                        <h3 className="c-heading">Surface Pro 4</h3>
                        <p className="c-paragraph">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla nec justo tincidunt, mattis dui non, ultrices massa. Nulla eleifend, eros sed laoreet auctor, turpis purus aliquet ligula, sit amet facilisis enim dolor nec nisl. Aliquam
                            erat volutpat.</p>
                        <div className="c-price">
                            <span>Starting at&nbsp;</span>
                           
                            <span>$</span>
                            <span >1,000</span>
                            <link  href="https://schema.org/InStock"/>
                        </div>
                        <div className="c-rating" >
                            <p className="x-screen-reader" id="sr_">Community rating:
                                <span >3</span>out of
                                <span >5</span>
                            </p>
                            <div aria-hidden="true"></div>
                        </div>
                        <div>
                            <Link href="#" className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                                <span>Call To Action</span>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </div>
    )
}

export function Feature () {
    return (
        <section className="m-feature f-align-left">
        <picture>
            <source srcset="https://placehold.it/800x450" media="(min-width: 1400px)"/>
            <source srcset="https://placehold.it/630x472" media="(min-width: 1084px)"/>
            <source srcset="https://placehold.it/542x406" media="(min-width: 768px)"/>
            <source srcset="https://placehold.it/767x288" media="(min-width: 540px)"/>
            <source srcset="https://placehold.it/539x201" media="(min-width:0)"/>
            <img srcset="https://placehold.it/630x472" src="https://placehold.it/630x472" alt="Placeholder with grey background and dimension watermark without any imagery"/>
        </picture>
        <div>
            <strong className="c-badge f-small f-highlight">BADGE</strong>
            <div className="c-logo">
                <img className="c-image" src="https://placehold.it/150x50" alt="Placeholder with grey background and dimension watermark without any imagery"/>
                <span>logo-image</span>
            </div>
            <h2 className="c-heading">Heading</h2>
            <p className="c-paragraph">Paragraph text. Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>
            <Link className="c-call-to-action c-glyph">
                <span>Call To Action</span>
            </Link>
        </div>
    </section>
    )
}

