import React, { useContext, Suspense } from 'react';
import { useRouter } from './components/router'
import { Nav } from './components/page'
import { Panes, Panes3x } from './components/store'
import { AddToCart, MyCart } from './components/cart'
import { ManageOrders, Order } from './components/order'
import { ManageProducts, Product } from './components/product'
import { Inventory, StartBusiness } from './components/business'

import RenderContext from './RenderContext'
import { _suspenseFetch, _suspenseWrap } from './utils/fetch'

import './App.css';
import { initializeIcons } from '@uifabric/icons';
import { Fabric } from '@fluentui/react/lib/Fabric';
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
  '/p': {
    component: Panes3x,
    componentFetch: {
      operation: "get",
      store: "products",
      urlidField: "category",
      query: { type: "Product" },
      refstores: [{ store: "products", lookup_field: "urlidField" }]
    }
  },
  [`/${AddToCart.name}`]: {
    component: AddToCart,
    componentFetch: {
      operation: "getOne",
      store: "products",
      urlidField: "recordid",
      refstores: [{ store: "products", lookup_field: "category" }]
    }
  },
  [`/mycart`]: {
    component: MyCart,
    routeProps: {
      checkout: false
    },
    componentFetch: {
      operation: "mycart"
    }
  },
  [`/checkout`]: {
    component: MyCart,
    routeProps: {
      checkout: true
    },
    requireAuth: true,
    componentFetch: {
      operation: "mycart"
    }
  },
  [`/${ManageOrders.name}`]: {
    component: ManageOrders,
    componentFetch: {
      operation: "get",
      store: "orders",
      query: { status: { $gte: 30 } },
    }
  },
  [`/${Order.name}`]: {
    component: Order,
    componentFetch: {
      operation: "getOne",
      store: "orders",
      urlidField: "recordid"
    }
  },
  [`/${ManageProducts.name}`]: {
    component: ManageProducts,
    componentFetch: {
      operation: "get",
      store: "products"
    }
  },
  ['/init']: {
    component: StartBusiness
  },
  [`/${Inventory.name}`]: {
    component: Inventory,
    componentFetch: {
      operation: "get",
      store: "inventory",
      refstores: [{ store: "products" }]//, "workitems"]
    }
  },
  [`/${Product.name}`]: {
    component: Product,
    componentFetch: {
      operation: "getOne",
      store: "products",
      urlidField: "recordid"
    }
  }
}

export function App({ startUrl }) {
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
        <Suspense fallback={<Nav></Nav>}>
          <Nav resource={sessionResource} />
        </Suspense>
        {routeElements}
      </main>
    </Fabric>
  )
}
