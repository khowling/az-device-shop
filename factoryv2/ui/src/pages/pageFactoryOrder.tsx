
import React, { useEffect, useState } from 'react';
import { trpc } from '../utils/trpc';
import { inferProcedureInput } from '@trpc/server';
import type { AppRouter, ZodError } from "@az-device-shop/factory-server";
import { factoryOrderModel } from "@az-device-shop/factory-server/schema";

// ------------------------------------------------ Form

interface DemoFormInterface {
  Close: () => void;
  recordId?: string;
}

interface FormErrors {
  [inputName: string]: {message: string}
}

type OrderFormData = inferProcedureInput<AppRouter['order']['add']>

interface FormState<T> { 
  data : T, 
  errors: FormErrors 
}


export default function OrderForm({Close, recordId}: DemoFormInterface) {

  console.log ('render OrderForm, recordId:', recordId)

  const [clickedon, setClickedon] = useState(0)
  const [form, setForm] = useState({  data: {}, errors: validate({})} as FormState<OrderFormData>) 
  
  const utils = trpc.useContext();

  function inputUpdate (key: string, value: any) {
    console.log ('inputUpdate', key, value)
    setForm(f => {
      const data = {...f.data, [key]: value}
      return {data, errors: validate(data)}
    })
  }

  function validate(data : any) {
    try {
      const zresult = factoryOrderModel.parse(data)
      console.log ('factoryOrderModel.parse result: ', zresult)
      return {}
    } catch (e) {
      const zerr = e as ZodError
      const res = zerr.issues.reduce((a: any, c: any) => { return {...a, [c.path[0]]: {...c}}},{})
      return res
    }
  }

  const mutation  = trpc.order.add.useMutation({
    async onSuccess() {
      // refetches posts after a post is added
      Close()
    },
  });

  async function updateItem (e : React.FormEvent<HTMLFormElement>) {
    console.log ('updateItem')
    e.preventDefault();
    const $form = e.currentTarget;
    try {
      console.log ('mutation.mutate: ', form.data)
      await mutation.mutate(form.data)
      $form.reset();
      
    } catch (cause) {
      console.error({ cause }, 'Failed to add post');
    }
  }

  return (
  <form  onSubmit={updateItem}>
    
    <div className="grid grid-cols-1 gap-6">
        
        <label className="block">
          <span className="text-gray-700">Status</span>
          <select value={form.data['status']} onFocus={() => setClickedon(clickedon+1)} onChange={e => inputUpdate(e.target.name, e.target.value)} name="status" className={`
            ${form.errors['status'] ? 'border-red-500 focus:border-red-500' : 'focus:border-gray-500'}
              block w-full mt-1 rounded-md bg-gray-100 border-transparent focus:bg-white focus:ring-0`}>
            <option></option>
            <option>Draft</option>
            <option>Required</option>
            <option>InFactory</option>
            <option>Cancel</option>
          </select>
          { form.errors['status'] && 
            <span className="ml-1 text-red-500 text-sm">{form.errors['status'].message}</span>
          }
        </label>

        <LookupSearch form_error={form.errors['item_ref']} form_value={form.data['item_ref']} inputUpdate={(value) => inputUpdate('item_ref', value)} clickedon={clickedon} label="Item" />

        
        <label className="block">
          <span className="text-gray-700">Quantity?</span>
          <input value={form.data['quantity'] || ""} onChange={e => inputUpdate(e.target.name, e.target.value)}  name="quantity" type="number"
              className="mt-1 block w-full rounded-md bg-gray-100 border-transparent focus:border-gray-500 focus:bg-white focus:ring-0"/>
          { form.errors['quantity'] && 
            <span className="ml-1 text-red-500 text-sm">{form.errors['quantity'].message}</span>
          }
        </label>
      </div>

      <div className="bg-gray-50 py-3 my-6 text-right">
        <button
            type="button"
            onClick={Close}
            className="inline-flex justify-center rounded-md border border-transparent bg-red-600 py-2 px-4 ml-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >Cancel
        </button>
        
        <button
          type="submit"
          disabled={mutation.isLoading || Object.keys(form.errors).length >0}
          className="disabled:opacity-25 inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4  ml-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >Save
        </button>
        {mutation.error && (
          <p style={{ color: 'red' }}>{mutation.error.message}</p>
        )}
      </div>
  
  </form>
  )
}

