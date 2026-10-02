import { fnOptions, type fnOptionsSchema } from "../../fn-options";
import { v } from "../../index";
import { isFn, type Module, type VarExtension } from "../../module";
import type { InferInput, TypeDefination } from "../../schema";
import type { LiteralString } from "../../types";
/** HTTP methods the router / client understand. */
export type RouteMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "PATCH"
	| "DELETE"
	| "HEAD"
	| "OPTIONS";

/**
 * Where an endpoint is available (better-call 1.x `metadata.scope`, plus
 * `SERVER_ONLY` as `"internal"`):
 *
 * | scope              | router (HTTP) | `router.api` | client |
 * | ------------------ | ------------- | ------------ | ------ |
 * | `"rpc"` (default)  | yes           | yes          | yes    |
 * | `"server"`         | yes           | yes          | no     |
 * | `"http"`           | yes           | no           | no     |
 * | `"internal"`       | no            | yes          | no     |
 */
export type RouteScope = "rpc" | "server" | "http" | "internal";

const ROUTE_SCOPES = [
	"rpc",
	"server",
	"http",
	"internal",
] as const satisfies readonly RouteScope[];

/** Served by {@link createRouter} (everything but `"internal"`). */
export const isRoutedScope = (scope: RouteScope | undefined): boolean =>
	scope !== "internal";

/** Callable in-process via `router.api` (everything but `"http"`). */
export const isServerScope = (scope: RouteScope | undefined): boolean =>
	scope !== "http";

/** On the typed / runtime client (`"rpc"` only). */
export const isClientScope = (scope: RouteScope | undefined): boolean =>
	scope === undefined || scope === "rpc";

/** Scope stamped on a fn's `$route`; missing means `"rpc"`. */
export type RouteScopeOf<F> = F extends { $route: { scope?: infer S } }
	? [Exclude<S, undefined>] extends [never]
		? "rpc"
		: Exclude<S, undefined> extends RouteScope
			? Exclude<S, undefined>
			: "rpc"
	: "rpc";

export type RouteOptions<
	P extends string = string,
	M extends RouteMethod = RouteMethod,
	I extends readonly string[] = readonly string[],
	S extends number = number,
	Sc extends RouteScope = RouteScope,
> = {
	path: P;
	method: M;
	/** Resource names the client should refresh after a successful call. */
	invalidate?: I;
	/** Where the endpoint is available (default `"rpc"`). See {@link RouteScope}. */
	scope?: Sc;
	/**
	 * Declared success status for this operation (default 200). Used by the
	 * router when the handler does not set `c.res.status`, and by OpenAPI
	 * as the primary success response code.
	 */
	status?: S;
};

/** Mutable per-call route state seeded by {@link route} into `c.route`. */
export type RouteState = {
	path: string;
	method: string;
	/** Mutable - handlers may push extra resource names at runtime. */
	invalidate: string[];
	/** Declared success status when set on {@link route}. */
	status?: number;
};

export type RouteMeta<
	P extends string = string,
	M extends string = string,
	I extends readonly string[] = readonly string[],
	S extends number = number,
> = {
	path: P;
	method: M;
	invalidate: I;
	/** Declared success status when set on {@link route}. */
	status?: S;
	/** Endpoint scope when not the default `"rpc"`. */
	scope?: RouteScope;
};

/** Header carrying the final invalidate list on successful responses. */
export const INVALIDATE_HEADER = "x-better-call-invalidate";

export const routeVar = v.var("route", {
	default: null as RouteState | null,
});

export type RouteModule<
	P extends string = string,
	M extends RouteMethod = RouteMethod,
	I extends readonly string[] = readonly string[],
	S extends number = number,
	Sc extends RouteScope = RouteScope,
> = Module & {
	readonly $route: true;
	readonly path: P;
	readonly method: M;
	readonly invalidate: I;
	readonly status?: S;
	readonly scope?: Sc;
	readonly route: typeof routeVar;
};

/**
 * Mount on a fn via `use: [route({ path, method, invalidate? })]`, or —
 * when `http` is already in scope — as fn options:
 * `{ path, method?, invalidate?, status? }`.
 *
 * Seeds mutable `c.route` for the call (handlers may push to
 * `c.route.invalidate`). Stamped onto the fn as `$route` for the router
 * and client.
 */
export function route<
	const P extends string,
	const M extends RouteMethod,
	const I extends readonly string[] = readonly [],
	const S extends number = number,
	const Sc extends RouteScope = "rpc",
