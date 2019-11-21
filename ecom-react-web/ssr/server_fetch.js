const http = require('http')

module.exports = async function (collection, recordid) {
    return new Promise(function(resolve, reject) {
        http.get(`http://localhost:3001/api/${collection}/${recordid}`, (res) => {
            const { statusCode } = res;
            const contentType = res.headers['content-type']

            let error;
            if (statusCode !== 200) {
                error = new Error('Request Failed.\n' +
                                `Status Code: ${statusCode}`)
            } else if (!/^application\/json/.test(contentType)) {
                error = new Error('Invalid content-type.\n' +
                                `Expected application/json but received ${contentType}`);
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
    })
}