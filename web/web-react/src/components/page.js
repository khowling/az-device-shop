import React, { useContext, Suspense } from 'react'
import { Link, navTo /*, Redirect */ } from './router.js'
import { MyImage, ModelPanel } from '../utils/common.js'
import { _suspenseFetch } from '../utils/fetch.js'
import { MyCart } from './cart.js'

import { CommandBarButton, Text, Panel, PanelType } from '@fluentui/react'
import { Icon } from '@fluentui/react';
import { mergeStyles, mergeStyleSets } from '@fluentui/merge-styles';


import { CartOpenContext } from '../GlobalContexts.js'



const titleClass = mergeStyleSets({ "display": "inline-block", "left": "5%", "maxWidth": "350px", "verticalAlign": "middle", "marginTop": "0px" })


export function Nav({ tenent, auth, cartCount }) {

  const [cartOpen, setCartOpen] = useContext(CartOpenContext)
  console.log(`Nav: cartOpen=${cartOpen} cartCount=${cartCount}`)

  return (
    <nav className="m-navigation-bar" role="menubar">

      <div className="c-navigation-menu" style={{ width: "100%" }}>

        {tenent && tenent.image &&
          <Link className="navbar-brand no-outline" style={{ "display": "inline-block", "left": "5%", "verticalAlign": "middle", "marginTop": "0px" }}>
            <MyImage image={tenent.image} height="33px" />
          </Link>
        }

        <Text nowrap variant="xLarge" className={titleClass} >{tenent ? tenent.name : 'no tenent'}</Text>

        <form className="c-search" autoComplete="off" name="form1" target="_self" style={{ display: "inline-block", left: "5%", minWidth: "350px", horizontalAlign: "middle", verticalAlign: "middle", marginTop: "0" }}>
          <input aria-label="Enter your search" type="search" name="search-field" placeholder="Search *TBC*" />
          <button className="c-glyph" name="search-button">
            <span className="x-screen-reader">Search</span>
          </button>
        </form>


        <div style={{ display: "inline-block", float: "right" }}>


          {!auth ? (
            <Suspense fallback={<span></span>}>
              <a href={(process.env.REACT_APP_SERVER_URL || '') + '/connect/microsoft' + (typeof window !== 'undefined' ? `?surl=${encodeURIComponent(window.location.href)}` : '/'/*`?surl=${encodeURIComponent(reqUrl)}`*/)} className="c-call-to-action c-glyph" style={{ padding: "11px 12px 13px", border: "2px solid transparent", color: "#0067b8", background: "transparent" }}>
                <span>Login</span>
              </a>
            </Suspense>
          )
            :
            (
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
              }} text={auth.given_name} disabled={false} checked={true}
                styles={{ root: { "vertical-align": "top", padding: "11px 12px 13px", border: "2px solid transparent", background: "transparent" }, label: { color: "#0067b8", fontWeight: "600", fontSize: "15px", lineHeight: "1.3" } }} />
            )
          }


          <CommandBarButton
            onClick={() => setCartOpen(true)}
            disabled={cartCount === 0}
            iconProps={{ iconName: 'ShoppingCart' }}
            text={`cart ${cartCount > 0 ? '(' + cartCount + ')' : ''}`}
            styles={{ root: { "vertical-align": "top", padding: "13px 14px 15px", background: "transparent", borderColor: "white" }, label: { color: "#0067b8", fontWeight: "600", fontSize: "15px", lineHeight: "1.3" } }}
          />

        </div>

      </div>

    
      <ModelPanel
        headerText="Shopping Cart"
        isOpen={cartOpen}
        onDismiss={() => {
          console.log (`onDismiss cartOpen=${cartOpen}`)
          setCartOpen(false)
        }
        }
        type={PanelType.medium}

        closeButtonAriaLabel="Close">
          { cartOpen && 
            <Suspense fallback={<div></div>}>
                <MyCart dismissPanel={() => setCartOpen(false)} resource={_suspenseFetch('componentFetch/mycart')} panel={true} />
            </Suspense>
          }
      </ModelPanel>
     

    </nav>
  )
}

const breadcrumbOl = {
  "whiteSpace": "nowrap",
  "padding": "0px",
  "margin": "0px",
  "display": "flex",
  "alignItems": "stretch"
}


const breadcrumb = {
  "fontSize": "18px",
  "fontWeight": "400",
  "margin": "11px 0px 1px",
}

const breadcrumbLi = {
  "listStyleType": "none",
  "margin": "0px",
  "padding": "0px",
  "display": "flex",
  "position": "relative",
  "alignItems": "center"
}

const breadcrumbLabel = {
  "color": "rgb(96, 94, 92)",
  "padding": "0px 8px",
  "lineHeight": "36px",
  "fontWeight": "400",
}

const breadcrumbLast = {
  "color": "rgb(50, 49, 48)",
  "padding": "0px 8px",
  "fontWeight": "600",
}

export function SSRBreadcrumb({ items }) {
  return (
    <div style={breadcrumb} role="navigation">
      <div className="ms-FocusZone" data-focuszone-id="FocusZone4">
        <ol style={breadcrumbOl}>
          {items.map((item, i) =>
            <li key={item.key} style={breadcrumbLi}>
              <span style={i === items.length - 1 ? breadcrumbLast : breadcrumbLabel}>
                <Link route={item.route} urlid={item.urlid} className="ms-Link ms-Breadcrumb-itemLink" tabIndex={i} >
                  <div className="ms-TooltipHost ">{item.text}</div>
                </Link>
              </span>
              {i < items.length - 1 &&
                <Icon iconName="ChevronRight" style={{ fontSize: "12px" }}></Icon>
              }
            </li>
          )}
        </ol>
      </div>
    </div>
  )
}
