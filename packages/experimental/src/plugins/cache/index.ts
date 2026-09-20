import { v } from "../../index";
import { type CacheApi, createCacheApi } from "./api";
import {
	type CacheMountConfig,
	type CachePolicy,
	type CachePreset,
	cacheOptions,
	cacheOptionsFor,
	type InvalidateTags,
} from "./options";
import type { CacheStore } from "./store";

export type { CacheApi } from "./api";
export { createCacheApi, resolveCachePolicy } from "./api";
export { memoryCache } from "./memory";
export type {
	CacheMountConfig,
	CachePolicy,
	CachePolicyObject,
	CachePreset,
	InvalidateTags,
	ResolvedCachePolicy,
	SoftCacheAlias,
} from "./options";
export { cacheOptions, cacheOptionsFor, cachePolicyOptionSchema } from "./options";
export type { CacheStore } from "./store";

export type CacheModuleOptions<
	Defaults extends Record<string, CachePreset> = Record<string, CachePreset>,
> = {
	store: CacheStore;
	defaults?: Defaults;
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
>(options: CacheModuleOptions<Defaults>) {
	type Aliases = string & keyof Defaults;
	const mount: CacheMountConfig = {
		defaults: options.defaults,
	};
	const api = createCacheApi(options.store, mount);
	return {
		cacheOptions: cacheOptionsFor<Aliases>(),
		cache: v.var("cache", {
			default: api as CacheApi,
		}),
	};
}

export type {
	CachePolicy as CacheFnPolicy,
	InvalidateTags as CacheInvalidateTags,
};
