// @flow
import React, { Reducer, useEffect, useState } from 'react';
import { trpc } from '../trpc';

import { type WsMessage } from '../../../server/src/index';

import {SlideOut, DialogInterface} from '../components/slideout'
import OrderForm from './pageFactoryOrder';
import { FactoryReducerState, stateReducer } from '../utils/stateStore'
import { getValue } from '@az-device-shop/eventing/jsfunc';

// --------------------------------------------------------------- FACTORY
interface ConnectedInfo {
  status: ConnectedStatus,
  message?: string
}

enum ConnectedStatus {
  Connected,
  Trying,
  Error
}

export function PageFactory() {

  const [state, dispatch] = React.useReducer<Reducer<FactoryReducerState, WsMessage>>(stateReducer, { state: null, metadata: null} )

  const [dialog, setDialog] = useState<DialogInterface>({open: false})
  const [connected, setConnected] = useState({status: ConnectedStatus.Trying} as ConnectedInfo)



  // this returns a useEffect
  trpc.factoryEvents.onAdd.useSubscription(undefined, {
    onStarted() {
      setConnected({status: ConnectedStatus.Connected})
    },
    onData<WsMessage>(data:any) {
      console.log ('got message')
      dispatch(data)
    },
    onError(err) {
      setConnected({status: ConnectedStatus.Error, message: err.message})
      console.error('Subscription error:', err);
      // we might have missed a message - invalidate cache
    }
  });

  const prodQueries = trpc.useQueries((t) =>
    state.state ? getValue(state.state, state.metadata.stateDefinition, 'workItems', 'items').map((w: any) => t.item.byId({ id: w?.spec?.item_ref?.id })): []
  )


  return (
    <>
      <div className="mt-7"></div>
      { connected.status === ConnectedStatus.Trying ? 
        <div className="alert alert-warning shadow-lg">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <span>Trying to connect to Log.....</span>
          </div>
        </div>
        : connected.status === ConnectedStatus.Error ? 
            <div className="alert alert-error shadow-lg">
            <div>
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>Error! Cannot connect: {connected.message}</span>
            </div>
          </div>
        :
        <div className="alert alert-success shadow-lg">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current flex-shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>Connected to live data stream</span>
          </div>
        </div>
      }

      { state.state && 
        <div className="mt-7 place-content-center grid grid-flow-col gap-10 p-5 text-center auto-cols-max border-solid rounded-md border border-slate" >
        
          <div className="flex flex-col p-2 bg-neutral rounded-box text-neutral-content">
            <span className="countdown font-mono text-5xl">
            {getValue(state.state, state.metadata.stateDefinition, '_control', 'log_sequence')}
            </span>
            Log Sequence
          </div> 
          <div className="flex flex-col p-2 bg-neutral rounded-box text-neutral-content">
            <span className="countdown font-mono text-5xl">
            {getValue(state.state, state.metadata.stateDefinition, '_control', 'change_count')}
            </span>
            Change Count
          </div> 
          <div className="flex flex-col p-2 bg-neutral rounded-box text-neutral-content">
            <span className="countdown font-mono text-5xl">
              {getValue(state.state, state.metadata.stateDefinition, 'workItems', 'items').length || 0}
            </span>
            Work Items In Progress
          </div> 
          <div className="flex flex-col p-2 bg-neutral rounded-box text-neutral-content">
            <span className="countdown font-mono text-5xl">
              {getValue(state.state, state.metadata.stateDefinition, 'factory', 'factoryStatus').capacity_allocated || 0}
            </span>
            Capacity Allocated
          </div> 
        </div>
      }

      { state.state && 
        <div tabIndex={0} className="collapse">
        <div className="collapse-title text-xl font-medium">
          degbug state
        </div>
        <div className="collapse-content">
          
          <pre>{JSON.stringify(state.state, null, 2)}</pre>



          <pre>{JSON.stringify(prodQueries, null, 2)}</pre>
        </div>
      </div>
          
        
      }

      { state.metadata && 

      <div className="mt-7 grid grid-cols-5 gap-1">
        { [[['DRAFT', 'NEW', 'FACTORY_READY'], "Processing"], [['FACTORY_ACCEPTED', 'FACTORY_COMPLETE'], "In Factory"], [['MOVE_TO_WAREHOUSE'], state.metadata.stage_txt && state.metadata.stage_txt[5] ], [['INVENTORY_AVAILABLE'], state.metadata.stage_txt && state.metadata.stage_txt[6]]].map (([stages, desc],idx) => 
        
        <div key={idx} className="basis-1/5">
          <p className="text-center font-sans text-l uppercase font-bold bg-green-400 rounded-full mx-2 py-1">{desc}</p>
          
          <div className="flex flex-col rounded-md bg-slate-50 gap-2 p-2">

          { idx === 0 &&
            <button onClick={() => setDialog({open: true})} className="hover:border-blue-500 hover:border-solid hover:bg-white hover:text-blue-500 group w-full flex flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 text-sm leading-6 text-slate-900 font-medium py-3">
              <svg className="group-hover:text-blue-500 mb-1 text-slate-400" width="20" height="20" fill="currentColor" aria-hidden="true">
                <path d="M10 5a1 1 0 0 1 1 1v3h3a1 1 0 1 1 0 2h-3v3a1 1 0 1 1-2 0v-3H6a1 1 0 1 1 0-2h3V6a1 1 0 0 1 1-1Z" />
              </svg>
              New Factory Order
            </button>
            }
            
            { getValue(state.state, state.metadata.stateDefinition, 'workItems', 'items').filter((i: any) => stages?.includes(i.status.stage as string)).map((o: any, i: number) => 
              
              <button key={i} onClick={() => setDialog({open: true})} className="text-left hover:bg-blue-500 hover:ring-blue-500 hover:shadow-md group rounded-md p-2 bg-white ring-1 ring-slate-200 shadow-sm text-sm leading-6">
                <dl className="grid sm:block lg:grid xl:block grid-cols-2 grid-rows-2 items-center">
                  <div className="group-hover:text-white font-semibold text-slate-900">
                    {o.identifier || "<TBC>"}
                  </div>
                  <div>{prodQueries?.find((p: any) => p.data?.id === o.spec?.item_ref?.id)?.data?.name} {o.spec.quantity}</div>
                  { [getValue(state.state, state.metadata.stateDefinition, 'factory', 'items', o.status?.factory_id)].map((f: any, i: number) => 
                    <dl className="grid sm:block lg:grid xl:block grid-cols-2 grid-rows-2 items-center" key={i}>
                      <div>{f.identifier}  : {f.stage}</div>
                      <progress className="progress progress-primary w-56" value={f.progress || 0} max="100"></progress>
                    </dl>
                  )}
                   
                  <dl className="mt-2 flex flex-wrap text-sm leading-6 font-medium text-slate-500">
                    <div>
                      <dt className="sr-only">Rating</dt>
                      <dd className="px-1.5 ring-1 ring-slate-200 rounded">PG</dd>
                    </div>
                    <div className="ml-2">
                      <dt className="sr-only">Year</dt>
                      <dd>2344</dd>
                    </div>
                    <div>
                      <dt className="sr-only">Genre</dt>
                      <dd className="flex items-center">
                        <svg width="2" height="2" fill="currentColor" className="mx-2 text-slate-300" aria-hidden="true">
                          <circle cx="1" cy="1" r="1" />
                        </svg>
                        Com
                      </dd>
                    </div>
                    <div>
                      <dt className="sr-only">Runtime</dt>
                      <dd className="flex items-center">
                        <svg width="2" height="2" fill="currentColor" className="mx-2 text-slate-300" aria-hidden="true">
                          <circle cx="1" cy="1" r="1" />
                        </svg>
                        0m 1s
                      </dd>
                    </div>
                  </dl>
                 
                  
                </dl>
              </button>
            
            )}
            
          </div>
        </div>
        
        )}
        
      </div>
      }

      <SlideOut openprop={dialog.open} setOpen={(open: boolean) => setDialog({open: false})}>
          <OrderForm recordId={dialog.recordId} Close={() => setDialog({open: false})}/>
      </SlideOut>
    </>
  )
}


