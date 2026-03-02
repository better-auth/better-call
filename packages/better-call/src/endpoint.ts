import { createInternalContext, type EndpointContext } from "./context";
import type { CookieOptions, CookiePrefixOptions } from "./cookies";
import {
	APIError,
	BetterCallError,
	type Status,
	type statusCodes,
	ValidationError,
} from "./error";
import type { HasRequiredKeys, Prettify } from "./helper";
import type { Middleware } from "./middleware";
import type { OpenAPIParameter, OpenAPISchemaType } from "./openapi";
import type { StandardSchemaV1 } from "./standard-schema";
import { toResponse } from "./to-response";
import type {
	BodyOption,
	HasRequiredInputKeys,
	HTTPMethod,
	InferUse,
	InputContext,
	ResolveBodyInput,
	ResolveErrorInput,
	ResolveQueryInput,
} from "./types";
import { isAPIError, tryCatch } from "./utils";

export type { EndpointContext } from "./context";

export interface EndpointMetadata {
	/**
	 * Open API definition
	 */
	openapi?: {
		summary?: string;
		description?: string;
		tags?: string[];
		operationId?: string;
		parameters?: OpenAPIParameter[];
		requestBody?: {
			content: {
				"application/json": {
					schema: {
						type?: OpenAPISchemaType;
						properties?: Record<string, any>;
						required?: string[];
						$ref?: string;
					};
				};
			};
		};
		responses?: {
			[status: string]: {
				description: string;
				content?: {
					"application/json"?: {
						schema: {
							type?: OpenAPISchemaType;
							properties?: Record<string, any>;
							required?: string[];
							$ref?: string;
						};
					};
					"text/plain"?: {
						schema?: {
							type?: OpenAPISchemaType;
							properties?: Record<string, any>;
							required?: string[];
							$ref?: string;
						};
					};
					"text/html"?: {
						schema?: {
							type?: OpenAPISchemaType;
							properties?: Record<string, any>;
							required?: string[];
							$ref?: string;
						};
					};
				};
			};
		};
	};
	/**
	 * Infer body and query type from ts interface
	 *
	 * useful for generic and dynamic types
	 *
	 * @example
	 * ```ts
	 * const endpoint = createEndpoint("/path", {
	 * 		method: "POST",
	 * 		body: z.record(z.string()),
	 * 		$Infer: {
	 * 			body: {} as {
	 * 				type: InferTypeFromOptions<Option> // custom type inference
	 * 			}
	 * 		}
	 * 	}, async(ctx)=>{
	 * 		const body = ctx.body
	 * 	})
	 * ```
	 */
	$Infer?: {
		/**
		 * Body
		 */
		body?: any;
		/**
		 * Query
		 */
		query?: Record<string, any>;
		/**
		 * Error
		 */
		error?: any;
	};
	/**
	 * If enabled, endpoint won't be exposed over a router
	 * @deprecated Use path-less endpoints instead
	 */
	SERVER_ONLY?: boolean;
	/**
	 * If enabled, endpoint won't be exposed as an action to the client
	 * @deprecated Use path-less endpoints instead
	 */
	isAction?: boolean;
	/**
	 * Defines the places where the endpoint will be available
	 *
	 * Possible options:
	 * - `rpc` - the endpoint is exposed to the router, can be invoked directly and is available to the client
	 * - `server` - the endpoint is exposed to the router, can be invoked directly, but is not available to the client
	 * - `http` - the endpoint is only exposed to the router
	 * @default "rpc"
	 */
	scope?: "rpc" | "server" | "http";
	/**
	 * List of allowed media types (MIME types) for the endpoint
	 *
	 * if provided, only the media types in the list will be allowed to be passed in the body
	 *
	 * @example
	 * ```ts
	 * const endpoint = createEndpoint("/path", {
	 * 		method: "POST",
	 * 		allowedMediaTypes: ["application/json", "application/x-www-form-urlencoded"],
	 * 	}, async(ctx)=>{
	 * 		const body = ctx.body
	 * 	})
	 * ```
	 */
	allowedMediaTypes?: string[];
	/**
	 * Extra metadata
	 */
	[key: string]: any;
}

export interface EndpointRuntimeOptions {
	method: string | string[];
	body?: StandardSchemaV1;
	/**
	 * Query Schema
	 */
	query?: StandardSchemaV1;
	/**
	 * Error Schema
	 */
	error?: StandardSchemaV1;
	/**
	 * If true headers will be required to be passed in the context
	 */
	requireHeaders?: boolean;
	/**
	 * If true request object will be required
	 */
	requireRequest?: boolean;
	/**
	 * Clone the request object from the router
	 */
	cloneRequest?: boolean;
	/**
	 * If true the body will be undefined
	 */
	disableBody?: boolean;
	/**
	 * Endpoint metadata
	 */
	metadata?: EndpointMetadata;
	/**
	 * List of middlewares to use
	 */
	use?: Middleware[];
	/**
	 * A callback to run before any API error is thrown or returned
	 *
	 * @param e - The API error
	 */
	onAPIError?: (e: APIError) => void | Promise<void>;
	/**
	 * A callback to run before a validation error is thrown.
	 * You can customize the validation error message by throwing your own APIError.
	 */
	onValidationError?: (info: {
		message: string;
		issues: readonly StandardSchemaV1.Issue[];
	}) => void | Promise<void>;
}

