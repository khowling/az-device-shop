import React, { useState, useEffect } from 'react';
import { Router } from './components/router'
import { Nav } from './components/page'
import { Panes, Panes3x } from './components/store'
import { AddToCart, MyCart } from './components/cart'
import { ManageOrders, Order } from './components/order'
import { ManageProducts, Product } from './components/product'
import { StartBusiness } from './components/business'
import { Inventory } from './components/factorymgr'
import { OrderMgr } from './components/ordermgr'


import { GlobalsContext } from './GlobalContexts'
import { _fetchit } from './utils/fetch'

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
    requireAuth: true,
    componentFetch: {
      operation: "myorders"
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


// Expose Global State, allowing items deep in the Router component tree to modify Nav!
export const GlobalsProviderWrapper = ({ children }) => {
  const [itemsInCart, setItemsInCart] = useState({ count: 0, open: false })

  useEffect(() => {
    async function fetchData() {
      const session = await _fetchit('/api/session_status')
      setItemsInCart(i => { return { ...i, session } })
    }
    fetchData()
  }, [])

  return (
    <GlobalsContext.Provider value={[itemsInCart, setItemsInCart]}>
      {children}
    </GlobalsContext.Provider>
  );
};

export function App({ startUrl }) {
  console.warn(`**Render App startUrl=${startUrl.pathname}`)

  return (
    <Fabric>
      <main id="mainContent" data-grid="container">
        <GlobalsProviderWrapper>
          <Nav />
          <Router startUrl={startUrl} cfg={AppRouteCfg} />
        </GlobalsProviderWrapper>
      </main>
    </Fabric>
  )
}
