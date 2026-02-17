import { createInternalContext } from "./context";
import type { Prettify } from "../helper";
import type { StandardSchemaV1 } from "../standard-schema";
import type { CookieOptions, CookiePrefixOptions } from "../cookies";
import type { Status, statusCodes } from "../error";
import { isAPIError } from "../utils";
import { kAPIErrorHeaderSymbol, APIError } from "../error";
import type {
	InferUse,
	ResolveBody,
	ResolveQuery,
	ResolveBodyInput,
	ResolveQueryInput,
} from "./types";

export type MiddlewareResponse = null | void | undefined | Record<string, any>;

/**
 * MiddlewareContext with flattened generics.
 * Body and Query are resolved via ResolveBody/ResolveQuery from the schema generics,
 * not extracted from an Options bag.
 */
export type MiddlewareContext<
	BodySchema extends object | undefined = undefined,
	QuerySchema extends object | undefined = undefined,
	ReqHeaders extends boolean = false,
	ReqRequest extends boolean = false,
	Context = {},
> = {
	method: string;
	path: string;
	body: ResolveBody<BodySchema>;
	query: ResolveQuery<QuerySchema>;
	params: string;
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
			  }
			| Response,
	) => Promise<R>;
	context: Prettify<Context>;
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
 * Options interface for createMiddleware.
 * Only used at the options parameter level — not stored in Middleware generics.
 */
export interface MiddlewareOptions<
	BodySchema extends object | undefined = undefined,
	QuerySchema extends object | undefined = undefined,
	ReqHeaders extends boolean = false,
	ReqRequest extends boolean = false,
> {
	body?: BodySchema &
		(BodySchema extends undefined ? unknown : StandardSchemaV1);
	query?: QuerySchema &
		(QuerySchema extends undefined ? unknown : StandardSchemaV1);
	error?: StandardSchemaV1;
	requireHeaders?: ReqHeaders;
	requireRequest?: ReqRequest;
	use?: Middleware[];
	[key: string]: any;
}

/**
 * Middleware type — stores resolved plain Body/Query types, not schema types.
 */
export type Middleware<
	Body = any,
	Query = any,
	Handler extends (inputCtx: any) => Promise<any> = any,
> = Handler & {
	options: {
		body?: StandardSchemaV1;
		query?: StandardSchemaV1;
		error?: StandardSchemaV1;
		requireHeaders?: boolean;
		requireRequest?: boolean;
		use?: Middleware[];
		[key: string]: any;
	};
};

type MiddlewareInputContext<
	BodySchema extends object | undefined,
	QuerySchema extends object | undefined,
> = {
	body?: ResolveBodyInput<BodySchema>;
	query?: ResolveQueryInput<QuerySchema>;
	request?: Request;
	headers?: HeadersInit;
	asResponse?: boolean;
	returnHeaders?: boolean;
	use?: Middleware[];
	[key: string]: any;
};

// Overload: options + handler
export function createMiddleware<
	BodySchema extends object | undefined = undefined,
	QuerySchema extends object | undefined = undefined,
	ReqHeaders extends boolean = false,
	ReqRequest extends boolean = false,
	R = unknown,
>(
	options: MiddlewareOptions<BodySchema, QuerySchema, ReqHeaders, ReqRequest>,
	handler: (
		context: MiddlewareContext<BodySchema, QuerySchema, ReqHeaders, ReqRequest>,
	) => Promise<R>,
): Middleware<
	ResolveBodyInput<BodySchema>,
	ResolveQueryInput<QuerySchema>,
	<InputCtx extends MiddlewareInputContext<BodySchema, QuerySchema>>(
		inputContext: InputCtx,
	) => Promise<R>
>;

// Overload: handler only
export function createMiddleware<R>(
	handler: (context: MiddlewareContext) => Promise<R>,
): Middleware<
	undefined,
	Record<string, any> | undefined,
	<InputCtx extends MiddlewareInputContext<undefined, undefined>>(
		inputContext: InputCtx,
	) => Promise<R>
>;

// Implementation
export function createMiddleware(optionsOrHandler: any, handler?: any) {
	const internalHandler = async (inputCtx: any) => {
		const context = inputCtx as Record<string, any>;
		const _handler =
			typeof optionsOrHandler === "function" ? optionsOrHandler : handler;
		const options =
			typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
		const internalContext = await createInternalContext(context, {
			options,
			path: "/",
		});

		if (!_handler) {
			throw new Error("handler must be defined");
		}
		try {
			const response = await _handler(internalContext as any);
			const headers = internalContext.responseHeaders;
			return context.returnHeaders
				? {
						headers,
						response,
					}
				: response;
		} catch (e) {
			if (isAPIError(e)) {
				Object.defineProperty(e, kAPIErrorHeaderSymbol, {
					enumerable: false,
					configurable: false,
					get() {
						return internalContext.responseHeaders;
					},
				});
			}
			throw e;
		}
	};
	internalHandler.options =
		typeof optionsOrHandler === "function" ? {} : optionsOrHandler;
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

	function fn<
		BodySchema extends object | undefined = undefined,
		QuerySchema extends object | undefined = undefined,
		ReqHeaders extends boolean = false,
		ReqRequest extends boolean = false,
		R = unknown,
	>(
		options: MiddlewareOptions<BodySchema, QuerySchema, ReqHeaders, ReqRequest>,
		handler: (
			ctx: MiddlewareContext<
				BodySchema,
				QuerySchema,
				ReqHeaders,
				ReqRequest,
				InferredContext
			>,
		) => Promise<R>,
	): Middleware<
		ResolveBodyInput<BodySchema>,
		ResolveQueryInput<QuerySchema>,
		(
			inputContext: MiddlewareInputContext<BodySchema, QuerySchema>,
		) => Promise<R>
	>;
	function fn<R>(
		handler: (
			ctx: MiddlewareContext<
				undefined,
				undefined,
				false,
				false,
				InferredContext
			>,
		) => Promise<R>,
	): Middleware<
		undefined,
		Record<string, any> | undefined,
		(inputContext: MiddlewareInputContext<undefined, undefined>) => Promise<R>
	>;
	function fn(optionsOrHandler: any, handler?: any) {
		if (typeof optionsOrHandler === "function") {
			return createMiddleware(
				{
					use: opts?.use,
				},
				optionsOrHandler,
			);
		}
		if (!handler) {
			throw new Error("Middleware handler is required");
		}
		const middleware = createMiddleware(
			{
				...optionsOrHandler,
				method: "*",
				use: [...(opts?.use || []), ...(optionsOrHandler.use || [])],
			},
			handler,
		);
		return middleware as any;
	}
	return fn;
};
