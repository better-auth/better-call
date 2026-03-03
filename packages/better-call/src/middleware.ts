import { createInternalContext } from "./context";
import type { CookieOptions, CookiePrefixOptions } from "./cookies";
import type { Status, statusCodes } from "./error";
import { type APIError, kAPIErrorHeaderSymbol } from "./error";
import type { Prettify } from "./helper";
import type { InferUse } from "./types";
import { isAPIError } from "./utils";

export type MiddlewareContext<Context = {}> = {
	/**
	 * Method
	 *
	 * The request method
	 */
	method: string;
	/**
	 * Path
	 *
	 * The path of the endpoint
	 */
	path: string;
	/**
	 * Body
	 *
	 * The body object will be the parsed JSON from the request and validated
	 * against the body schema if it exists
	 */
	body: any;
	/**
	 * Query
	 *
	 * The query object will be the parsed query string from the request
	 * and validated against the query schema if it exists
	 */
	query: Record<string, any> | undefined;
	/**
	 * Params
	 *
	 * If the path is `/user/:id` and the request is `/user/1` then the
	 * params will be `{ id: "1" }` and if the path includes a wildcard like
	 * `/user/*` then the params will be `{ _: "1" }` where `_` is the wildcard
	 * key. If the wildcard is named like `/user/**:name` then the params will
	 * be `{ name: string }`
	 */
	params: Record<string, any> | undefined;
	/**
	 * Request object
	 *
	 * If `requireRequest` is set to true in the endpoint options this will be
	 * required
	 */
	request: Request | undefined;
	/**
	 * Headers
	 *
	 * If `requireHeaders` is set to true in the endpoint options this will be
	 * required
	 */
	headers: Headers | undefined;
	/**
	 * Set header
	 *
	 * If it's called outside of a request it will just be ignored.
	 */
	setHeader: (key: string, value: string) => void;
	/**
	 * Set the response status code
	 */
	setStatus: (status: Status) => void;
	/**
	 * Get header
	 *
	 * If it's called outside of a request it will just return null
	 *
	 * @param key - The key of the header
	 */
	getHeader: (key: string) => string | null;
	/**
	 * Get a cookie value from the request
	 *
	 * @param key - The key of the cookie
	 * @param prefix - The prefix of the cookie between `__Secure-` and `__Host-`
	 * @returns The value of the cookie
	 */
	getCookie: (key: string, prefix?: CookiePrefixOptions) => string | null;
	/**
	 * Get a signed cookie value from the request
	 *
	 * @param key - The key of the cookie
	 * @param secret - The secret of the signed cookie
	 * @param prefix - The prefix of the cookie between `__Secure-` and `__Host-`
	 * @returns The value of the cookie or null if the cookie is not found or false if the signature is invalid
	 */
	getSignedCookie: (
		key: string,
		secret: string,
		prefix?: CookiePrefixOptions,
	) => Promise<string | null | false>;
	/**
	 * Set a cookie value in the response
	 *
	 * @param key - The key of the cookie
	 * @param value - The value to set
	 * @param options - The options of the cookie
	 * @returns The cookie string
	 */
	setCookie: (key: string, value: string, options?: CookieOptions) => string;
	/**
	 * Set signed cookie
	 *
	 * @param key - The key of the cookie
	 * @param value - The value to set
	 * @param secret - The secret to sign the cookie with
	 * @param options - The options of the cookie
	 * @returns The cookie string
	 */
	setSignedCookie: (
		key: string,
		value: string,
		secret: string,
		options?: CookieOptions,
	) => Promise<string>;
	/**
	 * JSON
	 *
	 * A helper function to create a JSON response with the correct headers
	 * and status code. If `asResponse` is set to true in the context then
	 * it will return a Response object instead of the JSON object.
	 *
	 * @param json - The JSON object to return
	 * @param routerResponse - The response object to return if `asResponse` is
	 * true in the context this will take precedence
	 */
	json: <R extends Record<string, any> | null>(
		json: R,
		routerResponse?:
			| {
					status?: number;
					headers?: Record<string, string>;
					response?: Response;
					body?: Record<string, any>;
			  }
			| Response,
	) => R;
	/**
	 * Middleware context
	 */
	context: Prettify<Context>;
	/**
	 * Redirect to a new URL
	 */
	redirect: (url: string) => APIError;
	/**
	 * Return error
	 */
	error: (
		status: keyof typeof statusCodes | Status,
		body?: {
			message?: string;
			code?: string;
		} & Record<string, any>,
		headers?: HeadersInit,
	) => APIError;
	asResponse?: boolean;
	returnHeaders?: boolean;
	returnStatus?: boolean;
	responseHeaders: Headers;
};

