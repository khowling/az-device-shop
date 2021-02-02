const assert = require('assert')
const fs = require('fs')

import { StateStore } from './flux'

export async function rollForwardState({ db, tenent }, collection: string, from_sequence: number, stateStores: StateStore[]): Promise<number> {

    let processed_seq = from_sequence
    console.log(`rollForwardState: reading 'factory_events' from database from seq#=${from_sequence}`)

    const stateStoreByName: { [key: string]: StateStore } = stateStores.reduce((acc, i) => { return { ...acc, [i.name]: i } }, {})

    await db.collection(collection).createIndex({ sequence: 1 })
    const cursor = await db.collection(collection).aggregate([
        { $match: { $and: [{ "partition_key": tenent.email }, { sequence: { $gt: from_sequence } }] } },
        { $sort: { "sequence": 1 } }
    ])

    while (await cursor.hasNext()) {
        const { _id, partition_key, sequence, ...changedata } = await cursor.next()

        for (let key of Object.keys(changedata)) {

            if (stateStoreByName.hasOwnProperty(key)) {
                stateStoreByName[key].apply(changedata[key])
            }
        }
        processed_seq = sequence
    }
    return processed_seq

}


export async function restoreLatestSnapshot(ctx, chkdir: string, stateStores: StateStore[]): Promise<number> {
    const dir = `${chkdir}/${ctx.tenent.email}`
    await fs.promises.mkdir(dir, { recursive: true })
    let latestfile = { fileseq: null, filedate: null, filename: null }
    const checkpoints = await fs.promises.readdir(dir)
    const filename_re = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})-(\\d{2})-(\\d{2})-(\\d).json`)
    for (let dir_entry of checkpoints) {
        const entry_match = dir_entry.match(filename_re)
        if (entry_match) {
            const [filename, year, month, day, hour, minute, second, fileseq] = entry_match

            if (latestfile.fileseq === null || latestfile.fileseq < fileseq) {
                latestfile = { fileseq, filedate: new Date(year, month - 1, day, hour, minute, second), filename }
            }
        }
    }

    if (latestfile.filename) {
        console.log(`Loading checkpoint seq#=${latestfile.fileseq} from=${latestfile.filename}`)
        //const { state_snapshot, ...rest } = 
        const body = await JSON.parse(fs.promises.readFile(dir + '/' + latestfile.filename, 'UTF-8'))

        const stateStoreByName: { [key: string]: StateStore } = stateStores.reduce((acc, i) => { return { ...acc, [i.name]: i } }, {})

        const { event_seq, ...snapshotdata } = body

        for (let key of Object.keys(snapshotdata)) {
            if (stateStoreByName.hasOwnProperty(key)) {
                stateStoreByName[key].deserializeState(snapshotdata[key])
            }
        }

        return event_seq
    } else {
        console.log(`No checkpoint found, start from 0`)
        return 0

    }
}

export async function snapshotState(ctx, chkdir: string, event_seq: number, stateMutex, stateStores: StateStore[]): Promise<any> {
    const now = new Date()
    let release = await stateMutex.aquire()
    const filename = `${chkdir}/${ctx.tenent.email}/${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${('0' + now.getDate()).slice(-2)}-${('0' + now.getHours()).slice(-2)}-${('0' + now.getMinutes()).slice(-2)}-${('0' + now.getSeconds()).slice(-2)}--${event_seq}.json`
    console.log(`writing movement ${filename}`)

    await fs.promises.writeFile(filename, JSON.stringify({
        event_seq,
        ...stateStores.reduce((acc, i) => { return { ...acc, [i.name]: i.serializeState } }, {})
    }))

    release()
    //return this.state.sequence
}


/* ////////////////////////////////////////////////////// AZURE STORAGE  //////////////
import {
    BlobServiceClient,
    StorageSharedKeyCredential,
    BlobDownloadResponseModel
} from "@azure/storage-blob";
import { callbackify } from "util"

function getBlobClient() {
    console.log(`looking for saved starting point ${process.env.STORAGE_ACCOUNT}`)
    const sharedKeyCredential = new StorageSharedKeyCredential(process.env.STORAGE_ACCOUNT, process.env.STORAGE_MASTER_KEY)
    const blobServiceClient = new BlobServiceClient(`https://${process.env.STORAGE_ACCOUNT}.blob.core.windows.net`, sharedKeyCredential)
    const containerClient = blobServiceClient.getContainerClient(process.env.STORAGE_CONTAINER)

    //const createContainerResponse = await containerClient.create();
    console.log(`Create container ${process.env.STORAGE_CONTAINER} successfully`);
    const blobClient = containerClient.getBlockBlobClient(process.env.STORAGE_CHECKPOINT_FILE);
    return blobClient
}
async function getLatestOrderingState_AzureBlob(ctx) {

    const blobClient = getBlobClient()
    try {
        let res1: Buffer = await blobClient.downloadToBuffer()
        ordering_state = JSON.parse(res1.toString())
    } catch (e) {
        console.error(e)
    }
}

async function orderCheckpoint_AzureBlob(ctx) {
    // Create a blob
    const blobClient = getBlobClient()

    const content = "hello";
    const uploadBlobResponse = await blobClient.upload(content, Buffer.byteLength(content));
    console.log(`Upload block blob successfully`, uploadBlobResponse.requestId);

}
*/ //////////////////////////////////////////////////////////////////////////////////////////






