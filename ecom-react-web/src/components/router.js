import React, {useState, useEffect} from 'react'
import {Panes} from './store.js'
import {Order} from './order.js'

const DEFAULT_LANDING = 'Panes';
const routableCompoments = [Panes, Order]

// =====================================     Processes navigation routes Called from DOM 

export function Link({component, recordid, props, children, ...rest}) {
  //let routeJson = getRouteObj(component, recordid, props)

  function _encodeURL (component, recordid, props) {
    let ulrstr = "/"
    ulrstr+= component? component : (recordid? "_" : "")
    ulrstr+= recordid ? ("/" + recordid)  : ""
  
    if (props && Object.keys(props).length >0) ulrstr+= "?props=" + encodeURIComponent(btoa(JSON.stringify(props)));
    return ulrstr;
  }
  
  function handleClick(event) {
    console.log ('Link: handleclick')
    if (
      !event.defaultPrevented && // onClick prevented default
      event.button === 0 && // ignore everything but left clicks
      !(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) // ignore clicks with modifier keys
    ) {
      console.log ('Link: pushstate')
      event.preventDefault()
      if (typeof window !== 'undefined') {
        window.history.pushState("","",_encodeURL (component, recordid, props))
      }
      // now notify the router!!
      listeners.forEach(listener => listener({component, recordid, props}))
    }

  }
  return (<a {...rest} onClick={handleClick} href={_encodeURL (component, recordid, props)}>{children}</a>)
}


// =====================================     Processes navigation routes Called from React JS 
export function navTo(component, recordid, props) {
  console.log (`navTo: ${component}`)
  //const routeJson = getRouteObj(component, recordid, props)
  listeners.forEach(listener => listener({component, recordid, props}))
  
}

const listeners = [];
const _compoenentMap = Object.assign({},      ...routableCompoments.map(mod => { return ({[mod.name]: mod})}))

export function useRouter (startUrl) {
  const [renderRoute, setRenderRoute] = useState(pathToRoute(startUrl))

  console.log (`useRouter() renderRoute=${JSON.stringify(renderRoute)}, router known components=${Object.keys(_compoenentMap).join(",")}]`)

  // Subscribe to <Link> events
  useEffect(() => {
    console.log ('useRouter: useEffect - initialise listeners to listen for <Link>)')
    listeners.push(newrouteRequested => setRenderRoute(newrouteRequested))
    return () => listeners.pop()
  },[])

  function pathToRoute({pathname, search, hash}) {
    console.log (`pathToRoute pathname=${pathname} search=${search}`)
    const propsparam = search && search.match(/\A?var1=([^&]+)&*/i),
          url_props = propsparam? propsparam[1]: null,
          withoutleadingslash = pathname.slice(1),
          [url_comp, recordid] = withoutleadingslash.length === 0? [] : withoutleadingslash.split("/")
    return {
      component: url_comp ? (url_comp === "_" ? undefined : url_comp) : undefined, 
      props: url_props ? JSON.parse(atob(decodeURIComponent(url_props))) : {},
      recordid,
    }
  }


  // Subscribe to popstate events (browser back/forward buttons)
  useEffect(() => {

    function chnRouteFn (event) {
      setRenderRoute(() => {
        if (typeof window  === 'undefined') {
          //throw new Error ("error")
          console.log ('no window')
        } else {
          const {pathname, search, hash} = new URL(window.location)
          return pathToRoute({pathname, search, hash})
        }
      })
    }

    if (typeof window !== 'undefined') {
      console.log ('useRouter: useEffect - initialise listeners to listen for popstate (browser back/forward)')
      window.addEventListener('popstate', chnRouteFn, false)
      //chnRouteFn()
      return () => { window.removeEventListener('popstate', chnRouteFn, false)}
    }
  }, [])

  function renderComponents(renderRoute) {
    let comps = {}
    if (!renderRoute.component) {
      console.log (`renderComponents: no default, rendering ${DEFAULT_LANDING}`)
      comps = {main: React.createElement(_compoenentMap[DEFAULT_LANDING], {key: DEFAULT_LANDING})}
      
      if (Object.keys(comps).length === 0) {
        comps =  {main: "404 - No landing page defined for app"}
      }

    } else { 
      // component direct

      let component = _compoenentMap[renderRoute.component];
      if (component) {
        comps = {main: React.createElement(component, Object.assign({key: JSON.stringify(renderRoute.props)}, renderRoute.props, {recordid: renderRoute.recordid}))}
      } else {
        comps = {main: `404 - Unknown Compoent ${renderRoute.component}`}
      }
    }
    return comps
  }

  return !renderRoute ? {main: <div>internal error, null renderRoute</div>} : renderComponents(renderRoute)
}
