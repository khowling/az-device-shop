const https = require('https')
const http = require('http')

module.exports = function (url, method = 'GET', headers = {}, body) {

    let opts = { method }, req_body
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


    let http_s = https
    if (url.startsWith('http://')) http_s = http
    return new Promise(function (resolve, reject) {
        const req = http_s.request(url, opts, (res) => {

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
                var strings = []
                res.on('data', function (chunk) {
                    strings.push(chunk)
                })
                res.on('end', () => {

                    if (strings.length === 0) {
                        resolve()
                    } else {

                        let body = strings.join('')
                        if (/^application\/json/.test(contentType)) {

                            try {
                                const parsedData = JSON.parse(body)
                                resolve(parsedData)
                            } catch (e) {
                                console.error(`server_fetch: ${e}`)
                                reject(e)
                            }
                        } else if (/^application\/xml/.test(contentType)) {
                            return resolve(body)
                        } else if (/^image/.test(contentType)) {
                            resolve(Buffer.from(body, 'binary').toString('base64'))
                        } else {
                            reject(`Unknown content-type : ${contentType}`)
                        }
                    }
                })
            }
        }).on('error', (e) => {
            console.error(`server_fetch: ${e.message}`)
            reject(e.message)
        })

        if (opts.method === 'POST' || opts.method === 'PUT') {
            // Write data to request body
            req.end(req_body)
        } else {
            req.end()
        }

    })
}