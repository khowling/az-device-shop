import React from 'react';
import { render } from 'react-dom';
//import './index.css';
import { App } from './App';
import * as serviceWorker from './serviceWorker';
import { RenderContext } from './GlobalContexts'


const { pathname, search, hash } = window.location

render(
    <RenderContext.Provider value={{ ssrContext: "spa" }}>
        <App startUrl={{ pathname, search, hash }} />
    </RenderContext.Provider>,
    document.getElementById('root'));

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
