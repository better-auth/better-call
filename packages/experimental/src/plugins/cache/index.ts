import { v } from "../../index";
import { type CacheApi, createCacheApi } from "./api";
import { type CachePolicy, cacheOptions, type InvalidateTags } from "./options";
import type { CacheStore } from "./store";

export type { CacheApi } from "./api";
export { createCacheApi } from "./api";
export { memoryCache } from "./memory";
export type { CachePolicy, InvalidateTags } from "./options";
export { cacheOptions } from "./options";
export type { CacheStore } from "./store";

export type CacheModuleOptions = {
	store: CacheStore;
};

/**
 * Mount store-backed caching: unlocks `cache` / `invalidateTags` on fn
 * options and installs `c.cache` (get/set/run/…).
 *
 * @example
 * ```ts
 * const app = v.fn({ use: [cache({ store: memoryCache() })] });
 * app.fn("user.get", {
 *   cache: { key: (c) => `user:${c.input.id}`, ttl: 60 },
 * }, handler);
 * ```
 */
export function cache(options: CacheModuleOptions) {
	const api = createCacheApi(options.store);
	return {
		cacheOptions,
		cache: v.var("cache", {
			default: api as CacheApi,
		}),
	};
}

export type {
	CachePolicy as CacheFnPolicy,
	InvalidateTags as CacheInvalidateTags,
};
