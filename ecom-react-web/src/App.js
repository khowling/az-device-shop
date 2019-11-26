import React, {useContext, useState, useEffect} from 'react';
import {useRouter} from './components/router.js'
import {Nav} from './components/page'
import {Panes} from './components/store.js'
import {Order, MyCart} from './components/order.js'

import RenderContext from './RenderContext'
import {_fetchit} from './utils/fetch'

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
  const [spaSession, setSpaSession] = useState()
  const routeElements = useRouter (startUrl, AppRouteCfg)
  const {ssrContext, session} = useContext(RenderContext)



  console.log (`App ssrContext=${ssrContext} session=${JSON.stringify(session)}`)

  useEffect(() => {
    if (ssrContext === "spa") { // Otherwise auth will come from serverInitialData
      _fetchit('GET','/api/session_status').then(d => setSpaSession(d))
    }
  },[ssrContext])
  

  return (
    <main id="mainContent" data-grid="container">
      <Nav session={session || spaSession}/>
      {routeElements}
    </main>
  );
}
