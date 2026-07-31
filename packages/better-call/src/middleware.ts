import {
	createInternalContext,
	type InferHeadersInput,
	type InferRequestInput,
	type InferUse,
	type ParsedQuery,
} from "./context";
import type { EndpointContext, EndpointOptions } from "./endpoint";
import { kAPIErrorHeaderSymbol } from "./error";
import type { StandardSchemaV1 } from "./standard-schema";
import { isAPIError } from "./utils";

export interface MiddlewareOptions extends Omit<EndpointOptions, "method"> {}

export type MiddlewareResponse = null | undefined | Record<string, unknown>;

export type MiddlewareContext<
	Options extends MiddlewareOptions,
	Context extends object = object,
> = EndpointContext<
	string,
	Options & {
		method: "*";
	},
	Context
>;

type MiddlewareHandler<
	Options extends MiddlewareOptions,
	Result,
	Context extends object = object,
> = (context: MiddlewareContext<Options, Context>) => Promise<Result>;

type MiddlewareCallResult<InputContext, Result> = InputContext extends {
	returnHeaders: true;
}
	? {
			headers: Headers;
			response: Awaited<Result>;
		}
	: Result;

type MiddlewareFunction<Options extends MiddlewareOptions, Result> = <
	InputContext extends MiddlewareInputContext<Options>,
>(
	inputContext: InputContext,
) => Promise<MiddlewareCallResult<InputContext, Result>>;

export function createMiddleware<Options extends MiddlewareOptions, R>(
	options: Options,
	handler: MiddlewareHandler<Options, R>,
): Middleware<Options, MiddlewareFunction<Options, R>>;
export function createMiddleware<R>(
	handler: MiddlewareHandler<MiddlewareOptions, R>,
): Middleware<MiddlewareOptions, MiddlewareFunction<MiddlewareOptions, R>>;
export function createMiddleware<Options extends MiddlewareOptions, R>(
	...args:
		| [options: Options, handler: MiddlewareHandler<Options, R>]
		| [handler: MiddlewareHandler<MiddlewareOptions, R>]
) {
	if (args.length === 1) {
		return buildMiddleware({}, args[0]);
	}

	return buildMiddleware(args[0], args[1]);
}

function buildMiddleware<
	Options extends MiddlewareOptions,
	Result,
	Context extends object = object,
>(
	options: Options,
	handler: MiddlewareHandler<Options, Result, Context>,
): Middleware<Options, MiddlewareFunction<Options, Result>> {
	const endpointOptions = {
		...options,
		method: "*" as const,
	};

	const internalHandler = async <
		InputContext extends MiddlewareInputContext<Options>,
	>(
		context: InputContext,
	): Promise<MiddlewareCallResult<InputContext, Result>> => {
		const internalContext = await createInternalContext<
			string,
			typeof endpointOptions,
			Context
		>(context, {
			options: endpointOptions,
			path: "/",
		});

		try {
			const response = await handler(internalContext);
			const headers = internalContext.responseHeaders;
			return (
				context.returnHeaders
					? {
							headers,
							response,
						}
					: response
			) as MiddlewareCallResult<InputContext, Result>;
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
	internalHandler.options = options;
	return internalHandler;
}

type InferMiddlewareBodyInput<Options extends MiddlewareOptions> =
	Options["body"] extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Options["body"]>
		: unknown;

type InferMiddlewareQueryInput<Options extends MiddlewareOptions> =
	Options["query"] extends StandardSchemaV1
		? StandardSchemaV1.InferInput<Options["query"]>
		: ParsedQuery | undefined;

export type MiddlewareInputContext<Options extends MiddlewareOptions> = {
	body?: InferMiddlewareBodyInput<Options>;
	query?: InferMiddlewareQueryInput<Options>;
} & InferRequestInput<Options> &
	InferHeadersInput<Options> & {
		asResponse?: boolean;
		returnHeaders?: boolean;
		use?: Middleware[];
	};

export type Middleware<
	Options extends MiddlewareOptions = MiddlewareOptions,
	Handler extends (...input: never[]) => Promise<unknown> = (
		...input: never[]
	) => Promise<unknown>,
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
		handler: MiddlewareHandler<Options, R, InferredContext>,
	): Middleware<Options, MiddlewareFunction<Options, R>>;
	function fn<R>(
		handler: MiddlewareHandler<MiddlewareOptions, R, InferredContext>,
	): Middleware<MiddlewareOptions, MiddlewareFunction<MiddlewareOptions, R>>;
	function fn<Options extends MiddlewareOptions, R>(
		optionsOrHandler:
			| Options
			| MiddlewareHandler<MiddlewareOptions, R, InferredContext>,
		handler?: MiddlewareHandler<Options, R, InferredContext>,
	) {
		if (typeof optionsOrHandler === "function") {
			return buildMiddleware(
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
				use: [...(opts?.use || []), ...(optionsOrHandler.use || [])],
			},
			handler,
		);
		return middleware;
	}
	return fn;
};