function LookupSearch({form_error, clickedon, label, inputUpdate, form_value}: {form_value: {id:string} | undefined, form_error: {message: string}, clickedon: number, label: string, inputUpdate: (value: any) => void}) {

  const [inputValue, setInutValue] = useState('')
  const [results, setResults] = useState({display: false, form_valueText: "", data: []} as {display: boolean, form_valueText: string, data: Array<{key: string, text: string}>})


  useEffect(() => {
    setResults({...results, display: false})
  }, [clickedon])
  const labelQuery = trpc.item.byId.useQuery(form_value as {id: string}, {enabled: form_value !== null, onSuccess: (data) => {
    console.log ('onSuccess', data)
    setResults({...results, form_valueText: data.name, display: false})
  }})

  const { isLoading, isError, data, error } = trpc.item.list.useQuery({/* use inputValue  */}, {enabled: results.display, onSuccess: (data) => {
  
    console.log ('onSuccess', data)
    setResults({...results, data: data.map((item) => {return {key: item.id, text: item.name}})})
  }})

  return (
    <label className="block">
      <span className="text-gray-700">{label}</span>

      <div className="mt-1 pointer-events-auto relative z-10 w-[24.125rem] rounded-lg bg-white text-[0.8125rem] leading-5 text-slate-700 shadow-xl shadow-black/5 ring-1 ring-slate-700/10">

      { !form_value ? 
        <div className="flex items-center">
          <svg className="absolute ml-3.5 mr-2 h-7 w-5 stroke-slate-500 my-2.5" fill="none" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input className={`grow pl-10 ${results.display ? "rounded-t-lg": "rounded-lg"}  border-inherit`} onClick={() => setResults({...results, display: true})}   placeholder="Search..." type="text" value={inputValue} onChange={({target}) =>setInutValue(target.value)}/>

        </div>

        :

        <div className="flex items-center">
          <div className="flex items-center  border border-solid py-1 px-2 m-1 rounded-lg bg-indigo-600 text-white">
            
            <div className="flex items-center text-base">{results.form_valueText}</div>
            <a onClick={() =>  inputUpdate(undefined)}>
              <svg className="ml-2 mt-1 h-3 w-3 items-center stroke-white " fill="none" viewBox="0 0 24 24" strokeWidth="4">
                <line x2="18" y2="18" />
                <line x1="18" y2="18" />
              </svg>
            </a>
          </div>
        </div>
      }

      <div className={`${results.display ? "": "hidden" } border-t border-slate-400/20 py-3 px-3.5`}>
        
        <div className="mb-1.5 text-[0.6875rem] font-semibold text-slate-500">Recent searches</div>

        <div className="flex items-center rounded-md p-1.5">
          <svg className="mr-2.5 h-5 w-5 flex-none stroke-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>Add new file...
        </div>

        <div className={`${results.display ? "": "hidden" } border-t border-slate-400/20 py-1 px-3.5`}/>
        
        { results.data.map(({key, text}, index) => 
            <a key={index} className="flex items-center rounded-md p-1.5 hover:bg-indigo-600 hover:text-white" onClick={() => inputUpdate({id: key})}>
            <svg className="mr-2.5 h-5 w-5 flex-none stroke-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path>
            </svg>{text}
          </a>
        )}


{/* 
    

          <div className="flex items-center rounded-md p-1.5">
            <svg className="mr-2.5 h-5 w-5 flex-none stroke-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"></path>
            </svg>Add new folder...
          </div>

          <div className="flex items-center rounded-md p-1.5">
            <svg className="mr-2.5 h-5 w-5 flex-none stroke-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path>
            </svg>Add hashtag...
          </div>

          <div className="flex items-center rounded-md p-1.5">
            <svg className="mr-2.5 h-5 w-5 flex-none stroke-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
            </svg>Add label...
          </div>

*/}
        </div>
      </div>
      { form_error && !results.display &&
        <span className="ml-1 text-red-500 text-sm">{form_error.message}</span>
      }
    </label>
                            
  )
}

