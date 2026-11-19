import type { InferRouteParams } from "rou3";
import type { CookieOptions, CookiePrefixOptions } from "./cookies";
import {
	getCookieKey,
	parseCookies,
	serializeCookie,
	serializeSignedCookie,
} from "./cookies";
import { getCryptoKey, verifySignature } from "./crypto";
import type { EndpointOptions } from "./endpoint";
import type { Status, statusCodes } from "./error";
import { APIError, ValidationError } from "./error";
import type { IsEmptyObject, Prettify, UnionToIntersection } from "./helper";
import type { MiddlewareHandler, MiddlewareOptions } from "./middleware";
import type { StandardSchemaV1 } from "./standard-schema";
import { copyHeaders } from "./to-response";
import { isRequest } from "./utils";
import { runValidation } from "./validator";

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

type TrailingWildcardKey<Path extends string> =
	Path extends `${infer Prefix}/*${"" | "/"}`
		? Exclude<keyof InferRouteParams<Path>, keyof InferRouteParams<Prefix>>
		: never;

type RouteParams<Path extends string> = {
	[Key in keyof InferRouteParams<Path>]: Key extends TrailingWildcardKey<Path>
		? InferRouteParams<Path>[Key] | undefined
		: InferRouteParams<Path>[Key];
};

export type InferParam<Path extends string> = string extends Path
	? Record<string, string | undefined> | undefined
	: [Path] extends [never]
		? Record<string, string | undefined> | undefined
		: IsEmptyObject<RouteParams<Path>> extends true
			? Record<string, string | undefined> | undefined
			: Prettify<RouteParams<Path>>;

export type InferParamInput<Path extends string> = string extends Path
	? { params?: Record<string, string | undefined> }
	: [Path] extends [never]
		? { params?: Record<string, string | undefined> }
		: IsEmptyObject<RouteParams<Path>> extends true
			? {
					params?: Record<string, string | undefined>;
				}
			: {
					params: Prettify<RouteParams<Path>>;
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
			request?: Request | undefined;
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
			headers?: HeadersInit | undefined;
		};

type InferMiddlewareContext<T> = T extends (...args: never[]) => infer Result
	? unknown extends Awaited<Result>
		? never
		: Extract<Awaited<Result>, object>
	: never;

type InferMiddlewareContexts<Opts extends EndpointOptions["use"]> =
	Opts extends MiddlewareHandler[]
		? InferMiddlewareContext<Opts[number]>
		: never;

export type InferUse<Opts extends EndpointOptions["use"]> = [
	InferMiddlewareContexts<Opts>,
] extends [never]
	? object
	: UnionToIntersection<InferMiddlewareContexts<Opts>>;

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
		use?: MiddlewareHandler[];
		path?: string;
		context?: Record<string, any>;
	};

class InternalContext {
	body: any;
	query: any;
	path = "virtual:";
	context: Record<string, any> = {};
	method = "GET";
	returned: any;
	headers?: HeadersInit;
	request?: Request;
	params?: Record<string, string | undefined>;
	asResponse?: boolean;
	returnHeaders?: boolean;
	returnStatus?: boolean;
	_responseHeaders: Headers | undefined = undefined;
	_requestHeaders: Headers | null = null;
	_parsedCookies: Map<string, string> | undefined;
	_cookiesParsed = false;
	_responseStatus: Status | undefined;

	get responseStatus() {
		return this._responseStatus;
	}

	get responseHeaders(): Headers {
		if (!this._responseHeaders) {
			this._responseHeaders = new Headers();
		}
		return this._responseHeaders;
	}

	cookies() {
		if (!this._cookiesParsed) {
			this._cookiesParsed = true;
			const header = this._requestHeaders?.get("cookie");
			if (header) {
				this._parsedCookies = parseCookies(header);
			}
		}
		return this._parsedCookies;
	}

	setHeader(key: string, value: string) {
		this.responseHeaders.set(key, value);
	}

	getHeader(key: string) {
		return this._requestHeaders?.get(key) ?? null;
	}

	getCookie(key: string, prefix?: CookiePrefixOptions) {
		const finalKey = getCookieKey(key, prefix);
		if (!finalKey) {
			return null;
		}
		return this.cookies()?.get(finalKey) || null;
	}

