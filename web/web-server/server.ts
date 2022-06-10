import path from 'path'
import fs from 'fs'

// Web require
import Koa from 'koa'
import cors from '@koa/cors'
import Router from '@koa/router'
import bodyParser from 'koa-bodyparser'
    // Simple session middleware for Koa. Defaults to cookie-based sessions and supports external stores
import session from 'koa-session'
import Joi from 'joi'

// Auth & SAS require
import jwkToPem from 'jwk-to-pem'
import jws from 'jws'

import { EventStoreConnection } from "@az-device-shop/eventing/store-connection"
import { OrderStateManager } from "@az-device-shop/ordering"


const app_host_url = process.env.APP_HOST_URL
const client_id = process.env.B2C_CLIENT_ID
const b2c_tenant = process.env.B2C_TENANT
const signin_policy = process.env.B2C_SIGNIN_POLICY
const passwd_reset_policy = process.env.B2C_RESETPWD_POLICY
const client_secret = encodeURIComponent(process.env.B2C_CLIENT_SECRET as string)


// Mongo require
import mongodb, {ChangeStream, ChangeStreamDocument, ChangeStreamUpdateDocument} from 'mongodb'
const { MongoClient, Timestamp } = mongodb
import { ObjectId } from 'bson'

const MongoURL = process.env.MONGO_DB
const USE_COSMOS = process.env.USE_COSMOS === "false" ? false : true


interface StoreDefinitionList {
    [key: string]: StoreDefinition
}
interface DefinitionStatus {
    [key: string]: number;
}
interface StoreDefinition {
    collection?: string;
    schema?: any;
    split_types?: Array<string>;
    status?: DefinitionStatus;
}

// Store Metadata
const StoreDef: StoreDefinitionList = {
    "business": {
        collection: "business",
        schema: Joi.object({
            'name': Joi.string().trim().required(),
            'catalog': Joi.string().trim().required(),
            'email': Joi.string().trim().required(),
            'inventory': Joi.boolean(),
            'image': Joi.object({
                'url': Joi.string().uri(),
                'pathname': Joi.string().uri({ relativeOnly: true })
            }).min(1)

        })
    },
    "products": {
        collection: "products",
        split_types: ['Product', 'Category'],
        schema: Joi.object({
            'type': Joi.string().valid('Product', 'Category').required(),
            'heading': Joi.string().trim().required(),
            'category_ref': Joi.object({
                '_id': Joi.string().regex(/^[0-9a-fA-F]{24}$/, "require ObjectId").required()
            }).when('type', {
                is: "Product",
                then: Joi.required()
                //otherwise: Joi.object({'category': //not exist//})
            }),
            'position': Joi.string().valid('normal', 'hero', 'highlight').when('type', {
                is: "Category",
                then: Joi.required()
                //otherwise: Joi.object({'category': //not exist//})
            }).trim(),
            'description': Joi.string().trim().required(),
            'price': Joi.number().when('type', {
                is: "Product",
                then: Joi.required()
            }),
            'image': Joi.object({
                'url': Joi.string().uri(),
                'pathname': Joi.string().uri({ relativeOnly: true })
            }).min(1)
        })
    },
    "inventory": {
        collection: "inventory_spec",
        schema: Joi.object({
            'status': Joi.string().valid('Draft', 'Required', 'InFactory', 'Cancel', 'Available').required(),
            'product_ref': Joi.object({
                '_id': Joi.string().regex(/^[0-9a-fA-F]{24}$/, "require ObjectId").required()
            }).required(),
            'category_ref': Joi.object({
                '_id': Joi.string().regex(/^[0-9a-fA-F]{24}$/, "require ObjectId").required()
            }).required(),
            'warehouse': Joi.string().required(),
            'qty': Joi.number().required()
        })
    },
    "inventory_complete": {
        collection: "inventory_complete",
    },
    "factory_events": {
        collection: "factory_events",
    },
    "order_events": {
        collection: "order_events",
    },
    "orders": {
        status: {
            InactiveCart: 5,
            ActiveCart: 10,
            NewOrder: 30
        },
        collection: "orders_spec",
        schema: Joi.object({
            'checkout_date': Joi.number(),
            'status': Joi.number().required(),
            'status_reason': Joi.string(),
            'owner': Joi.object().required(),
            'owner_type': Joi.string().valid('user', 'session'),
            'shipping': Joi.string().valid('A', 'B'),
            'items': Joi.array().items(Joi.object({})).required(),
            'items_count': Joi.number()
        })
    },
    "order_line": {
        schema: Joi.object({
            'options': Joi.object(),
            'qty': Joi.number().required(),
            'recorded_item_price': Joi.number().required(),
            'product_ref': Joi.object({
                '_id': Joi.string().regex(/^[0-9a-fA-F]{24}$/, "require ObjectId").required()
            }).required(),
        })
    },
    "session": {
        collection: "koa_sessions",
        schema: Joi.object({
            //partition_key: Joi.string().trim().required()
        })
    }
}

// Joi schema formatted as a Mongo 'projection' paramters for find operations                                                                               
const StoreProjections =
    Object.keys(StoreDef).filter(k => StoreDef[k].schema !== undefined).reduce((ac, c) => ({ ...ac, [c]: Object.keys(StoreDef[c].schema.describe().keys).reduce((ac, a) => ({ ...ac, [a.endsWith('_ref') ? `${a.slice(0, -4)}_id` : a]: 1 }), {}) }), {})


interface DBTOWEB_LOOKUPS {
    [key: string]: LOOKUPDEF;
}
interface LOOKUPDEF {
    store: string;
    records: any[];
}
// Convert mongodb document format to the format to be sent to the web
function dbToWeb (dbdoc: any, store: string, lookups?: DBTOWEB_LOOKUPS): any  {
    const storeKeys = Object.keys(StoreDef[store].schema.describe().keys)
    return storeKeys.reduce((acc, webCol) => {
        const [dbfield, lookup] = webCol.endsWith('_ref') ? [`${webCol.slice(0, -4)}_id`, true] : [webCol, false]
        if (dbdoc && dbdoc.hasOwnProperty(dbfield)) {
            if (lookup) {
                return { ...acc, [webCol]: { _id: dbdoc[dbfield].toHexString(), ...(lookups && lookups[webCol] && dbToWeb(lookups[webCol].records.find(r => r._id.equals(dbdoc[dbfield])), lookups[webCol].store) as object) } }
            }
            return { ...acc, [webCol]: dbdoc[dbfield] }
        }
        return acc
    }
        , dbdoc && dbdoc.hasOwnProperty('_id') ? { _id: dbdoc._id.toHexString() } : {})
}

