import React from 'react';
import { render, createRoot } from 'react-dom';
//import './index.css';
import { App } from './App';
import * as serviceWorker from './serviceWorker';
import { RenderContext } from './GlobalContexts'


const { pathname, search, hash } = window.location

//const root = createRoot(document.getElementById('root'));

const root = createRoot(document, { hydrate: false });
root.render(<App startUrl={{ pathname, search, hash }} />)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
