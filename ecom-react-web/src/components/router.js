import React, {useState, useEffect, useContext, Suspense} from 'react'
import {_suspenseFetch, _suspenseWrap} from '../utils/fetch'
import RenderContext from '../RenderContext'

// =====================================     Processes navigation routes Called from DOM 
export function Link({route, recordid, props, children, ...rest}) {
  const {ssrContext} = useContext(RenderContext)

  function _encodeURL (route, recordid, props) {
    let ulrstr = route? route : (recordid? "/_" : "/")
    ulrstr+= recordid ? ("/" + recordid)  : ""
  
    if (props && Object.keys(props).length >0) ulrstr+= "?props=" + encodeURIComponent(btoa(JSON.stringify(props)));
    return ulrstr;
  }
  
  function handleClick(event) {
    console.log ('Link: handleclick')
    if (
      !event.defaultPrevented && // onClick prevented default
      event.button === 0 && // ignore everything but left clicks
      !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) && // ignore clicks with modifier keys
      ssrContext === "spa" // Only override links if not SSR
    ) {
      console.log ('Link: pushstate')
      event.preventDefault()
      if (typeof window !== 'undefined') {
        window.history.pushState("","",_encodeURL (route, recordid, props))
      }
      // now notify the router!!
      listeners.forEach(listener => listener({routekey: route || '/', recordid, props}))
    }

  }
  return (<a {...rest} onClick={handleClick} href={_encodeURL (route, recordid, props)}>{children}</a>)
}


// =====================================     Processes navigation routes Called from React JS 
export function navTo(routekey, recordid, props) {
  console.log (`navTo: ${routekey}`)
  //const routeJson = getRouteObj(route, recordid, props)
  listeners.forEach(listener => listener({routekey, recordid, props}))
}

// convert parts of the url into route key, recordid and props
export function pathToRoute({pathname, search, hash}) {
  console.log (`pathToRoute pathname=${pathname} search=${search}`)
  const propsparam = search && search.match(/A?props=([^&]+)&*/i),
        url_props = propsparam? propsparam[1]: null,
        withoutleadingslash = pathname.slice(1),
        [url_comp = '/', recordid] = withoutleadingslash.split("/", 2)
        
  return {
    routekey: '/' + (url_comp ? (url_comp === "_" ? '' : url_comp) : ''), 
    props: url_props ? JSON.parse(atob(decodeURIComponent(url_props))) : {},
    recordid,
  }
}

const listeners = [];
// =====================================     My Super Simple Router 
export function useRouter (startUrl, cfg) {
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
  const {component, initialFetch} = cfg[renderRoute.routekey] || {}
  if (!component) {
    return `404 - error, unknown route ${renderRoute.routekey}`
  } else {
    let resource
    if (initialFetch) { 
      if (ssrContext === "server" || ssrContext === "hydrate") {
        // the data has been fetched on the server, so just wrap in a completed Promise
        resource = _suspenseWrap(serverInitialData)
      } else {
        //console.log (`Start the data fetch for the route, entity=${initialFetch.collection}`)
        resource = _suspenseFetch(initialFetch.store ? 'store/'+initialFetch.store : initialFetch.operation, initialFetch.recordid ? renderRoute.recordid : null)
      }
      return (
        <Suspense fallback={<h1>Loading profile...</h1>}>
          {React.createElement(component, Object.assign({key: component.name}, renderRoute.props, {resource}))}
        </Suspense>
      )
    }
    return React.createElement(component, Object.assign({key: component.name}, renderRoute.props))
    
  }
}
