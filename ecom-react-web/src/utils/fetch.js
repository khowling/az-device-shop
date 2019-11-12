export async function _fetchit(type, url, body = null) {
    return new Promise((resolve, reject) => {
      let opts = {
        crossDomain:true,
        method: type,
        credentials: 'same-origin'
      }
      if (body) {
        opts.body = body
        opts.headers = {
          'content-type': 'application/json'
        }
      }

      fetch((process.env.REACT_APP_FN_HOST || '') + url + (process.env.REACT_APP_FN_KEY || ''), opts).then((r) => {
        console.log (`fetch status ${r.status}`)
        if (!r.ok) {
          console.log (`non 200 err : ${r.status}`)
          return reject(r.status)
        } else {
          if ((r.status === 200 && type === 'DELETE') || (r.status === 201 && type === 'POST')) {
            return resolve();
          } else {
            r.json().then(rjson => {
              if (rjson) {
                return resolve(rjson)
              } else {
                return reject("no output")
              }
            })
          }          
        }
        }, err => {
          console.log (`err : ${err}`)
          return reject(err)
        })
      })
  }