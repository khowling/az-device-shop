const https = require('https')
const http = require('http')

module.exports = async function (url, options = {}, body) {
    let http_s = https
    if (url.startsWith('http://')) http_s = http
    return new Promise(function(resolve, reject) {
        const req = http_s.request(url, options, (res) => {
            const { statusCode } = res;
            const contentType = res.headers['content-type']

            let error;
            if (statusCode !== 200) {
                error = new Error(`Request Failed: Status Code: ${statusCode}`)
            } else if (!/^application\/json/.test(contentType)) {
                error = new Error(`Invalid content-type: Expected application/json but received ${contentType}`);
            }
            if (error) {
                console.error(error.message)
                // Consume response data to free up memory
                res.resume();
                return reject(error.message)
            }

            res.setEncoding('utf8')
            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; })
            res.on('end', () => {
                try {
                    const parsedData = JSON.parse(rawData)
                    return resolve (parsedData)
                } catch (e) {
                    console.error(e.message)
                    return reject(e.message)
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