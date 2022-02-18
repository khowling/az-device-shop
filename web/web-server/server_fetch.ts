import https from 'https'
import http from 'http'

export default async function (url: string, opts = {} as http.RequestOptions, body?: string | object): Promise<any> {

    let options = {method: body? 'POST' : 'GET',  ...opts }
    let bodystr: string 

    if (body) {
        const contentType = (typeof body === 'object'  && !(options.headers && options.headers['x-ms-blob-content-type'])) ? "application/json": ""
        bodystr = contentType ? JSON.stringify(body) : body as string

        options = {
            ...options,
            headers: {
                ...(contentType && { 'content-type': contentType}),
                'content-length': Buffer.byteLength(bodystr),
                ...(options.headers && { ...options.headers })
            }
        }
    }

    return new Promise(function (resolve, reject) {

        function req_callback(res)  {

            if (res.statusCode !== 200 && res.statusCode !== 201) {
                let error = new Error(`Request Failed: Status Code: ${res.statusCode}`)
                //console.error(error.message)
                // Consume response data to free up memory
                res.resume();
                //throw new Error(error)
                reject(error)
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
                                reject(new Error(e as string))
                            }
                        } else if (/^application\/xml/.test(contentType)) {
                            return resolve(body)
                        } else if (/^image/.test(contentType)) {
                            return resolve(Buffer.from(body, 'binary').toString('base64'))
                        } else {
                            return reject(new Error(`Unknown content-type : ${contentType}`))
                        }
                    }
                })
            }
        }

        function req_onerr(e) {
            console.error(`server_fetch: ${e.message}`)
            reject(e)
        }

        const req = url.startsWith('http://') ?
                http.request(url, options, req_callback).on('error', req_onerr) :
                https.request(url, options, req_callback).on('error',req_onerr)

        if (options.method === 'POST' || options.method === 'PUT') {
            // Write data to request body
            req.end(bodystr)
        } else {
            req.end()
        }

    })
}