 
import  WebSocket, { WebSocketServer } from "ws"
import * as fs from 'fs'
import  http from "http"
import { EventEmitter } from 'events'

type WS_ServerClientType = Record<string, any>;

export class ApplicationState {
    private error: boolean
    private healthCode: number
    private complete: boolean
    private auditlog: Array<string>

    constructor() {
        this.error = false
        this.complete = false
        this.auditlog = []
    }

    log (message: string, complete: boolean = false, error: boolean = false) : void {
        const alog = `${(new Date()).toLocaleString([], {hour12: true})}: ${error ? 'ERROR: ' : ''}${message}`
        this.auditlog.push(alog)
        console.log (alog)
        this.error = error
        this.complete = complete
    }

    healthz() : { body: Array<string>, status: number} {
        return { body:  this.auditlog, status: this.error? 500 : this.complete? 200: 503}
    }
}

export default class ServiceWebServer extends EventEmitter {

    //private context
    private httpServer: http.Server
    private port: string
    private routes
    private appState: ApplicationState
    private buildAssets: string

    constructor(options) {
        super();
        this.port = options.port
        this.appState = options.appState
        this.buildAssets = options.buildAssets

        this.routes = [
            {   // liveleness - for restart
                // readiness - for traffic
                method: 'GET',
                route: '/healthz',
                fn: (req, res) => {
                    const {body, status} = this.appState ? this.appState.healthz() : {status: 200, body: {}}

                    res.writeHead(status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(body))
                }
            }
        ]

    }

    addRoute(method, route, fn) {
        this.routes = this.routes.concat({ method, route, fn })
    }

    createServer() {
        console.log(`listening on ${this.port}`)
        this.httpServer = http.createServer(async function (req, res) {
            const { headers, method, url } = req
            if (url !== '/healthz') {
                console.log(`ServiceWebServer: got request method=${method}, url=${url}`)
            }
            const routeIdx = this.routes.findIndex(r => r.method === method && url.includes(r.route))
            if (routeIdx >= 0) {
                return this.routes[routeIdx].fn(req, res)
            } else if (this.buildAssets && !url.startsWith('/api')) {
                const fp = this.buildAssets + (url === "/"? '/index.html' : url)
                let ct = 'text/plain'
                switch(fp.replace(/^.*\./,'')) { 
                case 'html': 
                    ct= 'text/html'; break
                case 'png': 
                    ct= 'image/png'; break
                case 'json': 
                    ct= 'application/json'; break
                case 'js': 
                    ct= 'text/javascript'; break
                case 'css': 
                    ct= 'text/css'; break
                case 'svg':
                    ct = 'image/svg+xml'; break
                case 'ico':
                    ct = 'image/x-icon'; break
                default:
                     ct= 'text/plain'; break
                } 
                const src = fs.createReadStream(fp)
                res.writeHead(200, { 'Content-Type': ct });
                src.pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end("404 Not Found\n");
            }
        }.bind(this)).listen(this.port)
    }

    private ws_server_clients: WS_ServerClientType

    createWebSocketServer() {
        const wss = new WebSocketServer ({
            server: this.httpServer
        });

        this.ws_server_clients = new Map()

        wss.on('connection', function connection(ws) {
            console.log(`websocket connection`)
            const client_id = this.ws_server_clients.size
            this.ws_server_clients.set(client_id, ws)

            this.emit('newclient', ws)

            ws.on('close', function close() {
                if (this.ws_server_clients.has(client_id)) {
                    // dont send any more messages
                    this.ws_server_clients.delete(client_id)
                    console.log(`disconnected ${client_id}`)
                }
            }.bind(this))
        }.bind(this))
    }

    sendAllClients(data) {
        console.log(`sendAllClients: ${JSON.stringify(data)}`)
        if (data) {
            // console.log(`sending state updates to ${ws_server_clients.size} clients`)
            for (let [key, ws] of this.ws_server_clients.entries()) {
                ws.send(JSON.stringify(data))
            }
        }
    }

}