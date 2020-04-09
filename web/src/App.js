import React, {useContext, Suspense} from 'react';
import {useRouter} from './components/router'
import {Nav} from './components/page'
import {Panes} from './components/store'
import {AddToCart, MyCart} from './components/cart'
import {ManageOrders, Order} from './components/order'
import {ManageProducts, Product} from './components/product'

import RenderContext from './RenderContext'
import {_suspenseFetch, _suspenseWrap} from './utils/fetch'

import './App.css';
import { initializeIcons } from '@uifabric/icons';
import { Fabric } from '@fluentui/react/lib/Fabric';
initializeIcons();


export const AppRouteCfg = {
  '/': {
    component: Panes,
  },
  [`/${AddToCart.name}`] : {
    component: AddToCart,
    initialFetch: {
      operation: "getOne",
      store: "products",
      recordid: true
    }
  },
  [`/mycart`] : {
    component: MyCart,
    routeProps: {
      checkout: false
    },
    initialFetch: {
      operation: "mycart"
    }
  },
  [`/checkout`] : {
    component: MyCart,
    routeProps: {
      checkout: true
    },
    requireAuth: true,
    initialFetch: {
      operation: "mycart"
    }
  },
  [`/${ManageOrders.name}`] : {
    component: ManageOrders,
    initialFetch: {
      operation: "get",
      store: "orders"
    }
  },
  [`/${Order.name}`] : {
    component: Order,
    initialFetch: {
      operation: "getOne",
      store: "orders",
      recordid: true
    }
  },
  [`/${ManageProducts.name}`] : {
    component: ManageProducts,
    initialFetch: {
      operation: "get",
      store: "products"
    }
  },
  [`/${Product.name}`] : {
    component: Product,
    initialFetch: {
      operation: "getOne",
      store: "products",
      recordid: true
    }
  }
}

export function App({startUrl}) {
  const routeElements = useRouter (startUrl, AppRouteCfg)

  const {ssrContext, session} = useContext(RenderContext)
  let sessionResource
  if (ssrContext === "spa") {
    try {
      // call server AJAX for session state
      sessionResource = _suspenseFetch('session_status')
    } catch (e) {
      console.log (e)
    }
  } else {
    // session state injected from the server, so immediatly resolve 
    sessionResource = _suspenseWrap(session)
  }

  return (
    <Fabric>
      <main id="mainContent" data-grid="container">
        <Suspense fallback={<div>wait</div>}>
          <Nav resource={sessionResource}/>
        </Suspense>
        {routeElements}
      </main>
    </Fabric>
  )
}
