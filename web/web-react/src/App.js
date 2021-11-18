import React, { useState, useEffect, Suspense } from 'react';
import { Router } from './components/router.js'
import { Nav } from './components/page.js'
import { Panes, Panes3x } from './components/store.js'
import { AddToCart, MyCart } from './components/cart.js'
import { ManageOrders, Order } from './components/order.js'
import { ManageProducts, Product } from './components/product.js'
import { StartBusiness } from './components/business.js'
import { Inventory } from './components/factorymgr.js'
import { OrderMgr } from './components/ordermgr.js'
import { ThemeProvider } from '@fluentui/react';

import { AuthContext, TenentContext, CartCountContext, CartOpenContext, RenderContext } from './GlobalContexts.js'
import { _fetchit } from './utils/fetch.js'

import { initializeIcons } from '@fluentui/font-icons-mdl2';
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
      urlidField: "category_id",
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
      refstores: [{ store: "products", lookup_field: "category_ref" }]
    }
  },
  "/mycart": {
    component: MyCart,
    routeProps: {
      checkout: false
    },
    componentFetch: {
      clientSide: true,
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
      clientSide: true,
      operation: "mycart"
    }
  },
  "/myorders": {
    component: ManageOrders,
    requireAuth: true,
    componentFetch: {
      clientSide: true,
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


// Update Global State Contexts "CartCountContext" & "AuthContext" from API call "/api/session_status"
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
      if (newCartCount !== cartCount) {
        setCartCount(newCartCount)
      }
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

export function App({ startUrl }) {
  console.log(`App: startUrl=${startUrl.pathname}`)

  return (
    <ThemeProvider>
      <SessionProviderWrapper>
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
                const { ssrContext, reqUrl, serverInitialData } = renderContext ? renderContext.read() : {}
                return <Router ssrContext={ssrContext} reqUrl={reqUrl} serverInitialData={serverInitialData} startUrl={startUrl} cfg={AppRouteCfg} />
              }}
            </RenderContext.Consumer>
          </Suspense>

        </main>
      </SessionProviderWrapper>
    </ThemeProvider>
  )
}
