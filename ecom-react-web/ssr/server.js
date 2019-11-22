const Koa = require('koa'),
    Router = require('koa-router'),
    https = require('https'),
    bodyParser = require('koa-bodyparser'),
    session = require('koa-session')

const app = new Koa();
app.use(bodyParser())

const {MongoClient, ObjectID} = require('mongodb'),
    MongoURL = process.env.MONGO_DB,
    dbname = 'dbdev',
    session_collection_name = 'koa-sessions',
    USE_COSMOS = true

async function dbInit(dbname) {
    // ensure url encoded
    const murl = new URL (MongoURL)
    console.log (`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })

    //_dbname = url.parse(MongoURL).pathname.substr(1)
    let _db = client.db(dbname)

    // The keyword await makes JavaScript wait until that promise settles and returns its result.
    if (USE_COSMOS) {
        console.log (`ensuring collections are created`)
        // session
        try { 
            // create all MetaData collections
            const {ok, code, errMsg} = await _db.command({customAction: "CreateCollection", collection: session_collection_name, shardKey: "partition_key" })
            if (ok === 1) {
                console.log ('success')
            } else {
                throw new Error (err.errMsg)
            }
        } catch (err) {
            if (err.code !== 117) {
                // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                console.error (`Failed to create collection : ${err}`)
                throw new Error (err.errMsg)
            }
        }
    }
    return _db
}

async function init() {
    const db = app.context.db = await dbInit(dbname)
    // Sessions
    app.keys = ['secret']
    app.use(session({store: {
        get: async function(key) {
            console.log (`get ${key}`)
            return await db.collection(session_collection_name).findOne({_id: key, partition_key: "P1"})
        },
        set: async function (key, sess, maxAge, { rolling, changed }) {
            console.log (`set ${key} ${JSON.stringify(sess)}`)
            await db.collection(session_collection_name).insertOne({_id:  key, ...sess, partition_key: "P1"})
        },
        destroy: async function (key) {
            console.log (`destroy ${key}`)
            await db.collection(session_collection_name).deleteOne({_id:  key, ...sess, partition_key: "P1"})
        }
    }}, app))
    // routes
    app.use(ssrserver)
    app.use(authroutes)
    app.use(catchall)

	console .log (`starting on 3000..`)
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
    .get ('/api/*', async function (ctx, next) {
        console.log (`api before next`)
        ctx.body = "api"
        next()
        console.log (`api after next`)
    })
    .routes()

// Server Side Rendering  catchall middleware
const catchall = async ctx => {
    console.log (`route matched : ${ctx._matchedRoute}`)
    if (!ctx._matchedRoute) {
        console.log (`no route matched, serve index.html to ${ctx.session.given_name}`)
        var filePath = path.join(__dirname, BUILD_PATH, 'index.html')

        // Get Iniitial Data
        const urlsplit = ctx.request.url.split('?', 2),
        startURL = {pathname: urlsplit[0], search: urlsplit.length>1 ? urlsplit[1] : null},
        {routekey, recordid } = server_ssr.pathToRoute (startURL),
        {initialFetch} = server_ssr.AppRouteCfg[routekey] || {}

        let initialData ={}
        if (initialFetch) {
            initialData = await fetch(initialFetch.collection, recordid)
        }
        const renderData = {ssrContext: "server", serverInitialData: initialData, auth: {loggedon: (ctx.session.given_name), given_name: ctx.session.given_name}}

        // Get Initial DOM
        console.log (`Server -- Rendering HTML`)
        const reactContent = server_ssr.ssrRender(startURL, renderData)

        // SEND
        reactContent.ssrContext="hydrate"
        ctx.response.type = 'text/html'
        ctx.body = fs.createReadStream(filePath)
            .pipe(stringReplaceStream('<div id="root"></div>', `<div id="root">${reactContent}</div>`))
            .pipe(stringReplaceStream('SERVER_INITAL_DATA', JSON.stringify(renderData)))
            //   .pipe(stringReplaceStream('%PUBLIC_URL%', PublicREF))
    }
}


// ----------------------------------------------------------- AUTH
const jwkToPem = require('jwk-to-pem'),
      jws = require ('jws')

const client_id = process.env.B2C_CLIENT_ID 
const b2c_tenant = process.env.B2C_TENANT 
const signin_policy = process.env.B2C_POLICY 
const client_secret = encodeURIComponent(process.env.B2C_CLIENT_SECRET)

const authroutes = new Router({prefix: "/connect/microsoft"})
    .get('/',async function (ctx, next) {
        ctx.redirect(`https://${b2c_tenant}.b2clogin.com/${b2c_tenant}.onmicrosoft.com/${signin_policy}/oauth2/v2.0/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:3000/connect/microsoft/callback')}&scope=openid&response_type=code${ ctx.query.state ? "&state="+encodeURIComponent(ctx.query.state) : ""}`)
        next()
    })
    .get('/callback',async function (ctx, next) {
        
        if (ctx.query.code) {
            try { 
                const flow_body = `client_id=${client_id}&client_secret=${client_secret}&scope=openid&code=${encodeURIComponent(ctx.query.code)}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(`http://localhost:3000/connect/microsoft/callback`)}`
                const payload = await new Promise((resolve, reject) => {
                    let token_req = https.request({
                        hostname: `${b2c_tenant}.b2clogin.com`,
                        path: `/${b2c_tenant}.onmicrosoft.com/${signin_policy}/oauth2/v2.0/token`,
                        method: 'POST',
                        headers: {
                            'Content-Type': "application/x-www-form-urlencoded",
                            'Content-Length': Buffer.byteLength(flow_body)
                        }
                    }, (res) => {
                        let rawData = ''
                        res.on('data', (chunk) => {
                            rawData += chunk
                        })
        
                        res.on('end', () => {
                            if(!(res.statusCode === 200 || res.statusCode === 201)) {
                                reject (`${res.statusCode}:  ${rawData}`)
                            } else {
                                let {access_token, id_token } = JSON.parse(rawData)
                                // Validated the signature of the ID token
                                // https://docs.microsoft.com/en-us/azure/active-directory-b2c/active-directory-b2c-reference-oidc#validate-the-id-token
                                // https://docs.microsoft.com/en-us/azure/active-directory/develop/access-tokens#validating-the-signature
                                // Azure AD B2C has an OpenID Connect metadata endpoint, which allows an application to get information about Azure AD B2C at runtime. This information includes endpoints, token contents, and token signing keys
                                // https://khb2c2.b2clogin.com/khb2c2.onmicrosoft.com/B2C_1_V2_Sign_in_up/v2.0/.well-known/openid-configuration
                                
                                // https://khb2c2.b2clogin.com/khb2c2.onmicrosoft.com/b2c_1_v2_sign_in_up/discovery/v2.0/keys
                                const b2ckeys = {"kid":"X5eXk4xyojNFum1kl2Ytv8dlNP4-c57dO6QGTVBwaNk","nbf":1493763266,"use":"sig","kty":"RSA","e":"AQAB","n":"tVKUtcx_n9rt5afY_2WFNvU6PlFMggCatsZ3l4RjKxH0jgdLq6CScb0P3ZGXYbPzXvmmLiWZizpb-h0qup5jznOvOr-Dhw9908584BSgC83YacjWNqEK3urxhyE2jWjwRm2N95WGgb5mzE5XmZIvkvyXnn7X8dvgFPF5QwIngGsDG8LyHuJWlaDhr_EPLMW4wHvH0zZCuRMARIJmmqiMy3VD4ftq4nS5s8vJL0pVSrkuNojtokp84AtkADCDU_BUhrc2sIgfnvZ03koCQRoZmWiHu86SuJZYkDFstVTVSR0hiXudFlfQ2rOhPlpObmku68lXw-7V-P7jwrQRFfQVXw"}
                                const pem = jwkToPem(b2ckeys)
                                
                                const [head, payload, sig] =  id_token.split('.').map ((t,i) => i < 2 ? JSON.parse(Buffer.from (t, 'base64').toString()) : t)
                                
                                console.log (`id_token head: ${JSON.stringify(head)}`)
                                console.log (`id_token payload: ${JSON.stringify(payload)}`)

                                ctx.assert(head.kid === b2ckeys.kid, 401, 'directory keys out of date')
                                const jwtvalid = jws.verify(id_token, head.alg, pem)

                                if (!jwtvalid || payload.aud !== client_id) {
                                    reject ("Invalid JWT token")
                                } else {
                                    resolve(payload)
                                }
                            }
                        })
                    }).on('error', (e) => reject (`500: ${e}`))
                    token_req.write(flow_body)
                    token_req.end()
                })

                ctx.session.given_name = payload.given_name
                ctx.redirect(`http://localhost:3000${ ctx.query.state ? encodeURIComponent(ctx.query.state) : ""}`)

            } catch (e) {
                ctx.throw (500, e)
            }
        } else {
            ctx.throw (401, "no code")
        }

    })
    .routes()


init()