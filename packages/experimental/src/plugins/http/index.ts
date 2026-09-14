import {
	clientSchema,
	fromJsonBody,
	rejectReadonly,
	responseSchema,
	serverOnly,
	stripReturned,
	wireInput,
} from "./attrs";
import { createClient } from "./client";
import { cookieOptions, deleteCookie, getCookie, setCookie } from "./cookie";
import { applyError, encodeError, err, errorStatus, statusOf } from "./error";
import { createHandler, handler } from "./handle";
import { applyRedirect, asResponse, Redirect, redirect } from "./redirect";
import { fromRequest, req } from "./request";
import { res, toResponse } from "./response";
import { getRouteMeta, INVALIDATE_HEADER, route, routeVar } from "./route";
import {
	getScalarHTML,
	scalarHTML,
	schemaToOpenAPI,
	toOpenAPI,
} from "./openapi";
import { collectRoutes, createRouter, NOT_FOUND } from "./router";

export {
	clientSchema,
	fromJsonBody,
	rejectReadonly,
	responseSchema,
	serverOnly,
	stripReturned,
	wireInput,
} from "./attrs";
export type {
	ClientFetchOptions,
	ClientPlugin,
	ClientResource,
	ClientResult,
	CreateClientOptions,
	InferClientAPI,
	ResolvedResource,
	Store,
	StoreSnapshot,
} from "./client";
export { createClient, createStore } from "./client";
export type { CookieOptions } from "./cookie";
export {
	cookieOptions,
	cookieShape,
	deleteCookie,
	getCookie,
	setCookie,
} from "./cookie";
export type {
	EncodedError,
	EncodeErrorOptions,
	ErrorMessageOverride,
	HttpErrMeta,
} from "./error";
export {
	applyError,
	encodeError,
	err,
	errorStatus,
	kHttpErr,
	statusOf,
} from "./error";
export type { CreateHandlerContext, CreateHandlerOptions } from "./handle";
export { createHandler, handler } from "./handle";
export type {
	InferServerAPI,
	NestPathEndpoint,
	PathRouteLeaf,
	PathToKeys,
} from "./path-api";
export {
	buildPathTree,
	buildServerApi,
	flattenRouteLeaves,
	pathToClientKeys,
} from "./path-api";
export type { RedirectStatus } from "./redirect";
export {
	applyRedirect,
	asResponse,
	Redirect,
	redirect,
} from "./redirect";
export type { HttpRequest } from "./request";
export { fromRequest, req, toHttpRequest } from "./request";
export type { HttpResponse } from "./response";
export { res, toResponse } from "./response";
export type {
	RouteMeta,
	RouteMethod,
	RouteModule,
	RouteOptions,
	RouteState,
} from "./route";
export {
	getRouteMeta,
	INVALIDATE_HEADER,
	isRouteModule,
	route,
	routeVar,
} from "./route";
export type {
	CollectedRoute,
	CreateRouterOptions,
	Router,
	RouterOpenAPIOptions,
} from "./router";
export { collectRoutes, createRouter, NOT_FOUND } from "./router";

export type {
	OpenAPIDocument,
	OpenAPIOperation,
	OpenAPIParameter,
	OpenAPIPathItem,
	OpenAPIRequestBody,
	OpenAPIResponse,
	OpenAPISchemaObject,
	ScalarOptions,
	ToOpenAPIOptions,
} from "./openapi";
export {
	getScalarHTML,
	pathParamNames,
	scalarHTML,
	schemaToOpenAPI,
	toOpenAPI,
	toOpenAPIPath,
} from "./openapi";

export const http = {
	req,
	res,
	cookieOptions,
	fromRequest,
	handler,
	createHandler,
	createRouter,
	collectRoutes,
	NOT_FOUND,
	route,
	routeVar,
	getRouteMeta,
	INVALIDATE_HEADER,
	createClient,
	getCookie,
	setCookie,
	deleteCookie,
	err,
	statusOf,
	errorStatus,
	applyError,
	encodeError,
	redirect,
	applyRedirect,
	asResponse,
	toResponse,
	Redirect,
	serverOnly,
	clientSchema,
	responseSchema,
	rejectReadonly,
	stripReturned,
	wireInput,
	fromJsonBody,
	toOpenAPI,
	schemaToOpenAPI,
	getScalarHTML,
	scalarHTML,
};
