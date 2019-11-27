import React, {useContext, Suspense} from 'react';
import {useRouter} from './components/router.js'
import {Nav} from './components/page'
import {Panes} from './components/store.js'
import {Order, MyCart} from './components/order.js'

import RenderContext from './RenderContext'
import {_suspenseFetch, _suspenseWrap} from './utils/fetch'

import './App.css';
import { initializeIcons } from '@uifabric/icons';
initializeIcons();


export const AppRouteCfg = {
  '/': {
    component: Panes,
  },
  [`/${Order.name}`] : {
    component: Order,
    initialFetch: {
      operation: "getOne",
      store: "products",
      recordid: true
    }
  },
  [`/mycart`] : {
    component: MyCart,
    initialFetch: {
      operation: "mycart"
    }
  }
}

export function App({startUrl}) {
  const routeElements = useRouter (startUrl, AppRouteCfg)

  const {ssrContext, session} = useContext(RenderContext)
  let sessionResource
  if (ssrContext === "spa") {
    try {
    sessionResource = _suspenseFetch('session_status')
    } catch (e) {
      console.log (e)
    }
  } else {
    sessionResource = _suspenseWrap(session)
  }

  return (
    <main id="mainContent" data-grid="container">
      <Suspense fallback={<div>wait</div>}>
        <Nav resource={sessionResource}/>
      </Suspense>
      {routeElements}
    </main>
  )
}
