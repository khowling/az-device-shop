import https from 'https'
import http from 'http'

export default function (url: string, method = 'GET', headers = {}, body?): Promise<any> {

    let opts: any = { method }, req_body
    if (body) {
        if (typeof body === 'object' && !headers['x-ms-blob-content-type']) {
            req_body = JSON.stringify(body)
            opts.headers = {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(req_body),
                ...headers
            }
        } else {
            req_body = body
            opts.headers = {
                'content-length': Buffer.byteLength(req_body),
                ...headers
            }
        }
    }

    return new Promise(function (resolve, reject) {

        const req_callback = (res) => {

            if (res.statusCode !== 200 && res.statusCode !== 201) {
                let error = new Error(`Request Failed: Status Code: ${res.statusCode}`)
                //console.error(error.message)
                // Consume response data to free up memory
                res.resume();
                //throw new Error(error)
                reject(error.message)
            } else {

                // required to process binary image data into base64
                const contentType = res.headers['content-type']
                if (/^image/.test(contentType)) {
                    res.setEncoding('binary')
                }

                // collect the data chunks
                var strings: Array<string> = []
                res.on('data', function (chunk: any) {
                    strings.push(chunk)
                })
                res.on('end', () => {

                    if (strings.length === 0) {
                        resolve("")
                    } else {

                        let body = strings.join('')
                        if (/^application\/json/.test(contentType)) {

                            try {
                                const parsedData = JSON.parse(body)
                                return resolve(parsedData)
                            } catch (e) {
                                console.error(`server_fetch: ${e}`)
                                reject(e)
                            }
                        } else if (/^application\/xml/.test(contentType)) {
                            return resolve(body)
                        } else if (/^image/.test(contentType)) {
                            return resolve(Buffer.from(body, 'binary').toString('base64'))
                        } else {
                            return reject(`Unknown content-type : ${contentType}`)
                        }
                    }
                })
            }
        }

        let req;
        if (url.startsWith('http://')) {
            req = http.request(url, opts, req_callback).on('error', (e) => {
                console.error(`server_fetch: ${e.message}`)
                reject(e.message)
            })
        } else {
            req = https.request(url, opts, req_callback).on('error', (e) => {
                console.error(`server_fetch: ${e.message}`)
                reject(e.message)
            })
        }

        if (opts.method === 'POST' || opts.method === 'PUT') {
            // Write data to request body
            req.end(req_body)
        } else {
            req.end()
        }

    })
}