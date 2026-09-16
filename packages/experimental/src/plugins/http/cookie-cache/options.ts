import { v } from "../../../index";
import type { InferArgs } from "../../../schema";
import { cookieShape } from "../cookie";

/**
 * Fn-option shape for `cookieCache`. Schema is the source of truth; the
 * TS type falls out via {@link InferArgs}. Keys are optional so an
 * in-progress `{ | }` keeps a contextual type for IntelliSense — runtime
 * still requires `name` and `maxAge` when the layer runs.
 */
export const cookieCacheShape = {
	name: v.string({ optional: true }),
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
	refreshCache: v.union(
		[v.boolean(), v.object({ updateAge: v.number() })],
		{ optional: true },
	),
	cookie: v.object(cookieShape, { optional: true }),
	disableWhen: v.fn.type({ output: v.boolean(), optional: true }),
	validate: v.fn.type({ output: v.boolean(), optional: true }),
	prepare: v.fn.type({ optional: true }),
};

export type CookieCacheFnOption = InferArgs<typeof cookieCacheShape>;

/** Complete policy after {@link requirePolicy}-style checks (name + maxAge). */
export type CookieCachePolicy = Omit<CookieCacheFnOption, "name" | "maxAge"> & {
	name: string;
	maxAge: number;
};

export const cookieCacheOptionSchema = v.object(cookieCacheShape, {
	optional: true,
});
