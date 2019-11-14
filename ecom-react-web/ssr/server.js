const http = require('http')
const path = require ('path')
const fs = require ('fs')
const stringReplaceStream = require('string-replace-stream')
//const ReactDOMServer = require('react-dom/server')
//const App = require ('../dist/server').default

// import path from 'path'
// import http from 'http'
// import fs from 'fs'
import React from 'react'
import ReactDOMServer from 'react-dom/server'
// import stringReplaceStream from 'string-replace-stream'

import App from '../src/App'

const PUBLIC_PATH = "/_assets_"
const BUILD_PATH = '../build'

http.createServer(function(request, response) {
    console.log (`Server - requesting ${request.url}`)
    // /PUBLIC/manifest.json
    if (request.url.startsWith (PUBLIC_PATH) ) {
        
        //const staticfile = request.url.split("/")[2]
        //var filePath = path.join(path+ request.url)
        const filePath = request.url.replace (PUBLIC_PATH, BUILD_PATH)
        console.log (`serving static resource  filePath=${filePath}`)

        if (fs.existsSync(filePath)) {
            fs.createReadStream(filePath).pipe(response)
        } else {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("404 Not Found\n");
            response.end();
        }
    } else {
        
        var filePath = path.join(BUILD_PATH, 'index.html')
        console.log (`serving file [${__dirname}]  ${filePath}`)
        var stat = fs.statSync(filePath)

        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8'
        });

        var readStream = fs.createReadStream(filePath);
        var props = {}
        // We replaced all the event handlers with a simple call to readStream.pipe()
        const urlsplit = request.url.split('?')
        const reactContent = ReactDOMServer.renderToString(<App startUrl={{pathname: urlsplit[0], search: urlsplit.length>1 ? urlsplit[2] : null}}/>)
        readStream
           .pipe(stringReplaceStream('<div id="root"></div>', `<div id="root">${reactContent}</div>`))
        //   .pipe(stringReplaceStream('%PUBLIC_URL%', PublicREF))
           .pipe(response)
        //  <script src="/dist/${assets.main.js}" charset="utf-8"></script>

    }
})
.listen(process.env.PORT)
console.log (`Listening on ${process.env.PORT}`)