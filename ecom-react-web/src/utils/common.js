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