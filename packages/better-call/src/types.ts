import type {
	HasRequiredKeys,
	InferParamPath,
	InferParamWildCard,
	IsEmptyObject,
	Prettify,
	UnionToIntersection,
} from "./helper";
import type { Middleware } from "./middleware";
import type { StandardSchemaV1 } from "./standard-schema";

export type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";

/**
 * Resolves a method type parameter to its effective runtime type.
 */
export type ResolveMethod<M> =
	M extends Array<infer U> ? U : M extends "*" ? HTTPMethod : M;

/**
 * Resolve a $Infer value: if it's a StandardSchemaV1 schema, extract the
 * output type; otherwise use as-is.
 */
type ResolveInferValue<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferOutput<T>
	: T;
type ResolveInferValueInput<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferInput<T>
	: T;

/**
 * Resolves a body schema to its output type.
 */
export type ResolveBody<S, Meta = undefined> = Meta extends {
	$Infer: { body: infer B };
}
	? ResolveInferValue<B>
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferOutput<S>
		: any;

/**
 * Resolves a query schema to its output type.
 */
export type ResolveQuery<S, Meta = undefined> = Meta extends {
	$Infer: { query: infer Q };
}
	? ResolveInferValue<Q>
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferOutput<S>
		: Record<string, any> | undefined;

/**
 * Resolves body schema to its input type (for InputContext at call-site).
 */
export type ResolveBodyInput<S, Meta = undefined> = Meta extends {
	$Infer: { body: infer B };
}
	? ResolveInferValueInput<B>
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferInput<S>
		: undefined;

/**
 * Resolves query schema to its input type (for InputContext at call-site).
 */
export type ResolveQueryInput<S, Meta = undefined> = Meta extends {
	$Infer: { query: infer Q };
}
	? ResolveInferValueInput<Q>
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferInput<S>
		: Record<string, any> | undefined;

/**
 * Resolves error schema to its input type (for InputContext at call-site).
 */
export type ResolveErrorInput<S, Meta = undefined> = Meta extends {
	$Infer: { error: infer E };
}
	? ResolveInferValueInput<E>
	: S extends StandardSchemaV1
		? StandardSchemaV1.InferInput<S>
		: undefined;

/**
 * Resolves metadata by resolving any StandardSchemaV1 schemas inside $Infer to their input types.
 * Uses mapped type instead of Omit to avoid preserving the original schema types in declaration emit.
 */
export type ResolveMetaInput<Meta> = Meta extends {
	$Infer: infer I;
}
	? {
			[K in keyof Meta]: K extends "$Infer"
				? { [J in keyof I]: ResolveInferValueInput<I[J]> }
				: Meta[K];
		}
	: Meta;

/**
 * Constraint: body is `never` for GET/HEAD methods.
 */
export type BodyOption<M, B extends object | undefined = undefined> = M extends
	| "GET"
	| "HEAD"
	| ("GET" | "HEAD")[]
	? { body?: never }
	: { body?: B };

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
 * Infer body input from an already-resolved body type.
 * Body is the plain resolved type (not a schema).
 */
type InferBodyInput<Body> = undefined extends Body
	? { body?: Body }
	: { body: Body };

/**
 * Infer query input from an already-resolved query type.
 * Query is the plain resolved type (not a schema).
 */
type InferQueryInput<Query> = undefined extends Query
	? { query?: Query }
	: { query: Query };

/**
 * Infer method input: required for wildcard, optional for arrays and single methods.
 */
type InferMethodInput<M> = 0 extends 1 & M
	? { method?: HTTPMethod | undefined }
	: M extends "*"
		? { method: HTTPMethod }
		: M extends Array<any>
			? { method?: M[number] | undefined }
			: { method?: M | undefined };

/**
 * Infer request input.
 */
type InferRequestInput<ReqRequest extends boolean> = 0 extends 1 & ReqRequest
	? { request?: Request }
	: ReqRequest extends true
		? { request: Request }
		: { request?: Request };

/**
 * Infer headers input.
 */
type InferHeadersInput<ReqHeaders extends boolean> = 0 extends 1 & ReqHeaders
	? { headers?: HeadersInit }
	: ReqHeaders extends true
		? { headers: HeadersInit }
		: { headers?: HeadersInit };

/**
 * Infer the use (middleware) context union.
 * Guards against `any` and `[]` to avoid poisoning the Context type.
 */
export type InferUse<Opts extends Middleware[] | undefined> = 0 extends 1 & Opts
	? any
	: Opts extends Middleware[]
		? Opts extends []
			? {}
			: UnionToIntersection<Awaited<ReturnType<Opts[number]>>>
		: {};

/**
 * The full InputContext type for the Endpoint call signature.
 * Body and Query are already-resolved plain types.
 */
export type InputContext<
	Path extends string,
	M,
	Body,
	Query,
	ReqHeaders extends boolean,
	ReqRequest extends boolean,
> = InferBodyInput<Body> &
	InferMethodInput<M> &
	InferQueryInput<Query> &
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
 * Check if the InputContext has required keys.
 * Body and Query are already-resolved plain types.
 */
export type HasRequiredInputKeys<
	Path extends string,
	M,
	Body,
	Query,
	ReqHeaders extends boolean,
	ReqRequest extends boolean,
> = HasRequiredKeys<InputContext<Path, M, Body, Query, ReqHeaders, ReqRequest>>;
