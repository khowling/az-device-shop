import React, {useState} from 'react';
import {Link, useRouter} from './components/router'

import './App.css';

function Nav ({user}) {
  return (
    <nav className="m-navigation-bar" role="navigation">

      <div className="c-navigation-menu">

        <Link className="navbar-brand no-outline">
            <img src="https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png" alt="Microsoft" height="23"/>
        </Link>

        <button aria-controls="navigationMenuA" aria-haspopup="true" aria-expanded="false">Navigation menu</button>
        <ul id="navigationMenuA" aria-hidden="true">
            <li className="f-sub-menu">
                <button aria-controls="navigationMenuAMenu1" aria-haspopup="true" aria-expanded="false">Sub menu 1</button>
                <ul id="navigationMenuAMenu1" aria-hidden="true">
                    <li>
                        <a href="#/">Hyperlink 1</a>
                    </li>
                </ul>
            </li>
            <li>
                <a href="#/">Hyperlink 1</a>
            </li>
        </ul>
      </div>
    </nav>
  )
}

function useTesting () {
  const [mystate, setMyState] = useState ('345')
  //
  return {
    main: <div>{mystate}</div>
  }
}

function App() {
  const [main, setMain] = useState(<div>stateapp</div>)
  //const { main} = useTesting ()
  //const {  main } = useRouter ()
  console.log ('rendering main asd')
  return (
    <main id="mainContent" data-grid="container">
       
        {main}
      </main>
  );
}

export default App;
