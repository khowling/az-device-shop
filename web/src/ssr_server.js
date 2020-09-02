import React from 'react'
import ReactDOMServer from 'react-dom/server'
import RenderContext from './RenderContext'
import { App, AppRouteCfg } from './App'
import { pathToRoute } from './components/router'

function ssrRender(startURL, renderData) {
    return ReactDOMServer.renderToString(
        <RenderContext.Provider value={renderData}>
            <App startUrl={startURL} />
        </RenderContext.Provider>)
}

export {
    AppRouteCfg,
    pathToRoute,
    ssrRender
}