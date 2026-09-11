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
	readonly route: typeof routeVar;
};

/**
 * Mount on a fn via `use: [route({ path, method, invalidate? })]`.
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
	};
}
