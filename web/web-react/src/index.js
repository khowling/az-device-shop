import React from 'react';
import ReactDOM from 'react-dom';
//import './index.css';
import { App } from './App';
import * as serviceWorker from './serviceWorker';
import { TenentContext } from './GlobalContexts'


const { pathname, search, hash } = window.location

const root = ReactDOM.createRoot(document.getElementById('root'))
console.log(`index.js - root.render: downloadSAS=${process.env.REACT_APP_STORAGE_DOWNLOAD_SAS}`)
root.render(
    <TenentContext.Provider value={{
        downloadSAS: process.env.REACT_APP_STORAGE_DOWNLOAD_SAS, 
        name: "Dev Server",
        image: {"url": "https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png"}
        }}>
        <React.StrictMode>
            <App startUrl={{ pathname, search, hash }} />
        </React.StrictMode>,
    </TenentContext.Provider>

)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
