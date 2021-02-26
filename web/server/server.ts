const path = require('path')
const fs = require('fs')

// Web require
const
    Koa = require('koa'),
    cors = require('@koa/cors'),
    Router = require('koa-router'),
    bodyParser = require('koa-bodyparser'),
    // Simple session middleware for Koa. Defaults to cookie-based sessions and supports external stores
    session = require('koa-session'),
    Joi = require('joi')

// Auth & SAS require
const
    jwkToPem = require('jwk-to-pem'),
    jws = require('jws'),
    crypto = require('crypto')


const app_host_url = process.env.APP_HOST_URL
const client_id = process.env.B2C_CLIENT_ID
const b2c_tenant = process.env.B2C_TENANT
const signin_policy = process.env.B2C_SIGNIN_POLICY
const passwd_reset_policy = process.env.B2C_RESETPWD_POLICY
const client_secret = encodeURIComponent(process.env.B2C_CLIENT_SECRET as string)


// Mongo require
const { MongoClient, Timestamp, ObjectID, ObjectId } = require('mongodb'),
    MongoURL = process.env.MONGO_DB,
    USE_COSMOS = process.env.USE_COSMOS === "false" ? false : true

// Store Metadata
const StoreDef = {
    "business": {
        collection: "business",
        schema: Joi.object({
            'name': Joi.string().trim().required(),
            'catalog': Joi.string().trim().required(),
            'email': Joi.string().trim().required(),
            'inventory': Joi.boolean(),
            'image': Joi.object({
                'url': Joi.string().uri(),
                'container_url': Joi.string().uri(),
                'pathname': Joi.string().uri({ relativeOnly: true })
            }).xor('url', 'pathname').xor('url', 'container_url')

        })
    },
    "products": {
        collection: "products",
        split_types: ['Product', 'Category'],
        schema: Joi.object({
            'type': Joi.string().valid('Product', 'Category').required(),
            'heading': Joi.string().trim().required(),
            'category': Joi.string().when('type', {
                is: "Product",
                then: Joi.required()
                //otherwise: Joi.object({'category': //not exist//})
            }).trim(),
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
                'container_url': Joi.string().uri(),
                'pathname': Joi.string().uri({ relativeOnly: true })
            }).xor('url', 'pathname').xor('url', 'container_url')
        })
    },
    "inventory": {
        owner: true,
        collection: "inventory_spec",
        schema: Joi.object({
            'status': Joi.string().valid('Draft', 'Required', 'InFactory', 'Cancel', 'Available').required(),
            'productId': Joi.string().required(),
            'categoryId': Joi.string().required(),
            'warehouse': Joi.string().required(),
            'qty': Joi.number().required()
        })
    },
    "inventory_complete": {
        owner: true,
        collection: "inventory_complete",
    },
    "factory_events": {
        owner: true,
        collection: "factory_events",
    },
    "order_events": {
        owner: true,
        collection: "order_events",
    },
    "orders": {
        owner: true,
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
        }),
        indexes: [
            { status: 1 },
            { owner: { _id: 1 } }
        ]
    },
    "order_line": {
        schema: Joi.object({
            'options': Joi.object(),
            'qty': Joi.number().required(),
            'recorded_item_price': Joi.number().required(),
            'item': Joi.object({
                '_id': Joi.string().regex(/^[0-9a-fA-F]{24}$/, "require ObjectID").required()
            }).required()
        })
    },
    "session": {
        collection: "koa_sessions",
        schema: Joi.object({
            //partition_key: Joi.string().trim().required()
        })
    }
}

// Joi schema formatted as a 'projection' for find operations
const StoreProjections = Object.keys(StoreDef).filter(k => StoreDef[k].schema !== undefined).reduce((ac, c) => ({ ...ac, [c]: [...StoreDef[c].schema._ids._byKey.keys()].reduce((ac, a) => ({ ...ac, [a]: 1 }), {}) }), {})




