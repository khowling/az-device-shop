import React from 'react'
import { hydrateRoot } from 'react-dom'
import { App } from './App.js'
import Html from './Html'
import { RenderContext, TenentContext } from './GlobalContexts'

const { pathname, search, hash } = window.location

// https://github.com/reactwg/react-18/discussions/37#discussioncomment-837686
console.log(`hydrateRoot: populating RenderContext with window.__HYDRATE__DATA__ (not required when move to server components)`)

hydrateRoot(document,
    <TenentContext.Provider value={window.__HYDRATE__TENENT__}>
        <RenderContext.Provider value={window.__HYDRATE__DATA__}>
            <Html title="React18" hydrate_tenent={{}} hydrate_data={{}} >
                <App startUrl={{ pathname, search, hash }} />
            </Html>
        </RenderContext.Provider>
    </TenentContext.Provider>
)


