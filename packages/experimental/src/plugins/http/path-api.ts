import type { FnDefination } from "../../fn";
import { isFn, isNamespace } from "../../module";
import { getRouteMeta } from "./route";

/** `sign-up` → `signUp`; `:id` → `id`. */
export type KebabToCamel<S extends string> = S extends `:${infer Param}`
	? KebabToCamel<Param>
	: S extends `${infer Head}-${infer Tail}`
		? `${Head}${Capitalize<KebabToCamel<Tail>>}`
		: S;

type StripSlashes<P extends string> = P extends `/${infer R}`
	? StripSlashes<R>
	: P extends `${infer R}/`
		? StripSlashes<R>
		: P;

/** `/sign-up/email` → `["signUp", "email"]`. */
export type PathToKeys<P extends string> =
	StripSlashes<P> extends ""
		? []
		: StripSlashes<P> extends `${infer H}/${infer T}`
			? [KebabToCamel<H>, ...PathToKeys<T>]
			: [KebabToCamel<StripSlashes<P>>];

export type NestKeys<
	Keys extends readonly string[],
	V,
> = Keys extends readonly [
	infer K extends string,
	...infer Rest extends string[],
]
	? Rest["length"] extends 0
		? { readonly [P in K]: V }
		: { readonly [P in K]: NestKeys<Rest, V> }
	: V;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type UnionToIntersection<U> = (
	U extends unknown
		? (x: U) => void
		: never
) extends (x: infer I) => void
	? I
	: never;

/** Nest a value under path keys: `/sign-up/email` + V → `{ signUp: { email: V } }`. */
export type NestPathEndpoint<P extends string, V> = NestKeys<PathToKeys<P>, V>;

/** Runtime: `/sign-up/email` → `["signUp", "email"]`. */
export function pathToClientKeys(path: string): string[] {
	return path
		.split("/")
		.filter(Boolean)
		.map((segment) => {
			const raw = segment.startsWith(":") ? segment.slice(1) : segment;
			return raw.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
		});
}

export type PathRouteLeaf = {
	path: string;
	method: string;
	invalidate: readonly string[];
	fn: FnDefination<any, any, any, any, any, any>;
	/** Dotted export name (`signInEmail` or `auth.signInEmail`). */
	name: string;
	schema?: unknown;
};

/** Flatten a routes module to every `$route`-stamped fn. */
export function flattenRouteLeaves(
	module: Record<string, unknown>,
	prefix = "",
): PathRouteLeaf[] {
	const out: PathRouteLeaf[] = [];
	for (const [key, value] of Object.entries(module)) {
		const name = prefix ? `${prefix}.${key}` : key;
		if (isFn(value)) {
			const meta = getRouteMeta(value);
			if (meta) {
				out.push({
					name,
					path: meta.path,
					method: meta.method,
					invalidate: meta.invalidate,
					fn: value as FnDefination<any, any, any, any, any, any>,
					schema: (value as { $schema?: unknown }).$schema,
				});
			}
			continue;
		}
		if (isNamespace(value)) {
			out.push(...flattenRouteLeaves(value as Record<string, unknown>, name));
		}
	}
	return out;
}

/**
 * Nest leaves by HTTP path (`/sign-up/email` → `{ signUp: { email: leaf } }`).
 * Colliding paths overwrite (last wins).
 */
export function buildPathTree(
	leaves: PathRouteLeaf[],
): Record<string, unknown> {
	const root: Record<string, unknown> = {};
	for (const leaf of leaves) {
		const keys = pathToClientKeys(leaf.path);
		if (keys.length === 0) continue;
		let node = root;
		for (let i = 0; i < keys.length - 1; i++) {
			const key = keys[i];
			if (key === undefined) continue;
			const next = node[key];
			if (
				!next ||
				typeof next !== "object" ||
				(next as { $fn?: boolean }).$fn
			) {
				node[key] = {};
			}
			node = node[key] as Record<string, unknown>;
		}
		const last = keys[keys.length - 1];
		if (last === undefined) continue;
		node[last] = {
			$fn: true,
			$route: {
				path: leaf.path,
				method: leaf.method,
				invalidate: leaf.invalidate,
			},
			$schema: leaf.schema,
		};
	}
	return root;
}

/**
 * Server API: same shape as the routes module, only `$route` fns (and
 * namespaces that contain them). Keys are export names, not paths.
 */
export function buildServerApi(
	module: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(module)) {
		if (isFn(value)) {
			if (getRouteMeta(value)) out[key] = value;
			continue;
		}
		if (isNamespace(value)) {
			const nested = buildServerApi(value as Record<string, unknown>);
			if (Object.keys(nested).length > 0) out[key] = nested;
		}
	}
	return out;
}

/** Type-level server API — export keys, route fns only. */
export type InferServerAPI<M> = {
	[K in keyof M as M[K] extends { $fn: true; $route: unknown }
		? K
		: M[K] extends Record<string, unknown>
			? keyof InferServerAPI<M[K]> extends never
				? never
				: K
			: never]: M[K] extends { $fn: true; $route: unknown }
		? M[K]
		: M[K] extends Record<string, unknown>
			? InferServerAPI<M[K]>
			: never;
};
