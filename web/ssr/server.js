// Web require
const 
    Koa = require('koa'),
    Router = require('koa-router'),
    bodyParser = require('koa-bodyparser'),
    session = require('koa-session'),
    Joi = require('@hapi/joi')

// Auth & SAS require
const 
    jwkToPem = require('jwk-to-pem'),
    jws = require ('jws'),
    crypto = require('crypto')


const client_id = process.env.B2C_CLIENT_ID 
const b2c_tenant = process.env.B2C_TENANT 
const signin_policy = process.env.B2C_SIGNIN_POLICY 
const passwd_reset_policy = process.env.B2C_RESETPWD_POLICY 
const client_secret = encodeURIComponent(process.env.B2C_CLIENT_SECRET)


// Mongo require
const {MongoClient, ObjectID} = require('mongodb'),
    MongoURL = process.env.MONGO_DB,
    session_collection_name = 'koa-sessions',
    USE_COSMOS = process.env.USE_COSMOS === "false" ? false : true

// Store Metadata
const StoreDef = {
  "business": {    
    collection: "business",
    schema: Joi.object({
      //partition_key: Joi.string().trim().required()
    })
  },
  "products": {
    collection: "products",
    split_types: ['Product','Category'],
    schema: Joi.object({
        'type': Joi.string().valid('Product','Category').required(),
        'heading': Joi.string().trim().required(),
        'category': Joi.string().when ('type', {is: "Product", 
            then: Joi.required()
            //otherwise: Joi.object({'category': //not exist//})
            }).trim(),
        'position': Joi.string().valid('normal','hero', 'highlight').when ('type', {is: "Category", 
            then: Joi.required()
            //otherwise: Joi.object({'category': //not exist//})
        }).trim(),
        'description': Joi.string().trim().required(),
        'price': Joi.number().when ('type', {is: "Product", 
            then: Joi.required()
        }),
        'image':Joi.object({
            'url': Joi.string().uri(),
            'container_url': Joi.string().uri(),
            'filename': Joi.string().uri({relativeOnly: true})
        }).xor('url', 'filename').xor('url', 'container_url')
    })
  },
  "inventory": {
    owner: true,
    collection: "inventory",
    schema: Joi.object({
        'status': Joi.string().valid('Required','InFactory', 'Cancel', 'Available').required(),
        'product': Joi.string().required(),
        'category': Joi.string().required(),
        'warehouse': Joi.string().required(),
        'qty': Joi.number().required()
    })
  },
  "orders": {
    owner: true,
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
        const cart = await ctx.db.collection(StoreDef["orders"].collection).findOne({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"})
        if (cart && cart.items) {
            const ref_products = await ctx.db.collection(StoreDef["products"].collection).find({ _id: { $in: [...new Set(cart.items.map(m => m.item._id))] }, partition_key: "TEST"}).toArray()
            const ref_products_map = ref_products.reduce((a,c) => Object.assign({},a,{ [String(c._id)]: c}),null)
            cart.items = cart.items.map(i => Object.assign(i, {item: ref_products_map[String(i.item._id)] || {_id: i.item._id, _error: 'missing item'}}))
        }
        return cart || {}
    },
    "get": async function (ctx, store, query, projection) {
        const s = StoreDef[store]
        if (!s) throw `unknown ${store}`

        let find_query = {...query, partition_key: "TEST"}
        if (store.onwer) {
            if (!ctx.session.auth.sub) throw `${store} requires signin`
            find_query["owner._id"] = ctx.session.auth.sub
        }
        const cursor  = ctx.db.collection(s.collection).find(find_query, projection? {projection}: null)

        if (s.split_types) {
            // setup response oject with empty arrarys with all possible values of 'type'
            let response = s.split_types.reduce((obj, a) => {return {...obj, [a]: []}}, {})
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
    "getOne": async function (ctx, store, query, projection) {
        const s = StoreDef[store]
        if (!s) throw `unknown ${store}`
        
        let find_query = {...query, partition_key: "TEST"}
        if (store.onwer) {
            if (!ctx.session.auth.sub) throw `${store} requires signin`
            find_query["owner._id"] = ctx.session.auth.sub
        }

        return await ctx.db.collection(s.collection).findOne(query, projection? {projection}: null)
    },
    // -------------------------------
    // componentFetch is my GraphQL :)
    // -------------------------------
    "componentFetch": async function (ctx, componentFetch, urlid) {
        let result = {}

        if (componentFetch) {

            let query = {partition_key: "TEST"}

            if (componentFetch.urlidField) {
                if (!urlid) throw "componentFetch requires urlid"
                if (componentFetch.urlidField === "recordid") {
                     query['_id'] = ObjectID(urlid)
                } else {
                    query[componentFetch.urlidField]= urlid
                }
            } 
            if (componentFetch.query) {
                query = {...componentFetch.query, ...query}
            }
            //console.log (`ssr componentFetch (${componentFetch.operation}): ${JSON.stringify(oppArgs)}`)]
            result.data = await FetchOperation[componentFetch.operation](ctx, componentFetch.store, query)
            if (componentFetch.refstores && componentFetch.refstores.length >0) {
                let fetch_promises = []
                for (let ref_store of componentFetch.refstores) {
                    console.log (`componentFetch: get refstore : ${ref_store}`)
                    fetch_promises.push(FetchOperation.get (ctx, ref_store))
                }
                result.refstores = (await Promise.all(fetch_promises)).reduce ((o, v, i) => { return {...o, [componentFetch.refstores[i]]: v}}, {})
            }
            return result
        } else return  Promise.resolve({})

    }
}

async function dbInit() {
    // ensure url encoded
    const murl = new URL (MongoURL)
    console.log (`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
    // !! IMPORTANT - Need to urlencode the Cosmos connection string
    const _db = client.db()
    // If Cosmos, need to pre-create the collections, becuse it enforces a partitioning strategy.
    
    for (let store of Object.keys(StoreDef)) {
        console.log (`ensuring partitioned collection created for [${store}]`)
        if (USE_COSMOS) {
            try { 
                const {ok, code, errMsg} = await _db.command({customAction: "CreateCollection", collection: StoreDef[store].collection, shardKey: "partition_key" })
                
                if (ok === 1) {
                    console.log ('success')
                } else {
                    throw new Error (errMsg)
                }
            } catch (err) {
                if (err.code !== 48) {
                    // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                    console.error (`Failed to create collection : ${err}`)
                    throw new Error (err.errMsg)
                }
            }
        } else {
            console.log ('createCollection')
            await _db.createCollection(StoreDef[store].collection)
        }
    }
    return _db
}

// Init Web
const app = new Koa();
app.use(bodyParser())

async function init() {
    // Init DB
    const db = app.context.db = await dbInit()

    // Init Sessions
    app.keys = ['secret']
    app.use(session({
        maxAge: 86400000,
        store: {
            get: async function(key) {
                console.log (`get ${key}`)
                return await db.collection(session_collection_name).findOne({_id: key, partition_key: "TEST"})
            },
            set: async function (key, sess, maxAge, { rolling, changed }) {
                console.log (`set ${key} ${JSON.stringify(sess)}`)
                await db.collection(session_collection_name).replaceOne({_id:  key, partition_key: "TEST"}, { ...sess, ...{_id:  key, partition_key: "TEST"}}, {upsert: true})
            },
            destroy: async function (key) {
                console.log (`destroy ${key}`)
                await db.collection(session_collection_name).deleteOne({_id:  key, partition_key: "TEST"})
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

    app.use(async (ctx, next) => {
        try {
          await next();
        } catch (err) {
          console.log ('got error')
          err.status = err.statusCode || err.status || 500;
          throw err;
        }
      });

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
        //console.log (`serving static resource  filePath=${filePath}`)

        if (fs.existsSync(filePath)) {
            ctx.response.body = fs.createReadStream(filePath)
        } else {
            ctx.throw(404, `${ctx.request.url} not found`)
        }
        next()
    })
    .routes()

async function getSession (ctx) {
    const cart = await ctx.db.collection(StoreDef["orders"].collection).findOne({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"}, {projection: {"items_count": true}})
    const cart_items = cart && cart.items_count || 0
    return {
        auth: ctx.session.auth ? { userid: ctx.session.auth.sub, given_name: ctx.session.auth.given_name} : undefined,
        cart_items
    }
}

// catchall middleware (ensure this this the LAST middleware to be used)
const catchall = async (ctx, next) => {
    if (!ctx._matchedRoute && !ctx.request.url.endsWith('.png')) {
        //console.log (`no route matched for [${ctx.request.url}], serve index.html to ${ctx.session.auth && ctx.session.auth.given_name}`)
        var filePath = path.join(__dirname, BUILD_PATH, 'index.html')

        // Get Iniitial Data
        const urlsplit = ctx.request.url.split('?', 2),
            startURL = {pathname: urlsplit[0], search: urlsplit.length>1 ? urlsplit[1] : null},
            {routekey, urlid } = server_ssr.pathToRoute (startURL),
            {requireAuth, componentFetch} = server_ssr.AppRouteCfg[routekey] || {}

        if (requireAuth && !ctx.session.auth) {
            ctx.redirect (`/connect/microsoft?surl=${encodeURIComponent(ctx.request.url)}`)
        } else {
            let initfetchfn = FetchOperation.componentFetch(ctx, componentFetch, urlid)

            // Parallel fetch
            const [serverInitialData, session] = await Promise.all([initfetchfn,  getSession(ctx)])
            const renderData = {ssrContext: "server", serverInitialData, session}
            
            // Get Initial DOM
            console.log (`Server -- Rendering HTML: ${JSON.stringify(serverInitialData)}`)
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
    next()
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
        ctx.redirect(`${app.context.openid_configuration.end_session_endpoint}?post_logout_redirect_uri=${encodeURIComponent('http://localhost:3000')}`)
        //ctx.redirect(ctx.query.surl || "/")
        next()
    })
    .get('/callback',async function (ctx, next) {
        const nonce = ctx.session.auth_nonce

        if (ctx.query.code) {
            delete ctx.session.auth_nonce
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
                const carts = await ctx.db.collection(StoreDef["orders"].collection).find({"owner._id": { $in: [ctx.session.auth.sub, ctx.session._id]}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"}).toArray(),
                    session_cart = carts.find(c => c.owner._id === ctx.session._id),
                    user_cart = carts.find(c => c.owner._id === ctx.session.auth.sub)
                
                console.log (`Looking for session car [${ctx.session._id}=${session_cart !== null}], and user cart [${ctx.session.auth.sub}=${user_cart !== null}]`)
                // if no session_cart - no nothing, else
                    // if no user_cart - update session cart to user cart, else,
                        // if both - add records from session cart to user_cart, remove session cart
                if (session_cart) {
                    if (!user_cart) {
                        const res = await ctx.db.collection(StoreDef["orders"].collection).updateOne({owner: {_id: ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"},{ $set: {owner_type:  "user", owner: {_id: ctx.session.auth.sub}}}, {upsert: false, returnOriginal: false, returnNewDocument: false})
                    } else {
                        // unfortunatly, this involves 2 operations, so not atomic, need to allow for cosmos ratelimiting
                        // NEED TO MAKE THIS IDEMPOTENT
                        await ctx.db.collection(StoreDef["orders"].collection).updateOne({owner: {_id: ctx.session.auth.sub}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"}, { $inc: {items_count: session_cart.items_count}, $push: { items: { $each: session_cart.items}}})
                        ctx.db.collection(StoreDef["orders"].collection).updateOne({owner: {_id: ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"}, { $set : {status: StoreDef["orders"].status.InactiveCart, status_reason: `Login-merged: into ${user_cart._id}`}})
                    }
                    
                }

                ctx.redirect(ctx.query.state || "/")
                
            } catch (e) {
                console.log (e)
                ctx.throw (400, e)
            } 
        } else {
            console.log (ctx.querystring)
            if (ctx.querystring.indexOf ('=access_denied')  > 0 && ctx.querystring.indexOf ('=AADB2C90118') > 0) {
                // &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconnect%2Fmicrosoft%2Fcallback&scope=openid&response_type=code&prompt=login
                ctx.redirect (`https://${b2c_tenant}.b2clogin.com/${b2c_tenant}.onmicrosoft.com/oauth2/v2.0/authorize?p=${passwd_reset_policy}&client_id=${client_id}&nonce=${nonce}&scope=openid&response_type=code&redirect_uri=${encodeURIComponent(`http://localhost:3000/connect/microsoft/callback`)}`)
            } else {
                ctx.throw (401, "no code")
            }
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
            const res = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, owner_type: ctx.session.auth ? "user": "session", status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"},{ $inc: {items_count: 1}, $push: { items: {_id: ObjectID(), item: {_id: ObjectID(value.itemid)}, options: value.options, qty: 1, line_total,  added: new Date()}}}, {upsert: true, returnOriginal: false, returnNewDocument: true})
             
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
            ctx.body = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"},{ $inc: {items_count: -1}, $pull: { 'items': {_id: ObjectID(ctx.params.itemid)}}})
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
                const order_seq =  await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({_id: "order-sequence-stage1", partition_key: "TEST"}, {$inc: {sequence_value:1}}, {upsert: true, returnOriginal: false, returnNewDocument: true})
                const order = await ctx.db.collection(StoreDef["orders"].collection).findOneAndUpdate({owner: {_id: ctx.session.auth ? ctx.session.auth.sub : ctx.session._id}, status: StoreDef["orders"].status.ActiveCart, partition_key: "TEST"},{ $set: {  order_number: 'ORD'+String(order_seq.value.sequence_value).padStart(5,'0'), status: StoreDef["orders"].status.NewOrder, owner: {_id: ctx.session.auth.sub}}})
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
    /* Only used when NOT using SSR */
    .get('/componentFetch/:component?/:urlid?', async function (ctx, next) {

        const 
            routekey = '/'+(ctx.params.component || ''),
            {requireAuth, componentFetch} = server_ssr.AppRouteCfg[routekey] || {}

        if (!componentFetch) {
            ctx.throw(404, `unknown componentFetch [${routekey}]`)
        } else {

            try {
                ctx.body = await FetchOperation.componentFetch(ctx, componentFetch, (ctx.params.urlid || null))
                await next()
            } catch (e) {
                ctx.throw(400, `cannot retreive componentFetch: ${e}`)
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
      let query = {partition_key: "TEST"}
      if (ctx.params.id) {
        query['_id'] = ObjectID(ctx.params.id)
        ctx.body = await FetchOperation.getOne(ctx, ctx.params.store, query)
      } else {
        query = {...(ctx.query.q ? JSON.parse(decodeURI(ctx.query.q)) : {}), ...query}// url param q is a mongo find query
        ctx.body = await FetchOperation.get(ctx, ctx.params.store, query)
      }
      await next()
		} catch (e) {
			ctx.throw(400, `cannot find ${ctx.params.store+':'+ctx.params.id}: ${e}`)
		}
	})
	// curl -XPOST "http://localhost:3000/products" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
	.post('/store/:store', async function (ctx, next) {
        try { 
            if (!ctx.request.body) throw `no body`

            const   {_id, ...body }  = ctx.request.body,
                    store = StoreDef[ctx.params.store]
            if (!ctx.session.auth) throw `unauthenticated`
            if (!store) throw `unknown store: ${ctx.params.store}`

            const {value, error} = store.schema.validate(body, {allowUnknown: false})

            if (error) throw `document not valid: ${error}`

            if (_id) {
                ctx.body =  await ctx.db.collection(store.collection).updateOne({_id: ObjectID(_id), partition_key: "TEST"}, 
                { $set: value }, {_id: ObjectID(_id), partition_key: "TEST"})
            } else {
                ctx.body =  await ctx.db.collection(store.collection).insertOne({...value, _id: ObjectID(), owner: {_id: ctx.session.auth.sub}, creation: Date.now(), partition_key: "TEST"})
            }
            await next()
        } catch (e) {
			ctx.throw(400, `cannot save ${ctx.params.store}: ${e}`)
		}
    })
    .delete ('/store/:store/:id', async function (ctx, next) {
        try {
            const store = StoreDef[ctx.params.store]

            if (!store) throw `unknown store: ${ctx.params.store}`

            ctx.body = await ctx.db.collection(store.collection).deleteOne({_id: ObjectID(ctx.params.id), partition_key: "TEST"})
            await next()
		} catch (e) {
			ctx.throw(400, `cannot find ${ctx.params.store+':'+ctx.params.id}: ${e}`)
		}
    })
    .put('/file', async function (ctx, next) {
        const userdoc = ctx.request.body
    
        if (!userdoc || !userdoc.filename) {
            ctx.throw(400, `No filename provided`)
        }


        function createServiceSAS (key, storageacc, container, minutes, file) {

            // first construct the string-to-sign from the fields comprising the request,
            // then encode the string as UTF-8 and compute the signature using the HMAC-SHA256 algorithm
            // Note that fields included in the string-to-sign must be URL-decoded
        
            let exp_date = new Date(Date.now() + (minutes*60*1000)),
                //  The permissions associated with the shared access signature 
                // (Blob: r=read, a=add, c=create, w=write,  d=delete)
                // (Container: r=read, a=add, c=create, w=write,  d=delete, l=list)
                signedpermissions = file? "racw" : "rl",
                signedstart = '',
                signedexpiry= exp_date.toISOString().substring(0, 19) + 'Z',
                // for Blob or Container level Signed Resoure
                canonicalizedresource= file?  `/blob/${storageacc}/${container}/${file}` : `/blob/${storageacc}/${container}`,
                signedidentifier = '', //if you are associating the request with a stored access policy.
                signedIP = '',
                signedProtocol = 'https',
                signedversion = '2018-03-28',
                rscc = '', // Blob Service and File Service Only, To define values for certain response headers, Cache-Control
                rscd = '', // Content-Disposition
                rsce = '', // Content-Encoding
                rscl = '', // Content-Language
                rsct = '', // Content-Type
                stringToSign = 
                    signedpermissions + "\n" +
                    signedstart + "\n" +
                    signedexpiry + "\n" +
                    canonicalizedresource + "\n" +
                    signedidentifier + "\n" +
                    signedIP + "\n" +
                    signedProtocol + "\n" +
                    signedversion + "\n" +
                    rscc + "\n" +
                    rscd + "\n" +
                    rsce + "\n" +
                    rscl + "\n" +
                    rsct
        
            // create the string, then encode the string as UTF-8 and compute the signature using the HMAC-SHA256 algorithm
            const sig = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(stringToSign, 'utf-8').digest('base64');
            //console.log (`createServiceSAS stringToSign : ${stringToSign}`)
            return { 
                exp_date: exp_date.getTime(),
                container_url: `https://${storageacc}.blob.core.windows.net/${container}`, 
                sas: 
                    //`st=2016-08-15T11:03:04Z&" +
                    // signed expire 2017-08-15T19:03:04Z
                    `se=${encodeURIComponent(signedexpiry)}&` + 
                    //  The permissions associated with the shared access signature
                    `sp=${signedpermissions}&` + 
                    // API Version
                    `sv=${signedversion}&` +  
                    // The signedresource (sr) field specifies which resources are accessible via the shared access signature
                    // signed resource 'c' = the shared resource is a Container (and to the list of blobs in the container) 'b' = the shared resource is a Blob
                    `sr=${file ? "b" : "c"}&` +   
        
                    //    "sip=0.0.0.0-255.255.255.255&" +
                    // The Protocal (https)
                    `spr=${signedProtocol}&` +
                    `sig=${encodeURIComponent(sig)}`
            }
        }

        const fileprefix = encodeURIComponent(userdoc.filename.substring(userdoc.filename.lastIndexOf(".")))
        const filename = 'products' + '/' + (new ObjectID ()).toString() + fileprefix
        const retsas = createServiceSAS (process.env.STORAGE_MASTER_KEY, process.env.STORAGE_ACCOUNT, process.env.STORAGE_CONTAINER, 10, filename)
        ctx.body =  Object.assign({filename}, retsas)
        await next()
    })
    .all('/*', async function (ctx, next) {
        if (!ctx._matchedRoute) {
            ctx.throw(404, `no api found ${ctx.request.url}`)
        }
    })
    .routes()

// Run Server
init()