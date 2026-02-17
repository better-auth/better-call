import {
	createEndpoint,
	type Endpoint,
	type EndpointContext,
	type EndpointOptions,
} from "./endpoint";
import {
	createInternalContext,
	type InferBody,
	type InferBodyInput,
	type InferHeaders,
	type InferHeadersInput,
	type InferMiddlewareBody,
	type InferMiddlewareQuery,
	type InferQuery,
	type InferQueryInput,
	type InferRequest,
	type InferRequestInput,
	type InferUse,
	type InputContext,
} from "./context";
import type { Prettify } from "./helper";
import { isAPIError } from "./utils";
import { kAPIErrorHeaderSymbol } from "./error";

export interface MiddlewareOptions extends Omit<EndpointOptions, "method"> {}

type MiddlewareResponse = null | void | undefined | Record<string, any>;

export type MiddlewareContext<
	Options extends MiddlewareOptions,
	Context = {},
> = EndpointContext<
	string,
	Options & {
		method: "*";
	}
> & {
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
	body: InferMiddlewareBody<Options>;
	/**
	 * Query
	 *
	 * The query object will be the parsed query string from the request
	 * and validated against the query schema if it exists
	 */
	query: InferMiddlewareQuery<Options>;
	/**
	 * Params
	 *
	 * If the path is `/user/:id` and the request is `/user/1` then the
	 * params will
	 * be `{ id: "1" }` and if the path includes a wildcard like `/user/*`
	 * then the
	 * params will be `{ _: "1" }` where `_` is the wildcard key. If the
	 * wildcard
	 * is named like `/user/**:name` then the params will be `{ name: string }`
	 */
	params: string;
	/**
	 * Request object
	 *
	 * If `requireRequest` is set to true in the endpoint options this will be
	 * required
	 */
	request: InferRequest<Options>;
	/**
	 * Headers
	 *
	 * If `requireHeaders` is set to true in the endpoint options this will be
	 * required
	 */
	headers: InferHeaders<Options>;
	/**
	 * Set header
	 *
	 * If it's called outside of a request it will just be ignored.
	 */
	setHeader: (key: string, value: string) => void;
	/**
	 * Get header
	 *
	 * If it's called outside of a request it will just return null
	 *
	 * @param key  - The key of the header
	 * @returns
	 */
	getHeader: (key: string) => string | null;
	/**
	 * JSON
	 *
	 * a helper function to create a JSON response with
	 * the correct headers
	 * and status code. If `asResponse` is set to true in
	 * the context then
	 * it will return a Response object instead of the
	 * JSON object.
	 *
	 * @param json - The JSON object to return
	 * @param routerResponse - The response object to
	 * return if `asResponse` is
	 * true in the context this will take precedence
	 */
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
	/**
	 * Middleware context
	 */
	context: Prettify<Context>;
};

function createMiddleware<Options extends MiddlewareOptions, R>(
	options: Options,
	handler: (context: MiddlewareContext<Options>) => Promise<R>,
): <InputCtx extends MiddlewareInputContext<Options>>(
	inputContext: InputCtx,
) => Promise<R>;
function createMiddleware<Options extends MiddlewareOptions, R>(
	handler: (context: MiddlewareContext<Options>) => Promise<R>,
): <InputCtx extends MiddlewareInputContext<Options>>(
	inputContext: InputCtx,
) => Promise<R>;
function createMiddleware(optionsOrHandler: any, handler?: any) {
	const internalHandler = async (inputCtx: InputContext<any, any>) => {
		const context = inputCtx as InputContext<any, any>;
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
			// fixme(alex): this is workaround that set-cookie headers are not accessible when error is thrown from middleware
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

type MiddlewareInputContext<Options extends MiddlewareOptions> =
	InferBodyInput<Options> &
		InferQueryInput<Options> &
		InferRequestInput<Options> &
		InferHeadersInput<Options> & {
			asResponse?: boolean;
			returnHeaders?: boolean;
			use?: Middleware[];
		};

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
