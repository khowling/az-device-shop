// @flow
import { nodeHTTPRequestHandler } from '@trpc/server/adapters/node-http';
import { applyWSSHandler } from '@trpc/server/adapters/ws';

import { EventStoreConnection, type ChangeMessage, type StateChanges } from '@az-device-shop/eventing'
import type { FactoryActionType, FactoryAction, WORKITEM_STAGE, WorkItemObject, FactoryState } from './factoryState.js'
import { FactoryStateManager } from './factoryState.js'
import { NextFunction, Processor, ProcessorOptions } from "@az-device-shop/workflow"

import { z } from 'zod';
import { initTRPC, TRPCError } from '@trpc/server';
import {recordId, factoryOrderModel, itemSKUModel} from './schema/schemas.js'


import * as http from 'http'
import * as ws from 'ws';
//import type { AppRouter } from './trcpRouter.js';
import { ObjectId } from 'bson'

// ----------------------------------------------
// MONGO DB client

import { MongoClient, ChangeStreamInsertDocument, WithId, Document, ChangeStream, ChangeStreamDocument } from 'mongodb'
import { observable } from '@trpc/server/observable';
import type { ReducerInfo, StateStoreDefinition, StateUpdate } from '@az-device-shop/eventing';
//--------------------------------------
export type {  WorkItemObject, FactoryState } from './factoryState.js'
export type ZodError = z.ZodError


//-----------------------------------
async function validateRequest({ esFactoryEvents, input }: {esFactoryEvents: any, input: any}, next : NextFunction<FactoryAction>) {

  //let spec = trigger && trigger.doc
  //if (trigger && trigger.doc_id) {
  //    const mongo_spec = await esFactoryEvents.db.collection("inventory_spec").findOne({ _id: new ObjectId(trigger.doc_id), partition_key: esFactoryEvents.tenentKey })
  //    // translate the db document '*_id' ObjectId fields to '*Id' strings
  //    spec = { ...mongo_spec, ...(mongo_spec.product_id && { productId: mongo_spec.product_id.toHexString() }) }
  //}

  // Take processor input, and create 'NEW' 'workItems' in factoryStore
  return await next({ type: 'NEW', spec: input }/*, { update_ctx: { spec } } as ProcessorOptions*/)
}

async function sendToFactory(ctx: any, next: any) {
  // The output of the linked action from the prevoise step is stored in 'lastLinkedRes'
  const added : WorkItemObject  = ctx.lastLinkedRes.workItems.added as WorkItemObject

  // move the workItem to the FACTORY_READY stage,  this will be picked up by the 'factory' processor
  return await next(
      { type: 'STATUS_UPDATE', _id: added._id, status: { stage: 'FACTORY_READY' } }, { update_ctx: { wi_id: added._id } } as ProcessorOptions
  )
}

async function waitforFactoryComplete(ctx : any, next: any) {
  const currentVal : WorkItemObject = await ctx.linkedStore.getValue('workItems', 'items', ctx.wi_id)
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
  const result = await ctx.esFactoryEvents.db.collection("inventory_complete").updateOne(
      {sequence: completeInvSeq}, { "$set": {
          sequence: completeInvSeq,
          identifier: 'INV' + String(completeInvSeq).padStart(5, '0'),
          partition_key: ctx.esFactoryEvents.tenentKey,
          spec: ctx.spec,
          workItem_id: ctx.wi_id
      }},
      { upsert: true }
  )



  return await next(/*{ type: FactoryActionType.TidyUp, _id: ctx.wi_id }*/)
}




//--------------------------------------------------
// TRPC - will move into seperate file when fix the t.router export return typesciprt issue

export type WithWebId<TSchema> = TSchema & {
    id: string;
  };

const t = initTRPC.create();
const router = t.router;
const publicProcedure = t.procedure;

