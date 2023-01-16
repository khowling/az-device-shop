import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { applyWSSHandler } from '@trpc/server/adapters/ws';

import { EventStoreConnection } from '@az-device-shop/eventing/store-connection'
import { FactoryActionType, FactoryAction, FactoryStateManager, WORKITEM_STAGE, WorkItemObject, FactoryState } from './factoryState.js'
import { Processor, ProcessorOptions } from "@az-device-shop/workflow"

import { z } from 'zod';
import * as trpc from '@trpc/server';
import {recordId, factoryOrderModel, itemSKUModel} from './schema/schemas.js'


import * as http from 'http'
import * as ws from 'ws';
//import type { AppRouter } from './trcpRouter.js';
import { ObjectId } from 'bson'

// ----------------------------------------------
// MONGO DB client

import { MongoClient, ChangeStreamInsertDocument, WithId, Document, ChangeStream, ChangeStreamDocument } from 'mongodb'
import { observable } from '@trpc/server/observable';
import type { ReducerInfo, StateStoreDefinition, StateUpdateControl, StateUpdates } from '@az-device-shop/eventing/state';
export type { StateUpdateControl, UpdatesMethod, StateUpdates, StateStoreDefinition } from '@az-device-shop/eventing/state';

//--------------------------------------
export type {  WorkItemObject } from './factoryState.js'
export type ZodError = z.ZodError

//------------------------------------

const murl : string = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev?replicaSet=rs0"
const client = new MongoClient(murl);

//-------------------------------------------------------
const esConnection = new EventStoreConnection(murl, 'factory_events')
const factoryState = new FactoryStateManager('emeafactory_v0', esConnection)
const factoryProcessor = new Processor('emeaprocessor_v001', esConnection, { linkedStateManager: factoryState })

var submitFn : (update_ctx: any, trigger: any) => Promise<ReducerInfo> = async (update_ctx, trigger) => { throw new Error("submitFm not initialized") }


//-----------------------------------

async function validateRequest({ esConnection, trigger }: {esConnection: any, trigger: any}, next: (action: FactoryAction, options: ProcessorOptions, event_label?: string) => any) {

  let spec = trigger && trigger.doc
  if (trigger && trigger.doc_id) {
      const mongo_spec = await esConnection.db.collection("inventory_spec").findOne({ _id: new ObjectId(trigger.doc_id), partition_key: esConnection.tenentKey })
      // translate the db document '*_id' ObjectId fields to '*Id' strings
      spec = { ...mongo_spec, ...(mongo_spec.product_id && { productId: mongo_spec.product_id.toHexString() }) }
  }

  return await next({ type: 'NEW', spec }, { update_ctx: { spec } } as ProcessorOptions)
}

async function sendToFactory(ctx: any, next: any) {
  const added : WorkItemObject  = ctx.lastLinkedRes.workItems.added as WorkItemObject
  return await next(
      { type: 'STATUS_UPDATE', _id: added._id, status: { stage: 'FACTORY_READY' } }, { update_ctx: { wi_id: added._id } } as ProcessorOptions
  )
}

async function waitforFactoryComplete(ctx : any, next: any) {
  const currentVal : WorkItemObject = ctx.linkedStore.getValue('workItems', 'items', ctx.wi_id)
  return await next(null, 
      { retry_until: { isTrue: currentVal.status.stage === 'FACTORY_COMPLETE'} } as ProcessorOptions
  )
}

async function moveToWarehouse(ctx: any, next: any) {
  return await next({ type: 'STATUS_UPDATE', _id: ctx.wi_id, spec: ctx.spec, status: { stage: 'MOVE_TO_WAREHOUSE' } }, { sleep_until: Date.now() + 1000 * 4 /* 4 secs */  } as ProcessorOptions)
}


async function publishInventory(ctx: any, next: any) {

  return await next({ type: 'COMPLETE_INVENTORY', _id: ctx.wi_id, spec: ctx.spec }, { sleep_until: { time: Date.now() + 1000 * 5 /* 5 secs */ } })
}

async function completeInventoryAndFinish(ctx: any, next: any) {
  console.log (`publishInventory: ctx.lastLinkedRes=${JSON.stringify(ctx.lastLinkedRes.inventory_complete.inc)}`)
  const completeInvSeq = parseInt(ctx.lastLinkedRes.inventory_complete.inc)
  const result = await ctx.esConnection.db.collection("inventory_complete").updateOne(
      {sequence: completeInvSeq}, { "$set": {
          sequence: completeInvSeq,
          identifier: 'INV' + String(completeInvSeq).padStart(5, '0'),
          partition_key: ctx.esConnection.tenentKey,
          spec: ctx.spec,
          workItem_id: ctx.wi_id
      }},
      { upsert: true }
  )



  return await next(/*{ type: FactoryActionType.TidyUp, _id: ctx.wi_id }*/)
}

