import React, { useState } from 'react'

import { putBlob /*, listFiles */ } from '../utils/azureBlob.js'

import { Toggle, TextField, DefaultButton, Stack } from '@fluentui/react'


export function MyImage({ image, ...rest }) {
    if (image) {
        if (image.url) {
            return (
                <img src={image.url} alt="" {...rest} />
            )
        } else if (image.container_url && image.pathname) {
            return (
                <img src={image.container_url + "/" + image.pathname} alt="" {...rest} />
            )
        } else {
            return (
                <img src={"http://placehold.it/50x50"} alt="" {...rest} />
            )
        }
    } else {
        return (
            <img src={"http://placehold.it/50x50"} alt="" {...rest} />
        )
    }
}


export function Alert(txt) {
    return (
        <div style={{ display: "inline-block", float: "right" }}>
            <div className="m-alert f-error" role="alert" style={{ marginTop: "0" }}>
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
                            <img className="c-image" src="https://placehold.it/56x56" alt="Placeholder with grey background" />
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
                                <br />Uses your location
                          <br />Uses your webcam
                          <br />Uses your microphone
                          <br />
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



export function EditImage({ result_image, onChange }) {

    const [imageTypeUrl, setImageTypeUrl] = useState(result_image ? result_image.hasOwnProperty('url') : false)
    const [imageUrl, setImageUrl] = useState(imageTypeUrl && result_image && result_image.url ? result_image.url : '')

    console.log(`EditImage, result_image ${JSON.stringify(result_image)}`)
    let previewsrc = !result_image ? "http://placehold.it/300x150" : imageTypeUrl ? result_image.url : result_image.container_url + "/" + result_image.pathname
    // Picture
    const fileInputRef = React.createRef()

    function _onImageUrlChange(e) {

        if (imageTypeUrl) {
            console.log(`_onImageUrlChange: update image ${e.currentTarget.value}`)
            onChange({ target: { name: "image" } }, { "url": e.currentTarget.value })
        }
    }

    function _clickFile() {
        fileInputRef.current.click()
    }

    function _fileuploadhtml5(e) {
        var file = e.currentTarget.files[0];

        if (file) {
            console.log(`_fileuploadhtml5: ${file.name} - ${file.type}`)
            putBlob(file, progressEvt => {
                console.log('progress ' + progressEvt.loaded);
                if (progressEvt.lengthComputable) {
                    //this.line.animate(Math.round(progressEvt.loaded / progressEvt.total));
                } else {
                    //this.line.animate(0.5);
                }
            }, err => {
                alert(`_fileuploadhtml5 Upload failed: ${err}`)
            }).then(attachment => {

                //this.line.animate(1, () => this.line.set(0));
                console.log(`_fileuploadhtml5 Got : ${JSON.stringify(attachment)}`)

                onChange({ target: { name: "image" } }, attachment)

                //data.documents[field.name] = evt.target.responseText;
            }, err => {
                // console.log ("There was an error attempting to upload the file:" + JSON.stringify(errEvt));
                alert(`Upload failed: ${err}`)
                //this.line.set(0);
            })
        } else {
            console.log('pressed cancel')
        }
        return false;
    }


    return (
        <Stack tokens={{ childrenGap: 5, padding: 20 }} styles={{ root: { border: "1px solid" } }}>
            <Toggle key="image_Toggle" label="Image location" inlineLabel onText="external Url" offText="File Upload" defaultChecked={imageTypeUrl} onChange={(e, val) => { console.log(`setImageTypeUrl ${val}`); setImageTypeUrl(val) }} />
            <input key="image_input" type="file" ref={fileInputRef} name="file" style={{ display: "none" }} accept="image/*" onChange={_fileuploadhtml5} />

            <a key="image_a" href={previewsrc} target="_won">
                <MyImage width="250" src={previewsrc} alt="" />
            </a>

            <TextField key="image_text" prefix="Full Url" name="imageUrl" value={imageUrl} onBlur={_onImageUrlChange} onChange={(e, val) => setImageUrl(val)} required={imageTypeUrl} styles={{ root: { display: imageTypeUrl ? "block" : "none" } }} />
            <DefaultButton key="image_butt" iconProps={{ iconName: 'upload' }} styles={{ root: { display: imageTypeUrl ? "none" : "block" } }} onClick={_clickFile} >Upload file</DefaultButton>
        </Stack>
    )
}

