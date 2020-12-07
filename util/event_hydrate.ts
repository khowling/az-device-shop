const assert = require('assert')
const fs = require('fs')

export async function rollForwardState(ctx, collection_event: string, from_seq: number, applyfn): Promise<number> {

    let processed_seq = from_seq
    console.log(`rollForwardState: reading 'factory_events' from database from seq#=${from_seq}`)

    await ctx.db.collection(collection_event).createIndex({ sequence: 1 })
    const inflate_events = await ctx.db.collection(collection_event).aggregate(
        [
            { $match: { $and: [{ "partition_key": ctx.tenent.email }, { sequence: { $gt: from_seq } }] } },
            { $sort: { "sequence": 1 } }
        ]
    ).toArray()

    if (inflate_events && inflate_events.length > 0) {
        console.log(`rollForwardState: replaying from seq#=${inflate_events[0].sequence}, to seq#=${inflate_events[inflate_events.length - 1].sequence}  to state`)
        const ret_processor = []
        // HOW??? TODO
        for (let i = 0; i < inflate_events.length; i++) {

            const { _id, sequence, partition_key, ...eventdata } = inflate_events[i]
            assert(sequence === processed_seq + 1, `rollForwardState: expected seq=${processed_seq + 1}, got ${sequence}`)
            applyfn(eventdata)
            processed_seq = sequence
        }
    }
    return processed_seq
}


export async function returnLatestSnapshot(ctx, chkdir: string): Promise<any> {
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
        return await JSON.parse(fs.promises.readFile(dir + '/' + latestfile.filename, 'UTF-8'))

        //this.state = FactoryStateManager.deserializeState(state_snapshot)
        //return rest
    } else {
        console.log(`No checkpoint found, start from 0`)
        return {}

    }
}

export async function snapshotState(ctx, chkdir: string, sequence_snapshot: number, state_snapshot: any, processor_snapshot: any): Promise<any> {
    const now = new Date()
    const filename = `${chkdir}/${ctx.tenent.email}/${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${('0' + now.getDate()).slice(-2)}-${('0' + now.getHours()).slice(-2)}-${('0' + now.getMinutes()).slice(-2)}-${('0' + now.getSeconds()).slice(-2)}--${this.state.sequence}.json`
    console.log(`writing movement ${filename}`)
    await fs.promises.writeFile(filename, JSON.stringify({
        sequence_snapshot,
        state_snapshot, //: this.serializeState,
        processor_snapshot, //: processor_snapshot
    }))
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






