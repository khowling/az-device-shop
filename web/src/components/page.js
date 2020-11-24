import React, { useContext, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { Link, navTo /*, Redirect */ } from './router'
import { Alert, MyImage } from '../utils/common'
import { AddedCartCount } from '../GlobalContexts'
import { _suspenseFetch } from '../utils/fetch'
import { MyCart } from './cart'

import { CommandBarButton, Text, Panel, PanelType } from '@fluentui/react'

const modalRoot = typeof document !== 'undefined' && document.getElementById('modal-root');

function ModelPanel(props) {
  const { children, ...panelprops } = props
  return createPortal(
    <Panel {...panelprops}>
      {children}
    </Panel>,
    modalRoot)

}

export function Nav({ fallback, sessionResource }) {

  const { status, result } = sessionResource ? sessionResource.read() : {}
  const [itemsInCart, setItemsInCart] = useContext(AddedCartCount)

  console.log(`Render Nav, status: ${status}, fallback: ${fallback},  itemsInCart: ${JSON.stringify(itemsInCart)}`)

  function openNewItem() {
    setItemsInCart({ ...itemsInCart, open: true })
  }
  function dismissPanel() {
    setItemsInCart({ ...itemsInCart, open: false })
  }

  const cartitems = (result ? result.cart_items : 0) + itemsInCart.count
  if (itemsInCart.open && cartitems === 0) {
    dismissPanel()
  }

  if (result && !result.tenent) {
    //return <Redirect route='/init' />
    return null
  } else return (
    <nav className="m-navigation-bar" role="menubar">

      <div className="c-navigation-menu" style={{ width: "100%" }}>

        <Link className="navbar-brand no-outline" style={{ "display": "inline-block", "left": "5%", "verticalAlign": "middle", "marginTop": "0px" }}>
          <MyImage image={result && result.tenent.image} height="33px" />
          { /* <img src="https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png" alt="Microsoft" height="23" /> */}
        </Link>

        <Text nowrap variant={"xLarge"} style={{ "display": "inline-block", "left": "5%", "maxWidth": "350px", "verticalAlign": "middle", "marginTop": "0px" }}>{result && result.tenent.name}</Text>

        <form className="c-search" autoComplete="off" name="form1" target="_self" style={{ display: "inline-block", left: "5%", minWidth: "350px", horizontalAlign: "middle", verticalAlign: "middle", marginTop: "0" }}>
          <input aria-label="Enter your search" type="search" name="search-field" placeholder="Search *TBC*" />
          <button className="c-glyph" name="search-button">
            <span className="x-screen-reader">Search</span>
          </button>
        </form>

        {status === 'error' ?
          <Alert txt={result} />
          :

          <div style={{ display: "inline-block", float: "right" }}>


            {result && result.auth ?
              <CommandBarButton iconProps={{ iconName: 'Contact' }} menuProps={{
                items: [
                  {
                    key: 'myorders',
                    text: 'My Orders',
                    //href: '/myorders',
                    onClick: () => navTo('/myorders'),
                    iconProps: { iconName: 'ActivateOrders' }
                  },
                  {
                    key: 'products',
                    text: 'Manage Products',
                    //href: '/products',
                    onClick: () => navTo('/products'),
                    iconProps: { iconName: 'ProductRelease' }
                  },
                  {
                    key: 'inv',
                    text: 'Manage Inventory',
                    //href: '/inv',
                    onClick: () => navTo('/inv'),
                    iconProps: { iconName: 'Cloud' }
                  },
                  {
                    key: 'omgr',
                    text: 'Manage Orders',
                    //href: '/omgr',
                    onClick: () => navTo('/omgr'),
                    iconProps: { iconName: 'Cloud' }
                  },
                  {
                    key: 'logout',
                    text: 'Logout',
                    href: (process.env.REACT_APP_SERVER_URL || '') + "/connect/microsoft/logout" + (typeof window !== 'undefined' ? `?surl=${encodeURIComponent(window.location.origin)}` : ''),
                    iconProps: { iconName: 'SignOut' }
                  }]
              }} text={result.auth.given_name} disabled={false} checked={true}
                styles={{ root: { "vertical-align": "top", padding: "11px 12px 13px", border: "2px solid transparent", background: "transparent" }, label: { color: "#0067b8", fontWeight: "600", fontSize: "15px", lineHeight: "1.3" } }} />


              :
              <a href={(process.env.REACT_APP_SERVER_URL || '') + '/connect/microsoft' + (typeof window !== 'undefined' ? `?surl=${encodeURIComponent(window.location.href)}` : '')} className="c-call-to-action c-glyph" style={{ padding: "11px 12px 13px", border: "2px solid transparent", color: "#0067b8", background: "transparent" }}>
                <span>Login</span>
              </a>
            }

            <CommandBarButton
              onClick={() => openNewItem()}
              disabled={cartitems === 0}
              iconProps={{ iconName: 'ShoppingCart' }}
              text={`cart ${cartitems > 0 ? '(' + cartitems + ')' : ''}`}
              styles={{ root: { "vertical-align": "top", padding: "13px 14px 15px", background: "transparent", borderColor: "white" }, label: { color: "#0067b8", fontWeight: "600", fontSize: "15px", lineHeight: "1.3" } }}
            />
          </div>
        }
      </div>
      <Suspense fallback={<span />}>
        <ModelPanel
          headerText="Shopping Cart"
          isOpen={itemsInCart.open}
          onDismiss={dismissPanel}
          type={PanelType.medium}

          closeButtonAriaLabel="Close">
          {itemsInCart.open &&
            <MyCart dismissPanel={dismissPanel} resource={_suspenseFetch('componentFetch/mycart')} panel={true} />
          }
        </ModelPanel>
      </Suspense>

    </nav>
  )
}