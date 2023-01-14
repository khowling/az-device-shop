
import React, { useState } from 'react';
import { trpc } from '../utils/trpc';
import { inferProcedureInput } from '@trpc/server';
import type { AppRouter, ZodError } from '@full-stack-typesafe-ts/server/index';
import { itemSKUModel } from '@full-stack-typesafe-ts/server';

// ------------------------------------------------ Form

interface DemoFormInterface {
  Close: () => void;
  recordId?: string;
}

interface FormErrors {
  [inputName: string]: any
}

type ItemFormData = inferProcedureInput<AppRouter['item']['add']>

interface FormState<T> { 
  data : T, 
  errors: FormErrors 
}


export function ItemForm({Close, recordId}: DemoFormInterface) {

  console.log ('render DemoForm, recordId:', recordId)

  const emptyData: ItemFormData = {
    name: "",
    type: "Manufactured",
    required: "",
    additionalInfo: "",
    notifyMe: false
  }
  
  const [form, setForm] = useState({  data: emptyData, errors: validate(emptyData)} as FormState<ItemFormData>) 
  

  const utils = trpc.useContext();
  const { isLoading, isError, data, error } = trpc.item.byId.useQuery({ id: recordId || "dummy" }, {enabled: typeof recordId !== 'undefined', onSuccess: (serverdata) => {
    const data = {...serverdata, ...(serverdata.required && { required: new Date(serverdata.required.toString()).toJSON().split('T')[0] })}
    console.log ('onSuccess', data)
    setForm({ data, errors: validate(data) });
  }})



  function inputUpdate (key: string, value: any) {
    console.log ('inputUpdate', key, value)
    setForm(f => {
      const data = {...f.data, [key]: value}
      return {data, errors: validate(data)}
    })
  }

  function validate(data: ItemFormData ) {
    try {
      const zresult = itemSKUModel.parse(data)
      console.log ('itemSKUModel.parse result: ', zresult)
      return {}
    } catch (e) {
      const zerr = e as ZodError
      const res = zerr.issues.reduce((a: any, c: any) => { return {...a, [c.path[0]]: {...c}}},{})
      return res
    }
  }

  const mutation  = trpc.item.add.useMutation({
    async onSuccess() {
      // refetches posts after a post is added
      await utils.item.list.invalidate();
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
                <span className="text-gray-700">Name</span>
                <input value={form.data['name']} onChange={e => inputUpdate(e.target.name, e.target.value)} type="text" name="name" className={`
                    ${form.errors['name'] ? 'border-red-500 focus:border-red-500' : 'focus:border-gray-500'}
                    mt-1 block w-full rounded-md bg-gray-100 border-transparent focus:bg-white focus:ring-0`} placeholder=""/>
                { form.errors['name'] && 
                  <span className="ml-1 text-red-500 text-sm">{form.errors['name'].message}</span>
                }
              </label>
              <label className="block">
                <span className="text-gray-700">Type?</span>
                <select value={form.data['type']} onChange={e => inputUpdate(e.target.name, e.target.value)} name="type" className={`
                  ${form.errors['type'] ? 'border-red-500 focus:border-red-500' : 'focus:border-gray-500'}
                    block w-full mt-1 rounded-md bg-gray-100 border-transparent focus:bg-white focus:ring-0`}>
                  <option>Manufactured</option>
                  <option>Purchased</option>
                </select>
                { form.errors['type'] && 
                  <span className="ml-1 text-red-500 text-sm">{form.errors['type'].message}</span>
                }
              </label>
              <label className="block">
                <span className="text-gray-700">When is your event?</span>
                <input value={form.data['required'] as string} onChange={e => inputUpdate(e.target.name, e.target.value)}  name="required" type="date" 
                    className="mt-1 block w-full rounded-md bg-gray-100 border-transparent focus:border-gray-500 focus:bg-white focus:ring-0"/>
                { form.errors['required'] && 
                  <span className="ml-1 text-red-500 text-sm">{form.errors['required'].message}</span>
                }
              </label>

              <label className="block">
                <span className="text-gray-700">Additional details</span>
                <textarea  value={form.data['additionalInfo']} onChange={e => inputUpdate(e.target.name, e.target.value)}  name="additionalInfo" 
                    className="mt-1 block w-full rounded-md bg-gray-100 border-transparent focus:border-gray-500 focus:bg-white focus:ring-0" rows={3}></textarea>
                { form.errors['additionalInfo'] && 
                  <span className="ml-1 text-red-500 text-sm">{form.errors['additionalInfo'].message}</span>
                }
              </label>
              <div className="block">
                <div className="mt-2">
                  <div>
                    <label className="inline-flex items-center">
                      <input checked={form.data['notifyMe']}  onChange={e => inputUpdate(e.target.name, e.target.checked)}  name="notifyMe" type="checkbox" 
                          className="rounded bg-gray-200 border-transparent focus:border-transparent focus:bg-gray-200 text-gray-700 focus:ring-1 focus:ring-offset-2 focus:ring-gray-500"/>
                      <span className="ml-2">Notify Me of Updates</span>
                      { form.errors['notifyMe'] && 
                        <span className="ml-1 text-red-500 text-sm">{form.errors['notifyMe'].message}</span>
                      }
                    </label>
                  </div>
                </div>
              </div>
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