function modelCRUDRoutes<T extends z.ZodTypeAny>(schema: T, coll: string) {
  type ZType = z.infer<typeof schema>

  function idTransform<T>  (rec: WithId<Document>): WithWebId<T>  {
    const {_id, ...rest} : { _id: ObjectId} = rec
    return {id: _id.toHexString(), ...rest as T}
  }
  
  return router({
    list: publicProcedure
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

    byId: publicProcedure
      .input(recordId)
      .query(async ({input}) => {
        const { id } = input;
        const item =  await client.db().collection(coll).findOne({_id: new ObjectId(id)})
        if (!item) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `No users with id '${id}'`,
          });
        }
        return idTransform<ZType>(item) 
      }),

    add: publicProcedure
      .input(schema.and(recordId.partial({id: true})))
      .mutation(async ({input}) => {
        if (!input.id) {
          const item = await client.db().collection(coll).insertOne(input as Document)
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
  factory_txt?: string[],
  stage_txt?: string[]
}

// replae enum with const type
const ACTION_TYPE = {
  SNAPSHOT: "snapshot",
  EVENTS: "events",
  CLOSED: "closed"
}
export type ActionType = keyof typeof ACTION_TYPE


export type StateChangesUpdates<T> = {
  [key in  keyof T]: Array<StateUpdate> 
}

type WsMessageEvent = {
  type: 'EVENTS',
  sequence: number,
  statechanges: StateChangesUpdates<FactoryState>
}

type WsMessageSnapshot = {
  type: 'SNAPSHOT',
  snapshot: FactoryState,
  metadata: FactoryMetaData
}


export type WsMessage = WsMessageSnapshot | WsMessageEvent | {type: 'CLOSED'}

function modelSubRoutes<T extends z.ZodTypeAny>(schema: T, coll: string) {

  type ZType = z.infer<typeof schema>

  return t.router({
    onAdd: publicProcedure
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

        (async () => {
          emit.next({
            type: 'SNAPSHOT',
            metadata: {
                stateDefinition: factoryState.stateStore.stateDefinition,
                factory_txt: ['Waiting', 'Building', 'Complete'],
                stage_txt: ['DRAFT', 'NEW', 'FACTORY_READY', ' FACTORY_ACCEPTED', 'FACTORY_COMPLETE', 'MOVE_TO_WAREHOUSE', 'INVENTORY_AVAILABLE']
            },
            snapshot: await factoryState.stateStore.serializeState()
          } as WsMessage)
        })()

        // Need this to capture processor Linked State changes
        factoryProcessor.stateManager.on('changes', (message: ChangeMessage) => 
          message.stores[factoryState.name] && onAdd({ type: 'EVENTS', sequence: message.sequence, statechanges: message.stores[factoryState.name] as StateChangesUpdates<FactoryState> }  )
        )
        // Need thos to capture direct factory state changes
        factoryState.on('changes', (message: ChangeMessage) => 
          onAdd({ type: 'EVENTS', sequence: message.sequence, statechanges: message.stores[factoryState.name] as StateChangesUpdates<FactoryState> }  )
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

const appRouter = router({
    item: modelCRUDRoutes(itemSKUModel, 'item'),
    order: router({
      add: publicProcedure
      .input(factoryOrderModel)
      .mutation(async ({input} : {input: FactoryOrder}) => {
        await submitFn(input, null)
      })

    }),
    factoryEvents: modelSubRoutes(factoryOrderModel, 'factory_events'),
})

// only export *type signature* of router!
// to avoid accidentally importing your API
// into client-side code
export type AppRouter = typeof appRouter;
//--------------------------------------------------

//------------------------------------

const murl : string = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev?replicaSet=rs0"
const client = new MongoClient(murl);

//-------------------------------------------------------
// esFactoryEvents = Mongo Event Store Collection
const esFactoryEvents = new EventStoreConnection(murl, 'factory_events')

// stateStore - the leveldb state store for factory state and processor, both mastered from the same Mongo Event Store
const factoryState = new FactoryStateManager('emeafactory_v0', esFactoryEvents)
const factoryProcessor = new Processor('emeaprocessor_v001', esFactoryEvents, { linkedStateManager: factoryState })

factoryProcessor.context.esFactoryEvents = esFactoryEvents
factoryProcessor.use(validateRequest)
factoryProcessor.use(sendToFactory)
factoryProcessor.use(waitforFactoryComplete)
factoryProcessor.use(moveToWarehouse)
factoryProcessor.use(publishInventory)
factoryProcessor.use(completeInventoryAndFinish)

var submitFn : (update_ctx: any, input: any) => Promise<ReducerInfo> = async (update_ctx, input) => { throw new Error("submitFm not initialized") }

// ---------------------------------------------------------------------------------------
async function init() {

    const appState = console /*(new ApplicationState()*/

    // Connect MongoDB
    await client.connect();
    
    // esFactoryEvents - the Mongo EventStoreConnection
    await esFactoryEvents.initFromDB(client.db(), null, {distoryExisting: true})

    // stateStore - the leveldb state store for factory state and processor, need to rollforward from the Mongo Event Store is required!
    await factoryState.stateStore.initStore({distoryExisting: true})
    await factoryProcessor.stateStore.initStore({distoryExisting: true})

    esFactoryEvents.on('tenent_changed', async (oldTenentId) => {
        appState.log(`EventStoreConnection: TENENT CHANGED - DELETING existing ${esFactoryEvents.collection} documents partition_id=${oldTenentId} & existing`, false, true)
        await esFactoryEvents.db?.collection(esFactoryEvents.collection).deleteMany({ partition_key: oldTenentId })
        process.exit()
    })

    //let { submitFn, factoryState, processorState } = await factoryStartup(await esFactoryEvents.initFromDB(client.db(), null ,false)/*, appState*/)
    
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
        /*} else if (req.method === 'POST' && hurl.pathname === '/submit') {
          
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
            }) */
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





