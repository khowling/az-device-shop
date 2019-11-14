import React from 'react'
import ReactDOM from 'react-dom'
import App from '../src/App.js'
const {pathname, search, hash} = window.location

ReactDOM.hydrate(<App startUrl={{pathname, search, hash}} />, document.getElementById('root'));