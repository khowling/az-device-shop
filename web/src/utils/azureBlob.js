import { _fetchit } from './fetch'

const BLOCK_SIZE = 4 * 1024 * 1024

export function putBlob(file, root, evtFn) {

  const filename = file.name, filetype = file.type
  return new Promise((acc, rej) => {

    console.log(`uploading file ${filename}, size: ${file.size.toLocaleString()}, blocksz: ${BLOCK_SIZE}`)
    _fetchit('/api/file', 'PUT', {}, { filename, root }).then(({ container_url, sas, pathname }) => {
      const startt = new Date().getTime()
      const reader = new FileReader()
      let new_index

      const saslocator = `${container_url}/${pathname}?${sas}`

      let readNextChunk = (index) => {
        new_index = Math.min(file.size, index + BLOCK_SIZE)
        reader.readAsArrayBuffer(file.slice(index, new_index))
        console.log(`slice ${index} to ${new_index}`)
      }

      let currblock = 0, sendblockids = []
      reader.onload = (event) => {
        let blockid = pathname + ('0000' + currblock++).slice(-4)
        sendblockids.push(blockid)
        console.log(`putting block (${sendblockids.length}) ${blockid}`)

        _fetchit(`${saslocator}&comp=block&blockid=${new Buffer(blockid).toString('base64')}`, 'PUT', {
          "x-ms-blob-content-type": filetype,
          "x-ms-version": "2018-03-28",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "Content-Type"
        }, event.target.result)

          .then(() => {
            if (new_index < file.size) {
              readNextChunk(new_index)
              evtFn({ loaded: new_index, total: file.size })
            } else {

              _fetchit(`${saslocator}&comp=blocklist`, 'PUT', {
                "x-ms-blob-content-type": filetype,
                "x-ms-version": "2018-03-28",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "Content-Type"
              }, '<?xml version="1.0" encoding="utf-8"?>' +
              '<BlockList>' + sendblockids.map((l) => `<Latest>${new Buffer(l).toString('base64')}</Latest>`).join('') +
              '</BlockList>')
                .then(() => {
                  console.log(`finished  ${(new Date().getTime() - startt) / 1000}s`);
                  acc({ container_url, pathname })
                }, (err) => {
                  console.error(`putblock error : ${err}`)
                  return rej(err)
                })
            }
          }, (err) => {
            console.error(`putblock error : ${err}`)
            return rej(err)
          })
      }
      readNextChunk(0)
    })
  })
}

export function listFiles() {
  const
    readSAS = 'DynamicForm.instance.readSAS',
    user = 'DynamicForm.instance.user'

  if (!readSAS) Promise.reject("No ReadSAS for Storage")
  return new Promise((resolve, reject) => {

    _fetchit(`${readSAS.container_url}?${readSAS.sas}&restype=container&comp=list&prefix=${user ? user._id : "anonymous"}/`,
      { 'x-ms-version': "2018-03-28" }).then((succ) => {
        resolve(succ.split('<Blob>').map(b => b.substring(0, b.indexOf('</Blob>'))).slice(1).map(r => Object.assign({}, ...r.split('</').map((e) => { return { [e.substring(e.lastIndexOf('<') + 1, e.lastIndexOf('>'))]: e.substring(e.lastIndexOf('>') + 1) } }))))
      })

  })
}
