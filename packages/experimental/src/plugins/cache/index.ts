import { v } from "../../index";
import type { VarDefination } from "../../var";
import { type CacheApi, createCacheApi } from "./api";
import {
	type CacheMountConfig,
	type CacheOptionsExtension,
	type CachePolicy,
	type CachePreset,
	cacheOptionsFor,
	type InvalidateTags,
} from "./options";
import type { CacheStore } from "./store";

export type { CacheApi } from "./api";
export { createCacheApi, resolveCachePolicy } from "./api";
export { memoryCache } from "./memory";
export type {
	CacheMountConfig,
	CacheOptionsExtension,
	CachePolicy,
	CachePolicyObject,
	CachePreset,
	InvalidateTags,
	ResolvedCachePolicy,
	SoftCacheAlias,
	SoftCacheOptionSchema,
} from "./options";
export {
	cacheOptions,
	cacheOptionsFor,
	cachePolicyOptionSchema,
} from "./options";
export type { CacheStore } from "./store";

export type CacheModuleOptions<
	Defaults extends Record<string, CachePreset> = Record<string, CachePreset>,
> = {
	store: CacheStore;
	defaults?: Defaults;
};

/**
 * Portable return of {@link cache}. Named so consumers that export
 * `cache({ store, defaults })` can emit declarations via `better-call/cache`
 * without referencing deep `plugins/cache/options.mjs` paths (TS2742 / TS2883).
 */
export type CacheModuleOf<
	Defaults extends Record<string, CachePreset> = Record<string, CachePreset>,
> = {
	cacheOptions: CacheOptionsExtension<Extract<keyof Defaults, string>>;
	cache: VarDefination<"cache", CacheApi, undefined, never>;
};

/**
 * Mount store-backed caching: unlocks `cache` / `invalidateTags` on fn
 * options and installs `c.cache` (get/set/run/…).
 *
 * @example
 * ```ts
 * const app = v.fn({
 *   use: [cache({
 *     store: memoryCache(),
 *     defaults: { user: { ttl: 60, tags: ["user"] } },
 *   })],
 * });
 * app.fn("user.get", {
 *   cache: { name: "user", key: (c) => `user:${c.input.id}` },
 * }, handler);
 * ```
 */
export function cache<
	const Defaults extends Record<string, CachePreset> = Record<
		string,
		CachePreset
	>,
>(options: CacheModuleOptions<Defaults>): CacheModuleOf<Defaults> {
	type Aliases = Extract<keyof Defaults, string>;
	const mount: CacheMountConfig = {
		defaults: options.defaults,
	};
	const api = createCacheApi(options.store, mount);
	return {
		cacheOptions: cacheOptionsFor<Aliases>(),
		cache: v.var("cache", {
			default: api as CacheApi,
		}),
	} as CacheModuleOf<Defaults>;
}

export type {
	CachePolicy as CacheFnPolicy,
	InvalidateTags as CacheInvalidateTags,
};
