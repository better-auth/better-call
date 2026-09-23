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
import {
	cookieOptions,
	deleteCookie,
	getCookie,
	serializeCookie,
	setCookie,
} from "./cookie";
import { applyError, encodeError, err, errorStatus, statusOf } from "./error";
import { createHandler, handler } from "./handle";
import {
	collectModelsFromUse,
	getScalarHTML,
	isOpenAPIModule,
	openapi,
	scalarHTML,
	schemaToOpenAPI,
	toOpenAPI,
} from "./openapi";
import { applyRedirect, asResponse, Redirect, redirect } from "./redirect";
import { fromRequest, req } from "./request";
import { res, toResponse } from "./response";
import {
	createHttpOptions,
	getRouteMeta,
	type HttpOptionsExtension,
	INVALIDATE_HEADER,
	route,
	routeVar,
} from "./route";
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
	serializeCookie,
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
	OpenAPIDocument,
	OpenAPIModule,
	OpenAPIModuleOptions,
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
	collectModelsFromUse,
	getScalarHTML,
	isOpenAPIModule,
	openapi,
	pathParamNames,
	scalarHTML,
	schemaToOpenAPI,
	toOpenAPI,
	toOpenAPIPath,
} from "./openapi";
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
	HttpOptions,
	HttpOptionsExtension,
	RouteMeta,
	RouteMethod,
	RouteModule,
	RouteOptions,
	RouteState,
} from "./route";
export {
	createHttpOptions,
	getRouteMeta,
	httpOptions,
	INVALIDATE_HEADER,
	isRouteModule,
	route,
	routeVar,
} from "./route";
export type {
	CollectedRoute,
	CreateRouterOptions,
	Router,
} from "./router";
export { collectRoutes, createRouter, NOT_FOUND } from "./router";

const httpModuleBase = {
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
	serializeCookie,
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
	collectModelsFromUse,
	toOpenAPI,
	schemaToOpenAPI,
	getScalarHTML,
	scalarHTML,
	openapi,
	isOpenAPIModule,
} as const;

/** Options for {@link http} / {@link createHttp}. */
export type HttpModuleOptions = Record<string, never>;

/**
 * Portable return of {@link createHttp} / {@link http}. Named so consumers
 * that export `http()` can emit declarations via `better-call/http`
 * without deep `plugins/...` paths (TS2742 / TS2883).
 */
export type HttpModuleOf = typeof httpModuleBase & {
	httpOptions: HttpOptionsExtension;
};

/**
 * Build an HTTP plugin module.
 *
 * @example
 * ```ts
 * use: [http()]
 * ```
 */
export function createHttp(_options?: HttpModuleOptions): HttpModuleOf {
	return {
		...httpModuleBase,
		httpOptions: createHttpOptions(),
	};
}

export type HttpModule = HttpModuleOf;

/**
 * HTTP plugin: callable (`http()`) and usable bare (`use: [http]`) via
 * assigned default module members.
 *
 * Prefer `use: [http()]` (or `use: [createHttp()]`) when the bare
 * callable intersection fails to unlock http fn-options under tsc.
 */
export type Http = import("../../module").Module &
	HttpModule &
	(() => HttpModuleOf);

function httpFn(_options?: HttpModuleOptions): HttpModuleOf {
	return createHttp();
}

const defaultHttp = createHttp();

export const http: Http = Object.assign(httpFn, defaultHttp) as Http;
