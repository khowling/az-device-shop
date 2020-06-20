"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
Object.defineProperty(exports, "__esModule", { value: true });
// Mongo require
var _a = require('mongodb'), MongoClient = _a.MongoClient, Binary = _a.Binary, ObjectID = _a.ObjectID, MongoURL = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev", USE_COSMOS = false;
var StoreDef = {
    "orders": { collection: "orders", },
    "inventory": { collection: "inventory", }
};
function dbInit() {
    return __awaiter(this, void 0, void 0, function () {
        var murl, client, _db, _a, _b, store, _c, ok, code, errMsg, err_1, e_1_1;
        var e_1, _d;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    murl = new URL(MongoURL);
                    console.log("connecting with " + murl.toString());
                    return [4 /*yield*/, MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
                        // !! IMPORTANT - Need to urlencode the Cosmos connection string
                    ];
                case 1:
                    client = _e.sent();
                    _db = client.db();
                    if (!USE_COSMOS) return [3 /*break*/, 11];
                    _e.label = 2;
                case 2:
                    _e.trys.push([2, 9, 10, 11]);
                    _a = __values(Object.keys(StoreDef)), _b = _a.next();
                    _e.label = 3;
                case 3:
                    if (!!_b.done) return [3 /*break*/, 8];
                    store = _b.value;
                    console.log("ensuring partitioned collection created for [" + store + "]");
                    _e.label = 4;
                case 4:
                    _e.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, _db.command({ customAction: "CreateCollection", collection: StoreDef[store].collection, shardKey: "partition_key" })];
                case 5:
                    _c = _e.sent(), ok = _c.ok, code = _c.code, errMsg = _c.errMsg;
                    if (ok === 1) {
                        console.log('success');
                    }
                    else {
                        throw new Error(errMsg);
                    }
                    return [3 /*break*/, 7];
                case 6:
                    err_1 = _e.sent();
                    if (err_1.code !== 48) {
                        // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                        console.error("Failed to create collection : " + err_1);
                        throw new Error(err_1.errMsg);
                    }
                    return [3 /*break*/, 7];
                case 7:
                    _b = _a.next();
                    return [3 /*break*/, 3];
                case 8: return [3 /*break*/, 11];
                case 9:
                    e_1_1 = _e.sent();
                    e_1 = { error: e_1_1 };
                    return [3 /*break*/, 11];
                case 10:
                    try {
                        if (_b && !_b.done && (_d = _a.return)) _d.call(_a);
                    }
                    finally { if (e_1) throw e_1.error; }
                    return [7 /*endfinally*/];
                case 11: return [2 /*return*/, _db];
            }
        });
    });
}
function watch(db, collection, fn) {
    return __awaiter(this, void 0, void 0, function () {
        var changeStreamIterator;
        return __generator(this, function (_a) {
            changeStreamIterator = db.collection(collection).watch([
                { $match: { "operationType": { $in: ["insert", "update"] } } },
                { $project: { "_id": 1, "fullDocument": 1, "ns": 1, "documentKey": 1 } }
            ], { fullDocument: "updateLookup"
                //, ResumeAfter : bson.deserialize(Buffer.from("QwAAAAVfZGF0YQAyAAAAAFt7InRva2VuIjoiXCI0OVwiIiwicmFuZ2UiOnsibWluIjoiIiwibWF4IjoiRkYifX1dAA==", 'base64'))
                //, StartAfter : {_data: Binary(new Buffer.from('W3sidG9rZW4iOiJcIjI2XCIiLCJyYW5nZSI6eyJtaW4iOiIiLCJtYXgiOiJGRiJ9fV0=', 'base64'))}
                //, startAtOperationTime:   new Date()  
            });
            changeStreamIterator.on('change', function (data) {
                //console.log (`resume token: ${bson.serialize(data._id).toString('base64')}`)
                console.log("fullDocument : " + JSON.stringify(data.fullDocument));
                fn(data.fullDocument);
            });
            return [2 /*return*/];
        });
    });
}
var WorkItem_Stage;
(function (WorkItem_Stage) {
    WorkItem_Stage[WorkItem_Stage["New"] = 0] = "New";
    WorkItem_Stage[WorkItem_Stage["InProgress"] = 1] = "InProgress";
    WorkItem_Stage[WorkItem_Stage["Complete"] = 2] = "Complete";
})(WorkItem_Stage || (WorkItem_Stage = {}));
// current factory capacity
// NOT in a database, its a real-time streaming metric, maintained by this process.
var _factory_state = [];
function factory_state() {
    return _factory_state;
}
function factory_startup() {
    return __awaiter(this, void 0, void 0, function () {
        function avail_capacity() {
            return factory_capacity - _factory_state.reduce(function (tot, orders) { return tot + orders.status.allocated_capacity; }, 0);
        }
        function update_workitem_state(new_state) {
            _factory_state = new_state;
        }
        function add_workitem(invrequest) {
            // 2 things - reduce the factory_capacity && update the workorder status
            // these 2 things are transient, should be streamed?
            // = push updates to broker
            // = service to subscribe to the updates and keep the status!
            // How to implmenet ' Distributed transation??
            // spec == desired state
            // status == current state
            var newwi = { status: { stage: WorkItem_Stage.New, allocated_capacity: 0 }, metadata: { created_time: Date.now() }, spec: invrequest };
            _factory_state.push(newwi);
            console.log("add_workitem & emit");
            ws_server_emit([newwi]);
            //const res = await db.workitems.updateOne({_id: ObjectID(workitem._id), partition_key: "TEST"},{ $set: {status:  "InFactory"}}, {upsert: false, returnOriginal: false, returnNewDocument: false})
        }
        // a control loop is a non-terminating loop that regulates the state of the system.
        // watches the shared state of the Factory
        // makes changes attempting to move the current state towards the desired state
        // ENHANCEMENT
        // only 1 running at a time, leader election - guarantees that only one instance is actively making decisions, all the other instances are inactive, but ready to take leadership if something happens to the active one.
        // election relies on endpoints
        // kubectl describe 'endpoints', Annotations:  control-plane.alpha.kubernetes.io/leader: {"holderIdentity": podid}, The duration of the lease (of the leadership) in seconds: “leaseDurationSeconds”: 15
        // The time the current lease (the current leadership) should be renewed: “renewTime”: “2018–01–19T13:13:54Z”, If this doesn’t happen for any reason, inactive instances are entitled to acquire the leadership.
        // plans for changing the leader election mechanism based on endpoints in favour of a similar approach based on config maps. This avoids continuously triggering “endpoint-changed”
        function factory_control_loop() {
            return __awaiter(this, void 0, void 0, function () {
                var now, inventory, update_avaiable, _loop_1, inventory_1, inventory_1_1, inventory_spec;
                var e_2, _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            now = Date.now();
                            //  Free Factory capacity first
                            // look at desired state ('spec')
                            // look at 'Inventry' requirements (read Inventory Status == 'Required')
                            // look at current state ('status')
                            // look for existing workorders 
                            // perform required actions to get to desired state.
                            // are there any workitems complete? to free up capacity?
                            console.log("Factory Control Loop, looking for finished workitems " + _factory_state.length + ".......");
                            update_workitem_state(_factory_state.map(function (wi) {
                                if (wi.status.stage === WorkItem_Stage.InProgress) {
                                    var status_1 = wi.status, spec = wi.spec, metadata = wi.metadata, MSEC_TO_COMPLETE_ALL = 25000, timeleft = MSEC_TO_COMPLETE_ALL - (now - wi.status.starttime);
                                    var update_wi = void 0;
                                    if (timeleft > 0) {
                                        console.log(MSEC_TO_COMPLETE_ALL + " / 100.0) * " + timeleft);
                                        var progress = 100 - ((MSEC_TO_COMPLETE_ALL / 100.0) * timeleft);
                                        // emit progress
                                        update_wi = { status: __assign(__assign({}, status_1), { last_update: now, progress: progress }), spec: spec, metadata: metadata };
                                    }
                                    else {
                                        // emit finished
                                        update_wi = { status: __assign(__assign({}, status_1), { last_update: now, stage: WorkItem_Stage.Complete, allocated_capacity: 0 }), spec: spec, metadata: metadata };
                                    }
                                    ws_server_emit([update_wi]);
                                    return update_wi;
                                }
                                else {
                                    return wi;
                                }
                            }));
                            console.log("Factory Control Loop, looking for new workitems " + _factory_state.length + ".......");
                            update_workitem_state(_factory_state.map(function (wi) {
                                if (wi.status.stage === WorkItem_Stage.New) {
                                    var status_2 = wi.status, spec = wi.spec, metadata = wi.metadata;
                                    var update_wi = void 0;
                                    if (avail_capacity() >= wi.spec.qty) {
                                        // we have capacity, move to inprogress
                                        update_wi = { status: __assign(__assign({}, status_2), { last_update: now, wait_time: now - wi.status.starttime, progress: 0, starttime: now, stage: WorkItem_Stage.InProgress }), spec: spec, metadata: metadata };
                                    }
                                    else {
                                        // still need to wait
                                        update_wi = { status: __assign(__assign({}, status_2), { last_update: now, wait_time: now - wi.status.starttime }), spec: spec, metadata: metadata };
                                    }
                                    ws_server_emit([update_wi]);
                                    return update_wi;
                                }
                                else {
                                    return wi;
                                }
                            }));
                            return [4 /*yield*/, db.collection("inventory").find({ status: { $ne: "Available" }, partition_key: "TEST" }).toArray()];
                        case 1:
                            inventory = _b.sent();
                            console.log("Factory Control Loop, looking for required Inventory " + inventory.length + ".......");
                            update_avaiable = [];
                            _loop_1 = function (inventory_spec) {
                                var wi_status = _factory_state.find(function (wi) { return inventory_spec._id.toHexString() === wi.spec._id.toHexString(); });
                                if (inventory_spec.status === 'Required') {
                                    console.log("Found Required inventory");
                                    if (!wi_status) {
                                        console.log(" no eixting spec, creating");
                                        add_workitem(inventory_spec);
                                    }
                                    else if (wi_status.status.stage === WorkItem_Stage.Complete) {
                                        console.log(" got eixting spec, finished processing, update Inventory");
                                        update_avaiable.push(ObjectID(inventory_spec._id));
                                    }
                                    else if (wi_status.status.stage === WorkItem_Stage.InProgress) {
                                        console.log(" got eixting spec, still processing");
                                        // no change
                                    }
                                }
                                else if (inventory_spec.status === 'Cancel') {
                                    if (!wi_status) {
                                        add_workitem(inventory_spec);
                                    }
                                    else if (wi_status.status.stage === WorkItem_Stage.Complete) {
                                        update_avaiable.push(ObjectID(inventory_spec._id));
                                    }
                                    else if (wi_status.status.stage === WorkItem_Stage.InProgress) {
                                        // no change
                                    }
                                }
                            };
                            try {
                                for (inventory_1 = __values(inventory), inventory_1_1 = inventory_1.next(); !inventory_1_1.done; inventory_1_1 = inventory_1.next()) {
                                    inventory_spec = inventory_1_1.value;
                                    _loop_1(inventory_spec);
                                }
                            }
                            catch (e_2_1) { e_2 = { error: e_2_1 }; }
                            finally {
                                try {
                                    if (inventory_1_1 && !inventory_1_1.done && (_a = inventory_1.return)) _a.call(inventory_1);
                                }
                                finally { if (e_2) throw e_2.error; }
                            }
                            if (!(update_avaiable.length > 0)) return [3 /*break*/, 3];
                            return [4 /*yield*/, db.collection("inventory").find({ _id: { $in: update_avaiable }, partition_key: "TEST" }, { status: "Available" })];
                        case 2:
                            _b.sent();
                            _b.label = 3;
                        case 3: return [2 /*return*/];
                    }
                });
            });
        }
        var db, factory_capacity;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dbInit()
                    // need to read this from snapshot
                ];
                case 1:
                    db = _a.sent();
                    factory_capacity = 1000;
                    /////////////////////////////////////////////////////////
                    // Factory Operator - Custom Resource -> "EventsFactory"
                    // Operator Pattern  - Specify the Desired State (workitems), and have the controller implement it using a Control Loop
                    // Factory Controller has deep knowledge on how to create Investory
                    // 
                    // Immutable
                    // watch for new new Inventory
                    watch(db, "inventory", function (doc) {
                        if (doc.status === 'Required') {
                            add_workitem(doc);
                        }
                    });
                    setInterval(factory_control_loop, 10000);
                    return [2 /*return*/];
            }
        });
    });
}
var ws_server_clients = new Map();
function ws_server_emit(msg) {
    var e_3, _a;
    console.log("sending to " + ws_server_clients.size + " clients");
    try {
        for (var _b = __values(ws_server_clients.entries()), _c = _b.next(); !_c.done; _c = _b.next()) {
            var _d = __read(_c.value, 2), key = _d[0], ws = _d[1];
            console.log("" + key);
            ws.send(JSON.stringify(msg));
        }
    }
    catch (e_3_1) { e_3 = { error: e_3_1 }; }
    finally {
        try {
            if (_c && !_c.done && (_a = _b.return)) _a.call(_b);
        }
        finally { if (e_3) throw e_3.error; }
    }
}
function ws_server_startup() {
    // -----------------------------------------------------------------------------------
    // ----------------------------------------------------------------- HTTP & WS Servers
    var WebSocket = require('ws'), http = require('http'), 
    //    serveStatic = require('serve-static'),
    //    useragent = require('express-useragent'),
    port = process.env.PORT || 9090, httpServer = http.createServer().listen(port);
    console.log("listening to port " + port);
    // Web Socket Server
    var wss = new WebSocket.Server({
        perMessageDeflate: false,
        server: httpServer
    });
    wss.on('connection', function connection(ws) {
        var client_id = ws_server_clients.size;
        ws_server_clients.set(client_id, ws);
        ws.send(JSON.stringify(factory_state()));
        ws.on('close', function close() {
            if (ws_server_clients.has(client_id)) {
                // dont send any more messages
                ws_server_clients.delete(client_id);
                console.log("disconnected " + client_id);
            }
        });
        //,
        //    ua = useragent.parse(headers['user-agent']),
        //    client_key = `${NOTIFICATION_KEYPREFIX}USERS:${proc_id}-${node_connections.size}`
        //console.log (`connected ${client_key}`)
        /*
            ws.on('message', (message) => {
                console.log(`received: ${JSON.stringify(message)}`);
                let mobj = JSON.parse(message)
    
                // user JOIN & keep-alive
                if (mobj.type == "JOIN") {
    
                    let joined = new Date().getTime()
                    if (node_connections.has(client_key)) { // already joined, its a keep alive
                        joined = node_connections.get(client_key).joined
                    } else { // a new user!
                        node_connections.set (client_key, {ws: ws, joined: joined})
                    }
                    
                    const KEEPALIVE_INTERVAL = 10
    
                    var conn_info = {
                        type: "JOINED",
                        interval: KEEPALIVE_INTERVAL,
                        name: mobj.name,
                        process_type: PROC_TYPE,
                        ping: new Date().getTime() - mobj.time,
                        server: proc_key,
                        connected_for: Math.round ( (new Date().getTime() - joined)/1000),
                        platform: `${ua.platform}/${ua.os}/${ua.browser}`,
                        isMobile: ua.isMobile,
                    }
    
                    // update redis hash
                    redis.multi()
                    .hmset (client_key, conn_info)
                    .expire(client_key, KEEPALIVE_INTERVAL + 2)
                    .exec((err, res) => {  // Executes all previously queued commands in a transaction
                        if (err) {
                        console.log (`error ${err}`)
                        }
                    });
    
                    ws.send (JSON.stringify(conn_info))
                }
            })
    */
    });
}
factory_startup();
ws_server_startup();
//# sourceMappingURL=factoryController.js.map