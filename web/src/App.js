import React, { useState, useContext, Suspense } from 'react';
import { Router } from './components/router'
import { Nav } from './components/page'
import { Panes, Panes3x } from './components/store'
import { AddToCart, MyCart } from './components/cart'
import { ManageOrders, Order } from './components/order'
import { ManageProducts, Product } from './components/product'
import { StartBusiness } from './components/business'
import { Inventory } from './components/factorymgr'
import { OrderMgr } from './components/ordermgr'


import { RenderContext, AddedCartCount } from './GlobalContexts'
import { _suspenseFetch, _suspenseWrap } from './utils/fetch'

//import './App.css';
import { initializeIcons } from '@uifabric/icons';
import { Fabric } from '@fluentui/react'

initializeIcons();


export const AppRouteCfg = {
  '/': {
    component: Panes,
    componentFetch: {
      operation: "get",
      store: "products",
      query: { type: "Category" }
    }
  },
  "/shop": {
    component: Panes3x,
    componentFetch: {
      operation: "get",
      store: "products",
      urlidField: "category",
      query: { type: "Product" },
      refstores: [{ store: "products", lookup_field: "urlidField" }]
    }
  },
  "/a2c": {
    component: AddToCart,
    componentFetch: {
      operation: "getOne",
      store: "products",
      urlidField: "recordid",
      refstores: [{ store: "products", lookup_field: "category" }]
    }
  },
  "/mycart": {
    component: MyCart,
    routeProps: {
      checkout: false
    },
    componentFetch: {
      operation: "mycart"
    }
  },
  "/checkout": {
    component: MyCart,
    routeProps: {
      checkout: true
    },
    requireAuth: true,
    componentFetch: {
      operation: "mycart"
    }
  },
  "/myorders": {
    component: ManageOrders,
    componentFetch: {
      operation: "get",
      store: "orders",
      query: { status: { $gte: 30 } },
    }
  },
  "/o": {
    component: Order,
    componentFetch: {
      operation: "getOne",
      store: "orders",
      urlidField: "recordid"
    }
  },
  "/products": {
    component: ManageProducts,
    componentFetch: {
      operation: "get",
      store: "products"
    }
  },
  "/product": {
    component: Product,
    componentFetch: {
      operation: "getOne",
      store: "products",
      urlidField: "recordid"
    }
  },
  "/init": {
    component: StartBusiness
  },
  "/inv": {
    component: Inventory,
    componentFetch: {
      operation: "get",
      store: "inventory",
      refstores: [{ store: "products" }]//, "workitems"]
    }
  },
  "/omgr": {
    component: OrderMgr,
    componentFetch: {
      operation: "get",
      store: "inventory",
      refstores: [{ store: "products" }]//, "workitems"]
    }
  }
}


// Expose Global State, allowing items deep in the Router component tree to comunicate with the header!
export const CartProvider = ({ children }) => {
  const [itemsInCart, setItemsInCart] = useState({ count: 0, open: false })

  return (
    <AddedCartCount.Provider value={[itemsInCart, setItemsInCart]}>
      {children}
    </AddedCartCount.Provider>
  );
};

export function App({ startUrl }) {
  console.warn(`**Render App startUrl=${startUrl.pathname}`)

  // consume the value of a context! (=== <RenderContext.Consumer >)
  // Provider is either
  //  index.js (ssrContext == "spa")  // for development server
  //  ssr_server.js (ssrContext: "server", serverInitialData (as request by AppRouteCfg) & session) // 1st phase of sse, dom rendered from server
  //  ssr_hydrate.js (ssrContext: "server", serverInitialData (as request by AppRouteCfg) & session) // 2nd phase of ssr, hydrate from window.__HYDRATE__DATA__ (copy of 1st phase)
  const { ssrContext, session } = useContext(RenderContext)
  // return pending resource
  const [sessionResource] = useState(() => {
    console.log('App: getting sessionResource')
    return ssrContext === "spa" ? _suspenseFetch('session_status') : _suspenseWrap(session)
  })

  return (
    <Fabric>
      <main id="mainContent" data-grid="container">
        <CartProvider>
          <Suspense fallback={<Nav fallback={true} key="nav" />}>
            <Nav sessionResource={sessionResource} />
          </Suspense>
          <Router startUrl={startUrl} cfg={AppRouteCfg} />
        </CartProvider>
      </main>
    </Fabric>
  )
}
