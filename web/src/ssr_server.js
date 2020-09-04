import React from 'react'
import { renderToString } from 'react-dom/server'
import RenderContext from './RenderContext'
import { App, AppRouteCfg } from './App'
import { pathToRoute } from './components/router'

function ssrRender(startURL, renderData) {
    return renderToString(
        <RenderContext.Provider value={renderData}>
            <App startUrl={startURL} />
        </RenderContext.Provider>)
}

export {
    AppRouteCfg,
    pathToRoute,
    ssrRender
}