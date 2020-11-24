import React from 'react'
import { hydrate } from 'react-dom'
import { App } from './App.js'
import { RenderContext } from './GlobalContexts'
const { pathname, search, hash } = window.location

// render() for when you are rendering the content solely on the client side, 
// and hydrate() for when you are rendering on top of server-side rendered markup.

hydrate(
    <RenderContext.Provider value={window.__HYDRATE__DATA__}>
        <App startUrl={{ pathname, search, hash }} />
    </RenderContext.Provider>, document.getElementById('root'))

delete window.__HYDRATE__DATA__