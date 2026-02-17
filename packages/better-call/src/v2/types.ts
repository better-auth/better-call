import type {
	HasRequiredKeys,
	IsEmptyObject,
	InferParamPath,
	InferParamWildCard,
	Prettify,
	UnionToIntersection,
} from "../helper";
import type { StandardSchemaV1 } from "../standard-schema";
import type { Middleware } from "./middleware";

export type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
export type Method = HTTPMethod | "*";

/**
 * Resolves a method type parameter to its effective runtime type.
 *
 * - `["GET", "POST"]` -> `"GET" | "POST"`
 * - `"*"` -> HTTPMethod
 * - `"GET"` -> `"GET"`
 */
export type ResolveMethod<M> =
	M extends Array<infer U> ? U : M extends "*" ? HTTPMethod : M;

/**
 * Resolves a body schema to its output type.
 */
export type ResolveBody<S, Meta = undefined> = Meta extends {
	$Infer: { body: infer B };
}
	? B
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferOutput<S>
		: any;

/**
 * Resolves a query schema to its output type.
 */
export type ResolveQuery<S, Meta = undefined> = Meta extends {
	$Infer: { query: infer Q };
}
	? Q
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferOutput<S>
		: Record<string, any> | undefined;

/**
 * Resolves body schema to its input type (for InputContext).
 */
export type ResolveBodyInput<S, Meta = undefined> = Meta extends {
	$Infer: { body: infer B };
}
	? B
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferInput<S>
		: undefined;

/**
 * Resolves query schema to its input type (for InputContext).
 */
export type ResolveQueryInput<S, Meta = undefined> = Meta extends {
	$Infer: { query: infer Q };
}
	? Q
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferInput<S>
		: Record<string, any> | undefined;

/**
 * Constraint: body is `never` for GET/HEAD methods.
 */
export type BodyOption<
	M,
	B extends StandardSchemaV1 | undefined = undefined,
> = M extends "GET" | "HEAD" | ("GET" | "HEAD")[]
	? { body?: never }
	: { body?: B };

/**
 * Resolves the result type based on asResponse/returnHeaders/returnStatus flags.
 */
export type ResultType<
	R,
	AsResponse extends boolean,
	ReturnHeaders extends boolean,
	ReturnStatus extends boolean,
> = AsResponse extends true
	? Response
	: ReturnHeaders extends true
		? ReturnStatus extends true
			? {
					headers: Headers;
					status: number;
					response: Awaited<R>;
				}
			: {
					headers: Headers;
					response: Awaited<R>;
				}
		: ReturnStatus extends true
			? {
					status: number;
					response: Awaited<R>;
				}
			: Awaited<R>;

/**
 * Infer param types from a path string.
 */
export type InferParam<Path extends string> = [Path] extends [never]
	? Record<string, any> | undefined
	: IsEmptyObject<InferParamPath<Path> & InferParamWildCard<Path>> extends true
		? Record<string, any> | undefined
		: Prettify<InferParamPath<Path> & InferParamWildCard<Path>>;

/**
 * Infer param input (required vs optional based on whether path has params).
 */
type InferParamInput<Path extends string> = [Path] extends [never]
	? { params?: Record<string, any> }
	: IsEmptyObject<InferParamPath<Path> & InferParamWildCard<Path>> extends true
		? { params?: Record<string, any> }
		: { params: Prettify<InferParamPath<Path> & InferParamWildCard<Path>> };

/**
 * Infer body input: required if body schema input is not undefined.
 */
type InferBodyInput<BodySchema extends StandardSchemaV1 | undefined, Meta> =
	undefined extends ResolveBodyInput<BodySchema, Meta>
		? { body?: ResolveBodyInput<BodySchema, Meta> }
		: { body: ResolveBodyInput<BodySchema, Meta> };

/**
 * Infer query input: required if query schema input is not undefined.
 */
type InferQueryInput<QuerySchema extends StandardSchemaV1 | undefined, Meta> =
	undefined extends ResolveQueryInput<QuerySchema, Meta>
		? { query?: ResolveQueryInput<QuerySchema, Meta> }
		: { query: ResolveQueryInput<QuerySchema, Meta> };

/**
 * Infer method input: required for wildcard, optional for arrays and single methods.
 */
type InferMethodInput<M> = M extends "*"
	? { method: HTTPMethod }
	: M extends Array<any>
		? { method?: M[number] | undefined }
		: { method?: M | undefined };

/**
 * Infer request input.
 */
type InferRequestInput<ReqRequest extends boolean> = ReqRequest extends true
	? { request: Request }
	: { request?: Request };

/**
 * Infer headers input.
 */
type InferHeadersInput<ReqHeaders extends boolean> = ReqHeaders extends true
	? { headers: HeadersInit }
	: { headers?: HeadersInit };

/**
 * Infer the use (middleware) context union.
 */
export type InferUse<Opts extends Middleware[] | undefined> =
	Opts extends Middleware[]
		? UnionToIntersection<Awaited<ReturnType<Opts[number]>>>
		: {};

/**
 * The full InputContext type, computed from all endpoint generics.
 */
export type InputContext<
	Path extends string,
	M,
	BodySchema extends StandardSchemaV1 | undefined,
	QuerySchema extends StandardSchemaV1 | undefined,
	ReqHeaders extends boolean,
	ReqRequest extends boolean,
	Meta,
> = InferBodyInput<BodySchema, Meta> &
	InferMethodInput<M> &
	InferQueryInput<QuerySchema, Meta> &
	InferParamInput<Path> &
	InferRequestInput<ReqRequest> &
	InferHeadersInput<ReqHeaders> & {
		asResponse?: boolean;
		returnHeaders?: boolean;
		returnStatus?: boolean;
		use?: Middleware[];
		path?: string;
		context?: Record<string, any>;
	};

/**
 * Check if the InputContext has required keys (to decide if the call argument is required or optional).
 */
export type HasRequiredInputKeys<
	Path extends string,
	M,
	BodySchema extends StandardSchemaV1 | undefined,
	QuerySchema extends StandardSchemaV1 | undefined,
	ReqHeaders extends boolean,
	ReqRequest extends boolean,
	Meta,
> = HasRequiredKeys<
	InputContext<Path, M, BodySchema, QuerySchema, ReqHeaders, ReqRequest, Meta>
>;