interface DbObject {
    error?: string;
    collection?: string;
    _id?: any;
    value?: any;
}

function webToDBValidate(storedef, webdoc, create_id_ifmissing = false) {
    const { _id, ...body } = webdoc
    const { value, error } = storedef.schema.validate(body, { allowUnknown: false })
    return { 
        ...(_id ? { _id: new ObjectId(_id)} : create_id_ifmissing && { _id: new ObjectId() }),
        value: !error && Object.keys(value).reduce((a,c) => {
            return c.endsWith('_ref') ? {...a,  [`${c.slice(0, -4)}_id`] : new ObjectId(value[c]._id)} : {...a, [c]: value[c]}
        }, {}), 
        error 
    }
}

function webToDb (webdoc: any, store: string, userId: string) : DbObject {

    
    if (!(typeof webdoc === 'object' && webdoc !== null)) return {error: `no document provided`}
    if (!store) return {error: `no store provided`}
    const storedef = StoreDef[store]
    if (!storedef) return {error: `unknown store: ${store}`}

    const { _id, value, error } = webToDBValidate(storedef, webdoc)
    if (error) return {error: `document not valid: ${error}`}

    return {
        collection: storedef.collection, 
        ...(_id && { _id }),
        value: { 
            ...(!_id && {
                _id: new ObjectId(), 
                _ts: new Timestamp(0,0), 
                _createdBy: userId, 
                owner: { _id: userId}
            }),
            // Timestamp(0,0) *only* works on Inserts, for updates, it is taken literally 
            /*
            _lastModified: new Timestamp(), 
            _lastModifiedBy:  userId,
            */
            ...value
        }
    }

}

