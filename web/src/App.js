import React, { useContext, Suspense } from 'react';
import { useRouter } from './components/router'
import { Nav } from './components/page'
import { Panes, Panes3x } from './components/store'
import { AddToCart, MyCart } from './components/cart'
import { ManageOrders, Order } from './components/order'
import { ManageProducts, Product } from './components/product'
import { Inventory, StartBusiness } from './components/business'
import { Spinner, SpinnerSize } from '@fluentui/react';

import RenderContext from './RenderContext'
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
  }
}

export function App({ startUrl }) {
  //console.log(`App - ${JSON.stringify(AppRouteCfg)}`)
  const routeElements = useRouter(startUrl, AppRouteCfg)

  const { ssrContext, session } = useContext(RenderContext)
  let sessionResource
  if (ssrContext === "spa") {
    try {
      // call server AJAX for session state
      sessionResource = _suspenseFetch('session_status')
    } catch (e) {
      console.log(e)
    }
  } else {
    // session state injected from the server, so immediatly resolve 
    sessionResource = _suspenseWrap(session)
  }

  return (
    <Fabric>
      <main id="mainContent" data-grid="container">
        <Suspense fallback={<Spinner size={SpinnerSize.large} styles={{ root: { marginTop: "100px" } }} label="Please Wait..." ariaLive="assertive" labelPosition="right" />}>
          <Nav resource={sessionResource} />
          {routeElements}
        </Suspense>

      </main>
    </Fabric>
  )
}
