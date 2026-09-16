import { fnOptions } from "../../fn-options";
import { v } from "../../index";

/** Per-fn store cache policy (unlocked when the cache module is in `use`). */
export type CachePolicy = {
	key: string | ((c: any) => string | Promise<string>);
	/** Time to live in seconds. */
	ttl?: number;
	tags?: (string | ((c: any) => string | Promise<string>))[];
};

export type InvalidateTags =
	| (string | ((c: any) => string | Promise<string>))[]
	| undefined;

/**
 * Extends core {@link fnOptions} with store-cache keys. Mounted by
 * {@link import("./index").cache}; prefer `use: [cache({ store })]`.
 */
export const cacheOptions = v.extend(fnOptions, {
	cache: v.any({ optional: true }),
	invalidateTags: v.any({ optional: true }),
});
