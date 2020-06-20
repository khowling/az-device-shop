"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
// Mongo require
var _a = require('mongodb'), MongoClient = _a.MongoClient, Binary = _a.Binary, ObjectID = _a.ObjectID, bson = require('bson'), MongoURL = process.env.MONGO_DB || "mongodb://localhost:27017/dbdev", USE_COSMOS = false;
var StoreDef = {
    "orders": { collection: "orders", },
    "inventory": { collection: "inventory", }
};
function dbInit() {
    return __awaiter(this, void 0, void 0, function () {
        var murl, client, _db, _i, _a, store, _b, ok, code, errMsg, err_1;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    murl = new URL(MongoURL);
                    console.log("connecting with " + murl.toString());
                    return [4 /*yield*/, MongoClient.connect(murl.toString(), { useNewUrlParser: true, useUnifiedTopology: true })
                        // !! IMPORTANT - Need to urlencode the Cosmos connection string
                    ];
                case 1:
                    client = _c.sent();
                    _db = client.db();
                    if (!USE_COSMOS) return [3 /*break*/, 7];
                    _i = 0, _a = Object.keys(StoreDef);
                    _c.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 7];
                    store = _a[_i];
                    console.log("ensuring partitioned collection created for [" + store + "]");
                    _c.label = 3;
                case 3:
                    _c.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, _db.command({ customAction: "CreateCollection", collection: StoreDef[store].collection, shardKey: "partition_key" })];
                case 4:
                    _b = _c.sent(), ok = _b.ok, code = _b.code, errMsg = _b.errMsg;
                    if (ok === 1) {
                        console.log('success');
                    }
                    else {
                        throw new Error(errMsg);
                    }
                    return [3 /*break*/, 6];
                case 5:
                    err_1 = _c.sent();
                    if (err_1.code !== 48) {
                        // allow gracefull "Resource with specified id, name, or unique index already exists", otherwise:
                        console.error("Failed to create collection : " + err_1);
                        throw new Error(err_1.errMsg);
                    }
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 2];
                case 7: return [2 /*return*/, _db];
            }
        });
    });
}
function watch(collection, fn) {
    return __awaiter(this, void 0, void 0, function () {
        var db, changeStreamIterator;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, dbInit()
                    // introduced in 3.6 ReadRole user, access controll
                    // documentKey uniquly identifies the document
                ];
                case 1:
                    db = _a.sent();
                    changeStreamIterator = db.collection(collection).watch([
                        { $match: { "operationType": { $in: ["insert", "update", "replace"] } } },
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
            }
        });
    });
}
// current factory capacity
// NOT in a database, its a real-time streaming metric, maintained by this process.
function startup() {
    return __awaiter(this, void 0, void 0, function () {
        var factory_capacity;
        return __generator(this, function (_a) {
            factory_capacity = 100;
            // watch
            watch("inventory", function (doc) {
                console.log(doc);
            });
            return [2 /*return*/];
        });
    });
}
//# sourceMappingURL=server-mongowatch.js.map