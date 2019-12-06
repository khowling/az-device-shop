import React from 'react'
import { Link } from './router.js'
import {Alert} from '../utils/common'
import { CommandBarButton } from 'office-ui-fabric-react/lib/Button'


export function Nav ({resource}) {
  const {status, result } = resource.read()

  return (
    <nav className="m-navigation-bar" role="menubar">
      
      <div className="c-navigation-menu" style={{width: "100%"}}>

        <Link className="navbar-brand no-outline">
            <img src="https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png" alt="Microsoft" height="23"/>
        </Link>

        <form className="c-search" autoComplete="off" name="form1" target="_self" style={{display: "inline-block", left:"5%", minWidth: "350px", horizontalAlign: "middle", verticalAlign: "middle", marginTop: "0"}}>
          <input aria-label="Enter your search" type="search" name="search-field" placeholder="Search" />
          <button className="c-glyph" name="search-button">
              <span className="x-screen-reader">Search</span>
          </button>
        </form>

        { status === 'error' ?
          <Alert txt={result}/>
        :

          <div style={{display: "inline-block", float: "right"}}>


            { result && result.auth  ?  
              <CommandBarButton iconProps={{ iconName: 'Contact' }} menuProps={{items: [
                  {
                    key: 'orders',
                    text: 'My Orders',
                    href: '/ManageOrders',
                    iconProps: { iconName: 'ActivateOrders' }
                  },
                  {
                    key: 'logout',
                    text: 'Logout',
                    href: (process.env.REACT_APP_SERVER_URL || '') + "/connect/microsoft/logout" + (typeof window !== 'undefined' ? `?surl=${encodeURIComponent(window.location.origin)}` : ''),
                    iconProps: { iconName: 'SignOut' }
                  }]}} text={result.auth.given_name} disabled={false} checked={true} styles={{root: {padding: "11px 12px 13px", border: "2px solid transparent",  background: "transparent"}, label: {color: "#0067b8", fontWeight: "600", fontSize: "15px", lineHeight: "1.3"}}}/>

                
            : 
              <a href={(process.env.REACT_APP_SERVER_URL || '') + '/connect/microsoft' + (typeof window !== 'undefined' ? `?surl=${encodeURIComponent(window.location.href)}` : '')} className="c-call-to-action c-glyph" style={{padding: "11px 12px 13px", border: "2px solid transparent", color: "#0067b8", background: "transparent"}}>
                <span>Login</span>
              </a>
            }

            <Link route="/mycart" className="c-call-to-action c-glyph" style={{padding: "11px 12px 13px", border: "2px solid transparent", color: "#0067b8", background: "transparent"}}>
              <span>Cart ({result && result.cart_items || 0})</span>
            </Link>
          </div>
        }
        </div>
    </nav>
  )
}