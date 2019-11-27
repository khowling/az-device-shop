export const _suspenseWrap = (result) => {
  //let status = 'success'
  return {
    read() {
      return result
    }
  }
}


export const _suspenseFetch = (operation, recordid) => {
  //console.log (`_suspenseFetch :  web fetch for ${operation}/${recordid}`)
  let r = {status: 'pending'}
  let suspender =  fetch(`/api/${operation}${recordid ? '/'+recordid : ''}`)
      .then(async res => res.ok? res.json() : {error: res.status + ': '+ await res.text()})  
      .then(res => {
        console.log (`_suspenseFetch response error=${res.error}`)
        r = (!res.error) ? {status: 'success', result: res } : {status: 'error', result: res.error }
      })
      .catch((e) => {
        r = {status: 'error', result: e}
      })
  //console.log (`_suspenseFetch returning ${status}`)
  return {
    read() {
      if (r.status === 'pending') {
        throw suspender
      }
      return r
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