import React from 'react'
import { hydrateRoot } from 'react-dom'
import { App } from './App.js'
import { RenderContext, TenentContext } from './GlobalContexts'
import { initializeIcons } from '@fluentui/font-icons-mdl2';
initializeIcons();


const { pathname, search, hash } = window.location

// render() for when you are rendering the content solely on the client side, 
// and hydrate() for when you are rendering on top of server-side rendered markup.

// https://github.com/reactwg/react-18/discussions/37#discussioncomment-837686
console.log(`hydrateRoot: populating RenderContext with window.__HYDRATE__DATA__ (not required when move to server components)`)

hydrateRoot(document,
    <TenentContext.Provider value={window.__HYDRATE__TENENT__}>
        <RenderContext.Provider value={window.__HYDRATE__DATA__}>
            <App hydrate_tenent={{}} hydrate_data={{}} startUrl={{ pathname, search, hash }} />
        </RenderContext.Provider>
    </TenentContext.Provider>
)