	async getSignedCookie(
		key: string,
		secret: string,
		prefix?: CookiePrefixOptions,
	) {
		const finalKey = getCookieKey(key, prefix);
		if (!finalKey) {
			return null;
		}
		const value = this.cookies()?.get(finalKey);
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
		const isVerified = await verifySignature(signature, signedValue, secretKey);
		return isVerified ? signedValue : false;
	}

	setCookie(key: string, value: string, options?: CookieOptions) {
		const cookie = serializeCookie(key, value, options);
		this.responseHeaders.append("set-cookie", cookie);
		return cookie;
	}

	async setSignedCookie(
		key: string,
		value: string,
		secret: string,
		options?: CookieOptions,
	) {
		const cookie = await serializeSignedCookie(key, value, secret, options);
		this.responseHeaders.append("set-cookie", cookie);
		return cookie;
	}

	redirect(url: string) {
		const headers = this.responseHeaders;
		headers.set("location", url);
		return new APIError("FOUND", undefined, headers);
	}

	error(
		status: keyof typeof statusCodes | Status,
		body?:
			| {
					message?: string;
					code?: string;
			  }
			| undefined,
		headers?: HeadersInit,
	) {
		return new APIError(status, body, headers);
	}

	setStatus(status: Status) {
		this._responseStatus = status;
	}

	json(
		json: Record<string, any>,
		routerResponse?:
			| {
					status?: number;
					headers?: Record<string, string>;
					response?: Response;
					body?: Record<string, any>;
			  }
			| Response,
	) {
		if (!this.asResponse) {
			return json;
		}
		return {
			body: routerResponse?.body || json,
			routerResponse,
			_flag: "json",
		};
	}
}

function resolveRequestHeaders(
	context: InputContext<any, any>,
): Headers | null {
	if (context.headers !== undefined) {
		return context.headers instanceof Headers
			? context.headers
			: new Headers(context.headers);
	}
	if ("request" in context && isRequest(context.request)) {
		return context.request.headers;
	}
	return null;
}

function applyUse(
	ctx: InternalContext,
	options: EndpointOptions,
): InternalContext | Promise<InternalContext> {
	const hooks = options.use;
	if (!hooks?.length) {
		return ctx;
	}
	return applyUseAsync(ctx, hooks);
}

async function applyUseAsync(ctx: InternalContext, hooks: MiddlewareHandler[]) {
	for (const middleware of hooks) {
		const response = (await middleware({
			...ctx,
			returnHeaders: true,
			asResponse: false,
		})) as {
			response?: any;
			headers?: Headers;
		};
		if (response.response) {
			Object.assign(ctx.context, response.response);
		}
		if (response.headers) {
			copyHeaders(ctx.responseHeaders, response.headers);
		}
	}
	return ctx;
}

function fillContext(
	ctx: InternalContext,
	context: InputContext<any, any>,
	options: EndpointOptions,
	path: string | undefined,
) {
	ctx.body = context.body;
	ctx.query = context.query;
	ctx.path = context.path || path || "virtual:";
	ctx.context = "context" in context && context.context ? context.context : {};
	if (context.headers !== undefined) {
		ctx.headers = context.headers;
	}
	if (context.request !== undefined) {
		ctx.request = context.request;
	}
	if ("params" in context) {
		ctx.params = context.params;
	}
	ctx.method =
		context.method ??
		(Array.isArray(options.method)
			? options.method[0]
			: options.method === "*"
				? "GET"
				: options.method);
	if (context.asResponse) {
		ctx.asResponse = true;
	}
	if (context.returnHeaders) {
		ctx.returnHeaders = true;
	}
	if (context.returnStatus) {
		ctx.returnStatus = true;
	}
	ctx._requestHeaders = resolveRequestHeaders(context);
}

export const createInternalContext = (
	context: InputContext<any, any>,
	{
		options,
		path,
	}: {
		options: EndpointOptions;
		path?: string | undefined;
	},
): InternalContext | Promise<InternalContext> => {
	const ctx = new InternalContext();
	fillContext(ctx, context, options, path);

	const needsValidation = Boolean(
		options.body ||
			options.query ||
			options.requireHeaders ||
			options.requireRequest,
	);
	if (!needsValidation) {
		return applyUse(ctx, options);
	}

	return runValidation(options, context).then(({ data, error }) => {
		if (error) {
			throw new ValidationError(error.message, error.issues);
		}
		ctx.body = data.body;
		ctx.query = data.query;
		return applyUse(ctx, options);
	});
};
