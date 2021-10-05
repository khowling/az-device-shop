import React from 'react';
import ReactDOM from 'react-dom';
//import './index.css';
import { App } from './App';
import * as serviceWorker from './serviceWorker';
import { RenderContext } from './GlobalContexts'


const { pathname, search, hash } = window.location

const root = ReactDOM.createRoot(document.getElementById('root'))
console.log('index.js - root.render')
root.render(
    <React.StrictMode>
        <App startUrl={{ pathname, search, hash }} />
    </React.StrictMode>,

)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
