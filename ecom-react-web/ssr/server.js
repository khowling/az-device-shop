// Web require
const Koa = require('koa'),
    Router = require('koa-router'),
    bodyParser = require('koa-bodyparser'),
    session = require('koa-session'),
    Joi = require('@hapi/joi')

// Auth require
const jwkToPem = require('jwk-to-pem'),
    jws = require ('jws')
const client_id = process.env.B2C_CLIENT_ID 
const b2c_tenant = process.env.B2C_TENANT 
const signin_policy = process.env.B2C_POLICY 
const client_secret = encodeURIComponent(process.env.B2C_CLIENT_SECRET)


// Mongo require
const {MongoClient, ObjectID} = require('mongodb'),
    MongoURL = process.env.MONGO_DB,
    dbname = 'dbdev',
    session_collection_name = 'koa-sessions',
    USE_COSMOS = true

// Store Metadata
const StoreDef = {
        "products": {
            collection: "products",
            schema: Joi.object({
                heading: Joi.string().trim().required(),
                //partition_key: Joi.string().trim().required()
            })
        },
        "orders": {
            default_filter: { status: { $gte: 30}},
            status: {
                InactiveCart: 5,
                ActiveCart : 10,
                InactiveOrder: 20,
                NewOrder: 30
            },
            collection: "orders",
            schema: Joi.object({
                //partition_key: Joi.string().trim().required()
            }),
            indexes: [
                {status: 1 },
                {owner: {_id: 1}}
            ]
        },
        "session": {
            collection: session_collection_name,
            schema: Joi.object({
                //partition_key: Joi.string().trim().required()
            })
        }
    }

