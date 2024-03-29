import React from 'react'
import ReactDOM from 'react-dom'
import { App } from './App.js'
import Html from './Html.js'
import { RenderContext, TenentContext } from './GlobalContexts.js'

const { pathname, search, hash } = window.location

// https://github.com/reactwg/react-18/discussions/37#discussioncomment-837686
console.log(`hydrateRoot: populating RenderContext with window.__HYDRATE__DATA__ (not required when move to server components)`)
const container = document.getElementById('root');

/* 
 * If you call ReactDOM.hydrateRoot() on a node that already has this server-rendered markup, 
 * React will preserve it and only attach event handlers, allowing you to have a very performant first-load experience.
 */

ReactDOM.hydrateRoot(container,
    <TenentContext.Provider value={window.__HYDRATE__TENENT__}>
        <RenderContext.Provider value={window.__HYDRATE__DATA__}>
                <App startUrl={{ pathname, search, hash }} />
        </RenderContext.Provider>
    </TenentContext.Provider>
)


