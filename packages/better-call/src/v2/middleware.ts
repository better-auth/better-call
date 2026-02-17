import { createInternalContext, type EndpointContext } from "./context";
import type { Prettify } from "../helper";
import type { StandardSchemaV1 } from "../standard-schema";
import { isAPIError } from "../utils";
import { kAPIErrorHeaderSymbol } from "../error";
import type { InferUse } from "./types";

export interface MiddlewareOptions {
	body?: StandardSchemaV1;
	query?: StandardSchemaV1;
	error?: StandardSchemaV1;
	requireHeaders?: boolean;
	requireRequest?: boolean;
	use?: Middleware[];
	[key: string]: any;
}

export type MiddlewareResponse = null | void | undefined | Record<string, any>;

export type MiddlewareContext<
	Options extends MiddlewareOptions = MiddlewareOptions,
	Context = {},
> = {
	method: string;
	path: string;
	body: Options["body"] extends StandardSchemaV1<infer T> ? T : any;
	query: Options["query"] extends StandardSchemaV1<infer T>
		? T
		: Record<string, any> | undefined;
	params: string;
	request: Options["requireRequest"] extends true
		? Request
		: Request | undefined;
	headers: Options["requireHeaders"] extends true
		? Headers
		: Headers | undefined;
	setHeader: (key: string, value: string) => void;
	setStatus: (status: number) => void;
	getHeader: (key: string) => string | null;
	getCookie: (key: string, prefix?: string) => string | null;
	getSignedCookie: (
		key: string,
		secret: string,
		prefix?: string,
	) => Promise<string | null | false>;
	setCookie: (key: string, value: string, options?: any) => string;
	setSignedCookie: (
		key: string,
		value: string,
		secret: string,
		options?: any,
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
	redirect: (url: string) => any;
	error: (
		status: any,
		body?: {
			message?: string;
			code?: string;
		} & Record<string, any>,
		headers?: HeadersInit,
	) => any;
};

type MiddlewareInputContext<Options extends MiddlewareOptions> = {
	body?: Options["body"] extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Options["body"]>
		: any;
	query?: Options["query"] extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Options["query"]>
		: Record<string, any> | undefined;
	request?: Request;
	headers?: HeadersInit;
	asResponse?: boolean;
	returnHeaders?: boolean;
	use?: Middleware[];
	[key: string]: any;
};

export function createMiddleware<Options extends MiddlewareOptions, R>(
	options: Options,
	handler: (context: MiddlewareContext<Options>) => Promise<R>,
): Middleware<
	Options,
	<InputCtx extends MiddlewareInputContext<Options>>(
		inputContext: InputCtx,
	) => Promise<R>
>;
export function createMiddleware<Options extends MiddlewareOptions, R>(
	handler: (context: MiddlewareContext<Options>) => Promise<R>,
): Middleware<
	MiddlewareOptions,
	<InputCtx extends MiddlewareInputContext<Options>>(
		inputContext: InputCtx,
	) => Promise<R>
>;
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

export type Middleware<
	Options extends MiddlewareOptions = MiddlewareOptions,
	Handler extends (inputCtx: any) => Promise<any> = any,
> = Handler & {
	options: Options;
};

createMiddleware.create = <
	E extends {
		use?: Middleware[];
	},
>(
	opts?: E,
) => {
	type InferredContext = InferUse<E["use"]>;
	function fn<Options extends MiddlewareOptions, R>(
		options: Options,
		handler: (ctx: MiddlewareContext<Options, InferredContext>) => Promise<R>,
	): (inputContext: MiddlewareInputContext<Options>) => Promise<R>;
	function fn<Options extends MiddlewareOptions, R>(
		handler: (ctx: MiddlewareContext<Options, InferredContext>) => Promise<R>,
	): (inputContext: MiddlewareInputContext<Options>) => Promise<R>;
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
