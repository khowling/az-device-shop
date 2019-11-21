import React from 'react';
import {useRouter} from './components/router.js'
import {Nav} from './components/page'
import {Panes} from './components/store.js'
import {Order} from './components/order.js'

import './App.css';



export const AppRouteCfg = {
  '/': {
    component: Panes,
  },
  [`/${Order.name}`] : {
    component: Order,
    initialFetch: {
      collection: "products"
    }
  }
}

export function App({startUrl}) {
  const routeElements = useRouter (startUrl, AppRouteCfg)
  console.log ('App return')
  return (
    <main id="mainContent" data-grid="container">
      <Nav/>
      {routeElements}
    </main>
  );
}
