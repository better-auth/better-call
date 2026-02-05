import type { EndpointOptions } from "./endpoint";
import {
	type statusCodes,
	APIError,
	ValidationError,
	type Status,
} from "./error";
import type {
	InferParamPath,
	InferParamWildCard,
	IsEmptyObject,
	Prettify,
	UnionToIntersection,
} from "./helper";
import type {
	Middleware,
	MiddlewareContext,
	MiddlewareOptions,
} from "./middleware";
import { runValidation } from "./validator";
import {
	getCookieKey,
	parseCookies,
	serializeCookie,
	serializeSignedCookie,
	type CookieOptions,
	type CookiePrefixOptions,
} from "./cookies";
import { getCryptoKey, verifySignature } from "./crypto";
import type { StandardSchemaV1 } from "./standard-schema";
import { isRequest } from "./utils";

export type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
export type Method = HTTPMethod | "*";

export type InferBodyInput<
	Options extends EndpointOptions | MiddlewareOptions,
	Body = Options["metadata"] extends {
		$Infer: {
			body: infer B;
		};
	}
		? B
		: Options["body"] extends StandardSchemaV1
			? StandardSchemaV1.InferInput<Options["body"]>
			: undefined,
> = undefined extends Body
	? {
			body?: Body;
		}
	: {
			body: Body;
		};

export type InferBody<Options extends EndpointOptions | MiddlewareOptions> =
	Options["metadata"] extends {
		$Infer: {
			body: infer Body;
		};
	}
		? Body
		: Options["body"] extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Options["body"]>
			: any;

export type InferQueryInput<
	Options extends EndpointOptions | MiddlewareOptions,
	Query = Options["metadata"] extends {
		$Infer: {
			query: infer Query;
		};
	}
		? Query
		: Options["query"] extends StandardSchemaV1
			? StandardSchemaV1.InferInput<Options["query"]>
			: Record<string, any> | undefined,
> = undefined extends Query
	? {
			query?: Query;
		}
	: {
			query: Query;
		};

export type InferQuery<Options extends EndpointOptions | MiddlewareOptions> =
	Options["metadata"] extends {
		$Infer: {
			query: infer Query;
		};
	}
		? Query
		: Options["query"] extends StandardSchemaV1
			? StandardSchemaV1.InferOutput<Options["query"]>
			: Record<string, any> | undefined;

export type InferMethod<Options extends EndpointOptions> =
	Options["method"] extends Array<Method>
		? Options["method"][number]
		: Options["method"] extends "*"
			? HTTPMethod
			: Options["method"];

export type InferInputMethod<
	Options extends EndpointOptions,
	Method = Options["method"] extends Array<any>
		? Options["method"][number] | undefined
		: Options["method"] extends "*"
			? HTTPMethod
			: Options["method"] | undefined,
> = undefined extends Method
	? {
			method?: Method;
		}
	: {
			method: Method;
		};

export type InferParam<Path extends string> = [Path] extends [never]
	? Record<string, any> | undefined
	: IsEmptyObject<InferParamPath<Path> & InferParamWildCard<Path>> extends true
		? Record<string, any> | undefined
		: Prettify<InferParamPath<Path> & InferParamWildCard<Path>>;

export type InferParamInput<Path extends string> = [Path] extends [never]
	? { params?: Record<string, any> }
	: IsEmptyObject<InferParamPath<Path> & InferParamWildCard<Path>> extends true
		? {
				params?: Record<string, any>;
			}
		: {
				params: Prettify<InferParamPath<Path> & InferParamWildCard<Path>>;
			};

export type InferRequest<Option extends EndpointOptions | MiddlewareOptions> =
	Option["requireRequest"] extends true ? Request : Request | undefined;

export type InferRequestInput<
	Option extends EndpointOptions | MiddlewareOptions,
> = Option["requireRequest"] extends true
	? {
			request: Request;
		}
	: {
			request?: Request;
		};

export type InferHeaders<Option extends EndpointOptions | MiddlewareOptions> =
	Option["requireHeaders"] extends true ? Headers : Headers | undefined;

export type InferHeadersInput<
	Option extends EndpointOptions | MiddlewareOptions,
> = Option["requireHeaders"] extends true
	? {
			headers: HeadersInit;
		}
	: {
			headers?: HeadersInit;
		};

export type InferUse<Opts extends EndpointOptions["use"]> =
	Opts extends Middleware[]
		? UnionToIntersection<Awaited<ReturnType<Opts[number]>>>
		: {};

export type InferMiddlewareBody<Options extends MiddlewareOptions> =
	Options["body"] extends StandardSchemaV1<infer T> ? T : any;

export type InferMiddlewareQuery<Options extends MiddlewareOptions> =
	Options["query"] extends StandardSchemaV1<infer T>
		? T
		: Record<string, any> | undefined;

export type InputContext<
	Path extends string,
	Options extends EndpointOptions,
> = InferBodyInput<Options> &
	InferInputMethod<Options> &
	InferQueryInput<Options> &
	InferParamInput<Path> &
	InferRequestInput<Options> &
	InferHeadersInput<Options> & {
		asResponse?: boolean;
		returnHeaders?: boolean;
		returnStatus?: boolean;
		use?: Middleware[];
		path?: string;
		context?: Record<string, any>;
	};

export const createInternalContext = async (
	context: InputContext<any, any>,
	{
		options,
		path,
	}: {
		options: EndpointOptions;
		path?: string;
	},
) => {
	const headers = new Headers();
	let responseStatus: Status | undefined = undefined;

	const { data, error } = await runValidation(options, context);
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
		returned: undefined as any,
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
		json: (
			json: Record<string, any>,
			routerResponse?:
				| {
						status?: number;
						headers?: Record<string, string>;
						response?: Response;
						body?: Record<string, any>;
				  }
				| Response,
		) => {
			if (!context.asResponse) {
				return json;
			}
			return {
				body: routerResponse?.body || json,
				routerResponse,
				_flag: "json",
			};
		},
		responseHeaders: headers,
		get responseStatus() {
			return responseStatus;
		},
	};
	//if context was shimmed through the input we want to apply it
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
		/**
		 * Apply headers from the middleware to the endpoint headers
		 */
		if (response.headers) {
			response.headers.forEach((value, key) => {
				internalContext.responseHeaders.set(key, value);
			});
		}
	}
	return internalContext;
};
