const https = require('https')
const http = require('http')

module.exports = async function (url, options = { method: "GET" }, body) {
    let http_s = https
    if (url.startsWith('http://')) http_s = http
    return new Promise(function (resolve, reject) {
        const req = http_s.request(url, options, (res) => {
            const { statusCode } = res;
            const contentType = res.headers['content-type']

            // This will cause the 'chunks' to be returned in unencoded Buffers, not strings!
            //res.setEncoding(null)


            if (statusCode !== 200) {
                let error = new Error(`Request Failed: Status Code: ${statusCode}`)
                console.error(error.message)
                // Consume response data to free up memory
                res.resume();
                return reject(error.message)
            }


            var strings = []

            // data from the response object must be consumed, either by calling response.read() whenever there is a 'readable' event, or by adding a 'data' handler, or by calling the .resume() method. Until the data is consumed
            res.on('data', function (chunk) {
                strings.push(chunk)
            })
            res.on('end', () => {
                let body = strings.join('')
                if (/^application\/json/.test(contentType)) {

                    try {
                        const parsedData = JSON.parse(body)
                        return resolve(parsedData)
                    } catch (e) {
                        console.error(e.message)
                        return reject(e.message)
                    }
                } else if (/^application\/xml/.test(contentType)) {
                    return resolve(body)
                } else if (/^image/.test(contentType)) {
                    let b64_str = Buffer.from(body, 'binary').toString('base64')
                    return resolve(b64_str)
                } else {
                    return reject(`Unknown content-type : ${contentType}`)
                }
            });
        }).on('error', (e) => {
            console.error(`Got error: ${e.message}`)
            return reject(e.message)
        })

        if (options.method === 'POST') {
            // Write data to request body
            req.write(body)
        }
        req.end()
    })
}