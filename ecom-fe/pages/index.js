
function Home() {
    return (
      <main id="mainContent" data-grid="container">
        <Nav/>
        <Panes/>
      </main>)
  }

 function Nav ({user}) {


    return (
      <nav className="m-navigation-bar" role="navigation">

        <div class="c-navigation-menu">
  
          <a href="#/" className="navbar-brand no-outline">
              <img src="https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png" alt="Microsoft" height="23"/>
          </a>

          <button aria-controls="navigationMenuA" aria-haspopup="true" aria-expanded="false">Navigation menu</button>
          <ul id="navigationMenuA" aria-hidden="true">
              <li className="f-sub-menu">
                  <button aria-controls="navigationMenuAMenu1" aria-haspopup="true" aria-expanded="false">Sub menu 1</button>
                  <ul id="navigationMenuAMenu1" aria-hidden="true">
                      <li>
                          <a href="#">Hyperlink 1</a>
                      </li>
                      <li>
                          <a href="#">Hyperlink 2</a>
                      </li>
                      <li>
                          <a href="#">Hyperlink 3</a>
                      </li>
                  </ul>
              </li>
              <li>
                  <a href="#">Hyperlink 1</a>
              </li>
              <li>
                  <a href="#">Hyperlink 2</a>
              </li>
              <li>
                  <a href="#">Hyperlink 3</a>
              </li>
              <li>
                  <a href="#" target="_blank">Hyperlink 4</a>
              </li>
          </ul>
        </div>
      </nav>
    )
  }


  function Panes () {
    return (
    <div className="m-panes" data-grid="col-12" style={{"paddingTop": "0"}}>
      <section className="f-align-middle">
          <div className="m-panes-product-placement-item">
              <picture className="c-image">
                  <img src="https://statics-mwf-eus-ms-com.akamaized.net/_h/mwfhash2/mwf.app/images/components/panes/Panes_Large_Image_VP1-4.jpg" alt="Placeholder image"/>
              </picture>
              <div>
                  <h3 className="c-heading">Surface Book</h3>
                  <p className="c-paragraph">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla nec justo tincidunt, mattis dui non, ultrices massa. Nulla eleifend, eros sed laoreet auctor, turpis purus aliquet ligula, sit amet facilisis enim dolor nec nisl. Aliquam erat
                      volutpat.</p>
                  <div className="c-price" itemprop="offers" itemscope="" itemtype="https://schema.org/Offer">
                      <span>Starting at&nbsp;</span>
                      <meta itemprop="priceCurrency" content="USD"/>
                      <span>$</span>
                      <span itemprop="price">1,000</span>
                      <link itemprop="availability" href="https://schema.org/InStock"/>
                  </div>
                  <div className="c-rating" data-value="3" data-max="5" itemscope="" itemtype="https://schema.org/AggregateRating">
                      <p className="x-screen-reader" id="sr_">Community rating:
                          <span itemprop="ratingValue">3</span>out of
                          <span itemprop="bestRating">5</span>
                      </p>
                      <div aria-hidden="true"></div>
                  </div>
                  <div>
                      <a href="#" className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                          <span>Call To Action</span>
                      </a>
                  </div>
              </div>
          </div>
      </section>
      <section className="f-stacked">
          <div>
              <div className="m-panes-product-placement-item">
                  <picture className="c-image">
                      <img src="https://statics-mwf-eus-ms-com.akamaized.net/_h/mwfhash2/mwf.app/images/components/panes/Panes_Small_Image1_VP4.jpg" alt="Placeholder image"/>
                  </picture>
                  <div>
                      <h3 className="c-heading">Xbox One S</h3>
                      <p className="c-paragraph">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla nec justo tincidunt, mattis dui non, ultrices massa. Nulla eleifend, eros sed laoreet auctor, turpis purus aliquet ligula, sit amet facilisis enim dolor nec nisl. Aliquam
                          erat volutpat.</p>
                      <div className="c-price" itemprop="offers" itemscope="" itemtype="https://schema.org/Offer">
                          <span>Starting at&nbsp;</span>
                          <meta itemprop="priceCurrency" content="USD"/>
                          <span>$</span>
                          <span itemprop="price">1,000</span>
                          <link itemprop="availability" href="https://schema.org/InStock"/>
                      </div>
                      <div className="c-rating" data-value="3" data-max="5" itemscope="" itemtype="https://schema.org/AggregateRating">
                          <p className="x-screen-reader" id="sr_">Community rating:
                              <span itemprop="ratingValue">3</span>out of
                              <span itemprop="bestRating">5</span>
                          </p>
                          <div aria-hidden="true"></div>
                      </div>
                      <div>
                          <a href="#" className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                              <span>Call To Action</span>
                          </a>
                      </div>
                  </div>
              </div>
          </div>
          <div>
              <div className="m-panes-product-placement-item">
                  <picture className="c-image">
                      <img src="https://statics-mwf-eus-ms-com.akamaized.net/_h/mwfhash2/mwf.app/images/components/panes/Panes_Small_Image2_VP4.jpg" alt="Placeholder image"/>
                  </picture>
                  <div>
                      <h3 className="c-heading">Surface Pro 4</h3>
                      <p className="c-paragraph">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla nec justo tincidunt, mattis dui non, ultrices massa. Nulla eleifend, eros sed laoreet auctor, turpis purus aliquet ligula, sit amet facilisis enim dolor nec nisl. Aliquam
                          erat volutpat.</p>
                      <div className="c-price" itemprop="offers" itemscope="" itemtype="https://schema.org/Offer">
                          <span>Starting at&nbsp;</span>
                          <meta itemprop="priceCurrency" content="USD"/>
                          <span>$</span>
                          <span itemprop="price">1,000</span>
                          <link itemprop="availability" href="https://schema.org/InStock"/>
                      </div>
                      <div className="c-rating" data-value="3" data-max="5" itemscope="" itemtype="https://schema.org/AggregateRating">
                          <p className="x-screen-reader" id="sr_">Community rating:
                              <span itemprop="ratingValue">3</span>out of
                              <span itemprop="bestRating">5</span>
                          </p>
                          <div aria-hidden="true"></div>
                      </div>
                      <div>
                          <a href="#" className="c-call-to-action c-glyph" aria-label="More verbose call to action text">
                              <span>Call To Action</span>
                          </a>
                      </div>
                  </div>
              </div>
          </div>
      </section>
    </div>
    )
  }

  function Feature () {
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
                <img className="c-image" src="https://placehold.it/150x50" alt="Placeholder with grey background and dimension watermark without any imagery" itemscope="" itemtype="https://schema.org/ImageObject"/>
                <span>logo-image</span>
            </div>
            <h2 className="c-heading">Heading</h2>
            <p className="c-paragraph">Paragraph text. Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>
            <a href="#" className="c-call-to-action c-glyph">
                <span>Call To Action</span>
            </a>
        </div>
    </section>
    )
  }

  
  export default Home