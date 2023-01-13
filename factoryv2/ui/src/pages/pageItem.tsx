import React, { useState } from 'react';
import { trpc } from '../utils/trpc';
import {SlideOut, DialogInterface} from '../components/slideout'
import { ItemForm } from './pageItemForm'
  
export function PageItem() {

    const [dialog, setDialog] = useState<DialogInterface>({open: false})

    const utils = trpc.useContext();
    const { status, data } = trpc.item.list.useQuery({ limit: 50 })

    return (
        <>
        
        <h2 className="my-6  text-2xl font-bold tracking-tight text-gray-900">
            Latest Posts (Query)
            {status === 'loading' && '(loading)'}
        </h2>

        <div className="overflow-x-auto">
            <table className="table table-compact w-full">
            <thead>
                <tr>
                <th>Name</th> 
                <th>Type</th> 
                <th>Required Date</th> 
                <th>Additional Info</th>
                <th>Notify Me</th> 
                </tr>
            </thead> 
            <tbody>
            {data?.map((item, index) => (
                <tr className="hover" key={index} onClick={() => setDialog({open: true, recordId: item.id})}>
                
                <td>{item.name}</td> 
                <td>{item.type}</td> 
                <td>{item.required ? new Date(item.required).toDateString() : ''}</td> 
                <td>{item.additionalInfo}</td> 
                <td><input checked={item.notifyMe} disabled type="checkbox"/></td> 
                </tr>
                ))}
            </tbody>
            </table>
        </div>


        <button className="btn btn-wide mt-6" onClick={() => setDialog({open: true})}>Add</button>

        <SlideOut openprop={dialog.open} setOpen={(open: boolean) => setDialog({open: false})}>
            <ItemForm recordId={dialog.recordId} Close={() => setDialog({open: false})}/>
        </SlideOut>

    </>
    )
}

