import { v } from "../../../index";
import type { InferArgs, TypeDefination } from "../../../schema";
import { cookieShape } from "../cookie";

/**
 * Soft string: prefers `Aliases` for IntelliSense but accepts any string
 * (one-off cookie aliases are not a type error).
 */
export type SoftAlias<Aliases extends string = string> =
	| Aliases
	| (string & {});

/**
 * Fn-option / API option shape for `cookieCache`.
 *
 * - `name` — preset **alias** (looks up `http({ cookieCache: { policies } })`)
 * - `cookieName` — on-the-wire cookie name (required after resolve)
 *
 * Keys are optional so an in-progress `{ | }` keeps contextual IntelliSense —
 * runtime still requires `cookieName` + `maxAge` when the layer runs.
 */
export const cookieCacheShape = {
	/** Preset alias (not the cookie wire name). */
	name: v.string({ optional: true }),
	/** On-the-wire cookie name. */
	cookieName: v.string({ optional: true }),
	strategy: v.string({
		enum: ["compact", "jwt", "jwe"],
		optional: true,
	}),
	maxAge: v.number({ optional: true }),
	version: v.union([v.string(), v.fn.type({ output: v.string() })], {
		optional: true,
	}),
	secret: v.union([v.string(), v.array(v.string())], { optional: true }),
	jwe: v.object(
		{
			salt: v.string(),
			info: v.string(),
		},
		{ optional: true },
	),
	signer: v.object(
		{
			sign: v.fn.type({ output: v.string() }),
			verify: v.fn.type(),
		},
		{ optional: true },
	),
	refreshCache: v.union([v.boolean(), v.object({ updateAge: v.number() })], {
		optional: true,
	}),
	cookie: v.object(cookieShape, { optional: true }),
	/**
	 * When false, skip the entire layer (no get, no set).
	 * Default true. Replaces `disableWhen`.
	 */
	enabled: v.union([v.boolean(), v.fn.type({ output: v.boolean() })], {
		optional: true,
	}),
	validate: v.fn.type({ output: v.boolean(), optional: true }),
	/** Transform payload before encode (write path). */
	prepare: v.fn.type({ optional: true }),
	/** Transform / side-effect on successful hit (read path). */
	onHit: v.fn.type({ optional: true }),
};

type CookieCacheShapeArgs = InferArgs<typeof cookieCacheShape>;

/**
 * Object form of a cookie-cache option / preset (no callback).
 * Declared as an interface so object-literal IntelliSense survives the
 * object|callback union on {@link CookieCacheFnOption}.
 */
export interface CookieCacheFnOptionObject<Aliases extends string = string> {
	/** Preset alias (soft-typed from mount `policies` keys). */
	name?: SoftAlias<Aliases> | null;
	/** On-the-wire cookie name. */
	cookieName?: string | null;
	strategy?: "compact" | "jwt" | "jwe" | null;
	maxAge?: number | null;
	version?: CookieCacheShapeArgs["version"];
	/** Single secret or rotation list (`readonly` so `as const` mounts type-check). */
	secret?: string | readonly string[] | null;
	jwe?: CookieCacheShapeArgs["jwe"];
	signer?: CookieCacheShapeArgs["signer"];
	refreshCache?: CookieCacheShapeArgs["refreshCache"];
	cookie?: CookieCacheShapeArgs["cookie"];
	enabled?: CookieCacheShapeArgs["enabled"];
	validate?: CookieCacheShapeArgs["validate"];
	prepare?: CookieCacheShapeArgs["prepare"];
	onHit?: CookieCacheShapeArgs["onHit"];
}

/** Preset entry under `http({ cookieCache: { policies } })` — no alias field. */
export type CookieCachePreset = Omit<CookieCacheFnOptionObject, "name">;

/** Callback form — separate named type so the object branch keeps IntelliSense. */
export type CookieCacheFnOptionCallback<Aliases extends string = string> = (
	c: any,
) =>
	| CookieCacheFnOptionObject<Aliases>
	| Promise<CookieCacheFnOptionObject<Aliases>>;

/**
 * Fn / API option: object or `(c) => object | Promise<object>`.
 * Soft-typed `name` when `Aliases` is provided from the mount.
 */
export type CookieCacheFnOption<Aliases extends string = string> =
	| CookieCacheFnOptionObject<Aliases>
	| CookieCacheFnOptionCallback<Aliases>;

/** Complete policy after resolve (cookieName + maxAge required). */
export type CookieCachePolicy = Omit<
	CookieCacheFnOptionObject,
	"cookieName" | "maxAge" | "name"
> & {
	/** Preset alias, if any. */
	name?: string;
	cookieName: string;
	maxAge: number;
};

/** Mount config for {@link createCookieCacheApi}. */
export type CookieCacheMountConfig = {
	secret?: string | readonly string[];
	policies?: Record<string, CookieCachePreset>;
};

export const cookieCacheOptionSchema = v.union(
	[v.object(cookieCacheShape), v.fn.type()],
	{ optional: true },
);

/**
 * Schema brand so {@link InferArgs} / `FnOptsExt` see soft-typed
 * {@link CookieCacheFnOption}<Aliases> instead of plain `string` for `name`.
 */
export type SoftCookieCacheOptionSchema<Aliases extends string = string> =
	TypeDefination<
		CookieCacheFnOption<Aliases>,
		CookieCacheFnOption<Aliases>,
		undefined
	>;

/** Build an optional cookieCache fn-option schema with soft alias typing. */
export function cookieCacheOptionSchemaFor<
	Aliases extends string = string,
>(): SoftCookieCacheOptionSchema<Aliases> {
	return cookieCacheOptionSchema as SoftCookieCacheOptionSchema<Aliases>;
}
