export const _suspenseWrap = (res) => {
  //let status = 'success'
  return {
    read() {
      return {status: 'success', result: res }
    }
  }
}


export const _suspenseFetch = (operation, recordid) => {
  console.log (`_suspenseFetch :  web fetch for ${operation} ${recordid}`)
  let r = {status: 'pending'}
  let suspender =  _fetchit('GET', `/api/${operation}` + (recordid  ? `/${recordid}` : ''))
    //  .then(async res => res.ok? res.json() : {error: res.status + ': '+ await res.text()})  
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
        opts.body = JSON.stringify(body)
        opts.headers = {
          'content-type': 'application/json'
        }
      }
      
      fetch(url, opts).then(async (res) => {
        //console.log (`fetch status ${r.status}`)
        if (!res.ok) {
          console.log (`non 200 err : ${res.status}`)
          if (res.status === 401 && typeof window !== 'undefined') {
            window.location.replace ((process.env.REACT_APP_SERVER_URL || '') + '/connect/microsoft?surl=' + encodeURIComponent(window.location.href))
          } else {
            return reject(res.status + ': '+ await res.text())
          }
        } else {
          if ((res.status === 200 && type === 'DELETE') || (res.status === 201 && type === 'POST')) {
            return resolve()
          } else {
            res.json().then(rjson => {
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