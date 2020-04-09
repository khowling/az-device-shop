import { _fetchit } from './fetch'


function _callAzureStorage(path, mode = 'GET', body, filetype) {
  return new Promise( (resolve, reject) => {

    let client = new XMLHttpRequest();
    client.open(mode, path)

    // Requires CORS set on Storage Account
    // response headers!
    // client.setRequestHeader("Access-Control-Allow-Origin", "*")
    // request headers, automatic??
    //client.setRequestHeader("Access-Control-Request-Method", "POST")
    //client.setRequestHeader("Access-Control-Request-Headers", "Content-Type")
    client.setRequestHeader("x-ms-version", "2018-03-28")
    if (filetype) client.setRequestHeader("x-ms-blob-content-type", filetype)

    client.onreadystatechange = () => {
      if (client.readyState === XMLHttpRequest.DONE) {
        if (client.status === 200 || client.status === 201) {
          resolve(client.responseText)
        } else  { 
          console.log (`oh ${client.responseText}`)
          reject(client.status  + ": " + client.statusText)
        }
      }
    }

    client.addEventListener("error", (evt) => {
      console.log(`An error occurred while transferring the file ${evt}`)
      return reject(evt)
    });

    if (mode === 'POST'  || mode === "PUT") {
      client.send(body)
    } else {
      client.send()
    }
  })
}
  
// ---------------------------------------------- creates a new block blob
const putblock = (blockid, data, saslocator, filetype) => {
    return new Promise ((acc,rej) => {

        let comp
        if (!Array.isArray(blockid)) {
            comp = `comp=block&blockid=${new Buffer(blockid).toString('base64')}`
        } else {
            comp = "comp=blocklist"
            data = '<?xml version="1.0" encoding="utf-8"?>' +
                    '<BlockList>' +
                    blockid.map((l) => `<Latest>${new Buffer(l).toString('base64')}</Latest>`).join('') +
                    '</BlockList>'
            console.log ('putting ' + data)
        }

        console.log (`putting blockid ${blockid}`)// size: ${data.length.toLocaleString()} bytes`)
        _callAzureStorage(`${saslocator}&${comp}`, 'PUT', data, filetype).then((r) => acc(r), (e) => rej(e))
    })
}

const BLOCK_SIZE = 4* 1024 * 1024

export function putBlob (file, evtFn) {
  return new Promise ((acc,rej) => {

    console.log (`uploading file ${file.name}, size: ${file.size.toLocaleString()}, blocksz: ${BLOCK_SIZE}`)
    _fetchit('PUT', '/api/file', { filename: file.name} ).then (({container_url, sas, filename}) => {
      const startt = new Date().getTime()
      const reader = new FileReader()
      let new_index

      const saslocator = `${container_url}/${filename}?${sas}`
      
      let readNextChunk = (index) => {
        new_index = Math.min (file.size, index+BLOCK_SIZE)
        reader.readAsArrayBuffer(file.slice(index, new_index))
        console.log (`slice ${index} to ${new_index}`)
      }

      let currblock = 0, sendblockids = []
      reader.onload = (event) => {
        let blockid = filename + ('0000'+currblock++).slice(-4)
        sendblockids.push(blockid);
        console.log (`putting block (${sendblockids.length}) ${blockid}`)


        putblock(blockid, event.target.result, saslocator).then(() => {
          if (new_index < file.size) {
            readNextChunk(new_index)
            evtFn({loaded: new_index, total: file.size})
          } else {
            putblock(sendblockids, null, saslocator, file.type).then (() => {
              console.log (`finished  ${(new Date().getTime() - startt)/1000}s`);
              acc({container_url, filename})
            }, (err) => {
              console.error (`putblock error : ${err}`)
              return rej(err)
            })
          }
        }, (err) => {
          console.error (`putblock error : ${err}`)
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
  return new Promise( (resolve, reject) => {
    _callAzureStorage(`${readSAS.container_url}?${readSAS.sas}&restype=container&comp=list&prefix=${user? user._id : "anonymous"}/`).then((succ) => {
      resolve(succ.split('<Blob>').map(b => b.substring(0,b.indexOf('</Blob>'))).slice(1).map(r => Object.assign({}, ...r.split('</').map((e) => { return {[e.substring(e.lastIndexOf('<')+1, e.lastIndexOf('>'))]: e.substring(e.lastIndexOf('>')+1)}}))))
    })

  })
}