// Operations
const FetchOperation = {
    // no side effect, doesnt require auth
    "mycart": async function (ctx): Promise<any> {
        if (!ctx.tenentKey) throw `Requires init`
        const cart = await ctx.db.collection(StoreDef["orders"].collection).findOne({ owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { projection: StoreProjections["orders"] })
        if (cart && cart.items) {
            const ref_products = await ctx.db.collection(StoreDef["products"].collection).find({ _id: { $in: [...new Set(cart.items.map(m => m.product_id))] }, partition_key: ctx.tenentKey }, { projection: StoreProjections["products"] }).toArray()
            //const ref_products_map = ref_products.reduce((a, c) => { return { ...a, [c._id.toHexString()]: c } }, {})


            cart.items = cart.items.map(dbdoc => dbToWeb(dbdoc, 'order_line', { ['product_ref']: { store: 'products', records: ref_products } } as DBTOWEB_LOOKUPS))
            //map(i => { return { ...i, product_ref: ref_products_map[String(i.product_id)] || { _id: i.product_id, _error: 'missing item' } } })
        }
        return cart || {}
    },
    "myorders": async function (ctx): Promise<any> {
        if (!ctx.tenentKey) throw `Requires init`
        if (b2c_tenant && !ctx.session.auth) throw 'Requires logged in'
        const orders = await ctx.db.collection(StoreDef["orders"].collection).find({ owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: { $gte: 30 }, partition_key: ctx.tenentKey }, { projection: StoreProjections["orders"] }).toArray()

        return orders.map(o => {
            const orderState = ctx.orderStateStore ? ctx.orderStateStore.getValue('orders', 'items').find(os => o._id.equals(os.spec._id)) : { status: { error: `orderState not initialied` } }
            return orderState ? { ...o, orderState: orderState.status } : o
        })

    },
    "get": async function (ctx, store, query?: any, proj?: any): Promise<any> {
        if (!ctx.tenentKey) throw `Requires init`
        const s = StoreDef[store]
        if (!s) throw `unknown ${store}`

        let find_query = { ...query, partition_key: ctx.tenentKey }
        if (store.onwer) {
            if (!ctx.session.auth) throw `${store} requires signin`
            find_query["owner._id"] = ctx.session.auth.sub
        }

        const cursor = ctx.db.collection(s.collection).find(find_query, { projection: proj || StoreProjections[store] })

        if (s.split_types) {
            // setup response oject with empty arrarys with all possible values of 'type'
            let response = s.split_types.reduce((obj, a) => { return { ...obj, [a]: [] } }, {})
            // copied from https://github.com/mongodb/node-mongodb-native/blob/e5b762c6d53afa967f24c26a1d1b6c921757c9c9/lib/cursor/cursor.js#L836
            for await (const doc of cursor) {
                if (s.split_types.includes(doc.type)) {
                    response[doc.type].push(dbToWeb(doc, store))
                }
            }
            return response
        } else {
            return await cursor.map(doc => dbToWeb(doc, store))
        }
    },
    "getOne": async function (ctx, store, query, proj?: any): Promise<any> {
        if (!ctx.tenentKey) throw new Error(`Requires init`)
        const s = StoreDef[store]
        if (!s) throw new Error(`unknown ${store}`)

        let find_query = { ...query, partition_key: ctx.tenentKey }
        if (store.onwer) {
            if (!ctx.session.auth) throw `${store} requires signin`
            find_query["owner._id"] = ctx.session.auth.sub
        }

        return dbToWeb(await ctx.db.collection(s.collection).findOne(query, { projection: proj || StoreProjections[store] }), store)
    },
    // -------------------------------
    // componentFetch is my GraphQL :)
    // -------------------------------
    "componentFetch": async function (ctx, componentFetch, urlid): Promise<any> {
        if (!ctx.tenentKey) throw new Error(`Requires init`)
        let result: any = {}

        if (componentFetch) {

            let query = { partition_key: ctx.tenentKey }

            if (componentFetch.urlidField) {
                if (!urlid) throw new Error("componentFetch requires urlid")
                if (componentFetch.urlidField === "recordid") {
                    query['_id'] = new ObjectId(urlid)
                } else {
                    query[componentFetch.urlidField] = new ObjectId(urlid)
                }
            }
            if (componentFetch.query) {
                query = { ...componentFetch.query, ...query }
            }
            console.log(`server.ts: componentFetch "${componentFetch.operation}(${componentFetch.store}, ${JSON.stringify(query)})"`);
            result.data = await FetchOperation[componentFetch.operation](ctx, componentFetch.store, query)
            console.log(`server.ts: componentFetch done`)
            if (componentFetch.refstores && componentFetch.refstores.length > 0) {
                let fetch_promises: Array<Promise<any>> = []
                for (let refstore of componentFetch.refstores) {
                    if (refstore.orderState) {
                        if (false) {
                            fetch_promises.push(Promise.resolve(ctx.orderStateStore.stateStore.state[refstore.store]))
                        } else {
                            console.error(`Got "refstore.orderState" request for compoent, but "ctx.orderState" not initialised`)
                        }
                    } else {
                        console.log(`componentFetch: get refstore : ${JSON.stringify(refstore)}`)
                        if (!refstore.lookup_field) {
                            fetch_promises.push(FetchOperation.get(ctx, refstore.store))
                        } else {
                            fetch_promises.push(FetchOperation.get(ctx, refstore.store, { _id: new ObjectId(refstore.lookup_field === "urlidField" ? urlid : new ObjectId(result.data[refstore.lookup_field]._id)) }))
                        }
                    }
                }
                result.refstores = (await Promise.all(fetch_promises)).reduce((o, v, i) => { return { ...o, [componentFetch.refstores[i].store]: v } }, {})
            }
            return result
        } else return Promise.resolve({})

    }
}

async function dbInit() {
    // ensure url encoded
    //const murl = new URL(MongoURL as string)
    //console.log(`connecting with ${murl.toString()}`)
    console.log(`connecting with ${MongoURL}`)
    const client = await MongoClient.connect(MongoURL)
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    const _db = client.db()
    // If Cosmos, need to pre-create the collections, becuse it enforces a partitioning strategy.
    /*
    for (let store of Object.keys(StoreDef)) {
        console.log(`ensuring partitioned collection created for [${store}]`)
        if (USE_COSMOS) {
            try {
                const { ok, code, errMsg } = await _db.command({ customAction: "CreateCollection", collection: StoreDef[store].collection, shardKey: "partition_key" })

                if (ok === 1) {
                    //console.log('success')
                } else {

                    throw new Error(errMsg)
                }
            } catch (err) {
                if (err.code !== 48) {
                    // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                    console.error(`Failed to create collection : ${err}`)
                    throw new Error(err.errMsg)
                }
            }
        } else {
            //console.log('createCollection')
            //await _db.createCollection(StoreDef[store].collection)
        }
    }
    */
    return _db
}


// Serve Static files
const BUILD_PATH = './web-react/out' //process.env.NODE_ENV === 'production' ? './build' : './dist'
const PUBLIC_PATH = "./web-react/public"
async function serve_static(ctx, next) {

    const captures = ctx.captures.length
    ctx.assert(captures !== 0, 404, `${ctx.path} not found`)

    const staticType = captures === 2 ? ctx.captures[0] : 'public',
        filePath =  captures === 2 ? ctx.captures[1] : ctx.captures[0]

    let fsPath
    if (staticType === 'static') {// webpacked assets (lives in ./build)
        fsPath = path.join(process.cwd(), BUILD_PATH, filePath)
    } else if (staticType === 'public') {// public assets (lives in ./public)
        fsPath = path.join(process.cwd(), PUBLIC_PATH, filePath)
    }
    ctx.assert(fsPath, 404, `${ctx.path} not found`)

    // path.join(process.cwd() /* __dirname */, BUILD_PATH, ctx.captures[0]) :
    // path.join(process.cwd() /* __dirname */, PUBLIC_PATH, ctx.path)

    console.log(`serve_static: request ${ctx.request.url}, serving static resource  fsPath=${fsPath}`)

    if (fs.existsSync(fsPath)) {
        ctx.response.body = fs.createReadStream(fsPath)
    } else {
        ctx.throw(404, `${ctx.request.url} not found`)
    }
    next()
}



import {ApplicationState} from "@az-device-shop/eventing/webserver"

//import { order_state_startup } from './orderingFollower.js'
const app = new Koa();

async function init() {

    // Init Web

    app.use(bodyParser())
    const appState = app.context.appState = new ApplicationState()

    // Init DB
    const db = app.context.db = await dbInit()

    // Init Sessions
    app.keys = ['secret']
    app.use(session({
        maxAge: 86400000,
        //secure: false, // DEVELOPMENT ONLY!
        store: {
            get: async function (key: string) {
                console.log(`server.ts: session get ${key}`)
                return await db.collection(StoreDef["session"].collection).findOne({ _id: key, partition_key: "session" } as any)
            },
            set: async function (key: string, sess, maxAge, { rolling, changed }) {
                //console.log(`session set ${key} ${JSON.stringify(sess)}`)
                await db.collection(StoreDef["session"].collection).replaceOne({ _id: key, partition_key: "session" } as any, { ...sess, ...{ _id: key, partition_key: "session" } }, { upsert: true })
            },
            destroy: async function (key: string) {
                //console.log(`session destroy ${key}`)
                await db.collection(StoreDef["session"].collection).deleteOne({ _id: key, partition_key: "session" } as any)
            }
        }
    }, app))

    // app.context is the prototype from which ctx is created. 
    // You may add additional properties to ctx by editing app.context. 
    // This is useful for adding properties or methods to ctx to be used across your entire app
    if (b2c_tenant) {
        appState.log ("init(): getting openid config from b2c tenant...")
        app.context.openid_configuration = await fetch(`https://${b2c_tenant}.b2clogin.com/${b2c_tenant}.onmicrosoft.com/${signin_policy}/v2.0/.well-known/openid-configuration`)
        const signing_keys: any = await fetch(app.context.openid_configuration.jwks_uri)
        app.context.jwks = Object.assign({}, ...signing_keys.keys.map(k => ({ [k.kid]: k })))
    } else{
        appState.log ("init(): WARNING Skipping openid config from b2c tenant, missing environment variable B2C_TENANT")
    }

    appState.log ("init(): Setting Azure Storage container client...")
    const sharedKeyCredential = new StorageSharedKeyCredential(process.env.STORAGE_ACCOUNT, process.env.STORAGE_MASTER_KEY);
    const storeHost =  process.env.STORAGE_ACCOUNT === 'devstoreaccount1' ? `http://127.0.0.1:10000/${process.env.STORAGE_ACCOUNT}`: `https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`
    const blobServiceClient = new BlobServiceClient(storeHost, sharedKeyCredential)
    app.context.sharedKeyCredential = sharedKeyCredential
    app.context.containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER)


    // Init Settings (currently single tenent)
    appState.log ("init(): getting tenant config from db...")
    app.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ type: "business", partition_key: "root" })

    if (!app.context.tenent) {
        appState.log ("init(): no tenant creating default config")
        app.context.tenent = await createTenant( app.context, {
            "name": "Demo Bike Shop",
            "image": {"url": "https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png"},
            "catalog": "bike",
            "email": "first@sign.in",
            "inventory": true
        })
    }

    app.context.tenent = {
        ...app.context.tenent,
        downloadSAS: process.env.STORAGE_DOWNLOAD_SAS
    }

    app.context.tenentKey =  app.context.tenent._id

    appState.log ("init(): setting tenant watcher, will process.exit() if removed")
    app.context.businessWatcher = db.collection(StoreDef["business"].collection).watch([
        { $match: { $and: [{ 'operationType': { $in: ['insert', 'update', 'replace'] } }, { 'fullDocument.partition_key': 'root' }, { 'fullDocument.type': 'business' }] } },
        // https://docs.microsoft.com/en-us/azure/cosmos-db/mongodb/change-streams?tabs=javascript#current-limitations
        { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1, ...(!USE_COSMOS && {"operationType": 1 } ) }}
    ],
        { fullDocument: "updateLookup" }
    ).on('change', async (change: ChangeStreamUpdateDocument): Promise<void>  => {

        // Typescript error: https://jira.mongodb.org/browse/NODE-3621
        const documentKey  = change.documentKey  as unknown as { _id: ObjectId }
         
        appState.log(`TENENT Change -  operationType=${change.operationType} key=${JSON.stringify(documentKey)}`)
        if (!documentKey._id.equals(app.context.tenentKey)) {
            console.error(`TENENT RESET - Server needs to be restarted.  Ending process`)
            process.exit()
        }
    }) as ChangeStream


    // DEVELOPMENT ONLY, only for running react frontend locally on developer workstation and server in cloud
    //app.use(cors({ credentials: true }))


    appState.log ("init(): setting routes....")
    //const STATIC_URL_PREFIX = "/static"
    app.use(new Router()
        .get(`/(static)/(.*)`, serve_static)
        .get(`/(public)/(.*)`, serve_static)
        // This is for '/favicon.ico' '/manifest.json' '/robots.txt'
        .get(/^\/([^\/]*\..*)/, serve_static)
        .routes())

    app.use(authroutes)
    app.use(api)
    app.use(healthz)
    app.use(ssr)

    const port = process.env.PORT || 3000
    appState.log(`init(): starting webserver on ${port}..`)
    app.listen(port)


    // Init order status (dont await, incase no tenent! )
    appState.log(`init(): Init order status`)


    /*
    order_state_startup({db: app.context.db, tenent: app.context.tenent }).then(val => {
        appState.log(`init(): Init order status complete`, true)
        app.context.orderState = val
    })
    */
    appState.log(`Initilise EventStoreConnection with 'order_events'`)
    const connection = await new EventStoreConnection(null, 'order_events').initFromDB(db, app.context.tenent)
    appState.log(`Initilise orderingStartup`)
    const orderState = new OrderStateManager('emeaordering_v0', connection)

    await connection.rollForwardState([orderState.stateStore])
    const changeStream = connection.stateFollower([orderState.stateStore])
    appState.log(`init(): Init order status complete`, true)
    app.context.orderStateStore = orderState.stateStore
}

