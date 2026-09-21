import { fnOptions } from "../../fn-options";
import { v } from "../../index";
import type { InferArgs } from "../../schema";

/** string, or a fn that returns one (typically `(c) => …`). */
const cacheKeySchema = v.union([v.string(), v.fn.type({ output: v.string() })]);

/**
 * Soft string: prefers `Aliases` for IntelliSense but accepts any string.
 */
export type SoftCacheAlias<Aliases extends string = string> =
	| Aliases
	| (string & {});

/**
 * Per-fn store cache policy shape — schema is the source of truth; the
 * TS type falls out via {@link InferArgs}.
 *
 * - `name` — preset **alias** (looks up `cache({ defaults })`)
 * - `key` — storage key (required after resolve)
 */
export const cachePolicyShape = {
	/** Preset alias (not the storage key). */
	name: v.string({ optional: true }),
	/** Storage key — required at resolve time (option or defaults). */
	key: v.union([v.string(), v.fn.type({ output: v.string() })], {
		optional: true,
	}),
	/** Time to live in seconds. */
	ttl: v.number({ optional: true }),
	tags: v.array(cacheKeySchema, { optional: true }),
	/**
	 * When false, skip cache-aside get/set (invalidateTags still runs).
	 * Default true.
	 */
	enabled: v.union([v.boolean(), v.fn.type({ output: v.boolean() })], {
		optional: true,
	}),
	/** Transform value before JSON.stringify (write path). */
	prepare: v.fn.type({ optional: true }),
	/** Transform / side-effect on successful hit (read path). */
	onHit: v.fn.type({ optional: true }),
};

type CachePolicyShapeArgs = InferArgs<typeof cachePolicyShape>;

/** Object form of a cache option / preset (no callback). */
export type CachePolicyObject<Aliases extends string = string> = Omit<
	CachePolicyShapeArgs,
	"name" | "key"
> & {
	name?: SoftCacheAlias<Aliases> | null;
	/** Storage key — required after merge unless provided by defaults. */
	key?: CachePolicyShapeArgs["key"];
};

/** Preset under `cache({ defaults })` — typically ttl/tags/hooks, optional key. */
export type CachePreset = Omit<CachePolicyObject, "name">;

/**
 * Fn option: object or `(c) => object | Promise<object>`.
 */
export type CachePolicy<Aliases extends string = string> =
	| CachePolicyObject<Aliases>
	| ((
			c: any,
	  ) => CachePolicyObject<Aliases> | Promise<CachePolicyObject<Aliases>>);

/** Resolved policy with a concrete key. */
export type ResolvedCachePolicy = Omit<CachePolicyObject, "key" | "name"> & {
	name?: string;
	key: NonNullable<CachePolicyShapeArgs["key"]>;
};

export type InvalidateTags = InferArgs<typeof cacheKeySchema>[];

export type CacheMountConfig = {
	defaults?: Record<string, CachePreset>;
};

const cachePolicyObjectSchema = v.object(cachePolicyShape, { optional: true });

export const cachePolicyOptionSchema = v.union(
	[cachePolicyObjectSchema, v.fn.type()],
	{ optional: true },
);

/**
 * Extends core {@link fnOptions} with store-cache keys. Mounted by
 * {@link import("./index").cache}; prefer `use: [cache({ store })]`.
 */
export const cacheOptions = v.extend(fnOptions, {
	cache: cachePolicyOptionSchema,
	invalidateTags: v.array(cacheKeySchema, { optional: true }),
});

/** Per-mount cacheOptions (runtime identical; Aliases for soft typing). */
export function cacheOptionsFor<_Aliases extends string = string>() {
	return cacheOptions;
}
