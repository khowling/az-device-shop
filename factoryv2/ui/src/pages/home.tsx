import React, { useEffect, useState } from 'react';
import { PageItem } from './pageItem';
import { PageFactory } from './pageFactory';


export default function IndexPage() {

  const [tab, setTab] = useState(0)
  return (
    <div className="container mx-auto">
        <div className="mt-6 flex justify-center space-x-16 ">
          { ["Factory Orders", "Manage Items",,"Stats"].map((t,i) => 
            <a key={i} className={`tab tab-lg ${tab === i ? 'tab-active bg-blue-400': 'bg-white'}`} 
              onClick={() => setTab(i)}><p className="font-sans text-xl uppercase font-extrabold">{t}</p></a>  
          )}
        </div>
        { tab === 0 ?
          <PageFactory />
        : tab ===1 ?
          <PageItem />
        : 
          <div>2</div>
        }
    </div>
  )
}
