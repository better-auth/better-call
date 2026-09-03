import {
	clientSchema,
	fromJsonBody,
	readonly,
	rejectReadonly,
	rejectServerOnly,
	responseSchema,
	returned,
	serverOnly,
	stripReturned,
	wireInput,
} from "./attrs";
import { cookieOptions, deleteCookie, getCookie, setCookie } from "./cookie";
import { applyError, encodeError, err, errorStatus, statusOf } from "./error";
import { createHandler, handler } from "./handle";
import { applyRedirect, asResponse, Redirect, redirect } from "./redirect";
import { fromRequest, req } from "./request";
import { res, toResponse } from "./response";

export {
	clientSchema,
	fromJsonBody,
	readonly,
	rejectReadonly,
	rejectServerOnly,
	responseSchema,
	returned,
	serverOnly,
	stripReturned,
	wireInput,
} from "./attrs";
export type { CookieOptions } from "./cookie";
export {
	cookieOptions,
	cookieShape,
	deleteCookie,
	getCookie,
	setCookie,
} from "./cookie";
export type { EncodedError, HttpErrMeta } from "./error";
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

export const http = {
	req,
	res,
	cookieOptions,
	fromRequest,
	handler,
	createHandler,
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
	readonly,
	returned,
	serverOnly,
	clientSchema,
	responseSchema,
	rejectReadonly,
	rejectServerOnly,
	stripReturned,
	wireInput,
	fromJsonBody,
};
