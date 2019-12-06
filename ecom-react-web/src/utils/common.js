import React from 'react'


export function Alert(txt) {
    return (
        <div style={{display: "inline-block", float: "right"}}>
            <div className="m-alert f-error" role="alert" style={{marginTop: "0"}}>
              <button className="c-action-trigger c-glyph glyph-cancel" aria-label="Close alert"></button>
              <div>
                  <div className="c-glyph glyph-incident-triangle" aria-label="Error message"></div>
                  <p className="c-paragraph">{txt}
                      <span className="c-group">

                      </span>
                  </p>
              </div>
            </div>
          </div>
    )
}


export function AdditionalDetails() {
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
  