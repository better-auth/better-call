import type { CookieOptions, CookiePrefixOptions } from "./cookies";
import {
	getCookieKey,
	parseCookies,
	serializeCookie,
	serializeSignedCookie,
} from "./cookies";
import { getCryptoKey, verifySignature } from "./crypto";
import {
	APIError,
	type Status,
	type statusCodes,
	ValidationError,
} from "./error";
import type { Prettify } from "./helper";
import type { Middleware, MiddlewareContext } from "./middleware";
import type { StandardSchemaV1 } from "./standard-schema";
import type {
	InferParam,
	InferUse,
	ResolveBody,
	ResolveMethod,
	ResolveQuery,
} from "./types";
import { isRequest } from "./utils";
import { runValidation } from "./validator";

export type EndpointContext<
	Path extends string,
	M,
	BodySchema extends object | undefined,
	QuerySchema extends object | undefined,
	Use extends Middleware[],
	ReqHeaders extends boolean,
	ReqRequest extends boolean,
	Context = {},
	Meta = undefined,
> = {
	/**
	 * Method
	 *
	 * The request method
	 */
	method: ResolveMethod<M>;
	/**
	 * Path
	 *
	 * The path of the endpoint
	 */
	path: Path;
	/**
	 * Body
	 *
	 * The body object will be the parsed JSON from the request and validated
	 * against the body schema if it exists.
	 */
	body: ResolveBody<BodySchema, Meta>;
	/**
	 * Query
	 *
	 * The query object will be the parsed query string from the request
	 * and validated against the query schema if it exists
	 */
	query: ResolveQuery<QuerySchema, Meta>;
	/**
	 * Params
	 *
	 * If the path is `/user/:id` and the request is `/user/1` then the params will
	 * be `{ id: "1" }` and if the path includes a wildcard like `/user/*` then the
	 * params will be `{ _: "1" }` where `_` is the wildcard key. If the wildcard
	 * is named like `/user/**:name` then the params will be `{ name: string }`
	 */
	params: InferParam<Path>;
	/**
	 * Request object
	 *
	 * If `requireRequest` is set to true in the endpoint options this will be
	 * required
	 */
	request: ReqRequest extends true ? Request : Request | undefined;
	/**
	 * Headers
	 *
	 * If `requireHeaders` is set to true in the endpoint options this will be
	 * required
	 */
	headers: ReqHeaders extends true ? Headers : Headers | undefined;
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
	 * Response headers
	 *
	 * The live `Headers` for the response being built in the current
	 * request. Read it to inspect what has already been queued, e.g. to
	 * avoid emitting a `Set-Cookie` twice or to check headers set by an
	 * earlier handler in the chain.
	 *
	 * @example
	 * ```ts
	 * const alreadySet = ctx.responseHeaders
	 *   .getSetCookie()
	 *   .some((c) => c.startsWith("session="));
	 * ```
	 */
	responseHeaders: Headers;
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
	context: 0 extends 1 & Use
		? Prettify<Context>
		: Prettify<Context & InferUse<Use>>;
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
};

/**
 * Creates the internal context for an endpoint or middleware invocation.
 * This is the runtime function that does validation, cookie handling,
 * middleware execution, etc.
 */
export const createInternalContext = async (
	context: Record<string, any>,
	{
		options,
		path,
	}: {
		options: {
			method?: string | string[];
			body?: StandardSchemaV1;
			query?: StandardSchemaV1;
			requireHeaders?: boolean;
			requireRequest?: boolean;
			use?: Middleware[];
			[key: string]: any;
		};
		path?: string;
	},
) => {
	const headers = new Headers();
	let responseStatus: Status | undefined;

	const { data, error } = await runValidation(options as any, context as any);
	if (error) {
		throw new ValidationError(error.message, error.issues);
	}

	const requestHeaders: Headers | null =
		"headers" in context
			? context.headers instanceof Headers
				? context.headers
				: new Headers(context.headers)
			: "request" in context && isRequest(context.request)
				? context.request.headers
				: null;

	const requestCookies = requestHeaders?.get("cookie");
	const parsedCookies = requestCookies
		? parseCookies(requestCookies)
		: undefined;

	const internalContext = {
		...context,
		body: data.body,
		query: data.query,
		path: context.path || path || "virtual:",
		context: "context" in context && context.context ? context.context : {},
		headers: context?.headers,
		request: context?.request,
		params: "params" in context ? context.params : undefined,
		method:
			context.method ??
			(Array.isArray(options.method)
				? options.method[0]
				: options.method === "*"
					? "GET"
					: options.method),
		setHeader: (key: string, value: string) => {
			headers.set(key, value);
		},
		getHeader: (key: string) => {
			if (!requestHeaders) return null;
			return requestHeaders.get(key);
		},
		getCookie: (key: string, prefix?: CookiePrefixOptions) => {
			const finalKey = getCookieKey(key, prefix);
			if (!finalKey) {
				return null;
			}
			return parsedCookies?.get(finalKey) || null;
		},
		getSignedCookie: async (
			key: string,
			secret: string,
			prefix?: CookiePrefixOptions,
		) => {
			const finalKey = getCookieKey(key, prefix);
			if (!finalKey) {
				return null;
			}
			const value = parsedCookies?.get(finalKey);
			if (!value) {
				return null;
			}
			const signatureStartPos = value.lastIndexOf(".");
			if (signatureStartPos < 1) {
				return null;
			}
			const signedValue = value.substring(0, signatureStartPos);
			const signature = value.substring(signatureStartPos + 1);
			if (signature.length !== 44 || !signature.endsWith("=")) {
				return null;
			}
			const secretKey = await getCryptoKey(secret);
			const isVerified = await verifySignature(
				signature,
				signedValue,
				secretKey,
			);
			return isVerified ? signedValue : false;
		},
		setCookie: (key: string, value: string, options?: CookieOptions) => {
			const cookie = serializeCookie(key, value, options);
			headers.append("set-cookie", cookie);
			return cookie;
		},
		setSignedCookie: async (
			key: string,
			value: string,
			secret: string,
			options?: CookieOptions,
		) => {
			const cookie = await serializeSignedCookie(key, value, secret, options);
			headers.append("set-cookie", cookie);
			return cookie;
		},
		redirect: (url: string) => {
			headers.set("location", url);
			return new APIError("FOUND", undefined, headers);
		},
		error: (
			status: keyof typeof statusCodes | Status,
			body?:
				| {
						message?: string;
						code?: string;
				  }
				| undefined,
			headers?: HeadersInit,
		) => {
			return new APIError(status, body, headers);
		},
		setStatus: (status: Status) => {
			responseStatus = status;
		},
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
		): R => {
			if (!context.asResponse) {
				return json;
			}
			return {
				body: routerResponse?.body || json,
				routerResponse,
				_flag: "json",
			} as any;
		},
		get responseStatus() {
			return responseStatus;
		},
		responseHeaders: headers,
	} satisfies MiddlewareContext<any>;

	// Execute middleware chain
	for (const middleware of options.use || []) {
		const response = (await middleware({
			...internalContext,
			returnHeaders: true,
			asResponse: false,
		})) as {
			response?: any;
			headers?: Headers;
		};
		if (response.response) {
			Object.assign(internalContext.context, response.response);
		}
		if (response.headers) {
			response.headers.forEach((value, key) => {
				internalContext.responseHeaders.set(key, value);
			});
		}
	}

	return internalContext;
};
