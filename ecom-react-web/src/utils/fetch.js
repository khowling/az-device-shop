export const _suspenseWrap = (result) => {
  //let status = 'success'
  return {
    read() {
      return result
    }
  }
}


export const _suspenseFetch = (collection, recordid) => {
  //console.log (`_suspenseFetch :  web fetch for ${collection}/${recordid}`)
  let status = 'pending', result = 'waiting'
  let suspender =  fetch(`/api/${collection}${recordid ? '/'+recordid : ''}`)
      .then(res => res.json())
      .then(res => {
        //console.log (`_suspenseFetch response error=${res.error}`)
        if (!res.error) {
          status = 'success'
          result = res
        } else {
          status = 'error'
          result = res.error
        }
      })
      .catch((e) => {
        status = 'error'
        result = e
      })
  //console.log (`_suspenseFetch returning ${status}`)
  return {
    read() {
      if (status === 'pending') {
        throw suspender
      } else if (status === 'error') {
        throw result
      }
      return result
    }
  }
}



export async function _fetchit(type, url, body = null) {
    return new Promise((resolve, reject) => {
      
      let opts = {
        //crossDomain:true,
        method: type,
        //credentials: 'same-origin'
      }
      
      if (body) {
        opts.body = body
        opts.headers = {
          'content-type': 'application/json'
        }
      }
      
      fetch(url, opts).then((r) => {
        //console.log (`fetch status ${r.status}`)
        if (!r.ok) {
          //console.log (`non 200 err : ${r.status}`)
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
            }).catch((e) => {
              return reject("unknown response")
            })
          }          
        }
        }, err => {
          console.log (`err : ${err}`)
          return reject(err)
        })
      })
  }