import React from 'react'

// https://reactjs.org/docs/react-dom-server.html
import ReactDOMServer  from 'react-dom/server';


import { RenderContext, TenentContext } from './GlobalContexts.js'
import { App } from './App.js'
import Html from './Html.js'
import { Stylesheet, InjectionMode, resetIds } from '@fluentui/react';

export { AppRouteCfg } from './App.js'
export { pathToRoute } from './components/router.js'


// Do this in file scope to initialize the stylesheet before Fluent UI React components are imported.
const stylesheet = Stylesheet.getInstance();

// Set the config.
stylesheet.setConfig({
    injectionMode: InjectionMode.none,
    namespace: 'server'
});

//  https://github.com/reactwg/react-18/discussions/22
// Required for Suspense to work with data fetch promises
function createRenderData(ctx, renderContext, renderDataPromise) {

    if (!renderDataPromise) {
        return {
            read() { return renderContext }
        }
    } else {
        let done = false, result = null;
        let suspender = renderDataPromise.then(res => {
            done = true;
            renderContext.serverInitialData = res
        })
        return {
            read() {
                if (!done) {
                    throw suspender
                }
                return renderContext
            }
        }
    }
}

export async function ssrRender_new(ctx, startURL, renderDataPromise) {

    let controller = new AbortController();
    try {
      let stream = await renderToReadableStream(
        <html>
          <body>Success</body>
        </html>,
        {
          signal: controller.signal,
        }
      );
      
      // This is to wait for all suspense boundaries to be ready. You can uncomment
      // this line if you don't want to stream to the client
      // await stream.allReady;
    
      return new Response(stream, {
        headers: {'Content-Type': 'text/html'},
      });
    } catch (error) {
      return new Response(
        '<!doctype html><p>Loading...</p><script src="clientrender.js"></script>',
        {
          status: 500,
          headers: {'Content-Type': 'text/html'},
        }
      );
    }
}


export async function ssrRender(ctx, startURL, renderDataPromise) {

    const reqUrl = ctx.request.href
    return new Promise(async resolve => {
        let didError = false;
        console.log(`ssr_server.ts: ssrRender startURL=${startURL} with renderDataPromise`);
        // <App 'hydrate_data'> is required for the hydration process, unfortunatly it requires an await, will not be required when move to server components
        // https://github.com/reactwg/react-18/discussions/37#discussioncomment-837686


        stylesheet.reset();
        resetIds();
        // https://reactjs.org/docs/react-dom-server.html#rendertopipeablestream
        // renderToPipeableStream is a Node.js specific API, modern server environments should use renderToReadableStream instead

        const {pipe, abort} =  ReactDOMServer.renderToPipeableStream(
            <TenentContext.Provider value={ctx.tenent}>
                <RenderContext.Provider value={createRenderData(ctx, { ssrContext: "server", reqUrl }, renderDataPromise)}>
                    <Html title="React18" hydrate_tenent={ctx.tenent} hydrate_data={{ ssrContext: "hydrate", reqUrl, ...(renderDataPromise && { serverInitialData: await renderDataPromise }) }} >
                        <App startUrl={startURL} />
                    </Html>
                </RenderContext.Provider>
            </TenentContext.Provider>, {
                onAllReady() {
                    // If something errored before we started streaming, we set the error code appropriately.
                    ctx.res.statusCode = didError ? 500 : 200
                    ctx.res.setHeader('Content-type', 'text/html')
                    ctx.res.setHeader('Cache-Control', 'public')
                    ctx.res.setHeader('Cache-Control', 'max-age=43200')
                    ctx.res.write('<!DOCTYPE html>')
                    ctx.res.write(`<style>${stylesheet.getRules(true)}</style>`)
                    console.log(`ssr_server.ts: ssrRender startWriting`)
                    pipe(ctx.res);
                },
                onShellError(x) {
                    didError = true;
                    console.error(x);
                },
                onCompleteAll() {
                    console.log(`ssr_server.ts: ssrRender complete`)
                    resolve()
                }
            }
        )
    })
}

// https://github.com/facebook/react/pull/22450
export async function ssrRender_oldAPI(ctx, startURL, renderDataPromise) {

    const reqUrl = ctx.request.href
    return new Promise(async resolve => {
        let didError = false;
        console.log(`ssr_server.ts: ssrRender startURL=${startURL} with renderDataPromise`);
        // <App 'hydrate_data'> is required for the hydration process, unfortunatly it requires an await, will not be required when move to server components
        // https://github.com/reactwg/react-18/discussions/37#discussioncomment-837686


        stylesheet.reset();
        resetIds();
        const { startWriting, abort } = renderToNodePipe(
            <TenentContext.Provider value={ctx.tenent}>
                <RenderContext.Provider value={createRenderData(ctx, { ssrContext: "server", reqUrl }, renderDataPromise)}>
                    <Html title="React18" hydrate_tenent={ctx.tenent} hydrate_data={{ ssrContext: "hydrate", reqUrl, ...(renderDataPromise && { serverInitialData: await renderDataPromise }) }} >
                        <App startUrl={startURL} />
                    </Html>
                </RenderContext.Provider>
            </TenentContext.Provider>,
            ctx.res,
            {
                onReadyToStream() {
                    // If something errored before we started streaming, we set the error code appropriately.
                    ctx.res.statusCode = didError ? 500 : 200
                    ctx.res.setHeader('Content-type', 'text/html')
                    ctx.res.setHeader('Cache-Control', 'public')
                    ctx.res.setHeader('Cache-Control', 'max-age=43200')
                    ctx.res.write('<!DOCTYPE html>')
                    ctx.res.write(`<style>${stylesheet.getRules(true)}</style>`)
                    console.log(`ssr_server.ts: ssrRender startWriting`)
                    startWriting();
                },
                onError(x) {
                    didError = true;
                    console.error(x);
                },
                onCompleteAll() {
                    console.log(`ssr_server.ts: ssrRender complete`)
                    resolve()
                }
            }
        )
    })
}
