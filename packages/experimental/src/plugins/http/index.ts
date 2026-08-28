import { cookieOptions, deleteCookie, getCookie, setCookie } from "./cookie";
import { applyError, err, errorStatus, statusOf } from "./error";
import { createHandler } from "./handle";
import { applyRedirect, asResponse, Redirect, redirect } from "./redirect";
import { fromRequest, req } from "./request";
import { res, toResponse } from "./response";

export type { CookieOptions } from "./cookie";
export {
	cookieOptions,
	cookieShape,
	deleteCookie,
	getCookie,
	setCookie,
} from "./cookie";
export type { HttpErrMeta } from "./error";
export {
	applyError,
	err,
	errorStatus,
	kHttpErr,
	statusOf,
} from "./error";
export type { CreateHandlerOptions } from "./handle";
export { createHandler } from "./handle";
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
	createHandler,
	getCookie,
	setCookie,
	deleteCookie,
	err,
	statusOf,
	errorStatus,
	applyError,
	redirect,
	applyRedirect,
	asResponse,
	toResponse,
	Redirect,
};
