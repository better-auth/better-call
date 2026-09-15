import { v } from "../../index";
import { isFn, type Module } from "../../module";

/** HTTP methods the router / client understand. */
export type RouteMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "PATCH"
	| "DELETE"
	| "HEAD"
	| "OPTIONS";

export type RouteOptions<
	P extends string = string,
	M extends RouteMethod = RouteMethod,
	I extends readonly string[] = readonly string[],
> = {
	path: P;
	method: M;
	/** Resource names the client should refresh after a successful call. */
	invalidate?: I;
	/**
	 * Declared success status for this operation (default 200). Used by the
	 * router when the handler does not set `c.res.status`, and by OpenAPI
	 * as the primary success response code.
	 */
	status?: number;
};

/** Mutable per-call route state seeded by {@link route} into `c.route`. */
export type RouteState = {
	path: string;
	method: string;
	/** Mutable - handlers may push extra resource names at runtime. */
	invalidate: string[];
};

export type RouteMeta<
	P extends string = string,
	M extends string = string,
	I extends readonly string[] = readonly string[],
> = {
	path: P;
	method: M;
	invalidate: I;
	/** Declared success status when set on {@link route}. */
	status?: number;
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
> = Module & {
	readonly $route: true;
	readonly path: P;
	readonly method: M;
	readonly invalidate: I;
	readonly status?: number;
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
>(options: RouteOptions<P, M, I>): RouteModule<P, M, I> {
	const invalidate = (options.invalidate ?? []) as I;
	const method = options.method.toUpperCase() as M;
	const path = options.path;

	return {
		$route: true,
		path,
		method,
		invalidate,
		...(options.status !== undefined ? { status: options.status } : {}),
		route: routeVar,
		// Seed `c.route` before the handler (and any other interceptors).
		$routeSeed: v.on("*", (c, next) => {
			c.route = {
				path,
				method,
				invalidate: [...invalidate],
			};
			return next();
		}),
	} as RouteModule<P, M, I>;
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
	};
}

/**
 * Extra `v.fn` option keys unlocked when `http` (or this marker) is in `use`.
 * Prefer `{ path }` over `use: [route({ path, method })]` for new code.
 */
export type HttpFnOptions = {
	path?: string;
	method?: RouteMethod;
	invalidate?: readonly string[];
	status?: number;
};

/** Type carrier mounted on the `http` module (and as a named export). */
export const $fnOptions = {} as HttpFnOptions;

/**
 * When `path` is set, synthesize a {@link route} module into `use`.
 * Method defaults like better-auth's client: POST if `input` is declared,
 * otherwise GET.
 */
export function $applyFnOptions(options: Record<string, any>): void {
	if (typeof options.path !== "string") return;
	const method =
		(options.method as RouteMethod | undefined) ??
		(options.input !== undefined ? "POST" : "GET");
	options.use = [
		...((options.use ?? []) as Module[]),
		route({
			path: options.path,
			method,
			invalidate: options.invalidate,
			status: options.status,
		}),
	];
}
