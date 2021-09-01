import React, { useState, useEffect, Suspense } from 'react';
import Html from './Html'
import { Router } from './components/router'
import { Nav } from './components/page'
import { Panes, Panes3x } from './components/store'
import { AddToCart, MyCart } from './components/cart'
import { ManageOrders, Order } from './components/order'
import { ManageProducts, Product } from './components/product'
import { StartBusiness } from './components/business'
import { Inventory } from './components/factorymgr'
import { OrderMgr } from './components/ordermgr'
import { ThemeProvider } from '@fluentui/react';

import { AuthContext, TenentContext, CartCountContext, CartOpenContext, RenderContext } from './GlobalContexts'
import { _fetchit } from './utils/fetch'




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
      store: "products",
      refstores: [{ orderState: true, store: "inventory" }]
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
export const SessionProviderWrapper = ({ children }) => {

  const [auth, setAuth] = useState()
  const [cartCount, setCartCount] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const session = await _fetchit('/api/session_status')
      console.log(`SessionProviderWrapper: useEffect session=${JSON.stringify(session)}`)
      setAuth(session.auth)
      const newCartCount = session.cart_items || 0
      newCartCount !== cartCount && setCartCount()
    }
    fetchData()
  }, [])

  console.log(`SessionProviderWrapper: Render cartCount=${cartCount} cartOpen=${cartOpen} auth=${JSON.stringify(auth)}`)
  return (
    <AuthContext.Provider value={auth}>
      <CartCountContext.Provider value={[cartCount, setCartCount]}>
        <CartOpenContext.Provider value={[cartOpen, setCartOpen]}>
          {children}
        </CartOpenContext.Provider>
      </CartCountContext.Provider>
    </AuthContext.Provider>
  );
};

export function App({ startUrl, hydrate_data, hydrate_tenent }) {
  console.log(`App: startUrl=${startUrl.pathname}`)

  return (
    <SessionProviderWrapper>
      <Html title="React18" hydrate_data={hydrate_data} hydrate_tenent={hydrate_tenent}>
        <ThemeProvider>
          <main id="mainContent" data-grid="container">
            <TenentContext.Consumer>
              {tenent => {
                console.log(`tenent=${tenent}`); return (
                  <AuthContext.Consumer>
                    {auth => {
                      console.log(`auth=${auth}`); return (
                        <CartCountContext.Consumer>
                          {cartCountContext => {
                            console.log(`cartCountContext=${cartCountContext[0]}`); return (
                              <Nav tenent={tenent} auth={auth} cartCount={cartCountContext[0]} />
                            )
                          }}
                        </CartCountContext.Consumer>
                      )
                    }}
                  </AuthContext.Consumer>
                )
              }}
            </TenentContext.Consumer>

            <Suspense fallback={<div>wait route</div>}>
              <RenderContext.Consumer>
                {renderContext => {
                  const { ssrContext, reqUrl, serverInitialData } = renderContext.read()
                  return <Router ssrContext={ssrContext} reqUrl={reqUrl} serverInitialData={serverInitialData} startUrl={startUrl} cfg={AppRouteCfg} />
                }}
              </RenderContext.Consumer>
            </Suspense>

          </main>
        </ThemeProvider>
      </Html>
    </SessionProviderWrapper>

  )
}
