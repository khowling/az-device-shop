const Koa = require('koa'),
	  Router = require('koa-router'),
	  KoaBody = require('koa-body'),
	  Joi = require('@hapi/joi')

const {MongoClient, ObjectID} = require('mongodb')
const MongoURL = process.env.MONGO_DB
const MongoDB = 'dbdev'
const USE_COSMOS = true

const app = new Koa();

const collecionArray = [
	{
		name: "products",
		collection: "products",
		schema: Joi.object({
			heading: Joi.string().trim().required(),
			
			//partition_key: Joi.string().trim().required()
		})
	}
]


async function dbInit() {
	
	async function create_cosmos_collections (db, dbname) {
		for (let mc of collecionArray) {
			console.log (`creating cosmos ${mc.name} -  ${dbname}.${mc.collection}`)
			try { 
				// "shardKey": { "user_id": "Hash" },
				// "indexes": [
				// 	{
				// 		"key": { "keys":["user_id", "user_address"] },
				// 		"options": { "unique": "true" }
				// 	},
				// 	{
				// 		"key": { "keys":["_ts"] },
				// 		"options": { "expireAfterSeconds": "2629746" }
				// 	}
				// ],
				// "options": {
				// 	"If-Match": "<ETag>"
				// }

				await db.command({ shardCollection: `${dbname}.${mc.collection}`, key: { partition_key:  "hashed" }})
			} catch (err) {
				// allow gracefull error, as this will throw if collection already exists!
				//console.log (err)
			}
		}
	}

	// ensure url encoded
	const murl = new URL (MongoURL)
	console.log (`connecting with ${murl.toString()}`)
    const client = await MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
  
    //_dbname = url.parse(MongoURL).pathname.substr(1)
    _db = client.db(MongoDB)

    // The keyword await makes JavaScript wait until that promise settles and returns its result.
    if (USE_COSMOS) {
        console.log (`ensuring collections are created`)
        // session
        try { 
            // create all MetaData collections
            await create_cosmos_collections(_db, MongoDB)
        } catch (err) {
            console.error (err)
            // allow gracefull error, as this will throw if collection already exists!
            //process.exit(1)
        }
    }
    return _db
}


async function init() {
	app.context.db = await dbInit()
	console .log (`listending on 3001`)
	app.listen(3001)
}

// https://github.com/ria-com/node-koajs-rest-skeleton/blob/master/app/controllers/indexController.js

app.use(new Router({prefix: '/api'})
	.get('/products',  async function (ctx, next) {
		ctx.body = await ctx.db.collection('products').find({}).toArray()
		//ctx.body = ctx.db.collection('products').find({}).stream()
		await next()
	})
	.get('/products/:id',    async function (ctx, next) {
	  try {
		  ctx.body = await ctx.db.collection('products').findOne({_id: ObjectID(ctx.params.id), partition_key: "P1"})
    } catch (e) {
      ctx.throw(400, `Unknown id ${ctx.params.id}`)
    }
    await next()
	})
	// curl -XPOST "http://localhost:3000/products" -d '{"name":"New record 1"}' -H 'Content-Type: application/json'
	.post('/products/',      KoaBody(), async function (ctx, next) {
		const {value, error} = collecionArray[0].schema.validate(ctx.request.body, {allowUnknown: true})
		if (!error) {
			ctx.body = await ctx.db.collection('products').insertOne({...value, partition_key: "P1"})
			ctx.status = 201;
		} else {
			ctx.throw(400, {error})
		}
		await next();
	})
	.put('/products/:id',    KoaBody(), async function (ctx, next) {
		// findOneAndUpdate ??
	})
	.delete('/products/:id', async function (ctx, next) {
		// TBC
	}).routes()
)

// app.use(async ctx => {
// 	  ctx.body = 'Hello World';
// });


init()