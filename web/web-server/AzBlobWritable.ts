import * as crypto from 'crypto'
import fetch from './server_fetch.js'

export function createServiceSAS(key, storageacc, container, minutes, file?) {

    // first construct the string-to-sign from the fields comprising the request,
    // then encode the string as UTF-8 and compute the signature using the HMAC-SHA256 algorithm
    // Note that fields included in the string-to-sign must be URL-decoded

    let exp_date = new Date(Date.now() + (minutes * 60 * 1000)),
        //  The permissions associated with the shared access signature 
        // (Blob: r=read, a=add, c=create, w=write,  d=delete)
        // (Container: r=read, a=add, c=create, w=write,  d=delete, l=list)
        signedpermissions = file ? "racw" : "rl",
        signedstart = '',
        signedexpiry = exp_date.toISOString().substring(0, 19) + 'Z',
        // for Blob or Container level Signed Resoure
        canonicalizedresource = file ? `/blob/${storageacc}/${container}/${file}` : `/blob/${storageacc}/${container}`,
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

// Provides a FlushWritable class which is used exactly like stream.Writable but supporting a new _flush method 
// which is invoked after the consumer calls .end() but before the finish event is emitted.

import { Stream } from 'stream'
const BLOCK_SIZE = 4 * 1024 * 1024 // 4MB blocks

export class AzBlobWritable extends Stream.Writable {
    saslocator: string;
    pathname: string;
    filetype: string;
    blockBuffer: Buffer;
    blockBuffer_length: number;
    currblock: number;
    sendblockids: string[];
    totalbytes: number;

    
    constructor({ pathname, container_url, sas, extension }, options = {}) {
        super(options)
        this.saslocator = `${container_url}/${pathname}?${sas}`
        this.pathname = pathname
        this.filetype = 'image/' + extension
        // fixed-sized, raw memory allocations outside the V8 heap, size =  bytes
        this.blockBuffer = Buffer.allocUnsafe(BLOCK_SIZE)
        this.blockBuffer_length = 0
        this.currblock = 0
        this.sendblockids = []
        this.totalbytes = 0
    }

    _write(chunk, encoding, done) {
        // done for when this chunk of data is flushed. The return value indicates if you should continue writing right now
        // Once the done is invoked, the stream will emit a 'drain' event
        let space_left = BLOCK_SIZE - this.blockBuffer_length,
            chunk_to_copy = Math.min(space_left, chunk.length),
            chunk_remaining = chunk.length - chunk_to_copy

        this.totalbytes += chunk.length
        //          target, begin target offset (def:0), chunk start, chunk end (not inclusive): (def: chunk.length)
        chunk.copy(this.blockBuffer, this.blockBuffer_length, 0, chunk_to_copy)
        this.blockBuffer_length = this.blockBuffer_length + chunk_to_copy
        //console.log (`[processed ${this.totalbytes}]  copy current buffer length ${this.blockBuffer_length},  chunk.length ${chunk.length}, chunk copied ${chunk_to_copy}, chunk remaining ${chunk_remaining}`)

        if (this.blockBuffer_length < BLOCK_SIZE) {
            // blockBuffer got space_left
            done() // send done data (add a error string if error)
        } else {
            // blockBuffer
            let blockid = this.pathname + ('0000' + this.currblock++).slice(-4)
            this.sendblockids.push(blockid)
            console.log(`putting block (${this.sendblockids.length}) ${blockid}`)



            fetch(`${this.saslocator}&comp=block&blockid=${Buffer.from(blockid).toString('base64')}`, 'PUT', {
                "x-ms-blob-content-type": this.filetype,
                "x-ms-version": "2018-03-28"
            }, this.blockBuffer.slice(0, this.blockBuffer_length))

                //.catch(err => {
                //    console.error(`AzBlobWritable _write caught: ${err}`)
                //    done(new Error(err))
                //})
                .then(() => {
                    this.blockBuffer_length = 0
                    if (chunk_remaining > 0) {
                        // got remainder to copy
                        //console.log (`copying remaining, target start idx: ${this.blockBuffer_length},  chunk start idx: ${chunk_to_copy}, chunk end idx: ${chunk.length}`)
                        chunk.copy(this.blockBuffer, this.blockBuffer_length, chunk_to_copy, chunk.length)
                        this.blockBuffer_length = chunk_remaining
                        //console.log (`copying remaining, buffer new length ${this.blockBuffer_length},  chunk.length ${chunk.length}, chunk copied ${chunk_remaining}`)
                    }
                    done() // send done data (add a error string if error)
                }, (err) => {
                    console.error(`AzBlobWritable _write reject: ${err}`)
                    done(new Error(err))
                })
        }
    }

    _final(done) {

        const finalBlockFn = () => {
            return fetch(
                `${this.saslocator}&comp=blocklist`, 'PUT', {
                "content-type": "application/xml",
                "x-ms-blob-content-type": this.filetype,
                "x-ms-version": "2018-03-28",
            },
                '<?xml version="1.0" encoding="utf-8"?>' +
                '<BlockList>' + this.sendblockids.map((l) => `<Latest>${Buffer.from(l).toString('base64')}</Latest>`).join('') +
                '</BlockList>'
            )
        }

        if (this.blockBuffer_length > 0) {

            let blockid = this.pathname + ('0000' + this.currblock++).slice(-4)
            this.sendblockids.push(blockid)
            console.log(`AzBlobWritable _final putting block (${this.sendblockids.length})b ${blockid}`)

            fetch(
                `${this.saslocator}&comp=block&blockid=${Buffer.from(blockid).toString('base64')}`,
                'PUT', {
                "x-ms-blob-content-type": this.filetype,
                "x-ms-version": "2018-03-28"
            }, this.blockBuffer.slice(0, this.blockBuffer_length))
                //    .catch(err => {
                //        console.error(`AzBlobWritable _final caught: ${err}`)
                //        done(new Error(err))
                //    })
                .then(() => {
                    console.log(`AzBlobWritable _final success, now finalBlock`)
                    finalBlockFn()
                        //    .catch(err => {
                        //        console.error(`AzBlobWritable _final finalBlockFn caught: ${err}`)
                        //        done(new Error(err))
                        //    })
                        .then(() => {
                            console.log(`AzBlobWritable _final finalBlockFn success`)
                            done()
                        }, (err) => {
                            console.error(`AzBlobWritable _final finalBlockFn reject: ${err}`)
                            done(new Error(err))
                        })
                }, (err) => {
                    console.error(`AzBlobWritable _final reject: ${err}`)
                    done(new Error(err))
                })

        } else {
            console.log(`AzBlobWritable _final finalBlockFn only`)
            finalBlockFn()
                //.catch(err => {
                //    console.error(`AzBlobWritable _final finalBlockFn caught: ${err}`)
                //    done(new Error(err))
                //})
                .then(() => {
                    console.log(`AzBlobWritable _final finalBlockFn success`)
                    done()
                }, (err) => {
                    console.error(`AzBlobWritable _final finalBlockFn reject: ${err}`)
                    done(new Error(err))
                })
        }
    }
}
