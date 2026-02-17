import { createInternalContext } from "./context";
import type { Prettify } from "../helper";
import type { CookieOptions, CookiePrefixOptions } from "../cookies";
import type { Status, statusCodes } from "../error";
import { isAPIError } from "../utils";
import { kAPIErrorHeaderSymbol, APIError } from "../error";
import type { InferUse } from "./types";

export type MiddlewareContext<Context = {}> = {
	method: string;
	path: string;
	body: any;
	query: Record<string, any> | undefined;
	params: string;
	request: Request | undefined;
	headers: Headers | undefined;
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

export type Middleware<Handler extends (inputCtx: any) => Promise<any> = any> =
	Handler & {
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
							configurable: false,
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
						configurable: false,
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
