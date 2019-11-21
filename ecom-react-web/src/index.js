import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import {App} from './App';
import * as serviceWorker from './serviceWorker';
import RenderContext from './RenderContext'


const {pathname, search, hash} = window.location

ReactDOM.render(
    <RenderContext.Provider value={{ssrContext: "spa"}}>
        <App startUrl={{pathname, search, hash}} />
    </RenderContext.Provider>, 
    document.getElementById('root'));

//ReactDOM.createRoot (document.getElementById('root')).render(<App startUrl={{pathname, search, hash}}/>)

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
serviceWorker.unregister();
