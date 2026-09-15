import {
	type InferArgs,
	type InferInput,
	type SchemaInputOf,
	vTypes as v,
} from "./schema";
import { makeVar, type VarDefination } from "./var";

/**
 * Core `v.fn` options schema — field validators are one-to-one with
 * {@link OptionType}. Plugins unlock extra keys via `v.extend(fnOptions, …)`.
 */
export const fnOptionsSchema = v.object({
	input: v.any({ optional: true }),
	output: v.any({ optional: true }),
	errors: v.any({ optional: true }),
	readonly: v.boolean({ optional: true }),
	idempotent: v.boolean({ optional: true }),
	summary: v.string({ optional: true }),
	description: v.string({ optional: true }),
	tags: v.array(v.string(), { optional: true }),
	deprecated: v.boolean({ optional: true }),
	provides: v.array(v.string(), { optional: true }),
	requires: v.array(v.string(), { optional: true }),
	use: v.array(v.any(), { optional: true }),
});

/**
 * Built-in options var. Plugins `v.extend` this and mount the extension
 * via `use` so those keys appear on descendant `v.fn` option bags.
 *
 * Typed explicitly: `makeVar` returns `any`, and an untyped `fnOptions`
 * would make every `v.extend(fnOptions, …)` match *all* var names in
 * {@link import("./module").VarExtensionsFor}.
 */
export const fnOptions = makeVar("fnOptions", {
	default: {},
	schema: fnOptionsSchema,
}) as VarDefination<
	"fnOptions",
	InferInput<typeof fnOptionsSchema>,
	typeof fnOptionsSchema
>;

type FnOptionsInferred = InferArgs<SchemaInputOf<typeof fnOptionsSchema>>;

/**
 * `v.fn` options: schema keys from {@link fnOptionsSchema}, with call-site
 * generics overlaid on `input` / `output` / `errors` / `use` / etc. so
 * inference stays sharp (do not replace those with plain `InferArgs`).
 */
export type OptionType<
	I,
	O,
	P,
	Q,
	PL,
	RO extends boolean = boolean,
	Er = any,
> = Omit<
	FnOptionsInferred,
	| "input"
	| "output"
	| "errors"
	| "readonly"
	| "idempotent"
	| "summary"
	| "description"
	| "tags"
	| "deprecated"
	| "provides"
	| "requires"
	| "use"
> & {
	idempotent?: boolean;
	summary?: string;
	description?: string;
	deprecated?: boolean;
	/**
	 * The fn's DECLARED failures: tag -> payload schema. The THIRD
	 * contract door - input validates on entry, output on exit, errors at
	 * `throw c.error(tag, data)`. Once declared, any UNTAGGED throw
	 * escaping the body is a defect and comes out as `UnexpectedError`.
	 * Used fns with `errors` return a `.try` result when called on `c`,
	 * so their tags do not become part of this fn's public channel.
	 */
	errors?: Er;
	/**
	 * A readonly fn cannot write vars - not in its handler, not in
	 * anything it calls, not from interceptors mounted on it. Enforced at
	 * the type level (vars readonly on `c`, declared writers uncallable)
	 * and at runtime (the whole subtree's store locks).
	 */
	readonly?: RO;
	tags?: readonly string[];
	input?: I;
	/**
	 * The fn's return contract. A bare schema is BOTH the signature and
	 * the exit check; the wrapper `{ def?, validation? }` splits them -
	 * `{ def }` documents the return (tool cards, handler typing) without
	 * runtime validation, `validation` is the schema the exit check runs
	 * (defaults to none in the wrapper form).
	 */
	output?: O;
	/** Vars this fn guarantees to set. Checked on exit. */
	provides?: P;
	/** Vars that must already be set. Checked on entry, before the body. */
	requires?: Q;
	/**
	 * Module namespaces to pull in. Their vars come into scope, their fns
	 * land directly on `c` already bound to this context (a plain-record
	 * member nests as a NAMESPACE: `c.cookies.setCookie`), and their `on`
	 * entries stay active for everything below.
	 */
	use?: PL;
};