// TODO - I want to re-implement this so goes into client state cookie??
//  Function called via /api/session_status for client-side, or catchall for server-side
async function getSession(ctx) {
    let cart_items = 0
    if (ctx.tenentKey) {
        const cart = await ctx.db.collection(StoreDef["orders"].collection).findOne({ owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { projection: { "items_count": true } })
        if (cart && cart.items_count) cart_items = cart.items_count
    }
    return {
        auth: ctx.session.auth ? { userid: ctx.session.auth.sub, given_name: ctx.session.auth.given_name } : undefined,
        cart_items
    }
}


// ----------------------------------------------------------- Server SSR
import { Stream } from 'stream'
import fetch from './server_fetch.js'
//import { AzBlobWritable, createServiceSAS } from './AzBlobWritable.js'

// all requires after this will use babel transpile, using 'babel.config.json'
/*
require("@babel/register")()
const server_ssr = require('../../../../src/ssr_server')
*/
// https://devblogs.microsoft.com/typescript/announcing-typescript-4-5-beta/#commonjs-interop
//import ssr_server = require('../lib/ssr_server.js')
//const { AppRouteCfg, pathToRoute, ssrRender } = ssr_server
import { AppRouteCfg, pathToRoute, ssrRender } from '@az-device-shop/web-react' //'../web-react/lib/ssr_server.js'
import { sign } from 'crypto'
import { Http2ServerRequest } from 'http2'

// ssr middleware (ensure this this the LAST middleware to be used)
async function ssr(ctx, next) {
    if (!ctx._matchedRoute) {
        //console.log (`no route matched for [${ctx.request.url}], serve index.html to ${ctx.session.auth && ctx.session.auth.given_name}`)
        //var filePath = path.join(process.cwd() /* __dirname */, BUILD_PATH, 'index.html')

        // Get Iniitial Data
        const urlsplit = ctx.request.url.split('?', 2),
            startURL = { pathname: urlsplit[0], search: urlsplit.length > 1 ? urlsplit[1] : "", hash: "" },
            { routekey, urlid } = pathToRoute(startURL),
            { requireAuth, componentFetch } = AppRouteCfg[routekey] || {}

        if (!ctx.tenentKey && routekey != '/init') {
            ctx.redirect('/init')
        } else if (b2c_tenant && requireAuth && !ctx.session.auth) {
            ctx.redirect(`/connect/microsoft?surl=${encodeURIComponent(ctx.request.href)}`)
        } else {
            /*
            const renderContext: any = {
                ssrContext: "server",
                reqUrl: ctx.request.href
            }

            if (componentFetch) {
                //let initfetchfn = FetchOperation.componentFetch(ctx, componentFetch, urlid)

                // Parallel fetch
                //const [serverInitialData, session] = await Promise.all([initfetchfn, getSession(ctx)])

                renderContext.serverInitialData = await FetchOperation.componentFetch(ctx, componentFetch, urlid)
            }
            //renderContext.session = session
            //} else {
            //    renderContext.session = await getSession(ctx)
            //}
            */
            // https://koajs.com/#context
            // ctx.response = A Koa Response object.
            // ctx.res = Node's response object.
            await ssrRender(ctx, startURL, componentFetch && componentFetch.clientSide !== true && FetchOperation.componentFetch(ctx, componentFetch, urlid))
            /*
            ctx.response.type = 'text/html'
            ctx.body = fs.createReadStream(filePath)
                .pipe(stringReplaceStream('<div id="root"></div>', `<div id="root">${await server_ssr.ssrRender(startURL, renderContext)}</div>`))
                .pipe(stringReplaceStream('"SERVER_INITAL_DATA"', JSON.stringify(renderContext)))
            */
        }
    }
    next()
}

// ----------------------------------------------------------- HealthZ
const healthz = new Router({ prefix: "/healthz" })
    .get('/', async function (ctx, next) {
        const {body, status} = ctx.appState.healthz()
        ctx.body = body
        ctx.status = status
        next()
    }).routes()
// ----------------------------------------------------------- AUTH
const authroutes = new Router({ prefix: "/connect/microsoft" })
    .get('/', async function (ctx, next) {
        const nonce = ctx.session.auth_nonce = Math.random().toString(26).slice(2)
        //console.log(`login with surl=${ctx.query.surl}`)
        ctx.redirect(`${ctx.openid_configuration.authorization_endpoint}?client_id=${client_id}&redirect_uri=${encodeURIComponent(`${(app_host_url ? app_host_url : 'http://localhost:3000') + '/connect/microsoft/callback'}`)}&scope=openid&response_type=code&nonce=${nonce}${ctx.query.surl ? "&state=" + encodeURIComponent(ctx.query.surl) : ""}`)
        next()
    })
    .get('/logout', async function (ctx, next) {
        delete ctx.session.auth
        ctx.redirect(`${ctx.openid_configuration.end_session_endpoint}?post_logout_redirect_uri=${encodeURIComponent(app_host_url || 'http://localhost:3000')}`)
        //ctx.redirect(ctx.query.surl || "/")
        next()
    })
    .get('/callback', async function (ctx, next) {
        const nonce = ctx.session.auth_nonce

        if (ctx.query.code) {
            delete ctx.session.auth_nonce
            try {
                const flow_body = `client_id=${client_id}&client_secret=${client_secret}&scope=openid&code=${encodeURIComponent(ctx.query.code)}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(`${(app_host_url ? app_host_url : 'http://localhost:3000') + '/connect/microsoft/callback'}`)}`

                const { access_token, id_token } = await fetch(ctx.openid_configuration.token_endpoint, {method: 'POST', headers: {
                    'content-type': 'application/x-www-form-urlencoded' }}, flow_body)

                // Validated the signature of the ID token
                // https://docs.microsoft.com/en-us/azure/active-directory-b2c/active-directory-b2c-reference-oidc#validate-the-id-token
                const [head, payload, sig] = id_token.split('.').map((t, i) => i < 2 ? JSON.parse(Buffer.from(t, 'base64').toString()) : t)
                //console.log(head); console.log(payload)
                const token_signing_key = ctx.jwks[head.kid]
                const pem = jwkToPem(token_signing_key)

                ctx.assert(token_signing_key, 500, `Token signing key not found ${head.kid}`)
                ctx.assert(nonce === payload.nonce, 400, `Token doesnt match request`)
                ctx.assert(jws.verify(id_token, head.alg, pem), 400, `Token signature not valid`)
                ctx.assert(payload.aud === client_id, 400, `Token not for this audience`)

                ctx.session.auth = payload


                // Logged in -> add item (user) -> Logout -> Empty cart
                // Logged out -> add item (anon) -> Login (with existing 1 item user cart)  -> 2 items in cart -> Log out -> 0 Items
                // logged out -> purchase -> login -> just purchase that item, cart still contains 2 items

                // we are loggin in, check if the current session has a cart (unauthenticated), if so, add items to users cart
                const carts = await ctx.db.collection(StoreDef["orders"].collection).find({ "owner._id": { $in: [ctx.session.auth.sub, ctx.session._id] }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }).toArray(),
                    session_cart = carts.find(c => c.owner._id === ctx.session._id),
                    user_cart = carts.find(c => c.owner._id === ctx.session.auth.sub)

                console.log(`Looking for session car [${ctx.session._id}=${session_cart !== null}], and user cart [${ctx.session.auth.sub}=${user_cart !== null}]`)
                // if no session_cart - no nothing, else
                // if no user_cart - update session cart to user cart, else,
                // if both - add records from session cart to user_cart, remove session cart
                if (session_cart) {
                    if (!user_cart) {
                        const res = await ctx.db.collection(StoreDef["orders"].collection).updateOne({ owner: { _id: ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { $set: { owner_type: "user", owner: { _id: ctx.session.auth.sub } } }, { upsert: false, returnOriginal: false, returnNewDocument: false })
                    } else {
                        // unfortunatly, this involves 2 operations, so not atomic, need to allow for cosmos ratelimiting
                        // NEED TO MAKE THIS IDEMPOTENT
                        await ctx.db.collection(StoreDef["orders"].collection).updateOne({ owner: { _id: ctx.session.auth.sub }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { $inc: { items_count: session_cart.items_count }, $push: { items: { $each: session_cart.items } } })
                        ctx.db.collection(StoreDef["orders"].collection).updateOne({ owner: { _id: ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { $set: { status: StoreDef["orders"].status.InactiveCart, status_reason: `Login-merged: into ${user_cart._id}` } })
                    }

                }
                let ret_url = "/?login=ok"
                if (ctx.query.state) {
                    const newu = new URL(ctx.query.state)
                    newu.searchParams.set('login', 'ok')
                    ret_url = newu.href
                }
                ctx.redirect(ret_url)

            } catch (e) {
                console.error(e)
                ctx.throw(400, e)
            }
        } else {
            //console.log(ctx.querystring)
            if (ctx.querystring.indexOf('=access_denied') > 0 && ctx.querystring.indexOf('=AADB2C90118') > 0) {
                // &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconnect%2Fmicrosoft%2Fcallback&scope=openid&response_type=code&prompt=login
                ctx.redirect(`https://${b2c_tenant}.b2clogin.com/${b2c_tenant}.onmicrosoft.com/oauth2/v2.0/authorize?p=${passwd_reset_policy}&client_id=${client_id}&nonce=${nonce}&scope=openid&response_type=code&redirect_uri=${encodeURIComponent(`${(app_host_url ? app_host_url : 'http://localhost:3000') + '/connect/microsoft/callback'}`)}`)
            } else {
                console.error("/connect/microsoft/callback : no code")
                ctx.throw(401, "/connect/microsoft/callback : no code")
            }
        }
        next()
    })
    .routes()


import { SASProtocol, BlobSASPermissions, generateBlobSASQueryParameters, ContainerClient, BlobServiceClient, BlockBlobClient, StorageSharedKeyCredential } from "@azure/storage-blob"
// https://github.com/Azure/azure-sdk-for-js/tree/@azure/storage-blob_12.8.0/sdk/storage/storage-blob/#import-the-package

function getFileClient(containerClient : ContainerClient, store : string, filename: string) : BlockBlobClient {
    const extension = encodeURIComponent(filename.substring(1 + filename.lastIndexOf(".")))
    const pathname = `${store}/${(new ObjectId()).toString()}.${extension}`

    return containerClient.getBlockBlobClient(pathname);
}

function getFileSaS ({containerClient, sharedKeyCredential}, store, filename) {
// Generate service level SAS for a blob
    const extension = encodeURIComponent(filename.substring(1 + filename.lastIndexOf(".")))
    const blobName = `${store}/${(new ObjectId()).toString()}.${extension}`
    const sas = generateBlobSASQueryParameters({
        containerName: containerClient.containerName, // Required
        blobName, // Required
        permissions: BlobSASPermissions.parse("racwd"), // Required
        startsOn: new Date(), // Optional
        expiresOn: new Date(new Date().valueOf() + 86400), // Required. Date type
        //cacheControl: "cache-control-override", // Optional
        //contentDisposition: "content-disposition-override", // Optional
        //contentEncoding: "content-encoding-override", // Optional
        //contentLanguage: "content-language-override", // Optional
        //contentType: "content-type-override", // Optional
        //ipRange: { start: "0.0.0.0", end: "255.255.255.255" }, // Optional
        protocol: SASProtocol.HttpsAndHttp, // Optional
        version: "2016-05-31" // Optional
    },
        sharedKeyCredential // StorageSharedKeyCredential - `new StorageSharedKeyCredential(account, accountKey)`
    ).toString()
    return {sas, pathname: blobName, extension, container_url: containerClient.url}
}
/*
function getFileSaS(store, filename) {
    const extension = encodeURIComponent(filename.substring(1 + filename.lastIndexOf(".")))
    const pathname = `${store}/${(new ObjectId()).toString()}.${extension}`
    const retsas = createServiceSAS(process.env.STORAGE_MASTER_KEY, process.env.STORAGE_ACCOUNT, process.env.STORAGE_CONTAINER, 10, pathname)
    return Object.assign({ pathname, extension }, retsas)
}
*/

async function ensureInit(ctx, next) {
    if (!ctx.tenentKey)
        ctx.throw(400, `Please Initialised your tenent`)
    else
        await next()
}

async function createTenant(ctx, value) { 

    // clear down any old details
    if (ctx.tenentKey) {
        console.log(`/createtenent: tear down current tenent: ${ctx.tenentKey}`)
        for (let collname of Object.keys(StoreDef).filter(c => StoreDef[c].collection)) {
            const collection = StoreDef[collname].collection
            console.log(`/createtenent: tear down collection=${collection}`)
            await ctx.db.collection(collection).deleteMany({partition_key: collname === "business" ? "root" : ctx.tenentKey})
        }
    }

    // Create new details.
    const new_tenent = await ctx.db.collection(StoreDef["business"].collection).insertOne({ ...value, type: "business", partition_key: "root" })

    if (value.catalog === 'bike') {

        console.log(`/createtenent: create bike with partition_key: ${new_tenent.insertedId}`)
        const { images, products } = await fetch('https://khcommon.z6.web.core.windows.net/az-device-shop/setup/bikes.json')
        const { Product, Category } = products

        const imagemap = await writeimages(ctx.containerClient, new_tenent, images)

        const catmap = new Map()
        const newcats = Category.map(function (c) {
            console.log(`/createtenent: Processing catalog ${c.heading}`)
            const old_id = c._id, new_id = new ObjectId()//.toHexString()
            const newc = { ...c, _id: new_id, partition_key: new_tenent.insertedId, creation: Date.now() }
            if (c.image && c.image.pathname) {
                newc.image = imagemap.get(c.image.pathname)
                if (!newc.image) {
                    console.error(`/createtenent: Cannot find image pathname ${c.image.pathname}`)
                }
            }
            catmap.set(old_id, new_id)
            return newc
        })

        console.log(`/createtenent: Loading Categories : ${JSON.stringify(newcats)}`)
        await ctx.db.collection(StoreDef["products"].collection).insertMany(newcats)

        const newproducts = Product.map(function (p) {
            console.log(`/createtenent: Processing product ${p.heading}`)
            const old_id = p._id, new_id = new ObjectId()//.toHexString()
            const newp = { ...p, _id: new_id, partition_key: new_tenent.insertedId, creation: Date.now() }
            if (p.category_id) {
                newp.category_id = catmap.get(p.category_id)
                if (!newp.category_id) {
                    console.error(`/createtenent: Cannot find category ${p.category_id}`)
                }
            }
            if (p.image && p.image.pathname) {
                newp.image = imagemap.get(p.image.pathname)
                if (!newp.image) {
                    console.error(`/createtenent: Cannot find image pathname ${p.image.pathname}`)
                }
            }
            return newp
        })

        console.log("/createtenent: Importing Products")
        await ctx.db.collection(StoreDef["products"].collection).insertMany(newproducts)

        if (value.inventory) {
            await ctx.db.collection(StoreDef["inventory"].collection).insertMany(newproducts.map(function (p) {
                return {
                    _ts: new Timestamp(0,0), // Empty timestamp will be replaced by the server to the current server time
                    partition_key: new_tenent.insertedId,
                    status: 'Required',
                    product_id: p._id,
                    category_id: p.category_id,
                    warehouse: 'EMEA',
                    qty: 1
                }
            }))
        }

    }

    return {...value, _id: new_tenent.insertedId}
}

async function writeimages(containerClient: ContainerClient, new_tenent, images: any) {
    let imagemap = new Map()
    for (const pathname of Object.keys(images)) {

        const b64 = Buffer.from(images[pathname], 'base64'),
            bstr = b64.toString('utf-8'),
            file_stream = Stream.Readable.from(b64),
            new_blob_info = getFileClient(containerClient, new_tenent.insertedId.toHexString(), pathname)

        console.log(`/createtenent: Importing ${pathname} (${bstr.length})`)
        try {
            await new_blob_info.uploadStream(file_stream, 4 * 1024 * 1024, 20, {
              //abortSignal: AbortController.timeout(30 * 60 * 1000), // Abort uploading with timeout in 30mins
              onProgress: (ev) => console.log(ev)
            });
            console.log("uploadStream succeeds");
            imagemap.set(pathname, { pathname: new_blob_info.name })
          } catch (err) {
            console.log(
              `uploadStream failed, requestId - ${err.details.requestId}, statusCode - ${err.statusCode}, errorCode - ${err.details.errorCode}`
            );
          }
/*
        await new Promise(function (resolve, reject) {
            let error
            file_stream.pipe(blobStream)
            blobStream.on('finish', () => {
                console.log(`/import 'blobStream finish'`)
                if (!error) {
                    resolve("")
                } else {
                    reject(`error importing blob : ${error}`)
                }
            })

            blobStream.on('error', (e) => {
                console.error(`/createtenent: blobStream error: ${e}`)
                reject(`/createtenent: blobStream error : ${e}`)
            })

        })
 */
        

    }
    return imagemap
}


// API
const api = new Router({ prefix: '/api' })
    .get('/session_status', async function (ctx, next) {
        ctx.body = await getSession(ctx)
        next()
    })
    .post('/cartadd', async function (ctx, next) {
        console.log(`add product to cart ${ctx.session && JSON.stringify(ctx.session)}`)
        const { _id, value, error } = webToDBValidate ( StoreDef["order_line"], ctx.request.body, true ) as { _id?: any, value: any, error: any }
        if (error) throw new Error(error)
        const partition_key = ctx.tenentKey

        if (!error) {
            const ref_product = value.product_id && await ctx.db.collection(StoreDef["products"].collection).findOne({_id: value.product_id}, { projection: { "price": 1, "active": 1 } })
            ctx.assert(ref_product, 400, `Cannot find product ${value.product_id}`)
            ctx.assert(ref_product.price === value.recorded_item_price, 400, "Incorrect Price, please refresh your page")
            const line_total = ref_product.price * 1
            const res = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate(
                { 
                    partition_key, 
                    owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, 
                    owner_type: ctx.session.auth ? "user" : "session", 
                    status: StoreDef["orders"].status.ActiveCart 
                },
                { 
                    $inc: { items_count: 1 }, 
                    $push: {  items: {_id, ...value, line_total} } 
                },
                { 
                    upsert: true, 
                    returnOriginal: false,
                    returnNewDocument: true 
                })

            ctx.assert(res.ok === 1, 500, `error`)
            ctx.body = { items_count: res.value && res.value.items_count || 1 }
            ctx.status = 201
        } else {
            ctx.throw(400, error)
        }
        await next();
    })
    .put('/cartdelete/:itemid', async function (ctx, next) {
        try {
            ctx.body = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate(
                { owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, 
                { $inc: { items_count: -1 }, $pull: { 'items': { _id: new ObjectId(ctx.params.itemid) } } })
            ctx.status = 201;
            await next()
        } catch (e) {
            ctx.throw(400, `cannot retreive mycart: ${e}`)
        }
    })
    // side effect, requires auth (force sign-in, so any cart data will be against auth.sub)
    .put('/checkout', async function (ctx, next) {
        if (b2c_tenant && !ctx.session.auth) {
            ctx.throw(401, 'please login')
        } else {
            try {
                const { value, error } = Joi.object({ 'shipping': Joi.string().valid('A', 'B').required() }).validate(ctx.request.body, { allowUnknown: true })

                // Timestamp(0,0) *only* works on Inserts, for updates, it is taken literally
                const order = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate(
                    { owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, 
                    [{ 
                        $set: { 
                            _checkoutTimeStamp: "$$CLUSTER_TIME",
                            status: StoreDef["orders"].status.NewOrder, 
                            checkout_date: "$$NOW", 
                            shipping: value 
                        } 
                    }])
                ctx.body = { _id: order.value._id }
                await next()
            } catch (e) {
                ctx.throw(400, `cannot retreive mycart: ${e}`)
            }
        }
    })
    .get('/mycart', async function (ctx, next) {
        try {
            ctx.body = await FetchOperation.mycart(ctx)
            await next()
        } catch (e) {
            ctx.throw(400, `cannot retreive mycart: ${e}`)
        }
    })
    /* Only used when NOT using SSR */
    .get('/componentFetch/:component?/:urlid?', ensureInit, async function (ctx, next) {

        const
            routekey = '/' + (ctx.params.component || ''),
            { requireAuth, componentFetch } = AppRouteCfg[routekey] || {}

        if (!componentFetch) {
            ctx.throw(404, `unknown componentFetch [${routekey}]`)
        } else {

            try {
                ctx.body = await FetchOperation.componentFetch(ctx, componentFetch, (ctx.params.urlid || null))
                await next()
            } catch (e) {
                ctx.throw(400, `Cannot retreive componentFetch: ${e}`)
            }
        }
    })
    .get('/store/:store', async function (ctx, next) {
        const q = ctx.query.q ? JSON.parse(decodeURI(ctx.query.q)) : null// url param q is a mongo find query
        try {
            ctx.body = await FetchOperation.get(ctx, ctx.params.store, q)
            await next()
        } catch (e) {
            ctx.throw(400, `cannot get ${ctx.params.store}: ${e}`)
        }
    })
    .get('/store/:store/:id?', async function (ctx, next) {
        try {
            let query = { partition_key: ctx.tenentKey }
            if (ctx.params.id) {
                query['_id'] = new ObjectId(ctx.params.id)
                ctx.body = await FetchOperation.getOne(ctx, ctx.params.store, query)
            } else {
                query = { ...(ctx.query.q ? JSON.parse(decodeURI(ctx.query.q)) : {}), ...query }// url param q is a mongo find query
                ctx.body = await FetchOperation.get(ctx, ctx.params.store, query)
            }
            await next()
        } catch (e) {
            ctx.throw(400, `cannot find ${ctx.params.store + ':' + ctx.params.id}: ${e}`)
        }
    })
    .get('/onhand/:sku', async function (ctx, next) {
        if (ctx.orderStateStore) {
            ctx.body = ctx.orderStateStore.getValue('inventory', 'onhand').find(i => i.productId === ctx.params.sku) || { qty: 0 }
        } else {
            ctx.throw(400, `/onhand : "orderState"  not initialised`)
        }
        await next()
    })
    // curl -XPOST "http://localhost:3000/products" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
    .post('/store/:store', async function (ctx, next) {
        try {
            if (!ctx.request.body) throw new Error(`no body`)
            if (b2c_tenant && !ctx.session.auth) throw new Error(`unauthenticated`)
            if (!ctx.tenentKey) throw new Error(`no tenent`)


            const {_id, value, error, collection} = webToDb (ctx.request.body, ctx.params.store, ctx.session.auth?.sub)
            if (error) throw new Error(error)
            const partition_key = ctx.tenentKey

            if (_id) {
                ctx.body = await ctx.db.collection(collection).updateOne({ _id, partition_key }, { $set: value })
            } else {
                ctx.body = await ctx.db.collection(collection).insertOne({partition_key, ...value})
            }
            await next()
        } catch (e) {
            ctx.throw(400, `cannot save ${ctx.params.store}: ${e}`)
        }
    })
    .delete('/store/:store/:id', async function (ctx, next) {
        try {
            const store = StoreDef[ctx.params.store]

            if (!store) throw `unknown store: ${ctx.params.store}`

            ctx.body = await ctx.db.collection(store.collection).deleteOne({ _id: new ObjectId(ctx.params.id), partition_key: ctx.tenentKey })
            await next()
        } catch (e) {
            ctx.throw(400, `cannot find ${ctx.params.store + ':' + ctx.params.id}: ${e}`)
        }
    })
    .put('/file', async function (ctx, next) {
        const userdoc = ctx.request.body

        if (!userdoc || !userdoc.filename) {
            ctx.throw(400, `No filename provided`)
        }

        ctx.body = getFileSaS(ctx, userdoc.root ? 'root' : ctx.tenentKey.toHexString(), userdoc.filename)
        await next()
    })
    .get('/file/:folder/:id', async function (ctx, next) {
        const containerClient: ContainerClient = ctx.containerClient
        const pathname = ctx.params.folder + '/' + ctx.params.id
        const downloadBlockBlobResponse = await containerClient.getBlockBlobClient(pathname).download()
        ctx.status = 200;
        ctx.response.set("content-type", downloadBlockBlobResponse.contentType);

        await new Promise((resolve, rej) => {
            downloadBlockBlobResponse.readableStreamBody.pipe(ctx.res).on('finish', () => {
                ctx.res.end()
                resolve('done')
                })
        })
        await next()
/*
        const url = `${process.env.STORAGE_ACCOUNT === 'devstoreaccount1' ? 'http://127.0.0.1:10000': `https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`}/${process.env.STORAGE_CONTAINER}/${pathname}?${process.env.STORAGE_DOWNLOAD_SAS}`
        console.log (`/file : url=${url}`)
        try {
            await new Promise((acc, rej) => {
                https.get(url, async (res) => {
                    console.log (res.statusCode)
                    if (res.statusCode !== 200) {
                        //ctx.throw(400, `Request Failed: Status Code: ${res.statusCode}`)
                        rej(res.statusCode)
                    } else {
                        ctx.status = res.statusCode;
                        res.pipe(ctx.res).on('finish', acc)
                    }
                })
            })
            await next()
        } catch (e) {
            ctx.throw(400, `Request Failed: error: ${JSON.stringify(e)}`)
            await next()
        }
*/
    })
    .get('/export', async function (ctx, next) {
        //const retsas = createServiceSAS(process.env.STORAGE_MASTER_KEY, process.env.STORAGE_ACCOUNT, process.env.STORAGE_CONTAINER, 10)

        const products = await FetchOperation.get(ctx, "products")

        const imagesb64 = {}
        for (const c of [...products.Category, ...products.Product]) {

            if (c.image && c.image.pathname) {
                const pathname = c.image.pathname
                if (pathname && !imagesb64.hasOwnProperty(pathname)) {
                    imagesb64[pathname] = await fetch(`/api/file/${pathname}`)
                }
            }
        }

        ctx.body = { 'images': imagesb64, products }
        await next()

    })
    .post('/createtenent', async function (ctx, next) {
        try {
            if (!ctx.request.body) throw new Error(`no body`)

            const {_id, value, error, collection} = webToDb (ctx.request.body, "business", ctx.session.auth ? ctx.session.auth.sub : ctx.session._id )
            if (error) throw new Error(error)

            console.log(`/createtenent: Starting - close the business watch cursor`)
            await app.context.businessWatcher.close()

            ctx.res.on('finish', () => {
                console.error(`/createtenent finished: TENENT RESET - Server needs to be restarted.  Ending process`)
                process.exit()
            })

            await createTenant(ctx, value)

            console.log("/createtenent: Finished")
            ctx.body = { status: 'success', description: 'done' }
            await next()

        } catch (e) {
            console.error(`/createtenent: ERROR ${e} ${JSON.stringify(e)}`)
            ctx.throw(400, e)
            await next()
        }

    })
    .all('/(.*)', async function (ctx, next) {
        if (!ctx._matchedRoute) {
            ctx.throw(404, `no api found ${ctx.request.url}`)
        }
    })
    .routes()

// Run Server
init()