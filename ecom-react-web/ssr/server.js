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

// https://nckweb.com.ar/a-pain-in-the-react-challenges-behind-ssr/
// The need of transpiling JSX code on the server, 2 options:
// Webpack: apply similar building steps as it’s done with the client code, however, we dont need budbling on the server

// Babel: transpile the code using babel-cli, no bundling.

import App from '../src/App'

//var App = React.createFactory(require('../src/App'))
const output = {path: path.resolve(__dirname, '../static'), publicPath : "/_assets_"}

//const assets = JSON.parse(fs.readFileSync('./dist/assets.json', 'utf8'))
//const assets = require('../dist/assets.json')

http.createServer(function(request, response) {
    console.log (`Server - requesting ${request.url}`)
    // /PUBLIC/manifest.json
    if (request.url.startsWith (output.publicPath) ) {
        
        //const staticfile = request.url.split("/")[2]
        //var filePath = path.join(path+ request.url)
        const filePath = request.url.replace (output.publicPath, output.path)
        console.log (`serving static resource  filePath=${filePath}`)

        if (fs.existsSync(filePath)) {
            fs.createReadStream(filePath).pipe(response)
        } else {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("404 Not Found\n");
            response.end();
        }
    } else {
        
        var filePath = path.join(output.path, 'index.html')
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