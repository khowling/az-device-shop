import React from 'react'
import ReactDOM from 'react-dom'
import {App} from './App.js'
import RenderContext from './RenderContext'
const {pathname, search, hash} = window.location

ReactDOM.hydrate(
    <RenderContext.Provider value={window.__HYDRATE__DATA__}>
        <App startUrl={{pathname, search, hash}} />
    </RenderContext.Provider>, document.getElementById('root'))

delete window.__HYDRATE__DATA__