// Operations
const FetchOperation = {
    // no side effect, doesnt require auth
    "mycart": async function (ctx): Promise<any> {
        if (!ctx.tenentKey) throw `Requires init`
        const cart = await ctx.db.collection(StoreDef["orders"].collection).findOne({ owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { projection: StoreProjections["orders"] })
        if (cart && cart.items) {
            const ref_products = await ctx.db.collection(StoreDef["products"].collection).find({ _id: { $in: [...new Set(cart.items.map(m => m.item._id))] }, partition_key: ctx.tenentKey }, { projection: StoreProjections["products"] }).toArray()
            const ref_products_map = ref_products.reduce((a, c) => Object.assign({}, a, { [String(c._id)]: c }), null)
            cart.items = cart.items.map(i => Object.assign(i, { item: ref_products_map[String(i.item._id)] || { _id: i.item._id, _error: 'missing item' } }))
        }
        return cart || {}
    },
    "myorders": async function (ctx): Promise<any> {
        if (!ctx.tenentKey) throw `Requires init`
        if (!ctx.session.auth) throw 'Requires logged in'
        const orders = await ctx.db.collection(StoreDef["orders"].collection).find({ owner: { _id: ctx.session.auth.sub }, status: { $gte: 30 }, partition_key: ctx.tenentKey }, { projection: StoreProjections["orders"] }).toArray()

        return orders.map(o => {
            const orderState = ctx.orderState ? ctx.orderState.stateStore.state.orders.items.find(os => o._id.equals(os.spec._id)) : { status: { error: `orderState not initialied` } }
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
            while (await cursor.hasNext()) {
                const doc = await cursor.next()
                if (s.split_types.includes(doc.type)) {
                    response[doc.type].push(doc)
                }
            }
            return response
        } else {
            return await cursor.toArray()
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

        return await ctx.db.collection(s.collection).findOne(query, { projection: proj || StoreProjections[store] })
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
                    query['_id'] = ObjectID(urlid)
                } else {
                    query[componentFetch.urlidField] = urlid
                }
            }
            if (componentFetch.query) {
                query = { ...componentFetch.query, ...query }
            }
            //console.log (`ssr componentFetch (${componentFetch.operation}): ${JSON.stringify(oppArgs)}`)]
            result.data = await FetchOperation[componentFetch.operation](ctx, componentFetch.store, query)
            if (componentFetch.refstores && componentFetch.refstores.length > 0) {
                let fetch_promises: Array<Promise<any>> = []
                for (let refstore of componentFetch.refstores) {
                    if (refstore.orderState) {
                        if (ctx.orderState) {
                            fetch_promises.push(Promise.resolve(ctx.orderState.stateStore.state[refstore.store]))
                        } else {
                            console.error(`Got "refstore.orderState" request for compoent, but "ctx.orderState" not initialised`)
                        }
                    } else {
                        console.log(`componentFetch: get refstore : ${JSON.stringify(refstore)}`)
                        if (!refstore.lookup_field) {
                            fetch_promises.push(FetchOperation.get(ctx, refstore.store))
                        } else {
                            fetch_promises.push(FetchOperation.get(ctx, refstore.store, { _id: ObjectID(refstore.lookup_field === "urlidField" ? urlid : result.data[refstore.lookup_field]) }))
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
    const client = await MongoClient.connect(MongoURL, { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    const _db = client.db()
    // If Cosmos, need to pre-create the collections, becuse it enforces a partitioning strategy.

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
    return _db
}


// Serve Static files
const PUBLIC_PATH = "/static"
const BUILD_PATH = "./dist"
async function serve_static(ctx, next) {

    const filePath = path.join(process.cwd() /* __dirname */, BUILD_PATH, ctx.request.url)
    console.log(`serve_static: request ${ctx.request.url}, serving static resource  filePath=${filePath}`)

    if (fs.existsSync(filePath)) {
        ctx.response.body = fs.createReadStream(filePath)
    } else {
        ctx.throw(404, `${ctx.request.url} not found`)
    }
    next()
}





import { order_state_startup } from './orderingFollower'
const app = new Koa();

async function init() {

    // Init Web

    app.use(bodyParser())

    // Init DB
    const db = app.context.db = await dbInit()

    // Init Sessions
    app.keys = ['secret']
    app.use(session({
        maxAge: 86400000,
        //secure: false, // DEVELOPMENT ONLY!
        store: {
            get: async function (key) {
                console.log(`session get ${key}`)
                return await db.collection(StoreDef["session"].collection).findOne({ _id: key, partition_key: "session" })
            },
            set: async function (key, sess, maxAge, { rolling, changed }) {
                //console.log(`session set ${key} ${JSON.stringify(sess)}`)
                await db.collection(StoreDef["session"].collection).replaceOne({ _id: key, partition_key: "session" }, { ...sess, ...{ _id: key, partition_key: "session" } }, { upsert: true })
            },
            destroy: async function (key) {
                //console.log(`session destroy ${key}`)
                await db.collection(StoreDef["session"].collection).deleteOne({ _id: key, partition_key: "session" })
            }
        }
    }, app))

    // app.context is the prototype from which ctx is created. 
    // You may add additional properties to ctx by editing app.context. 
    // This is useful for adding properties or methods to ctx to be used across your entire app
    // Init Auth
    app.context.openid_configuration = await fetch(`https://${b2c_tenant}.b2clogin.com/${b2c_tenant}.onmicrosoft.com/${signin_policy}/v2.0/.well-known/openid-configuration`)
    const signing_keys: any = await fetch(app.context.openid_configuration.jwks_uri)
    app.context.jwks = Object.assign({}, ...signing_keys.keys.map(k => ({ [k.kid]: k })))

    // Init Settings (currently single tenent)
    app.context.tenent = await db.collection(StoreDef["business"].collection).findOne({ type: "business", partition_key: "root" })
    app.context.tenentKey = app.context.tenent && app.context.tenent._id

    // DEVELOPMENT ONLY, only for running react frontend locally on developer workstation and server in cloud (using REACT_APP_SERVER_URL)
    app.use(cors({ credentials: true }))

    // Init Routes
    app.use(new Router()
        .get(`${PUBLIC_PATH}/(.*)`, serve_static)
        .get(/^\/[^\/]*\./, serve_static)
        .routes())

    app.use(authroutes)
    app.use(api)
    app.use(ssr)

    console.log(`Starting on 3000..`)
    app.listen(3000)

    // Init order status (dont await, incase no tenent! )
    order_state_startup(app.context).then(val => {
        app.context.orderState = val
    })

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
        tenent: ctx.tenent, // needed just for spa-mode, to redirect to '/init' if missing
        auth: ctx.session.auth ? { userid: ctx.session.auth.sub, given_name: ctx.session.auth.given_name } : undefined,
        cart_items
    }
}


// ----------------------------------------------------------- Server SSR
const stringReplaceStream = require('string-replace-stream')
const { Readable } = require('stream')
import fetch from './server_fetch'
import { AzBlobWritable, createServiceSAS } from './AzBlobWritable'

// all requires after this will use babel transpile, using 'babel.config.json'
/*
require("@babel/register")()
const server_ssr = require('../../../../src/ssr_server')
*/
const server_ssr = require('../../../../lib/ssr_server')

// ssr middleware (ensure this this the LAST middleware to be used)
async function ssr(ctx, next) {
    if (!ctx._matchedRoute) {
        //console.log (`no route matched for [${ctx.request.url}], serve index.html to ${ctx.session.auth && ctx.session.auth.given_name}`)
        var filePath = path.join(process.cwd() /* __dirname */, BUILD_PATH, 'index.html')

        // Get Iniitial Data
        const urlsplit = ctx.request.url.split('?', 2),
            startURL = { pathname: urlsplit[0], search: urlsplit.length > 1 ? urlsplit[1] : null },
            { routekey, urlid } = server_ssr.pathToRoute(startURL),
            { requireAuth, componentFetch } = server_ssr.AppRouteCfg[routekey] || {}

        if (!ctx.tenentKey && routekey != '/init') {
            ctx.redirect('/init')
        } else if (requireAuth && !ctx.session.auth) {
            ctx.redirect(`/connect/microsoft?surl=${encodeURIComponent(ctx.request.href)}`)
        } else {
            const renderContext: any = { ssrContext: "server" }

            if (componentFetch) {
                let initfetchfn = FetchOperation.componentFetch(ctx, componentFetch, urlid)

                // Parallel fetch
                const [serverInitialData, session] = await Promise.all([initfetchfn, getSession(ctx)])
                renderContext.serverInitialData = serverInitialData
                renderContext.session = session
            } else {
                renderContext.session = await getSession(ctx)
            }

            // SEND
            ctx.response.type = 'text/html'
            ctx.body = fs.createReadStream(filePath)
                .pipe(stringReplaceStream('<div id="root"></div>', `<div id="root">${await server_ssr.ssrRender(startURL, renderContext)}</div>`))
                .pipe(stringReplaceStream('"SERVER_INITAL_DATA"', JSON.stringify(renderContext)))
        }
    }
    next()
}


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

                const { access_token, id_token } = await fetch(ctx.openid_configuration.token_endpoint, 'POST',
                    { 'content-type': 'application/x-www-form-urlencoded' }, flow_body)

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

/*
function LoggedIn(ctx, next) {
    console.log(`checking logged in with ${ctx.session.auth}`)
    return ctx.redirect(`/connect/microsoft?surl=${encodeURIComponent(ctx.request.url)}`)
}
*/

function getFileSaS(store, filename) {
    const extension = encodeURIComponent(filename.substring(1 + filename.lastIndexOf(".")))
    const pathname = `${store}/${(new ObjectID()).toString()}.${extension}`
    const retsas = createServiceSAS(process.env.STORAGE_MASTER_KEY, process.env.STORAGE_ACCOUNT, process.env.STORAGE_CONTAINER, 10, pathname)
    return Object.assign({ pathname, extension }, retsas)
}

async function ensureInit(ctx, next) {

    if (!ctx.tenentKey)
        ctx.throw(400, `Please Initialised your tenent`)
    else
        await next()
}


// API
const api = new Router({ prefix: '/api' })
    .get('/session_status', async function (ctx, next) {
        ctx.body = await getSession(ctx)
        next()
    })
    .post('/cartadd', async function (ctx, next) {
        console.log(`add product to cart ${ctx.session && JSON.stringify(ctx.session)}`)
        const { value, error } = StoreDef["order_line"].schema.validate(ctx.request.body, { allowUnknown: true })
        if (!error) {
            const ref_product = await ctx.db.collection(StoreDef["products"].collection).findOne({ _id: ObjectId(value.item._id) }, { projection: { "price": 1, "active": 1 } })
            ctx.assert(ref_product, 400, "Cannot find product")
            ctx.assert(ref_product.price === value.recorded_item_price, 400, "Incorrect Price, please refresh your page")
            const line_total = ref_product.price * 1
            const res = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, owner_type: ctx.session.auth ? "user" : "session", status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { $inc: { items_count: 1 }, $push: { items: { _id: ObjectID(), item: { _id: ObjectID(value.item._id) }, options: value.options, qty: 1, line_total, added: new Date() } } }, { upsert: true, returnOriginal: false, returnNewDocument: true })

            ctx.assert(res.ok === 1, 500, `error`)
            ctx.body = { items_count: res.value.items_count }
            ctx.status = 201
        } else {
            ctx.throw(400, error)
        }
        await next();
    })
    .put('/cartdelete/:itemid', async function (ctx, next) {
        try {
            ctx.body = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ owner: { _id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { $inc: { items_count: -1 }, $pull: { 'items': { _id: ObjectID(ctx.params.itemid) } } })
            ctx.status = 201;
            await next()
        } catch (e) {
            ctx.throw(400, `cannot retreive mycart: ${e}`)
        }
    })
    // side effect, requires auth (force sign-in, so any cart data will be against auth.sub)
    .put('/checkout', async function (ctx, next) {
        if (!ctx.session.auth) {
            ctx.throw(401, 'please login')
        } else {
            try {
                const { value, error } = Joi.object({ 'shipping': Joi.string().valid('A', 'B').required() }).validate(ctx.request.body, { allowUnknown: true })

                const order = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({ owner: { _id: ctx.session.auth.sub }, status: StoreDef["orders"].status.ActiveCart, partition_key: ctx.tenentKey }, { $set: { _ts: new Timestamp(), status: StoreDef["orders"].status.NewOrder, checkout_date: Date.now(), shipping: value } })
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
            { requireAuth, componentFetch } = server_ssr.AppRouteCfg[routekey] || {}

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
                query['_id'] = ObjectID(ctx.params.id)
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
        if (ctx.orderState) {
            ctx.body = ctx.orderState.stateStore.state.inventory.onhand.find(i => i.productId === ctx.params.sku) || { qty: 0 }
        } else {
            ctx.throw(400, `/onhand : "orderState"  not initialised`)
        }
        await next()
    })
    // curl -XPOST "http://localhost:3000/products" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
    .post('/store/:store', async function (ctx, next) {
        try {
            if (!ctx.request.body) throw new Error(`no body`)
            if (!ctx.session.auth) throw new Error(`unauthenticated`)
            if (!ctx.tenentKey) throw new Error(`no tenent`)


            const store = StoreDef[ctx.params.store]
            if (!store) throw new Error(`unknown store: ${ctx.params.store}`)

            const { _id, partition_key, ...body } = ctx.request.body
            const { value, error } = store.schema.validate(body, { allowUnknown: false })

            if (error) throw new Error(`document not valid: ${error}`)

            if (_id) {
                ctx.body = await ctx.db.collection(store.collection).updateOne({ _id: ObjectID(_id), partition_key: ctx.tenentKey }, { $set: value })
            } else {
                ctx.body = await ctx.db.collection(store.collection).insertOne({ ...value, _id: ObjectID(), _ts: new Timestamp(), owner: { _id: ctx.session.auth.sub }, creation: Date.now(), partition_key: ctx.tenentKey })
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

            ctx.body = await ctx.db.collection(store.collection).deleteOne({ _id: ObjectID(ctx.params.id), partition_key: ctx.tenentKey })
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

        ctx.body = getFileSaS(userdoc.root ? 'root' : ctx.tenentKey.toHexString(), userdoc.filename)
        await next()
    })
    .get('/export', async function (ctx, next) {
        const retsas = createServiceSAS(process.env.STORAGE_MASTER_KEY, process.env.STORAGE_ACCOUNT, process.env.STORAGE_CONTAINER, 10)

        const products = await FetchOperation.get(ctx, "products")


        /*
         * const res = await fetch(`${retsas.container_url}?${retsas.sas}&restype=container&comp=list`, {
         *    method: 'GET',
         *    headers: {
         *        'x-ms-version': "2018-03-28"
         *    }
         * })
         * const files = res.split('<Blob>').map(b => b.substring(0, b.indexOf('</Blob>'))).slice(1).map(r => Object.assign({}, ...r.split('</').map((e) => { return { [e.substring(e.lastIndexOf('<') + 1, e.lastIndexOf('>'))]: e.substring(e.lastIndexOf('>') + 1) } })))
         */

        const imagesb64 = {}
        for (const c of [...products.Category, ...products.Product]) {

            if (c.image && c.image.container_url) {
                const pathname = c.image.pathname || c.image.filename || c.image.blobname
                if (pathname && !imagesb64.hasOwnProperty(pathname)) {
                    //console.log(`getting ${c.image.container_url}/${pathname}`)
                    imagesb64[pathname] = await fetch(`${c.image.container_url}/${pathname}`)
                }
            }
        }

        ctx.body = { 'images': imagesb64, products }
        await next()

    })
    .post('/createtenent', async function (ctx, next) {
        if (!ctx.request.body) throw new Error(`no body`)

        try {


            if (ctx.tenentKey) {
                console.log(`/createtenent: tear down current tenent: ${ctx.tenentKey}`)
                for (let coll of Object.keys(StoreDef).filter(c => StoreDef[c].collection).map(c => StoreDef[c].collection)) {
                    console.log(`/createtenent: tear down collection=${coll}`)
                    await ctx.db.collection(coll).deleteMany({})
                }
            }

            const { value, error } = StoreDef["business"].schema.validate(ctx.request.body, { allowUnknown: false })
            if (error) throw new Error(`document not valid: ${error}`)

            app.context.tenent = { ...value, type: "business", partition_key: "root" }
            const tenent_res = await ctx.db.collection(StoreDef["business"].collection).insertOne(app.context.tenent)
            app.context.tenentKey = tenent_res.insertedId

            if (ctx.request.body.catalog === 'bike') {

                const { images, products } = await fetch('https://khcommon.z6.web.core.windows.net/az-device-shop/setup/bikes.json')
                const { Product, Category } = products

                async function writeimages(images: any) {
                    let imagemap = new Map()
                    for (const pathname of Object.keys(images)) {

                        const b64 = Buffer.from(images[pathname], 'base64'),
                            bstr = b64.toString('utf-8'),
                            file_stream = Readable.from(b64),
                            new_blob_info = getFileSaS(app.context.tenentKey.toHexString(), pathname),
                            blobStream = new AzBlobWritable(new_blob_info)

                        console.log(`Importing ${pathname} (${bstr.length})`)

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
                                console.error(`/createtenent blobStream error: ${e}`)
                                reject(`/createtenent blobStream error : ${e}`)
                            })

                        })
                        imagemap.set(pathname, { pathname: new_blob_info.pathname, container_url: new_blob_info.container_url })

                    }
                    return imagemap
                }

                const imagemap = await writeimages(images)

                const catmap = new Map()
                const newcats = Category.map(function (c) {
                    console.log(`Processing catalog ${c.heading}`)
                    const old_id = c._id, new_id = ObjectID().toHexString()
                    const newc = { ...c, _id: ObjectID(new_id), partition_key: app.context.tenentKey, creation: Date.now() }
                    if (c.image && c.image.pathname) {
                        newc.image = imagemap.get(c.image.pathname)
                        if (!newc.image) {
                            console.error(`Cannot find image pathname ${c.image.pathname}`)
                        }
                    }
                    catmap.set(old_id, new_id)
                    return newc
                })

                console.log(`Loading Categories : ${JSON.stringify(newcats)}`)
                await ctx.db.collection(StoreDef["products"].collection).insertMany(newcats)

                const newproducts = Product.map(function (p) {
                    console.log(`Processing product ${p.heading}`)
                    const old_id = p._id, new_id = ObjectID().toHexString()
                    const newp = { ...p, _id: ObjectID(new_id), partition_key: app.context.tenentKey, creation: Date.now() }
                    if (p.category) {
                        newp.category = catmap.get(p.category)
                        if (!newp.category) {
                            console.error(`Cannot find category ${p.category}`)
                        }
                    }
                    if (p.image && p.image.pathname) {
                        newp.image = imagemap.get(p.image.pathname)
                        if (!newp.image) {
                            console.error(`Cannot find image pathname ${p.image.pathname}`)
                        }
                    }
                    return newp
                })

                console.log("Importing Products")
                await ctx.db.collection(StoreDef["products"].collection).insertMany(newproducts)

                if (ctx.request.body.inventory) {
                    await ctx.db.collection(StoreDef["inventory"].collection).insertMany(newproducts.map(function (p) {
                        return {
                            _ts: new Timestamp(), // Empty timestamp will be replaced by the server to the current server time
                            partition_key: app.context.tenentKey,
                            status: 'Required',
                            productId: p._id,
                            categoryId: p.category,
                            warehouse: 'EMEA',
                            qty: 10
                        }
                    }))
                }

            }

            ctx.body = { status: 'success', description: 'done' }
            await next()


        } catch (e) {
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