// Operations
const FetchOperation = {
    "mycart": async function (ctx) {
        const cart = await ctx.db.collection(StoreDef["orders"].collection).findOne({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"})
        if (cart && cart.items) {
            const ref_products = await ctx.db.collection(StoreDef["products"].collection).find({ _id: { $in: [...new Set(cart.items.map(m => m.item._id))] }}).toArray()
            const ref_products_map = ref_products.reduce((a,c) => Object.assign({},a,{ [String(c._id)]: c}),null)
            cart.items = cart.items.map(i => Object.assign(i, {item: ref_products_map[String(i.item._id)] || {_id: i.item._id, _error: 'missing item'}}))
        }
        return cart || {}
    },
    "get": async function (ctx, store, query) {
        
        return await ctx.db.collection(StoreDef[store].collection).find(query || StoreDef[store].default_filter || {}).toArray()
    },
    "getOne": async function (ctx, store, query) {
        return await ctx.db.collection(StoreDef[store].collection).findOne(query)
    }
}

async function dbInit(dbname) {
    // ensure url encoded
    const murl = new URL (MongoURL)
    console.log (`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    const _db = client.db(dbname)
    // If Cosmos, need to pre-create the collections, becuse it enforces a partitioning strategy.
    if (USE_COSMOS) {
        for (let store of Object.keys(StoreDef)) {
            console.log (`ensuring partitioned collection created for [${store}]`)
            try { 
                const {ok, code, errMsg} = await _db.command({customAction: "CreateCollection", collection: StoreDef[store].collection, shardKey: "partition_key" })
                if (ok === 1) {
                    console.log ('success')
                } else {
                    throw new Error (errMsg)
                }
            } catch (err) {
                if (err.code !== 117) {
                    // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                    console.error (`Failed to create collection : ${err}`)
                    throw new Error (err.errMsg)
                }
            }
        }
    }
    return _db
}

// Init Web
const app = new Koa();
app.use(bodyParser())

async function init() {
    // Init DB
    const db = app.context.db = await dbInit(dbname)

    // Init Sessions
    app.keys = ['secret']
    app.use(session({
        maxAge: 86400000,
        store: {
            get: async function(key) {
                //console.log (`get ${key}`)
                return await db.collection(session_collection_name).findOne({_id: key, partition_key: "P1"})
            },
            set: async function (key, sess, maxAge, { rolling, changed }) {
                //console.log (`set ${key} ${JSON.stringify(sess)}`)
                await db.collection(session_collection_name).replaceOne({_id:  key, partition_key: "P1"}, { ...sess, ...{_id:  key, partition_key: "P1"}}, {upsert: true})
            },
            destroy: async function (key) {
                //console.log (`destroy ${key}`)
                await db.collection(session_collection_name).deleteOne({_id:  key, partition_key: "P1"})
            }
    }}, app))

    // Init Auth
    app.context.openid_configuration = await fetch(`https://${b2c_tenant}.b2clogin.com/${b2c_tenant}.onmicrosoft.com/${signin_policy}/v2.0/.well-known/openid-configuration`)
    const signing_keys = await fetch(app.context.openid_configuration.jwks_uri)
    app.context.jwks = Object.assign({}, ...signing_keys.keys.map (k => ({[k.kid]: k})))

    // Init Routes
    app.use(ssrserver)
    app.use(authroutes)
    app.use(api)
    app.use(catchall)

	console .log (`Starting on 3000..`)
	app.listen(3000)
}

// ----------------------------------------------------------- Server SSR
const path = require ('path')
const fs = require ('fs')
const stringReplaceStream = require('string-replace-stream')
const fetch = require('./server_fetch')

const PUBLIC_PATH = "/_assets_"
const BUILD_PATH = "../build"
const server_ssr = require(BUILD_PATH+"/ssr_server.js")

const ssrserver = new Router()
	.get(`${PUBLIC_PATH}/*`,  async function (ctx, next) {

        const filePath =  path.join(__dirname, ctx.request.url.replace (PUBLIC_PATH, BUILD_PATH))
        console.log (`serving static resource  filePath=${filePath}`)

        if (fs.existsSync(filePath)) {
            ctx.response.body = fs.createReadStream(filePath)
        } else {
            ctx.throw(404, `${ctx.request.url} not found`)
        }
        next()
    })
    .routes()

async function getSession (ctx) {
    const cart = await ctx.db.collection(StoreDef["orders"].collection).findOne({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"}, {projection: {"items_count": true}})
    const cart_items = cart && cart.items_count || 0
    return {
        auth: ctx.session.auth ? { userid: ctx.session.auth.sub, given_name: ctx.session.auth.given_name} : undefined,
        cart_items
    }
}

// catchall middleware (ensure this this the LAST middleware to be used)
const catchall = async ctx => {
    if (!ctx._matchedRoute && !ctx.request.url.endsWith('.png')) {
        console.log (`no route matched for [${ctx.request.url}], serve index.html to ${ctx.session.auth && ctx.session.auth.given_name}`)
        var filePath = path.join(__dirname, BUILD_PATH, 'index.html')

        // Get Iniitial Data
        const urlsplit = ctx.request.url.split('?', 2),
            startURL = {pathname: urlsplit[0], search: urlsplit.length>1 ? urlsplit[1] : null},
            {routekey, recordid } = server_ssr.pathToRoute (startURL),
            {requireAuth, initialFetch} = server_ssr.AppRouteCfg[routekey] || {}

        if (requireAuth && !ctx.session.auth) {
            ctx.redirect (`/connect/microsoft?surl=${encodeURIComponent(ctx.request.url)}`)
        } else {
            let initfetchfn = Promise.resolve({})
            if (initialFetch) {
                let oppArgs = [ctx]
                if (initialFetch.store) oppArgs.push(initialFetch.store)
                if (initialFetch.recordid) oppArgs.push( {_id: ObjectID(recordid), partition_key: "P1"})

                initfetchfn = FetchOperation[initialFetch.operation](...oppArgs)
            }
            // Parallel fetch
            const [serverInitialData, session] = await Promise.all([initfetchfn,  getSession(ctx)])
            const renderData = {ssrContext: "server", serverInitialData, session}
            
            // Get Initial DOM
            console.log (`Server -- Rendering HTML`)
            const reactContent = server_ssr.ssrRender(startURL, renderData)

            // SEND
            reactContent.ssrContext="hydrate"
            ctx.response.type = 'text/html'
            ctx.body = fs.createReadStream(filePath)
                .pipe(stringReplaceStream('<div id="root"></div>', `<div id="root">${reactContent}</div>`))
                .pipe(stringReplaceStream('"SERVER_INITAL_DATA"', JSON.stringify(renderData)))
                .pipe(stringReplaceStream('%PUBLIC_URL%', PUBLIC_PATH))
        }
    }
}

// ----------------------------------------------------------- AUTH
const authroutes = new Router({prefix: "/connect/microsoft"})
    .get('/',async function (ctx, next) {
        const nonce = ctx.session.auth_nonce = Math.random().toString(26).slice(2)
        console.log (`login with surl=${ctx.query.surl}`)
        ctx.redirect(`${app.context.openid_configuration.authorization_endpoint}?client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:3000/connect/microsoft/callback')}&scope=openid&response_type=code&nonce=${nonce}${ ctx.query.surl ? "&state="+encodeURIComponent(ctx.query.surl) : ""}`)
        next()
    })
    .get('/logout',async function (ctx, next) {
        delete ctx.session.auth
        ctx.redirect(ctx.query.surl || "/")
        next()
    })
    .get('/callback',async function (ctx, next) {
        const nonce = ctx.session.auth_nonce
        delete ctx.session.auth_nonce

        if (ctx.query.code) {
            try { 
                const flow_body = `client_id=${client_id}&client_secret=${client_secret}&scope=openid&code=${encodeURIComponent(ctx.query.code)}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(`http://localhost:3000/connect/microsoft/callback`)}`
                
                const {access_token, id_token } = await fetch (app.context.openid_configuration.token_endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': "application/x-www-form-urlencoded",
                        'Content-Length': Buffer.byteLength(flow_body)
                    }}, flow_body)
                
                // Validated the signature of the ID token
                // https://docs.microsoft.com/en-us/azure/active-directory-b2c/active-directory-b2c-reference-oidc#validate-the-id-token
                const [head, payload, sig] =  id_token.split('.').map ((t,i) => i < 2 ? JSON.parse(Buffer.from (t, 'base64').toString()) : t)
                console.log (head); console.log (payload)
                const token_signing_key = app.context.jwks[head.kid]
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
                const carts = await ctx.db.collection(StoreDef["orders"].collection).find({"owner._id": { $in: [ctx.session.auth.sub, ctx.session._id]}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"}).toArray(),
                    session_cart = carts.find(c => c.owner._id === ctx.session._id),
                    user_cart = carts.find(c => c.owner._id === ctx.session.auth.sub)
                
                console.log (`Looking for session car [${ctx.session._id}=${session_cart !== null}], and user cart [${ctx.session.auth.sub}=${user_cart !== null}]`)
                // if no session_cart - no nothing, else
                    // if no user_cart - update session cart to user cart, else,
                        // if both - add records from session cart to user_cart, remove session cart
                if (session_cart) {
                    if (!user_cart) {
                        const res = await ctx.db.collection(StoreDef["orders"].collection).updateOne({owner: {_id: ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"},{ $set: {owner_type:  "user", owner: {_id: ctx.session.auth.sub}}}, {upsert: false, returnOriginal: false, returnNewDocument: false})
                    } else {
                        // unfortunatly, this involves 2 operations, so not atomic, need to allow for cosmos ratelimiting
                        // NEED TO MAKE THIS IDEMPOTENT
                        await ctx.db.collection(StoreDef["orders"].collection).updateOne({owner: {_id: ctx.session.auth.sub}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"}, { $inc: {items_count: session_cart.items_count}, $push: { items: { $each: session_cart.items}}})
                        ctx.db.collection(StoreDef["orders"].collection).updateOne({owner: {_id: ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"}, { $set : {status: StoreDef["orders"].status.InactiveCart, status_reason: `Login-merged: into ${user_cart._id}`}})
                    }
                    
                }

                ctx.redirect(ctx.query.state || "/")
                
            } catch (e) {
                console.log (e)
                ctx.throw (400, e)
            }
        } else {
            ctx.throw (401, "no code")
        }
        next()
    })
    .routes()

function LoggedIn(ctx, next) {
    console.log (`checking logged in with ${ctx.session.auth}`)
    return ctx.redirect (`/connect/microsoft?surl=${encodeURIComponent(ctx.request.url)}`)
}
// API
const api = new Router({prefix: '/api'})
    .get('/session_status',async function (ctx, next) {
        ctx.body = await getSession(ctx)
        next()
    })
	.post('/cartadd', async function (ctx, next) {
		console.log (`add product to cart ${ctx.session && JSON.stringify(ctx.session)}`)
		const {value, error} = StoreDef["orders"].schema.validate(ctx.request.body, {allowUnknown: true})
		if (!error) {
            const ref_product = await ctx.db.collection(StoreDef["products"].collection).findOne({ _id: ObjectID(value.itemid)}, {projection: { "price": 1, "active": 1}})
            const line_total = ref_product.price * 1
            const res = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, owner_type: ctx.session.auth ? "user": "session", status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"},{ $inc: {items_count: 1}, $push: { items: {_id: ObjectID(), item: {_id: ObjectID(value.itemid)}, options: value.options, qty: 1, line_total,  added: new Date()}}}, {upsert: true, returnOriginal: false, returnNewDocument: true})
             
            ctx.assert (res.ok === 1, 500, `error`)
            ctx.body = {items_count: res.value.items_count}
            ctx.status = 201
		} else {
			ctx.throw(400, {error})
		}
		await next();
    })
    .put('/cartdelete/:itemid', async function (ctx, next) {
        try {
            ctx.body = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"},{ $inc: {items_count: -1}, $pull: { 'items': {_id: ObjectID(ctx.params.itemid)}}})
			ctx.status = 201;
            await next()
        } catch (e) {
            ctx.throw(400, `cannot retreive mycart: ${e}`)
        }
    })
    .put('/checkout', async function (ctx, next) {
        if (!ctx.session.auth) {
            ctx.throw(401, 'please login')
        } else {
            try {
                // TODO - check products are still OK!
                const order_seq =  await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({_id: "order-sequence-stage1", partition_key: "P1"}, {$inc: {sequence_value:1}}, {upsert: true, returnOriginal: false, returnNewDocument: true})
                const order = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "P1"},{ $set: {  order_number: 'ORD'+String(order_seq.value.sequence_value).padStart(5,'0'), status: StoreDef["orders"].status.NewOrder, owner: {_id: ctx.session.auth.sub}}})
                ctx.body = order
                await next()
            } catch (e) {
                ctx.throw(400, `cannot retreive mycart: ${e}`)
            }
        }
	})
    .get('/mycart', async function (ctx, next) {
        try {
            ctx.body = await FetchOperation.mycart(ctx, ctx.session)
            await next()
        } catch (e) {
            ctx.throw(400, `cannot retreive mycart: ${e}`)
        }
	})
	.get('/store/:store', async function (ctx, next) {
        try {
            ctx.body = await FetchOperation.get(ctx, ctx.params.store)
            await next()
        } catch (e) {
            ctx.throw(400, `cannot get ${ctx.params.store}: ${e}`)
        }
	})
	.get('/store/:store/:id', async function (ctx, next) {
	  	try {
            ctx.body = await FetchOperation.getOne(ctx, ctx.params.store, {_id: ObjectID(ctx.params.id), partition_key: "P1"})
            await next()
		} catch (e) {
			ctx.throw(400, `cannot find ${ctx.params.store+':'+ctx.params.id}: ${e}`)
		}
	})
	// curl -XPOST "http://localhost:3000/products" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
	.post('/store/:store', async function (ctx, next) {
        try { 
            const {value, error} = StoreDef[store].schema.validate(ctx.request.body, {allowUnknown: true})
            if (error) throw `document no valid: ${error}`
            ctx.body =  await ctx.db.collection(StoreDef[ctx.params.store].collection).insertOne({...value, partition_key: "P1"})
            await next()
        } catch (e) {
			ctx.throw(400, `cannot save ${ctx.params.store}: ${e}`)
		}
	})
	.put('/products/:id', async function (ctx, next) {
		// findOneAndUpdate ??
	})
	.delete('/products/:id', async function (ctx, next) {
		// TBC
    })
    .all('/*', async function (ctx, next) {
        if (!ctx._matchedRoute) {
            ctx.throw(404, `no api found ${ctx.request.url}`)
        }
    })
    .routes()


// Run Server
init()