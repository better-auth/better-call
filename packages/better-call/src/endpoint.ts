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
	ResolveBody,
	ResolveBodyInput,
	ResolveQuery,
	ResolveQueryInput,
	ResultType,
} from "./types";
import { isAPIError, tryCatch } from "./utils";

export type { EndpointContext } from "./context";

export interface EndpointMetadata {
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
	$Infer?: {
		body?: any;
		query?: Record<string, any>;
	};
	SERVER_ONLY?: boolean;
	isAction?: boolean;
	scope?: "rpc" | "server" | "http";
	allowedMediaTypes?: string[];
	[key: string]: any;
}

export interface EndpointRuntimeOptions {
	method: string | string[];
	body?: StandardSchemaV1;
	query?: StandardSchemaV1;
	error?: StandardSchemaV1;
	requireHeaders?: boolean;
	requireRequest?: boolean;
	cloneRequest?: boolean;
	disableBody?: boolean;
	metadata?: EndpointMetadata;
	use?: Middleware[];
	onAPIError?: (e: APIError) => void | Promise<void>;
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
> = {
	<
		AsResponse extends boolean = false,
		ReturnHeaders extends boolean = false,
		ReturnStatus extends boolean = false,
	>(
		...args: HasRequiredInputKeys<
			Path,
			Method,
			Body,
			Query,
			false,
			false
		> extends true
			? [
					InputContext<Path, Method, Body, Query, false, false> & {
						asResponse?: AsResponse;
						returnHeaders?: ReturnHeaders;
						returnStatus?: ReturnStatus;
					},
				]
			: [
					(InputContext<Path, Method, Body, Query, false, false> & {
						asResponse?: AsResponse;
						returnHeaders?: ReturnHeaders;
						returnStatus?: ReturnStatus;
					})?,
				]
	): Promise<ResultType<R, AsResponse, ReturnHeaders, ReturnStatus>>;
	options: EndpointRuntimeOptions & { method: Method; metadata?: Meta };
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
>(
	path: Path,
	options: { method: Method } & BodyOption<Method, BodySchema> & {
			query?: QuerySchema;
			use?: [...Use];
			requireHeaders?: ReqHeaders;
			requireRequest?: ReqRequest;
			error?: StandardSchemaV1;
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
	Meta
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
>(
	options: { method: Method } & BodyOption<Method, BodySchema> & {
			path?: never;
			query?: QuerySchema;
			use?: [...Use];
			requireHeaders?: ReqHeaders;
			requireRequest?: ReqRequest;
			error?: StandardSchemaV1;
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
	Meta
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
	>(
		path: Path,
		options: { method: Method } & BodyOption<Method, BodySchema> & {
				query?: QuerySchema;
				use?: [...Use];
				requireHeaders?: ReqHeaders;
				requireRequest?: ReqRequest;
				error?: StandardSchemaV1;
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
		Meta
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
