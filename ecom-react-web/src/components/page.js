import React from 'react'
import { Link } from './router.js'
import { CommandBarButton } from 'office-ui-fabric-react'


export function Nav ({session}) {
  return (
    <nav className="m-navigation-bar" role="menubar">

      <div className="c-navigation-menu" style={{width: "100%"}}>

        <Link className="navbar-brand no-outline">
            <img src="https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png" alt="Microsoft" height="23"/>
        </Link>

        <button aria-controls="navigationMenuA" aria-haspopup="true" aria-expanded="false">Navigation menu</button>
        <ul id="navigationMenuA" aria-hidden="true">
            <li className="f-sub-menu">
                <button aria-controls="navigationMenuAMenu1" aria-haspopup="true" aria-expanded="false">Sub menu 1</button>
                <ul id="navigationMenuAMenu1" aria-hidden="true">
                    <li>
                        <a href="#/">Hyperlink 1</a>
                    </li>
                </ul>
            </li>
            <li>
                <a href="#/">Hyperlink 1</a>
            </li>
        </ul>
        

        <form className="c-search" autoComplete="off" name="form1" target="_self" style={{display: "inline-block", left:"5%", minWidth: "350px", horizontalAlign: "middle", verticalAlign: "middle", marginTop: "0"}}>
          <input aria-label="Enter your search" type="search" name="search-field" placeholder="Search" />
          <button className="c-glyph" name="search-button">
              <span className="x-screen-reader">Search</span>
          </button>
        </form>

        <div style={{display: "inline-block", float: "right"}}>
          <Link route="/mycart" className="c-call-to-action c-glyph" style={{padding: "11px 12px 13px", border: "2px solid transparent", color: "#0067b8", background: "transparent"}}>
            <span>Cart ({session && session.cart.items.length})</span>
          </Link>
          { session && session.auth && session.auth.loggedon ?  
            <CommandBarButton iconProps={{ iconName: 'Contact' }} menuProps={{items: [
                {
                  key: 'logout',
                  text: 'Logout',
                  href: (process.env.REACT_APP_SERVER_URL || '') + "/connect/microsoft/logout" + (typeof window !== 'undefined' ? `?surl=${encodeURIComponent(window.location.origin)}` : ''),
                  iconProps: { iconName: 'Mail' }
                }]}} text={session.auth.given_name} disabled={false} checked={true} styles={{root: {padding: "11px 12px 13px", border: "2px solid transparent",  background: "transparent"}, label: {color: "#0067b8", fontWeight: "600", fontSize: "15px", lineHeight: "1.3"}}}/>

              
          : 
            <a href={(process.env.REACT_APP_SERVER_URL || '') + '/connect/microsoft' + (typeof window !== 'undefined' ? `?surl=${encodeURIComponent(window.location.href)}` : '')} className="c-call-to-action c-glyph" style={{padding: "11px 12px 13px", border: "2px solid transparent", color: "#0067b8", background: "transparent"}}>
              <span>Login</span>
            </a>
          }
          </div>
        </div>
    </nav>
  )
}