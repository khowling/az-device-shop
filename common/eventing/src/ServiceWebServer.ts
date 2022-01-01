 
import  WebSocket, { WebSocketServer } from "ws"
import  http from "http"
import { EventEmitter } from 'events'

type WS_ServerClientType = Record<string, any>;

export default class ServiceWebServer extends EventEmitter {

    //private context
    private httpServer: http.Server
    private port: string
    private routes

    constructor(options) {
        super();
        this.port = options.port
        this.routes = [
            {   // liveleness - for restart
                // readiness - for traffic
                method: 'GET',
                route: '/healthz',
                fn: (req, res) => {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end()
                }
            }
        ]

    }

    addRoute(method, route, fn) {
        this.routes = this.routes.concat({ method, route, fn })
    }

    createServer() {
        console.log(`listening on ${this.port}`)
        this.httpServer = http.createServer(function (req, res) {
            const { headers, method, url } = req
            if (url !== '/healthz') {
                console.log(`ServiceWebServer: got request method=${method}, url=${url}`)
            }
            const routeIdx = this.routes.findIndex(r => r.method === method && url.includes(r.route))
            if (routeIdx >= 0) {
                return this.routes[routeIdx].fn(req, res)
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