export type Endpoint<
	Path extends string = string,
	Method = any,
	Body = any,
	Query = any,
	Use extends Middleware[] = any,
	R = any,
	Meta extends EndpointMetadata | undefined = EndpointMetadata | undefined,
	Error = any,
> = {
	(
		context: InputContext<Path, Method, Body, Query, false, false> & {
			asResponse: true;
		},
	): Promise<Response>;
	(
		context: InputContext<Path, Method, Body, Query, false, false> & {
			returnHeaders: true;
			returnStatus: true;
		},
	): Promise<{
		headers: Headers;
		status: number;
		response: Awaited<R>;
	}>;
	(
		context: InputContext<Path, Method, Body, Query, false, false> & {
			returnHeaders: true;
		},
	): Promise<{
		headers: Headers;
		response: Awaited<R>;
	}>;
	(
		context: InputContext<Path, Method, Body, Query, false, false> & {
			returnStatus: true;
		},
	): Promise<{
		status: number;
		response: Awaited<R>;
	}>;
	(
		context?: InputContext<Path, Method, Body, Query, false, false>,
	): Promise<Awaited<R>>;
	options: EndpointRuntimeOptions & {
		method: Method;
		metadata?: Meta;
	};
	path: Path;
};

// Path + options + handler overload
export function createEndpoint<
	Path extends string,
	Method extends HTTPMethod | HTTPMethod[] | "*",
	BodySchema extends object | undefined = undefined,
	QuerySchema extends object | undefined = undefined,
	Use extends Middleware[] = [],
	ReqHeaders extends boolean = false,
	ReqRequest extends boolean = false,
	R = unknown,
	Meta extends EndpointMetadata | undefined = undefined,
	ErrorSchema extends StandardSchemaV1 | undefined = undefined,
>(
	path: Path,
	options: { method: Method } & BodyOption<Method, BodySchema> & {
			query?: QuerySchema;
			use?: [...Use];
			requireHeaders?: ReqHeaders;
			requireRequest?: ReqRequest;
			error?: ErrorSchema;
			cloneRequest?: boolean;
			disableBody?: boolean;
			metadata?: Meta;
			onAPIError?: (e: APIError) => void | Promise<void>;
			onValidationError?: (info: {
				message: string;
				issues: readonly StandardSchemaV1.Issue[];
			}) => void | Promise<void>;
			[key: string]: any;
		},
	handler: (
		ctx: EndpointContext<
			Path,
			Method,
			BodySchema,
			QuerySchema,
			Use,
			ReqHeaders,
			ReqRequest,
			InferUse<Use>,
			Meta
		>,
	) => Promise<R>,
): Endpoint<
	Path,
	Method,
	ResolveBodyInput<BodySchema, Meta>,
	ResolveQueryInput<QuerySchema, Meta>,
	Use,
	R,
	Meta,
	ResolveErrorInput<ErrorSchema, Meta>
>;

// Options-only (virtual/path-less) overload
export function createEndpoint<
	Method extends HTTPMethod | HTTPMethod[] | "*",
	BodySchema extends object | undefined = undefined,
	QuerySchema extends object | undefined = undefined,
	Use extends Middleware[] = [],
	ReqHeaders extends boolean = false,
	ReqRequest extends boolean = false,
	R = unknown,
	Meta extends EndpointMetadata | undefined = undefined,
	ErrorSchema extends StandardSchemaV1 | undefined = undefined,
>(
	options: { method: Method } & BodyOption<Method, BodySchema> & {
			path?: never;
			query?: QuerySchema;
			use?: [...Use];
			requireHeaders?: ReqHeaders;
			requireRequest?: ReqRequest;
			error?: ErrorSchema;
			cloneRequest?: boolean;
			disableBody?: boolean;
			metadata?: Meta;
			onAPIError?: (e: APIError) => void | Promise<void>;
			onValidationError?: (info: {
				message: string;
				issues: readonly StandardSchemaV1.Issue[];
			}) => void | Promise<void>;
			[key: string]: any;
		},
	handler: (
		ctx: EndpointContext<
			never,
			Method,
			BodySchema,
			QuerySchema,
			Use,
			ReqHeaders,
			ReqRequest,
			InferUse<Use>,
			Meta
		>,
	) => Promise<R>,
): Endpoint<
	never,
	Method,
	ResolveBodyInput<BodySchema, Meta>,
	ResolveQueryInput<QuerySchema, Meta>,
	Use,
	R,
	Meta,
	ResolveErrorInput<ErrorSchema, Meta>
