import React, {useState, useEffect, useContext, Suspense} from 'react'
import {_suspenseFetch, _suspenseWrap} from '../utils/fetch'
import RenderContext from '../RenderContext'

// Used by Link & NavTo
export function _encodeURL (route, urlid, props) {
  let ulrstr = route? route : (urlid? "/_" : "/")
  ulrstr+= urlid ? ("/" + urlid)  : ""

  if (props && Object.keys(props).length >0) ulrstr+= "?props=" + encodeURIComponent(btoa(JSON.stringify(props)));
  return ulrstr;
}

// =====================================     Processes navigation routes Called from DOM 
export function Link({route, urlid, props, children, ...rest}) {
  const {ssrContext} = useContext(RenderContext)
  
  function handleClick(event) {
    //console.log ('Link: handleclick')
    if (
      !event.defaultPrevented && // onClick prevented default
      event.button === 0 && // ignore everything but left clicks
      !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) && // ignore clicks with modifier keys
      ssrContext === "spa" // Only override links if not SSR
    ) {
      console.log ('Link: pushstate')
      event.preventDefault()
      // (1) Update the browser URL
      if (typeof window !== 'undefined') {
        window.history.pushState("","", event.currentTarget.href)
      }
      // (2) Now notify the router!!
      listeners.forEach(listener => listener({routekey: route || '/', urlid, props}))
    }

  }

  return (<a {...rest} onClick={handleClick} href={_encodeURL (route, urlid, props)}>{children}</a>)
}


// =====================================     Processes navigation routes Called from React JS 
export function navTo(route, urlid, props) {
  //console.log (`navTo: ${routekey}`)
  // (1) Update the browser URL
  if (typeof window !== 'undefined') {
    window.history.pushState("","", _encodeURL (route, urlid, props))
  }
  //const routeJson = getRouteObj(route, recordid, props)
  listeners.forEach(listener => listener({routekey: route || '/', urlid, props}))
}

// convert parts of the url into route key, recordid and props
export function pathToRoute({pathname, search, hash}) {
  //console.log (`pathToRoute pathname=${pathname} search=${search}`)
  const propsparam = search && search.match(/A?props=([^&]+)&*/i),
        url_props = propsparam? propsparam[1]: null,
        withoutleadingslash = pathname.slice(1),
        [url_comp = '/', urlid] = withoutleadingslash.split("/", 2)
        
  return {
    routekey: '/' + (url_comp ? (url_comp === "_" ? '' : url_comp) : ''), 
    props: url_props ? JSON.parse(atob(decodeURIComponent(url_props))) : {},
    urlid,
  }
}

const listeners = [];
// =====================================     My Super Simple Router 
// Params: cfg = routing configration (AppRouteCfg)
export function useRouter (startUrl, cfg) {
  
  // renderRoute : route that needs to be rendered (default is the startURL)
  const [renderRoute, setRenderRoute] = useState(() => pathToRoute(startUrl))
  const {ssrContext, serverInitialData} = useContext(RenderContext)

  console.log (`useRouter() ssrContext=${ssrContext} renderRoute=${JSON.stringify(renderRoute)}`)

  // Subscribe to <Link> events
  useEffect(() => {
    if (ssrContext === "spa") {
      //console.log ('useRouter: useEffect - initialise listeners to listen for <Link>)')
      listeners.push(newrouteRequested => setRenderRoute(newrouteRequested))
      return () => listeners.pop()
    }
  },[ssrContext])

  // Subscribe to popstate events (browser back/forward buttons)
  useEffect(() => {
    function chnRouteFn (event) {
      setRenderRoute(() => {
        const {pathname, search, hash} = new URL(window.location)
        console.log (`useRouter:useEffect calling pathToRoute with window url`)
        return pathToRoute({pathname, search, hash})
      })
    }

    if (typeof window !== 'undefined' && ssrContext === "spa") {
      //console.log ('useRouter: useEffect - initialise listeners to listen for popstate (browser back/forward)')
      window.addEventListener('popstate', chnRouteFn, false)
      return () => { window.removeEventListener('popstate', chnRouteFn, false)}
    }
  }, [ssrContext])

  // return child components
  const {component, componentFetch, routeProps = {}, requireAuth} = cfg[renderRoute.routekey] || {}
  if (!component) {
    return `404 - error, unknown route ${renderRoute.routekey}`
  } else {
    let resource
    if (componentFetch) { 
      if (ssrContext === "server" || ssrContext === "hydrate") {
        // the data has been fetched on the server, so just wrap in a completed Promise
        resource = _suspenseWrap(serverInitialData)
      } else {

        console.log (`Start the data fetch for the route`)

        if (requireAuth) {
          // TODO - router does have access to session data
        }
        /*
        let operation = componentFetch.store ? 'store/'+componentFetch.store : componentFetch.operation, 
            recordid = null, 
            query = componentFetch.query || null

        if (componentFetch.urlidField) {
          if (componentFetch.urlidField === "recordid") {
            recordid = renderRoute.urlid
          } else {
            query = {...query, [componentFetch.urlidField]: renderRoute.urlid}
          }
        }
        */
        
        resource = _suspenseFetch('componentFetch'+renderRoute.routekey,  renderRoute.urlid)
        
      }
      return (
        <Suspense fallback={<h1>Loading profile...</h1>}>
          {React.createElement(component, Object.assign({key: component.name}, routeProps, renderRoute.props, {resource}))}
        </Suspense>
      )
    }
    return React.createElement(component, Object.assign({key: component.name}, routeProps, renderRoute.props))
    
  }
}
