## Web UI

### SSR Operation

Using React 18 ALPHA, to allow ```<Suspense>``` Support for SSR [docs](https://github.com/reactwg/react-18/discussions/37)

```
npm install react@alpha react-dom@alpha react-scripts@canary --save-dev
npm install @fluentui/react @fluentui/merge-styles  --save-dev
```

[Installing React 18 Alpha](https://github.com/reactwg/react-18/discussions/9)

Running Locally
 * npm start
    * ```PORT=8000 REACT_APP_SERVER_URL=http://localhost:3000 react-scripts start"```
    * uses ```index.js``` -> ``` react-dom.render(<App startUrl={{ pathname, search, hash }} />```

Running SSR

 * Send HTML to browser
   * ```server/server.ts ssr()``` -> ```src/ssr_server.ts react-dom/unstable-fizz pipeToNodeWritable(<Providers...> <App/> </Providers>)```

 * Browser loads React and your App JS package
   * Client App Code : ```<script src="/static/js/main.js"></script>```
        ```server/server.ts serve_static()``` -> ```./build/js/main.js```
        Built from webpack on ```src/ssr_hydrate.ts react-dom.render(<Providers value='window.__HYDRATE__TENENT__'> <App/> </Providers>)```,  ```build_assets_web```

 * Hydration == browser js walks the HTML DOM and attaches event handlers


```web (full build)``` ("preLaunchTask": "full_build_web")
    * "build_assets_web" -> ```npm build_assets```
        ## Webpack 'development' package', using  ```src/ssr_hydrate.js```, output: ```src/build/js/main.js```
        REACT_APP_FACTORY_PORT=9091 REACT_APP_ORDERING_PORT=9090 NODE_ENV=development node scripts/build.js
    * "build_lib_web" -> ```npm build_lib```
        rm -r ./lib; babel --config-file ./babel.config.json --out-dir lib ./src
    * "compile_typescript_web"
        tsc -p web/server/tsconfig.json 


* ```src/index.html```
* 
* ```src/ssr_server```

### WebSocket Routing (factory & ordering)


### Docker


```
export ACR_NAME=
```

### Build & Run

```
docker build -t ${ACR_NAME}.azurecr.io/az-device-shop/web:0.1.0 -f Dockerfile.root ../

docker run --env-file ./.env -d -p 3000:3000 ${$ACR_NAME}.azurecr.io/az-device-shop/web:0.1.0 
```

### Build and push to ACR

or
```
az acr build --registry $ACR_NAME --image az-device-shop/web:0.1.0 -f Dockerfile.root ../
```