type DefaultHandler = (inputCtx: MiddlewareContext<any>) => Promise<any>;

export type Middleware<
	Handler extends (
		inputCtx: MiddlewareContext<any>,
	) => Promise<any> = DefaultHandler,
> = Handler & {
	options: Record<string, any>;
};

export function createMiddleware<Context = {}, R = unknown>(
	handler: (context: MiddlewareContext<Context>) => Promise<R>,
): Middleware<(inputContext: Record<string, any>) => Promise<R>>;
export function createMiddleware(handler: any) {
	const internalHandler = async (inputCtx: any) => {
		const context = inputCtx as Record<string, any>;
		const internalContext = await createInternalContext(context, {
			options: {},
			path: "/",
		});

		try {
			const response = await handler(internalContext as any);
			const headers = internalContext.responseHeaders;
			return context.returnHeaders
				? {
						headers,
						response,
					}
				: response;
		} catch (e) {
			// fixme(alex): this is workaround that set-cookie headers are not accessible when error is thrown from middleware
			if (isAPIError(e)) {
				Object.defineProperty(e, kAPIErrorHeaderSymbol, {
					enumerable: false,
					configurable: true,
					get() {
						return internalContext.responseHeaders;
					},
				});
			}
			throw e;
		}
	};
	internalHandler.options = {};
	return internalHandler;
}

createMiddleware.create = <
	E extends {
		use?: Middleware[];
	},
>(
	opts?: E,
) => {
	type InferredContext = InferUse<E["use"]>;

	function fn<R>(
		options: { use?: Middleware[] },
		handler: (ctx: MiddlewareContext<InferredContext>) => Promise<R>,
	): Middleware<(inputContext: Record<string, any>) => Promise<R>>;
	function fn<R>(
		handler: (ctx: MiddlewareContext<InferredContext>) => Promise<R>,
	): Middleware<(inputContext: Record<string, any>) => Promise<R>>;
	function fn(optionsOrHandler: any, handler?: any) {
		if (typeof optionsOrHandler === "function") {
			const internalHandler = async (inputCtx: any) => {
				const context = inputCtx as Record<string, any>;
				const internalContext = await createInternalContext(context, {
					options: { use: opts?.use },
					path: "/",
				});

				try {
					const response = await optionsOrHandler(internalContext as any);
					const headers = internalContext.responseHeaders;
					return context.returnHeaders ? { headers, response } : response;
				} catch (e) {
					if (isAPIError(e)) {
						Object.defineProperty(e, kAPIErrorHeaderSymbol, {
							enumerable: false,
							configurable: true,
							get() {
								return internalContext.responseHeaders;
							},
						});
					}
					throw e;
				}
			};
			internalHandler.options = { use: opts?.use };
			return internalHandler;
		}
		if (!handler) {
			throw new Error("Middleware handler is required");
		}
		const use = [...(opts?.use || []), ...(optionsOrHandler.use || [])];
		const internalHandler = async (inputCtx: any) => {
			const context = inputCtx as Record<string, any>;
			const internalContext = await createInternalContext(context, {
				options: { use },
				path: "/",
			});

			try {
				const response = await handler(internalContext as any);
				const headers = internalContext.responseHeaders;
				return context.returnHeaders ? { headers, response } : response;
			} catch (e) {
				if (isAPIError(e)) {
					Object.defineProperty(e, kAPIErrorHeaderSymbol, {
						enumerable: false,
						configurable: true,
						get() {
							return internalContext.responseHeaders;
						},
					});
				}
				throw e;
			}
		};
		internalHandler.options = { use };
		return internalHandler as any;
	}
	return fn;
};
