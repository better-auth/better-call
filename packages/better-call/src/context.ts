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
	method: ResolveMethod<M>;
	path: Path;
	body: ResolveBody<BodySchema, Meta>;
	query: ResolveQuery<QuerySchema, Meta>;
	params: InferParam<Path>;
	request: ReqRequest extends true ? Request : Request | undefined;
	headers: ReqHeaders extends true ? Headers : Headers | undefined;
	setHeader: (key: string, value: string) => void;
	setStatus: (status: Status) => void;
	getHeader: (key: string) => string | null;
	getCookie: (key: string, prefix?: CookiePrefixOptions) => string | null;
	getSignedCookie: (
		key: string,
		secret: string,
		prefix?: CookiePrefixOptions,
	) => Promise<string | null | false>;
	setCookie: (key: string, value: string, options?: CookieOptions) => string;
	setSignedCookie: (
		key: string,
		value: string,
		secret: string,
		options?: CookieOptions,
	) => Promise<string>;
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
	context: 0 extends 1 & Use
		? Prettify<Context>
		: Prettify<Context & InferUse<Use>>;
	redirect: (url: string) => APIError;
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
