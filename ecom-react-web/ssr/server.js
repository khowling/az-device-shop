const http = require('http')
const path = require ('path')
const fs = require ('fs')
const stringReplaceStream = require('string-replace-stream')

const fetch = require('./server_fetch')
//const ReactDOMServer = require('react-dom/server')
//const App = require ('../dist/server').default

// import path from 'path'
// import http from 'http'
// import fs from 'fs'
import React from 'react'
import ReactDOMServer from 'react-dom/server'
// import stringReplaceStream from 'string-replace-stream'

import {App, AppRouteCfg} from '../src/App'
import {pathToRoute} from '../src/components/router'
import RenderContext from '../src/RenderContext'

const PUBLIC_PATH = "/_assets_"
const BUILD_PATH = '../build'

http.createServer(async function(request, response) {
    console.log (`Server - requesting ${request.url}`)
    // /PUBLIC/manifest.json
    if (request.url.startsWith (PUBLIC_PATH) ) {
        //return response.end()

        const filePath =  path.join(__dirname, request.url.replace (PUBLIC_PATH, BUILD_PATH))
        console.log (`serving static resource  filePath=${filePath}`)

        if (fs.existsSync(filePath)) {
            fs.createReadStream(filePath).pipe(response)
        } else {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("404 Not Found\n");
            response.end();
        }
    } else {
        
        var filePath = path.join(__dirname, BUILD_PATH, 'index.html')
        console.log (`serving file [${__dirname}]  ${filePath}`)

        console.log (`Server -- Getting any required initial data syncronusly`)
        const urlsplit = request.url.split('?', 2),
            startURL = {pathname: urlsplit[0], search: urlsplit.length>1 ? urlsplit[1] : null},
            {routekey, recordid } = pathToRoute (startURL),
            {initialFetch} = AppRouteCfg[routekey] || {}

        let initialData =''
        if (initialFetch) {
            initialData = await fetch(initialFetch.collection, recordid)
        }

        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8'
        });
        var readStream = fs.createReadStream(filePath);


        console.log (`Server -- Rendering HTML`)
        const reactContent = ReactDOMServer.renderToString(
            <RenderContext.Provider value={{ssrContext: "server", serverInitialData: initialData}}>
                <App startUrl={startURL}/>
            </RenderContext.Provider>)
        readStream
           .pipe(stringReplaceStream('<div id="root"></div>', `<div id="root">${reactContent}</div>`))
           .pipe(stringReplaceStream('SERVER_INITAL_DATA', JSON.stringify(initialData)))
        //   .pipe(stringReplaceStream('%PUBLIC_URL%', PublicREF))
           .pipe(response)
        //  <script src="/dist/${assets.main.js}" charset="utf-8"></script>

    }
})
.listen(process.env.PORT)
console.log (`Listening on ${process.env.PORT}`)