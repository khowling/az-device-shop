import React from 'react'
//import { renderToString } from 'react-dom/server'
import { pipeToNodeWritable } from 'react-dom/unstable-fizz'
import { RenderContext } from './GlobalContexts'
import { App, AppRouteCfg } from './App'
import { pathToRoute } from './components/router'

//  https://github.com/reactwg/react-18/discussions/22


async function ssrRender(startURL, renderData, ctx) {
    return new Promise(resolve => {
        let didError = false;
        const { startWriting, abort } = pipeToNodeWritable(
            <RenderContext.Provider value={renderData}>
                <App startUrl={startURL} />
            </RenderContext.Provider>,
            //ctx.body,
            ctx.res,
            {
                onReadyToStream() {
                    // If something errored before we started streaming, we set the error code appropriately.
                    ctx.res.statusCode = didError ? 500 : 200;
                    ctx.res.setHeader('Content-type', 'text/html');
                    ctx.res.write('<!DOCTYPE html>');
                    startWriting();
                },
                onError(x) {
                    didError = true;
                    console.error(x);
                },
                onCompleteAll() {
                    resolve()
                }
            }
        )
    })
}

export {
    AppRouteCfg,
    pathToRoute,
    ssrRender
}