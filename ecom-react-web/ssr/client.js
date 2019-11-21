import React from 'react'
import ReactDOM from 'react-dom'
import {App} from '../src/App.js'
import RenderContext from '../src/RenderContext'
const {pathname, search, hash} = window.location

ReactDOM.hydrate(
    <RenderContext.Provider value={{ssrContext: "hydrate", serverInitialData: window.__HYDRATE__DATA__}}>
        <App startUrl={{pathname, search, hash}} />
    </RenderContext.Provider>, document.getElementById('root'))

delete window.__HYDRATE__DATA__