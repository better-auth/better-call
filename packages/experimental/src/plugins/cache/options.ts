import { fnOptions, fnOptionsSchema } from "../../fn-options";
import { v } from "../../index";
import type { VarExtension } from "../../module";
import type { InferArgs, InferInput, TypeDefination } from "../../schema";

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

/**
 * Object form of a cache option / preset.
 * Interface so object-literal IntelliSense survives the object|callback union.
 */
export interface CachePolicyObject<Aliases extends string = string> {
	/** Preset alias (soft-typed from mount `defaults` keys). */
	name?: SoftCacheAlias<Aliases> | null;
	/** Storage key — required after merge unless provided by defaults. */
	key?: CachePolicyShapeArgs["key"];
	ttl?: CachePolicyShapeArgs["ttl"];
	tags?: CachePolicyShapeArgs["tags"];
	enabled?: CachePolicyShapeArgs["enabled"];
	prepare?: CachePolicyShapeArgs["prepare"];
	onHit?: CachePolicyShapeArgs["onHit"];
}

/** Preset under `cache({ defaults })` — typically ttl/tags/hooks, optional key. */
export type CachePreset = Omit<CachePolicyObject, "name">;

/** Callback form — separate so the object branch keeps IntelliSense. */
export type CachePolicyCallback<Aliases extends string = string> = (
	c: any,
) => CachePolicyObject<Aliases> | Promise<CachePolicyObject<Aliases>>;

/**
 * Fn option: object or `(c) => object | Promise<object>`.
 */
export type CachePolicy<Aliases extends string = string> =
	| CachePolicyObject<Aliases>
	| CachePolicyCallback<Aliases>;

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
 * Schema brand so {@link InferArgs} / `FnOptsExt` see soft-typed
 * {@link CachePolicy}<Aliases>.
 */
export type SoftCacheOptionSchema<Aliases extends string = string> =
	TypeDefination<CachePolicy<Aliases>, CachePolicy<Aliases>, undefined>;

export function cachePolicyOptionSchemaFor<
	Aliases extends string = string,
>(): SoftCacheOptionSchema<Aliases> {
	return cachePolicyOptionSchema as SoftCacheOptionSchema<Aliases>;
}

/**
 * Extends core {@link fnOptions} with store-cache keys. Mounted by
 * {@link import("./index").cache}; prefer `use: [cache({ store })]`.
 */
export const cacheOptions = v.extend(fnOptions, {
	cache: cachePolicyOptionSchema,
	invalidateTags: v.array(cacheKeySchema, { optional: true }),
});

/**
 * Portable return of {@link cacheOptionsFor}. Named so consumers that
 * export `cache({ store, defaults })` can emit declarations via
 * `better-call/cache` without deep `plugins/cache/options.mjs` paths.
 */
export type CacheOptionsExtension<Aliases extends string = string> =
	VarExtension<
		"fnOptions",
		{
			readonly cache: SoftCacheOptionSchema<Aliases>;
			readonly invalidateTags: TypeDefination<
				(string | ((...args: any[]) => string | Promise<string>))[],
				| (string | ((...args: any[]) => string | Promise<string>))[]
				| null
				| undefined,
				undefined
			>;
		},
		InferInput<typeof fnOptionsSchema>
	>;

/** Per-mount cacheOptions with soft-typed `cache.name` from defaults keys. */
export function cacheOptionsFor<
	Aliases extends string = string,
>(): CacheOptionsExtension<Aliases> {
	return v.extend(fnOptions, {
		cache: cachePolicyOptionSchemaFor<Aliases>(),
		invalidateTags: v.array(cacheKeySchema, { optional: true }),
	}) as CacheOptionsExtension<Aliases>;
}
