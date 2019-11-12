import React, {useState, useEffect} from 'react'
import {Panes} from './store'
import {Order} from './order'

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
const _Router_FACTORIES = Object.assign({}, ...routableCompoments.map(mod => { return ({[mod.name]: React.createFactory(mod)})}))

export function useRouter () {
  const [renderRoute, setRenderRoute] = useState()

  console.log (`useRouter() [state: renderRoute : ${JSON.stringify(renderRoute)}]`)

  // Subscribe to <Link> events
  useEffect(() => {
    console.log ('useRouter: useEffect - initialise listeners to listen for <Link>)')
    listeners.push(newrouteRequested => setRenderRoute(newrouteRequested))
    return () => listeners.pop()
  },[])


  const chnRouteFn = (event) =>  setRenderRoute(() => {
    if (typeof window  === 'undefined') {
      //throw new Error ("error")
      console.log ('no window')
    } else {
      const url = new URL(window.location),
            url_comprec = url.pathname.substr(1),
            url_props = url.searchParams.get ("props"),
            [url_comp, recordid] = url_comprec.length === 0? [] : url_comprec.split("/")
      
      console.log (`decodeCurrentURI: ${JSON.stringify(url)}`)
      return {
        component: url_comp ? (url_comp === "_" ? undefined : url_comp) : undefined, 
        props: url_props ? JSON.parse(atob(decodeURIComponent(url_props))) : {},
        recordid, 
        urlparms: []
      }
    }
  })

  // Subscribe to popstate events (browser back/forward buttons)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log ('useRouter: useEffect - initialise listeners to listen for popstate (browser back/forward)')
      window.addEventListener('popstate', chnRouteFn, false)
      chnRouteFn()
      return () => { window.removeEventListener('popstate', chnRouteFn, false)}
    }
  }, [])

  function renderComponents(renderRoute) {
    let comps = {}
    if (!renderRoute.component) { 
      comps = {main: (_Router_FACTORIES[DEFAULT_LANDING])(Object.assign({key: DEFAULT_LANDING}))}
    
      if (Object.keys(comps).length === 0) {
        comps =  {main: "404 - No landing page defined for app"}
      }

    } else { 
      // component direct
      let cf = _Router_FACTORIES[renderRoute.component];
      if (cf) {
        comps = {main: cf(Object.assign({key: JSON.stringify(renderRoute.props)}, renderRoute.props, {recordid: renderRoute.recordid}))}
      } else {
        comps = {main: `404 - Unknown Compoent ${renderRoute.component}`}
      }
    }
    return comps
  }

  return !renderRoute ? {} : renderComponents(renderRoute)
}