>;

// Implementation
export function createEndpoint(
	pathOrOptions: any,
	handlerOrOptions: any,
	handlerOrNever?: any,
): any {
	const path: string | undefined =
		typeof pathOrOptions === "string" ? pathOrOptions : undefined;
	const options: any =
		typeof handlerOrOptions === "object" ? handlerOrOptions : pathOrOptions;
	const handler: any =
		typeof handlerOrOptions === "function" ? handlerOrOptions : handlerOrNever;

	if ((options.method === "GET" || options.method === "HEAD") && options.body) {
		throw new BetterCallError("Body is not allowed with GET or HEAD methods");
	}

	if (path && /\/{2,}/.test(path)) {
		throw new BetterCallError("Path cannot contain consecutive slashes");
	}

	const runtimeOptions: EndpointRuntimeOptions = {
		method: options.method,
		body: options.body,
		query: options.query,
		error: options.error,
		requireHeaders: options.requireHeaders,
		requireRequest: options.requireRequest,
		cloneRequest: options.cloneRequest,
		disableBody: options.disableBody,
		metadata: options.metadata,
		use: options.use,
		onAPIError: options.onAPIError,
		onValidationError: options.onValidationError,
	};

	const internalHandler = async (...inputCtx: any[]): Promise<any> => {
		const context = (inputCtx[0] || {}) as Record<string, any>;
		const { data: internalContext, error: validationError } = await tryCatch(
			createInternalContext(context, {
				options: runtimeOptions,
				path,
			}),
		);

		if (validationError) {
			if (!(validationError instanceof ValidationError)) throw validationError;

			if (options.onValidationError) {
				await options.onValidationError({
					message: validationError.message,
					issues: validationError.issues,
				});
			}

			throw new APIError(400, {
				message: validationError.message,
				code: "VALIDATION_ERROR",
			});
		}

		const response = await handler(internalContext as any).catch(
			async (e: any) => {
				if (isAPIError(e)) {
					const onAPIError = options.onAPIError;
					if (onAPIError) {
						await onAPIError(e);
					}
					if (context.asResponse) {
						return e;
					}
				}
				throw e;
			},
		);

		const responseHeaders = internalContext.responseHeaders;
		const status = internalContext.responseStatus;

		return context.asResponse
			? toResponse(response, {
					headers: responseHeaders,
					status,
				})
			: context.returnHeaders
				? context.returnStatus
					? {
							headers: responseHeaders,
							response,
							status,
						}
					: {
							headers: responseHeaders,
							response,
						}
				: context.returnStatus
					? { response, status }
					: response;
	};

	internalHandler.options = runtimeOptions;
	internalHandler.path = path;
	return internalHandler as any;
}

createEndpoint.create = <E extends { use?: Middleware[] }>(opts?: E) => {
	return <
		Path extends string,
		Method extends HTTPMethod | HTTPMethod[] | "*",
		BodySchema extends object | undefined = undefined,
		QuerySchema extends object | undefined = undefined,
		Use extends Middleware[] = [],
		ReqHeaders extends boolean = false,
		ReqRequest extends boolean = false,
		R = unknown,
		Meta extends EndpointMetadata | undefined = undefined,
		ErrorSchema extends StandardSchemaV1 | undefined = undefined,
	>(
		path: Path,
		options: { method: Method } & BodyOption<Method, BodySchema> & {
				query?: QuerySchema;
				use?: [...Use];
				requireHeaders?: ReqHeaders;
				requireRequest?: ReqRequest;
				error?: ErrorSchema;
				cloneRequest?: boolean;
				disableBody?: boolean;
				metadata?: Meta;
				onAPIError?: (e: APIError) => void | Promise<void>;
				onValidationError?: (info: {
					message: string;
					issues: readonly StandardSchemaV1.Issue[];
				}) => void | Promise<void>;
				[key: string]: any;
			},
		handler: (
			ctx: EndpointContext<
				Path,
				Method,
				BodySchema,
				QuerySchema,
				Use,
				ReqHeaders,
				ReqRequest,
				InferUse<E["use"]>,
				Meta
			>,
		) => Promise<R>,
	): Endpoint<
		Path,
		Method,
		ResolveBodyInput<BodySchema, Meta>,
		ResolveQueryInput<QuerySchema, Meta>,
		Use,
		Awaited<R>,
		Meta,
		ResolveErrorInput<ErrorSchema, Meta>
	> => {
		return createEndpoint(
			path,
			{
				...options,
				use: [...(options?.use || []), ...(opts?.use || [])],
			} as any,
			handler as any,
		) as any;
	};
};
