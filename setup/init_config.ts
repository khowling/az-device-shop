import * as mongoDB from "mongodb";
import { ObjectId } from 'bson'

import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from "@azure/storage-blob"

const AZURITE_STORAGE_MASTER_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw=='
const AZURITE_ACCOUNT = 'devstoreaccount1'

const storeHost =  process.env.STORAGE_ACCOUNT ?  `https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net` : `http://127.0.0.1:10000/${process.env.AZURITE_ACCOUNT}`
const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
  
const sharedKeyCredential = new StorageSharedKeyCredential(process.env.STORAGE_ACCOUNT || AZURITE_ACCOUNT, process.env.STORAGE_MASTER_KEY || AZURITE_STORAGE_MASTER_KEY)

const blobServiceClient = new BlobServiceClient(storeHost, sharedKeyCredential)
app.context.sharedKeyCredential = sharedKeyCredential
app.context.containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER)


function getFileClient(containerClient : ContainerClient, store : string, filename: string) : BlockBlobClient {
    const extension = encodeURIComponent(filename.substring(1 + filename.lastIndexOf(".")))
    const pathname = `${store}/${(new ObjectId()).toString()}.${extension}`

    return containerClient.getBlockBlobClient(pathname);
}

async function writeimages(containerClient: ContainerClient, new_tenent, images: any) {
    let imagemap = new Map()
    for (const pathname of Object.keys(images)) {

        import { Readable } from 'stream';

        const b64 = Buffer.from(images[pathname], 'base64'),
            bstr = b64.toString('utf-8'),
            file_stream = Readable.from(b64),
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

    }
    return imagemap
}

import { images, products }  from './bikes.json'
import { TenentContext } from "../shop/ui/src/GlobalContexts";

async function populateTenent(db: mongoDB.Db) { 

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



const tenent_key = 'root'
interface TenentContext {
    name: string;
    image: { url: string };
    inventory: boolean;
    catalog: string;
}

const tenent_def: TenentContext = {
    name: process.argv[2] || "Developer Local Test Store",
    image: { url: process.argv[3] || 'https://assets.onestore.ms/cdnfiles/onestorerolling-1511-11008/shell/v3/images/logo/microsoft.png' },
    inventory: true,
    catalog: 'bike'
}



function main(): void {
    try {
        const client: mongoDB.MongoClient = new mongoDB.MongoClient(process.env.DB_CONN_STRING || 'mongodb://localhost:27017/azshop');
        await client.connect();
        const db: mongoDB.Db = client.db(process.env.DB_NAME);
        console.log('Connected to the database, creating local developer tenent');
        
        
        console.log(`tear down existing config`)
        await db.collection('business').deleteMany({partition_key: tenent_key })

    
        // Create new details.
        const new_tenent = await db.collection('business').insertOne({ ...tenent_def, type: "business", partition_key: tenent_key })
        
        // Perform database operations here
        await populateTenent(db);

    } catch (error) {
        console.error('Error connecting to the database:', error);
    } finally {
        await client.close();
        console.log('Disconnected from the database');
    }
}

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
}