>(options: RouteOptions<P, M, I, S, Sc>): RouteModule<P, M, I, S, Sc> {
	const invalidate = (options.invalidate ?? []) as I;
	const method = options.method.toUpperCase() as M;
	const path = options.path;

	return {
		$route: true,
		path,
		method,
		invalidate,
		...(options.status !== undefined ? { status: options.status } : {}),
		...(options.scope !== undefined ? { scope: options.scope } : {}),
		route: routeVar,
		// Seed `c.route` before the handler (and any other interceptors).
		$routeSeed: v.on("*", (c, next) => {
			c.route = {
				path,
				method,
				invalidate: [...invalidate],
				...(options.status !== undefined ? { status: options.status } : {}),
			};
			return next();
		}),
	} as RouteModule<P, M, I, S, Sc>;
}

export const isRouteModule = (value: unknown): value is RouteModule =>
	typeof value === "object" &&
	value !== null &&
	(value as { $route?: unknown }).$route === true &&
	typeof (value as { path?: unknown }).path === "string" &&
	typeof (value as { method?: unknown }).method === "string";

/** Read route meta stamped on a fn. */
export function getRouteMeta(fn: unknown): RouteMeta | undefined {
	if (!isFn(fn)) return undefined;
	const stamped = (fn as { $route?: RouteMeta }).$route;
	if (stamped?.path && stamped?.method) {
		return {
			path: stamped.path,
			method: stamped.method,
			invalidate: stamped.invalidate ?? [],
			...(stamped.status !== undefined ? { status: stamped.status } : {}),
			...(stamped.scope !== undefined ? { scope: stamped.scope } : {}),
		};
	}
	return undefined;
}

/** Find a {@link RouteModule} among resolved `use` modules. */
export function findRouteModule(
	modules: readonly Record<string, unknown>[],
): RouteModule | undefined {
	for (const mod of modules) {
		if (isRouteModule(mod)) return mod;
	}
	return undefined;
}

export function routeMetaFromModule(mod: RouteModule): RouteMeta {
	return {
		path: mod.path,
		method: String(mod.method).toUpperCase(),
		invalidate: [...(mod.invalidate ?? [])],
		...(mod.status !== undefined ? { status: mod.status } : {}),
		...(mod.scope !== undefined ? { scope: mod.scope } : {}),
	};
}

/**
 * Extra `v.fn` option keys unlocked when `http` (or this marker) is in `use`.
 * Prefer `{ path }` over `use: [route({ path, method })]` for new code.
 */
export type HttpOptions = {
	path?: LiteralString;
	method?: RouteMethod;
	invalidate?: readonly string[];
	status?: number;
	scope?: RouteScope;
};

/**
 * Extends core {@link fnOptions} with HTTP route keys. Mount via
 * `use: [httpOptions]`, `use: [{ httpOptions }]`, or `use: [http]` to unlock
 * `{ path, method?, … }` on `v.fn` options (runtime stamps `$route` when
 * `path` is set). `path` uses `literal: true` so call-site paths stay
 * narrow (`"/a"` not `string`).
 */
export const httpOptions = v.extend(fnOptions, {
	path: v.string({ literal: true, optional: true }),
	method: v.string({
		optional: true,
		enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
	}),
	invalidate: v.array(v.string(), { optional: true }),
	status: v.number({ optional: true }),
	scope: v.string({ optional: true, enum: ROUTE_SCOPES }),
});

/**
 * Portable return of {@link createHttpOptions}. Named so consumers that
 * export `http()` (or the options extension itself) can emit declarations
 * via `better-call/http` without referencing deep `plugins/...` paths
 * (TS2742 / TS2883).
 */
export type HttpOptionsExtension = VarExtension<
	"fnOptions",
	{
		readonly path: TypeDefination<
			LiteralString,
			LiteralString | null | undefined,
			undefined
		>;
		readonly method: TypeDefination<
			RouteMethod,
			RouteMethod | null | undefined,
			undefined
		>;
		readonly invalidate: TypeDefination<
			string[],
			string[] | null | undefined,
			undefined
		>;
		readonly status: TypeDefination<
			number,
			number | null | undefined,
			undefined
		>;
		readonly scope: TypeDefination<
			RouteScope,
			RouteScope | null | undefined,
			undefined
		>;
	},
	InferInput<typeof fnOptionsSchema>
>;

/** Per-mount httpOptions stamped by {@link createHttp} / {@link http}. */
export function createHttpOptions(): HttpOptionsExtension {
	return v.extend(fnOptions, {
		path: v.string({ literal: true, optional: true }),
		method: v.string({
			optional: true,
			enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
		}),
		invalidate: v.array(v.string(), { optional: true }),
		status: v.number({ optional: true }),
		scope: v.string({ optional: true, enum: ROUTE_SCOPES }),
	}) as HttpOptionsExtension;
}
