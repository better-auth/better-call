import { cookieOptions, deleteCookie, getCookie, setCookie } from "./cookie";
import { applyError, err, errorStatus, statusOf } from "./error";
import { fromRequest, req } from "./request";
import { res } from "./response";

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
export type { HttpRequest } from "./request";
export { fromRequest, req, toHttpRequest } from "./request";
export type { HttpResponse } from "./response";
export { res } from "./response";

export const http = {
	req,
	res,
	cookieOptions,
	handler: fromRequest,
	getCookie,
	setCookie,
	deleteCookie,
	err,
	statusOf,
	errorStatus,
	applyError,
};
