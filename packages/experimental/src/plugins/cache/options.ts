import { fnOptions } from "../../fn-options";
import { v } from "../../index";
import type { InferArgs } from "../../schema";

/** string, or a fn that returns one (typically `(c) => …`). */
const cacheKeySchema = v.union([
	v.string(),
	v.fn.type({ output: v.string() }),
]);

/**
 * Per-fn store cache policy shape — schema is the source of truth; the
 * TS type falls out via {@link InferArgs}.
 */
export const cachePolicyShape = {
	key: cacheKeySchema,
	/** Time to live in seconds. */
	ttl: v.number({ optional: true }),
	tags: v.array(cacheKeySchema, { optional: true }),
};

export type CachePolicy = InferArgs<typeof cachePolicyShape>;
export type InvalidateTags = InferArgs<typeof cacheKeySchema>[];

/**
 * Extends core {@link fnOptions} with store-cache keys. Mounted by
 * {@link import("./index").cache}; prefer `use: [cache({ store })]`.
 */
export const cacheOptions = v.extend(fnOptions, {
	cache: v.object(cachePolicyShape, { optional: true }),
	invalidateTags: v.array(cacheKeySchema, { optional: true }),
});
