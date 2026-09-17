import { v } from "../../index";
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
import {
	codecFor,
	compactCodec,
	cookieCacheApi,
	createChunkedCookieStore,
	getChunkedCookie,
	getCookieCache,
	jweCodec,
	jwtCodec,
	MAX_COOKIE_CHUNKS,
	MAX_COOKIE_SIZE,
} from "./cookie-cache";
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
	getRouteMeta,
	httpOptions,
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
	ChunkCookie,
	ChunkedCookieStore,
	CookieCacheApi,
	CookieCacheCodec,
	CookieCacheFnOption,
	CookieCachePolicy,
	CookieCacheSigner,
	CookieCacheStrategy,
	DecodeResult,
	GetCookieCacheConfig,
} from "./cookie-cache";
export {
	codecFor,
	compactCodec,
	cookieCacheApi,
	cookieCacheOptionSchema,
	createChunkedCookieStore,
	createCookieCacheApi,
	getChunkedCookie,
	getCookieCache,
	jweCodec,
	jwtCodec,
	MAX_COOKIE_CHUNKS,
	MAX_COOKIE_SIZE,
} from "./cookie-cache";
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
	RouteMeta,
	RouteMethod,
	RouteModule,
	RouteOptions,
	RouteState,
} from "./route";
export {
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

/** `c.cookieCache` — set/get/run/clear for the cookie-cache layer. */
export const cookieCache = v.var("cookieCache", {
	default: cookieCacheApi,
});

export const http = {
	httpOptions,
	req,
	res,
	cookieOptions,
	cookieCache,
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
	getCookieCache,
	createChunkedCookieStore,
	getChunkedCookie,
	compactCodec,
	jwtCodec,
	jweCodec,
	codecFor,
	MAX_COOKIE_SIZE,
	MAX_COOKIE_CHUNKS,
};
