/// <reference types="node" />
//import { StateStore } from './flux.js';
//import { EventStoreConnection } from './eventStoreConnection.js';

export interface RouteObj {
    pathname: string;
    search: string;
    hash:string;
}

export interface RouteReturn {
    routekey: string;
    props: any;
    urlid: string;
}

export declare function ssrRender(ctx: any, startURL: RouteObj, renderDataPromise: any): Promise<any>;
export declare function pathToRoute(arg: RouteObj) : RouteReturn
export declare const AppRouteCfg: any