factoryProcessor.context.esConnection = esConnection
factoryProcessor.use(validateRequest)
factoryProcessor.use(sendToFactory)
factoryProcessor.use(waitforFactoryComplete)
factoryProcessor.use(moveToWarehouse)
factoryProcessor.use(publishInventory)
factoryProcessor.use(completeInventoryAndFinish)


//--------------------------------------------------
// TRPC - will move into seperate file when fix the t.router export return typesciprt issue

export type WithWebId<TSchema> = TSchema & {
    id: string;
  };

const t = trpc.initTRPC.create();

function modelCRUDRoutes<T extends z.ZodTypeAny>(schema: T, coll: string) {
  type ZType = z.infer<typeof schema>

  function idTransform<T>  (rec: WithId<Document>): WithWebId<T>  {
    const {_id, ...rest} : { _id: ObjectId} = rec
    return {id: _id.toHexString(), ...rest as T}
  }
  
  return t.router({
    list: t.procedure
      .input(
        z.object({
          limit: z.number().min(1).max(100).nullish(),
          cursor: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        /**
         * For pagination docs you can have a look here
         * @see https://trpc.io/docs/useInfiniteQuery
         * @see https://www.prisma.io/docs/concepts/components/prisma-client/pagination
         */

        const limit = input.limit ?? 50;
        //const projection = {name: 1,type: 1, tags:1 }

        const items = (await client.db().collection(coll).find({}, { limit /*, projection*/ }).toArray()).map((d) => idTransform<ZType>(d))
        return items

      }),

    byId: t.procedure
      .input(recordId)
      .query(async ({input}) => {
        const { id } = input;
        const item =  await client.db().collection(coll).findOne({_id: new ObjectId(id)})
        if (!item) {
          throw new trpc.TRPCError({
            code: 'NOT_FOUND',
            message: `No users with id '${id}'`,
          });
        }
        return idTransform<ZType>(item) 
      }),

    add: t.procedure
      .input(schema.and(recordId.partial({id: true})))
      .mutation(async ({input} : {input: WithId<ZType>}) => {
        if (!input.id) {
          const item = await client.db().collection(coll).insertOne(input)
          return item;
        } else {
          const {id, ...rest} = input
          const item = await client.db().collection(coll).updateOne({_id: new ObjectId(id)},{ $set: rest })
          return item
        }
      })

  })
}

export type OrderState = z.infer<typeof factoryOrderModel>

export type FactoryMetaData = {
  stateDefinition: {
      [sliceKey: string]: StateStoreDefinition;
  },
  factory_txt: string[],
  stage_txt: string[]
}

// replae enum with const type
const ACTION_TYPE = {
  SNAPSHOT: "snapshot",
  EVENTS: "events",
  CLOSED: "closed"
}
export type ActionType = keyof typeof ACTION_TYPE



export type StateChangesControl = {
  "_control": StateUpdateControl
}

export type StateChangesUpdates = {
  [key: string ]: Array<StateUpdates> 
}

export type WsMessage = {
  type: ActionType,
  metadata?: FactoryMetaData,
  statechanges?: StateChangesControl | StateChangesUpdates,
  snapshot?: FactoryState
}

function modelSubRoutes<T extends z.ZodTypeAny>(schema: T, coll: string) {

  type ZType = z.infer<typeof schema>

  return t.router({
    onAdd: t.procedure
    .subscription(() => {
      // `resolve()` is triggered for each client when they start subscribing `onAdd`
      // return an `observable` with a callback which is triggered immediately
      return observable<ZType>((emit) => {
        
        const onAdd = (data : WsMessage)  => {
          // emit data to client
          //const output = data.fullDocument 
          console.log (data)
          emit.next(data);
        };

        emit.next({
          type: 'SNAPSHOT',
          metadata: {
              stateDefinition: factoryState.stateStore.stateDefinition,
              factory_txt: ['Waiting', 'Building', 'Complete'],
              stage_txt: ['DRAFT', 'NEW', 'FACTORY_READY', ' FACTORY_ACCEPTED', 'FACTORY_COMPLETE', 'MOVE_TO_WAREHOUSE', 'INVENTORY_AVAILABLE']
          },
          snapshot: factoryState.stateStore.serializeState as unknown as FactoryState
        } as WsMessage)

        // Need this to capture processor Linked State changes
        factoryProcessor.stateManager.on('changes', (events) => 
          events[factoryState.name] && onAdd({ type: 'EVENTS', statechanges: events[factoryState.name] }  )
        )
        // Need thos to capture direct factory state changes
        factoryState.on('changes', (events) => 
          onAdd({ type: 'EVENTS', statechanges: events[factoryState.name] }  )
        )

  /*
        // trigger `onAdd()` when `add` is triggered in our event emitter
        const em = changeStream.on('change', onAdd);
        console.log(em.listenerCount('change'))
*/
        // unsubscribe function when client disconnects or stops subscribing
        return () => {
          const smem = factoryProcessor.stateManager.off('change', onAdd);
          const fsem = factoryState.off('change', onAdd);
          console.log(`factoryProcessor.stateManager listener Count: ${smem.listenerCount('change')}, factoryState listener Count: ${fsem.listenerCount('change')}`)
        };
      });
    })
  })
}

type FactoryOrder = z.infer<typeof factoryOrderModel>

const appRouter = t.router({
    item: modelCRUDRoutes(itemSKUModel, 'item'),
    order: t.router({
      add: t.procedure
      .input(factoryOrderModel)
      .mutation(async ({input} : {input: FactoryOrder}) => {
        await submitFn({ trigger: { doc: input } }, null)
      })

    }),
    factoryEvents: modelSubRoutes(factoryOrderModel, 'factory_events'),
})

// only export *type signature* of router!
// to avoid accidentally importing your API
// into client-side code
export type AppRouter = typeof appRouter;
//--------------------------------------------------


// ---------------------------------------------------------------------------------------
async function init() {

    const appState = console /*(new ApplicationState()*/

    await client.connect();
    await esConnection.initFromDB(client.db(), false)

    esConnection.on('tenent_changed', async (oldTenentId) => {
        appState.log(`EventStoreConnection: TENENT CHANGED - DELETING existing ${esConnection.collection} documents partition_id=${oldTenentId} & existing`, false, true)
        await esConnection.db.collection(esConnection.collection).deleteMany({ partition_key: oldTenentId })
        process.exit()
    })

    //let { submitFn, factoryState, processorState } = await factoryStartup(await esConnection.initFromDB(client.db(), null ,false)/*, appState*/)
    
    submitFn = await factoryProcessor.listen()

    const factInterval = setInterval(async function () {
        //console.log('factoryStartup: checking on progress WorkItems in "FactoryStage.Building"')
        await factoryState.dispatch({ type: 'FACTORY_PROCESS' })
    }, 5000)

    const port = process.env.PORT || 5000
    console.log(port)

    const httpServer = http.createServer(async function (req, res) {
        const { headers, method, url } = req

        console.log (`got: ${url}`)
        const href = url!.startsWith('/') ? `http://127.0.0.1${url}`  : req.url!
        // get procedure path and remove the leading slash
        // /procedure -> procedure
        const hurl = new URL(href);

        if (hurl.pathname.startsWith('/trpc/')) {
            
            await nodeHTTPRequestHandler({
            ...{
                router: appRouter,
                createContext() {
                    return {};
                }
            }, req, res, path: hurl.pathname.slice(6) });
        } else if (req.method === 'POST' && hurl.pathname === '/submit') {
          
            let body = ''
            req.on('data', (chunk) => {
                body = body + chunk
            });
            req.on('end', async () => {
                //console.log(`http trigger got: ${body}`)
                try {
                    const po = await submitFn({ trigger: { doc: JSON.parse(body) } }, null)
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'ack',
                        info: po,
                        status_url: `/query/${po.added._id}`
                    }))
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                    return res.end(JSON.stringify({
                        status: 'nack',
                        error: `failed to create workflow err=${err}`
                    }))
                }
            })
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end("404 Not Found\n");
        }
    }).listen(port)


    console.log ('websocket')
    const wss = new ws.WebSocketServer({ server: httpServer });
    const handler = applyWSSHandler<AppRouter>({
      wss,
      router: appRouter,
      createContext() {
          return {};
      },
    });

    console.log(`WebSocket Server listening on ws://<host>>:${port}`);

    process.on('SIGTERM', () => {
      console.log('SIGTERM');
      handler.broadcastReconnectNotification();
      wss.close();
    });

}

init()





