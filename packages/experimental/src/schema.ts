import { type Issue, ValidationError } from "./error";
import type { LiteralString, Prettify } from "./types";

export type Rules = {
	/** Strings: length. Numbers: value. */
	min?: number;
	/** Strings: length. Numbers: value. */
	max?: number;
	/** Strings only: exact length. */
	length?: number;
	regex?: RegExp;
	/** Strings only. Trims and lowercases before the format check. */
	email?: boolean;
	url?: boolean;
	startsWith?: string;
	endsWith?: string;
	/** Numbers only. */
	int?: boolean;
	/** Allowed values. */
	enum?: readonly unknown[];
	/** Escape hatch - return true, or a message to fail with. */
	check?: (value: any) => boolean | string;
};

/** Plugin-owned field metadata. Outer key is the plugin namespace
 * (`"http"`, `"db"`, …); core never interprets the contents. */
export type AttrBag = Record<string, Record<string, unknown>>;

export interface TypeDefination<T, O, D = never> extends Rules {
	name: LiteralString;
	type?: T;
	output?: O;
	shape?: unknown;
	/** `function` types only: the declared input of the expected fn -
	 * plain closures get it validated at their door on every call. */
	fnInput?: unknown;
	/** Used when the incoming value is `undefined`. A zero-arg function
	 * is called (fresh value per validate) except on `function` schemas,
	 * where the default IS the fn. The factory may be async - validate
	 * returns a Promise when it (or a nested default) is thenable. */
	default?: D | (() => D | Promise<D>);
	/** When true, `undefined` and `null` pass straight through unvalidated. */
	optional?: boolean;
	transform?: (value: any) => O;
	/** Opaque plugin attributes - ignored by validate / Infer*. */
	$attrs?: AttrBag;
}

export type TypeOptions<T, O> = {
	transform?: (value: T) => O;
	/** Accepted on every helper; overloads refine the output when `true`. */
	optional?: boolean;
};

/**
 * `optional` widens the output with `| undefined | null`; `default` keeps
 * it narrow because a value is always produced. Declaring both means
 * optional to send, never absent. `default: null` is the exception that
 * still unions `| null` into the output - absence produces null.
 *
 * Helpers select among these via option-shape overloads rather than `Opt` /
 * `D` type parameters: providing a partial type argument (e.g.
 * `v.string<"a" | "b">`) would lock remaining params to their defaults, so
 * `{ optional: true }` would fail to type-check.
 */
type OutOf<O, D, Opt> = [Opt] extends [true]
	? [D] extends [never]
		? O | undefined | null
		: O
	: O;

/**
 * Recover a type's output `O`. Plain `infer O` from
 * `TypeDefination<any, infer O, …>` drops `| undefined` because `output?`
 * is optional and TypeScript attributes the undefined to the property.
 * When the third type arg is `undefined` (optional, no default), put
 * `| undefined | null` back so handlers see the same absence validate
 * produces at runtime. When the default itself is `null`, put `| null`
 * back the same way.
 */
type OutputOf<F> =
	F extends TypeDefination<any, infer O, infer D>
		? [D] extends [never]
			? O
			: undefined extends D
				? O | undefined | null
				: null extends D
					? O | null
					: O
		: never;

type StringOptions<E extends string, O> = TypeOptions<E, O> &
	Pick<
		Rules,
		| "min"
		| "max"
		| "length"
		| "regex"
		| "email"
		| "url"
		| "startsWith"
		| "endsWith"
		| "check"
	> & { enum?: readonly E[] };

type ArrayOptions<E, O> = TypeOptions<FieldOut<E>[], O> &
	Pick<Rules, "min" | "max" | "length" | "check">;

type UnionOptions<T extends readonly unknown[], O> = TypeOptions<
	FieldOut<T[number]>,
	O
> &
	Pick<Rules, "check">;

type NumberOptions<O> = TypeOptions<number, O> &
	Pick<Rules, "min" | "max" | "int" | "check"> & {
		enum?: readonly number[];
	};

export type InferType<T> =
	T extends TypeDefination<infer T2, any, any> ? T2 : never;

export type InferOutput<T> =
	T extends TypeDefination<any, any, any> ? OutputOf<T> : never;

export type DefineInput<I> = Prettify<{
	[K in keyof I]: FieldIn<I[K]>;
}>;

/** Keys whose field is OPTIONAL with no default: absent from the output
 * too, so they mark `?`. A defaulted field always produces a value and
 * stays required. */
type OutOptional<O> = {
	[K in keyof O]: [DefaultOf<O[K]>] extends [never]
		? never
		: [DefaultOf<O[K]>] extends [undefined]
			? K
			: never;
}[keyof O];

export type DefineOutput<O> = Prettify<
	{ [K in keyof O as K extends OutOptional<O> ? never : K]: FieldOut<O[K]> } & {
		[K in keyof O as K extends OutOptional<O> ? K : never]?: FieldOut<O[K]>;
	}
>;

/**
 * A handler-less `v.fn({ input, output })` used as a schema describes
 * "a fn from `input` to `output`" - the VALUE is the fn itself. Two
 * views of the same signature:
 *
 * `SchemaFnIn` is the PROVIDER's side - what a caller must hand over.
 * Like any handler, their fn receives the PARSED input (validation runs
 * at its door) and returns the declared output, sync or async.
 *
 * `SchemaFnOut` is the CONSUMER's side (`c.input.x`) - the handler calls
 * it with RAW args, exactly like calling the fn it stands in for.
 *
 * No declared input means the signature is UNSPECIFIED, not zero-arg -
 * any fn fits (`create: v.fn`), so the args stay open.
 */
type SchemaFnIn<FI, FO> = (
	...args: unknown extends FI ? any[] : [input: InferInput<FI>]
) => unknown extends FO
	? any
	: InferInput<OutputSchemaOf<FO>> | Promise<InferInput<OutputSchemaOf<FO>>>;

type SchemaFnOut<FI, FO> = (
	...args: unknown extends FI ? any[] : [input: InferArgs<FI>]
) => unknown extends FO
	? any
	: InferInput<OutputSchemaOf<FO>> | Promise<InferInput<OutputSchemaOf<FO>>>;

/**
 * A fn schema whose input IS a var carries that var's name as an optional
 * phantom (`$fnVar`, tuple-wrapped so a plain fn can never false-match).
 * Scope resolution reads it to WIDEN the fn's args with everything the
 * scope mounts on that var - see `WidenSchemaFns`. Optional, so any plain
 * closure still satisfies the type.
 */
export type FnVarBrand<FI> = FI extends {
	$var: true;
	name: infer N extends string;
}
	? { readonly $fnVar?: [N] }
	: unknown;

/**
 * A declared `output` comes in two forms: a bare schema (the signature
 * AND the exit check), or the wrapper `{ def?, validation? }` splitting
 * what the fn PROMISES from what gets CHECKED - `{ def }` documents
 * without paying runtime validation, `{ def, validation }` checks with a
 * different (usually looser) schema than it documents. The wrapper is
 * recognized by its keys, so an output that IS an object with only
 * `def`/`validation` fields must be written `v.object({...})`.
 *
 * `OutputSchemaOf` is the type-level unwrap - the schema the fn's return
 * type (and its rendered signature) comes from.
 */
export type OutputSchemaOf<O> =
	Exclude<keyof O, "def" | "validation"> extends never
		? O extends { def: infer D }
			? D
			: O extends { validation: infer Vl }
				? Vl
				: O
		: O;

/** The runtime unwrap: `def` is the documented schema (falls back to
 * `validation`), `validation` is what the exit check runs - undefined
 * means no check. A bare schema is both. */
export const outputContract = (
	output: unknown,
): { def?: unknown; validation?: unknown } => {
	if (output === undefined) return {};
	if (
		output !== null &&
		typeof output === "object" &&
		!Array.isArray(output) &&
		!isType(output) &&
		!isVar(output) &&
		!isFnSchema(output)
	) {
		const keys = Object.keys(output);
		if (
			keys.length > 0 &&
			keys.every((k) => k === "def" || k === "validation")
		) {
			const { def, validation } = output as {
				def?: unknown;
				validation?: unknown;
			};
			return { def: def ?? validation, validation };
		}
	}
	return { def: output, validation: output };
};

/**
 * One input field, in five flavours:
 *  - a `v.var()`, whose shape comes from the var's own `schema`
 *  - a handler-less `v.fn(...)` builder, which types the field as a FN
 *  - a type from `v.string()` / `v.object()` / ...
 *  - a bare nested record, which recurses
 *  - anything else (e.g. `null`, `"lit"`) kept as itself - so
 *    `v.union([user, null])` infers `User | null`, not just `User`
 *
 * The record case has to come after TypeDefination: a TypeDefination is
 * itself a record, and so is a builder.
 */
type FieldOut<F> = F extends { $var: true; schema?: infer S }
	? InferInput<NonNullable<S>>
	: F extends { $fnSchema: { input?: infer FI; output?: infer FO } }
		? FnSchemaOut<F, SchemaFnOut<FI, FO> & FnVarBrand<FI>>
		: F extends TypeDefination<any, any, any>
			? OutputOf<F>
			: F extends Record<string, unknown>
				? Prettify<{ [K in keyof F]: FieldOut<F[K]> }>
				: F;

type FieldIn<F> = F extends { $var: true; schema?: infer S }
	? InferArgs<NonNullable<S>>
	: F extends { $fnSchema: { input?: infer FI; output?: infer FO } }
		? FnSchemaIn<F, SchemaFnIn<FI, FO> & FnVarBrand<FI>>
		: F extends TypeDefination<infer T, any, infer D>
			? undefined extends D
				? T | null
				: null extends D
					? T | null
					: T
			: F extends Record<string, unknown>
				? ArgsShape<F>
				: F;

/**
 * Input-side twin of {@link FnSchemaOut}: optional fn-typed fields accept
 * `null` the same way `v.string({ optional: true })` does.
 */
type FnSchemaIn<F, Fn> = F extends { optional: true }
	? F extends { default: infer D }
		? null extends D
			? Fn | null
			: Fn
		: Fn | null
	: F extends { default: infer D }
		? null extends D
			? Fn | null
			: Fn
		: Fn;

/**
 * `optional: true` on `v.fn.type` widens the same way a type's `optional`
 * does: absent without a default means the value may be `undefined` or
 * `null`. A `default: null` still unions `| null` into the output.
 */
type FnSchemaOut<F, Fn> = F extends { optional: true }
	? F extends { default: infer D }
		? null extends D
			? Fn | null
			: Fn
		: Fn | undefined | null
	: F extends { default: infer D }
		? null extends D
			? Fn | null
			: Fn
		: Fn;

/**
 * A field's declared default, looked through a var to its schema. Only a
 * TYPE's default counts - a var's own default is its initial value, not a
 * licence to omit the input. The `$fnSchema` guard mirrors `asType`'s
 * ordering: a bare `v.fn` is CALLABLE, and any callable duck-matches
 * TypeDefination (`.name` comes with every function), which would read a
 * phantom default off it and wrongly mark the field optional. `v.fn.type`
 * may still declare `optional` / `default` on the carrier itself.
 */
type DefaultOf<F> = F extends { $var: true; schema?: infer S }
	? NonNullable<S> extends TypeDefination<any, any, infer D>
		? D
		: never
	: F extends { $fnSchema: unknown }
		? F extends { optional: true }
			? F extends { default: infer D }
				? D
				: undefined
			: F extends { default: infer D }
				? D
				: never
		: F extends TypeDefination<any, any, infer D>
			? D
			: never;

type Defaulted<I> = {
	[K in keyof I]: [DefaultOf<I[K]>] extends [never] ? never : K;
}[keyof I];

/** Defaulted keys are optional to send, but always present in the handler. */
type ArgsShape<I> = Prettify<
	{ [K in keyof I as K extends Defaulted<I> ? never : K]: FieldIn<I[K]> } & {
		[K in keyof I as K extends Defaulted<I> ? K : never]?: FieldIn<I[K]>;
	}
>;

/**
 * Post-transform shape - what a handler sees. The `$var` branch must come
 * first: a var's `name` property duck-matches TypeDefination, and falling
 * into that branch reads the var's VALUE type instead of its schema. A
 * TUPLE input maps position by position - the fn takes that many args.
 */
export type InferInput<I> = I extends { $var: true; schema?: infer S }
	? InferInput<NonNullable<S>>
	: I extends { $fnSchema: { input?: infer FI; output?: infer FO } }
		? SchemaFnOut<FI, FO> & FnVarBrand<FI>
		: I extends readonly unknown[]
			? { -readonly [K in keyof I]: InferInput<I[K]> }
			: I extends TypeDefination<any, any, any>
				? OutputOf<I>
				: Prettify<{ [K in keyof I]: FieldOut<I[K]> }>;

/** Pre-transform shape - what a caller sends. Same branch order. */
export type InferArgs<I> = I extends { $var: true; schema?: infer S }
	? InferArgs<NonNullable<S>>
	: I extends { $fnSchema: { input?: infer FI; output?: infer FO } }
		? SchemaFnIn<FI, FO> & FnVarBrand<FI>
		: I extends readonly unknown[]
			? { -readonly [K in keyof I]: InferArgs<I[K]> }
			: I extends TypeDefination<infer T, any, infer D>
				? undefined extends D
					? T | null
					: null extends D
						? T | null
						: T
				: ArgsShape<I>;

export const isType = (value: any): value is TypeDefination<any, any> =>
	typeof value?.name === "string";

/** A handler-less `v.fn(...)` builder doubles as a schema: the value it
 * describes is a FN with the declared signature. The builder FN itself is
 * branded too, so bare `v.fn` reads as "any function". */
export const isFnSchema = (
	value: any,
): value is {
	$fnSchema: { input?: unknown; output?: unknown };
	optional?: boolean;
	default?: unknown;
} => typeof value?.$fnSchema === "object" && value.$fnSchema !== null;

export const asType = (value: any): TypeDefination<any, any> =>
	// A var's own `name` ("user") would duck-match isType, so unwrap first -
	// and a builder is a record, so it must be caught before the fallback.
	isVar(value)
		? asType(value.schema ?? {})
		: isFnSchema(value)
			? ({
					name: "function",
					fnInput: value.$fnSchema.input,
					...(value.optional ? { optional: true } : {}),
					...(value.default !== undefined ? { default: value.default } : {}),
				} as TypeDefination<any, any>)
			: isType(value)
				? value
				: // Bare literals in `v.union([schema, null])` / `["a", "b"]`:
					// map to a type whose `name` matches `typeOf`, with `enum`
					// pinning the exact value for string/number/boolean.
					value === null
					? ({ name: "null" } as TypeDefination<null, null>)
					: value === undefined
						? ({ name: "undefined" } as TypeDefination<undefined, undefined>)
						: typeof value === "string" ||
								typeof value === "number" ||
								typeof value === "boolean"
							? ({
									name: typeof value,
									enum: [value],
								} as TypeDefination<any, any>)
							: { name: "object", shape: value };

/**
 * Replace the whole `$attrs` bag. On a var, rebinds `customize` so a later
 * customize keeps these attrs (the original closure closes over pre-attr
 * options and would otherwise drop them).
 */
const withAttrBag = <S>(schema: S, bag: AttrBag): S => {
	if (isVar(schema)) {
		const v = schema as {
			$attrs?: AttrBag;
			customize: (opts: any) => unknown;
			[key: string]: unknown;
		};
		return {
			...v,
			$attrs: bag,
			customize: (opts: any) => withAttrBag(v.customize(opts) as S, bag),
		} as S;
	}
	return { ...asType(schema), $attrs: bag } as S;
};

/**
 * Attach plugin attributes under `namespace`, deep-merging with any
 * already on the schema. Returns a new type def (or var) with the same
 * value type. Core mostly ignores these - plugin edges and a few
 * exit paths (e.g. `v.fn` stripping `http.returned`) consume them.
 *
 * Passed a var, attributes land on the var itself (`$attrs`) and the
 * `$var` / `name` / `schema` identity is preserved; `customize` is rebound
 * so attrs survive further customization.
 */
export const withAttrs = <S>(
	schema: S,
	namespace: string,
	attrs: Record<string, unknown>,
): S => {
	const prev = (attrsOf(schema) ?? {}) as AttrBag;
	return withAttrBag(schema, {
		...prev,
		[namespace]: { ...(prev[namespace] ?? {}), ...attrs },
	});
};

/** Read the whole attr bag, or one plugin namespace. */
export function attrsOf(schema: unknown): AttrBag | undefined;
export function attrsOf(
	schema: unknown,
	namespace: string,
): Record<string, unknown> | undefined;
export function attrsOf(
	schema: unknown,
	namespace?: string,
): AttrBag | Record<string, unknown> | undefined {
	if (schema === null || schema === undefined) return undefined;
	// Vars carry whole-var attrs on themselves; field attrs live on the
	// schema type def. Do not unwrap through asType or var identity is
	// lost and whole-var attrs become invisible.
	const bag = isVar(schema)
		? (schema as { $attrs?: AttrBag }).$attrs
		: asType(schema).$attrs;
	if (!bag) return undefined;
	return namespace === undefined ? bag : bag[namespace];
}

/** Decide whether a field schema (type def or var) should be dropped / rejected. */
export type FieldPred = (schema: unknown) => boolean;

/**
 * Drop fields (and nested object / array / union children) where `drop`
 * is true. Vars keep their identity; only the inner `schema` is projected.
 * Used by plugin edges and by {@link parseFields}.
 */
export const omitFields = <S>(schema: S, drop: FieldPred): S => {
	if (isVar(schema)) {
		const v = schema as { schema?: unknown };
		return {
			...(schema as object),
			schema: v.schema === undefined ? undefined : omitFields(v.schema, drop),
		} as S;
	}
	const def = asType(schema);
	if (def.name === "object" && def.shape !== undefined) {
		const shape: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(
			def.shape as Record<string, unknown>,
		)) {
			if (drop(child)) continue;
			shape[key] = omitFields(child, drop);
		}
		return { ...def, shape } as S;
	}
	if (def.name === "array" && def.shape !== undefined) {
		return { ...def, shape: omitFields(def.shape, drop) } as S;
	}
	if (def.name === "union" && Array.isArray(def.shape)) {
		return {
			...def,
			shape: (def.shape as unknown[]).map((option) => omitFields(option, drop)),
		} as S;
	}
	return schema;
};

/**
 * Throw if any field matching `match` is present on `value` (own key).
 * Object validation otherwise strips unknown keys, so this is what stops
 * callers from smuggling gated values.
 */
export const rejectFields = (
	schema: unknown,
	value: unknown,
	match: FieldPred,
	path = "input",
	message = "field is not allowed",
): void => {
	if (value === null || value === undefined) return;
	const root = isVar(schema)
		? ((schema as { schema?: unknown }).schema ?? {})
		: schema;
	const def = asType(root);
	if (def.name === "object" && def.shape !== undefined) {
		if (typeOf(value) !== "object") return;
		const record = value as Record<string, unknown>;
		for (const [key, child] of Object.entries(
			def.shape as Record<string, unknown>,
		)) {
			if (match(child) && Object.hasOwn(record, key)) {
				throw new ValidationError(`${path}.${key}`, message);
			}
			if (Object.hasOwn(record, key)) {
				rejectFields(child, record[key], match, `${path}.${key}`, message);
			}
		}
		return;
	}
	if (def.name === "array" && def.shape !== undefined && Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			rejectFields(def.shape, value[i], match, `${path}[${i}]`, message);
		}
		return;
	}
	if (def.name === "union" && Array.isArray(def.shape)) {
		// Only gate against arms the value can satisfy once matched
		// fields are projected out. Checking every arm would reject a
		// key that is gated on a non-matching arm but free on the one
		// that actually fits.
		for (const option of def.shape as unknown[]) {
			try {
				const result = validate(asType(omitFields(option, match)), value, path);
				// Async defaults: don't pick this arm sync. Swallow the
				// rejection so a later sync arm can still win without an
				// unhandled promise.
				if (
					result !== null &&
					typeof result === "object" &&
					typeof (result as { then?: unknown }).then === "function"
				) {
					(result as Promise<unknown>).then(undefined, () => {});
					continue;
				}
			} catch (thrown) {
				if (!(thrown instanceof ValidationError)) throw thrown;
				continue;
			}
			rejectFields(option, value, match, path, message);
			return;
		}
	}
};

export type ParseFieldsOptions = {
	path?: string;
	/** Throw when these fields are present on the value (own key). */
	reject?: FieldPred;
	/** Drop these fields from the schema before validating. */
	omit?: FieldPred;
	/** Message used when {@link reject} fires. */
	rejectMessage?: string;
};

/**
 * Parse `value` against `schema`, optionally rejecting and/or omitting
 * fields by attribute predicate. Core stays attribute-key agnostic -
 * callers pass the predicates (e.g. `attrsOf(s, "http")?.readonly`).
 */
export const parseFields = <S>(
	schema: S,
	value: unknown,
	options: ParseFieldsOptions = {},
): unknown => {
	const path = options.path ?? "input";
	if (options.reject) {
		rejectFields(
			schema,
			value,
			options.reject,
			path,
			options.rejectMessage ?? "field is not allowed",
		);
	}
	const projected = options.omit ? omitFields(schema, options.omit) : schema;
	return validate(asType(projected), value, path);
};

export const typeOf = (value: unknown) =>
	value === null
		? "null"
		: Array.isArray(value)
			? "array"
			: Number.isNaN(value)
				? "NaN"
				: typeof value;

export const isVar = (value: any): boolean => value?.$var === true;

// Zod's email regex
// The author has written about this explicitly: trying to accept every technically valid email address leads to overly complex,
// hard-to-maintain, and sometimes ReDoS-vulnerable regexes that still reject real-world addresses people actually use.
// Zod prioritizes a practical filter that works well for the vast majority of real user-entered emails.
const EMAIL =
	/^(?!\.)(?!.*\.\.)([a-z0-9_'+\-.]*)[a-z0-9_+-]@([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/;

const PREVIEW_MAX = 80;

/** Truncated, JSON-safe preview of a value for validation messages. */
export const preview = (value: unknown): string => {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (typeof value === "string") {
		const quoted = JSON.stringify(value);
		return quoted.length > PREVIEW_MAX
			? `${quoted.slice(0, PREVIEW_MAX - 1)}…`
			: quoted;
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}
	if (typeof value === "function") return "[Function]";
	if (typeof value === "symbol") return value.toString();
	try {
		const json = JSON.stringify(value);
		if (json === undefined) return typeOf(value);
		return json.length > PREVIEW_MAX
			? `${json.slice(0, PREVIEW_MAX - 1)}…`
			: json;
	} catch {
		return typeOf(value);
	}
};

const NO_VALUE = Symbol("no-value");

const fail = (
	path: string,
	message: string,
	value: unknown = NO_VALUE,
): never => {
	const issue: Issue =
		value !== NO_VALUE
			? { path, message, received: preview(value) }
			: { path, message };
	throw new ValidationError(path, message, [issue]);
};

const typeError = (
	path: string,
	expected: string,
	value: unknown,
): ValidationError => {
	const received = preview(value);
	const message = `expected ${expected}, received ${typeOf(value)} (${received})`;
	return new ValidationError(path, message, [{ path, message, received }]);
};

/** Constraint checks, run after the value's type is known to be right. */
const applyRules = (def: Rules, value: any, path: string) => {
	if (def.enum && !def.enum.includes(value)) {
		fail(
			path,
			`expected one of ${def.enum.join(", ")}, received ${preview(value)}`,
			value,
		);
	}
	if (typeof value === "string") {
		if (def.length !== undefined && value.length !== def.length) {
			fail(
				path,
				`expected length ${def.length}, received ${value.length}`,
				value,
			);
		}
		if (def.min !== undefined && value.length < def.min) {
			fail(
				path,
				`expected at least ${def.min} characters, received ${value.length}`,
				value,
			);
		}
		if (def.max !== undefined && value.length > def.max) {
			fail(
				path,
				`expected at most ${def.max} characters, received ${value.length}`,
				value,
			);
		}
		if (def.regex && !def.regex.test(value)) {
			fail(
				path,
				`does not match ${def.regex}, received ${preview(value)}`,
				value,
			);
		}
		if (def.email && !EMAIL.test(value)) {
			fail(
				path,
				`expected an email address, received ${preview(value)}`,
				value,
			);
		}
		if (def.url) {
			try {
				new URL(value);
			} catch {
				fail(path, `expected a URL, received ${preview(value)}`, value);
			}
		}
		if (def.startsWith !== undefined && !value.startsWith(def.startsWith)) {
			fail(
				path,
				`expected to start with "${def.startsWith}", received ${preview(value)}`,
				value,
			);
		}
		if (def.endsWith !== undefined && !value.endsWith(def.endsWith)) {
			fail(
				path,
				`expected to end with "${def.endsWith}", received ${preview(value)}`,
				value,
			);
		}
	}
	if (Array.isArray(value)) {
		if (def.length !== undefined && value.length !== def.length) {
			fail(
				path,
				`expected length ${def.length}, received ${value.length}`,
				value,
			);
		}
		if (def.min !== undefined && value.length < def.min) {
			fail(
				path,
				`expected at least ${def.min} items, received ${value.length}`,
				value,
			);
		}
		if (def.max !== undefined && value.length > def.max) {
			fail(
				path,
				`expected at most ${def.max} items, received ${value.length}`,
				value,
			);
		}
	}
	if (typeof value === "number") {
		if (def.int && !Number.isInteger(value)) {
			fail(path, `expected an integer, received ${value}`, value);
		}
		if (def.min !== undefined && value < def.min) {
			fail(path, `expected >= ${def.min}, received ${value}`, value);
		}
		if (def.max !== undefined && value > def.max) {
			fail(path, `expected <= ${def.max}, received ${value}`, value);
		}
	}
	if (def.check) {
		const result = def.check(value);
		if (result !== true) {
			fail(
				path,
				typeof result === "string"
					? result
					: `failed check, received ${preview(value)}`,
				value,
			);
		}
	}
};

const isThenable = (value: unknown): value is Promise<unknown> =>
	typeof (value as { then?: unknown })?.then === "function";

/** Sync when every entry is sync; Promise when any is thenable. */
const allMaybeAsync = <T>(values: Array<T | Promise<T>>): T[] | Promise<T[]> =>
	values.some(isThenable)
		? Promise.all(values.map((value) => Promise.resolve(value)))
		: (values as T[]);

type Attempt<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/** Run validate catching ValidationError into an Attempt; thenable results chain. */
const attemptValidate = (
	def: TypeDefination<any, any, any>,
	value: unknown,
	path: string,
): Attempt<unknown> | Promise<Attempt<unknown>> => {
	try {
		const result = validate(def, value, path);
		if (isThenable(result)) {
			return result.then(
				(resolved): Attempt<unknown> => ({ ok: true, value: resolved }),
				(thrown): Attempt<unknown> => {
					if (!(thrown instanceof ValidationError)) throw thrown;
					return { ok: false, issues: thrown.issues };
				},
			);
		}
		return { ok: true, value: result };
	} catch (thrown) {
		if (!(thrown instanceof ValidationError)) throw thrown;
		return { ok: false, issues: thrown.issues };
	}
};

const throwIssues = (issues: Issue[], path: string, fallback: string) => {
	const first = issues[0];
	if (first) throw new ValidationError(first.path, first.message, issues);
	throw new ValidationError(path, fallback);
};

export const validate = (
	def: TypeDefination<any, any, any>,
	value: unknown,
	path: string,
	/** Internal: skip default resolution after an async factory settled. */
	settled = false,
): any => {
	// `undefined` / (when optional) `null` fall back to the declared
	// default before anything else, then to `optional`, which passes the
	// absence through untouched. A shaped object with no default treats
	// omit as `{}` so all-optional fields can be left off the call without
	// a dummy payload. Non-optional `null` falls through to the type check.
	if (!settled && (value === undefined || (value === null && def.optional))) {
		if (def.default !== undefined) {
			// Factories produce a fresh value each time - needed for Date /
			// object / array defaults. Skip on `function` schemas: there the
			// default IS the fn. Async factories (and Promise defaults) make
			// this call return a Promise; sync callers stay sync.
			value =
				typeof def.default === "function" && def.name !== "function"
					? (def.default as () => unknown)()
					: def.default;
			// `default: null` IS the value - do not type-check it as the
			// field type (a string schema's null default is still null).
			if (value === null) return null;
			if (isThenable(value)) {
				return value.then((resolved) => validate(def, resolved, path, true));
			}
		} else if (def.optional) return value;
		else if (def.name === "object" && def.shape !== undefined) value = {};
	}
	// A var used as an input field validates against its own schema. An
	// absent value is left alone so the var keeps its default.
	if (isVar(def)) {
		if (value === undefined) return undefined;
		const schema = (def as any).schema;
		return schema === undefined ? value : validate(schema, value, path);
	}
	if (def.name === "any") {
		return def.transform ? def.transform(value) : value;
	}
	if (def.name === "date") {
		if (!(value instanceof Date)) {
			throw typeError(path, "date", value);
		}
		return def.transform ? def.transform(value) : value;
	}
	if (def.name === "function") {
		if (typeof value !== "function") {
			throw typeError(path, "function", value);
		}
		// A branded fn (`$fn`) validates its own declared input at its own
		// door; a plain closure gets THIS schema's input validated for it.
		const inner = def.fnInput;
		if (inner === undefined || (value as { $fn?: boolean }).$fn === true) {
			return value;
		}
		const innerType = asType(inner);
		return (input?: unknown, parent?: unknown) =>
			(value as (i: unknown, p: unknown) => unknown)(
				validate(innerType, input, `${path}()`),
				parent,
			);
	}
	if (def.name === "array") {
		if (!Array.isArray(value)) {
			throw typeError(path, "array", value);
		}
		applyRules(def, value, path);
		// No declared element (`v.array()`): ANY array - passed through
		// as-is, elements untouched.
		if (def.shape === undefined) {
			return def.transform ? def.transform(value) : value;
		}
		// Every element validates - ALL failures report together, not
		// just the first, mirroring object fields.
		const elementType = asType(def.shape);
		const attempts = value.map((item, index) =>
			attemptValidate(elementType, item, `${path}[${index}]`),
		);
		const assemble = (settledAttempts: Attempt<unknown>[]) => {
			const items: unknown[] = [];
			const problems: Issue[] = [];
			for (const attempt of settledAttempts) {
				if (attempt.ok) items.push(attempt.value);
				else problems.push(...attempt.issues);
			}
			if (problems[0]) {
				throw new ValidationError(
					problems[0].path,
					problems[0].message,
					problems,
				);
			}
			return def.transform ? def.transform(items) : items;
		};
		const settledAttempts = allMaybeAsync(attempts);
		return isThenable(settledAttempts)
			? settledAttempts.then(assemble)
			: assemble(settledAttempts);
	}
	if (def.name === "object") {
		if (typeOf(value) !== "object") {
			throw typeError(path, "object", value);
		}
		// No declared shape (`v.object()`): ANY object - passed through
		// as-is, nothing stripped.
		if (def.shape === undefined) {
			return def.transform ? def.transform(value) : value;
		}
		// Every field validates - ALL failures report together, not just
		// the first. Three bad fields is one error with three issues.
		const entries = Object.entries(def.shape as Record<string, unknown>);
		const attempts = entries.map(([field, child]) => {
			const result = attemptValidate(
				asType(child),
				(value as Record<string, unknown>)[field],
				`${path}.${field}`,
			);
			if (isThenable(result)) {
				return result.then((attempt) => ({ field, attempt }));
			}
			return { field, attempt: result };
		});
		const assemble = (
			settledAttempts: Array<{ field: string; attempt: Attempt<unknown> }>,
		) => {
			const parsed: Record<string, unknown> = {};
			const issues: Issue[] = [];
			for (const { field, attempt } of settledAttempts) {
				if (!attempt.ok) {
					issues.push(...attempt.issues);
					continue;
				}
				// An absent optional field stays ABSENT - materializing the key
				// as `undefined` would clobber values it gets spread over.
				if (attempt.value !== undefined) parsed[field] = attempt.value;
			}
			if (issues[0]) {
				throw new ValidationError(issues[0].path, issues[0].message, issues);
			}
			return def.transform ? def.transform(parsed) : parsed;
		};
		const settledAttempts = allMaybeAsync(attempts);
		return isThenable(settledAttempts)
			? settledAttempts.then(assemble)
			: assemble(settledAttempts);
	}
	if (def.name === "union") {
		// Try each option in order - first success wins. All failures
		// report together so callers see every branch's issues.
		const options = def.shape;
		if (!Array.isArray(options) || options.length === 0) {
			throw new ValidationError(path, "expected a non-empty union");
		}
		const tryMember = (
			index: number,
			issues: Issue[],
		): unknown | Promise<unknown> => {
			if (index >= options.length) {
				const received = preview(value);
				const summary: Issue = {
					path,
					message: `expected union (${options.length} branches), received ${typeOf(value)} (${received})`,
					received,
				};
				throwIssues(
					issues.length ? [summary, ...issues] : [summary],
					path,
					summary.message,
				);
			}
			const attempt = attemptValidate(asType(options[index]), value, path);
			const next = (settledAttempt: Attempt<unknown>) => {
				if (settledAttempt.ok) {
					applyRules(def, settledAttempt.value, path);
					return def.transform
						? def.transform(settledAttempt.value)
						: settledAttempt.value;
				}
				const labeled = settledAttempt.issues.map((issue) => ({
					...issue,
					message: `branch ${index}: ${issue.message}`,
				}));
				return tryMember(index + 1, [...issues, ...labeled]);
			};
			return isThenable(attempt) ? attempt.then(next) : next(attempt);
		};
		return tryMember(0, []);
	}
	if (typeOf(value) !== def.name) {
		throw typeError(path, def.name, value);
	}
	// Canonicalize before rules so padded / mixed-case addresses pass the
	// email regex and handlers always see the normalized form.
	if (def.email && typeof value === "string") {
		value = value.trim().toLowerCase();
	}
	applyRules(def, value, path);
	return def.transform ? def.transform(value) : value;
};

/** Builds the runtime object; the declared return type is the contract. */
const build = (name: string, options: any, extra?: any): any => ({
	name,
	...extra,
	...options,
});

/** A default may be the value itself or a factory that mints it fresh on
 * each validate - `() => new Date()`, `() => []`, `async () => id()`, …. */
type DefaultInput<T> = T | (() => T | Promise<T>);

/** `default: null` (or a factory that returns it) - absence produces null,
 * and the output type unions `| null` in. */
type NullDefault = null | (() => null | Promise<null>);

/**
 * Call signatures for the type helpers. Option-shape overloads replace
 * `Opt` / `D` type parameters so a partial type argument (literal narrowing)
 * does not lock `optional` / `default` to their defaults.
 */
type StringFn = {
	<const E extends string, O = E>(
		options: StringOptions<E, O> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<E, O | null, null>;
	<const E extends string, O = E>(
		options: StringOptions<E, O> & {
			optional: true;
			default: DefaultInput<string>;
		},
	): TypeDefination<E, O, string>;
	<const E extends string, O = E>(
		options: StringOptions<E, O> & { optional: true },
	): TypeDefination<E, OutOf<O, never, true>, undefined>;
	<const E extends string, O = E>(
		options: StringOptions<E, O> & { default: NullDefault },
	): TypeDefination<E, O | null, null>;
	<const E extends string, O = E>(
		options: StringOptions<E, O> & { default: DefaultInput<string> },
	): TypeDefination<E, O, string>;
	<const E extends string, O = E>(
		options?: StringOptions<E, O>,
	): TypeDefination<E, O, never>;
};

type NumberFn = {
	<O = number>(
		options: NumberOptions<O> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<number, O | null, null>;
	<O = number>(
		options: NumberOptions<O> & {
			optional: true;
			default: DefaultInput<number>;
		},
	): TypeDefination<number, O, number>;
	<O = number>(
		options: NumberOptions<O> & { optional: true },
	): TypeDefination<number, OutOf<O, never, true>, undefined>;
	<O = number>(
		options: NumberOptions<O> & { default: NullDefault },
	): TypeDefination<number, O | null, null>;
	<O = number>(
		options: NumberOptions<O> & { default: DefaultInput<number> },
	): TypeDefination<number, O, number>;
	<O = number>(options?: NumberOptions<O>): TypeDefination<number, O, never>;
};

type BooleanFn = {
	<O = boolean>(
		options: TypeOptions<boolean, O> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<boolean, O | null, null>;
	<O = boolean>(
		options: TypeOptions<boolean, O> & {
			optional: true;
			default: DefaultInput<boolean>;
		},
	): TypeDefination<boolean, O, boolean>;
	<O = boolean>(
		options: TypeOptions<boolean, O> & { optional: true },
	): TypeDefination<boolean, OutOf<O, never, true>, undefined>;
	<O = boolean>(
		options: TypeOptions<boolean, O> & { default: NullDefault },
	): TypeDefination<boolean, O | null, null>;
	<O = boolean>(
		options: TypeOptions<boolean, O> & { default: DefaultInput<boolean> },
	): TypeDefination<boolean, O, boolean>;
	<O = boolean>(
		options?: TypeOptions<boolean, O>,
	): TypeDefination<boolean, O, never>;
};

type DateFn = {
	<O = Date>(
		options: TypeOptions<Date, O> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<Date, O | null, null>;
	<O = Date>(
		options: TypeOptions<Date, O> & {
			optional: true;
			default: DefaultInput<Date>;
		},
	): TypeDefination<Date, O, Date>;
	<O = Date>(
		options: TypeOptions<Date, O> & { optional: true },
	): TypeDefination<Date, OutOf<O, never, true>, undefined>;
	<O = Date>(
		options: TypeOptions<Date, O> & { default: NullDefault },
	): TypeDefination<Date, O | null, null>;
	<O = Date>(
		options: TypeOptions<Date, O> & { default: DefaultInput<Date> },
	): TypeDefination<Date, O, Date>;
	<O = Date>(options?: TypeOptions<Date, O>): TypeDefination<Date, O, never>;
};

type AnyFn = {
	<T = unknown>(
		options: TypeOptions<T, T> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<T, T | null, null>;
	<T = unknown>(
		options: TypeOptions<T, T> & { optional: true; default: DefaultInput<T> },
	): TypeDefination<T, T, T>;
	<T = unknown>(
		options: TypeOptions<T, T> & { optional: true },
	): TypeDefination<T, OutOf<T, never, true>, undefined>;
	<T = unknown>(
		options: TypeOptions<T, T> & { default: NullDefault },
	): TypeDefination<T, T | null, null>;
	<T = unknown>(
		options: TypeOptions<T, T> & { default: DefaultInput<T> },
	): TypeDefination<T, T, T>;
	<T = unknown>(options?: TypeOptions<T, T>): TypeDefination<T, T, never>;
};

/**
 * Object defaults may be partial: nested fields still run through
 * validate (so their own defaults apply). An empty `{}` is always
 * fine at the type level - parent `optional` / `default` must not
 * demand that every required child be listed in the default.
 */
type ObjectDefault<S> = DefaultInput<Partial<ArgsShape<S>>>;

type ObjectFn = {
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<ArgsShape<S>, O | null, null>;
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & {
			optional: true;
			default: ObjectDefault<S>;
		},
	): TypeDefination<ArgsShape<S>, O, ArgsShape<S>>;
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & { optional: true },
	): TypeDefination<ArgsShape<S>, OutOf<O, never, true>, undefined>;
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & {
			default: NullDefault;
		},
	): TypeDefination<ArgsShape<S>, O | null, null>;
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & {
			default: ObjectDefault<S>;
		},
	): TypeDefination<ArgsShape<S>, O, ArgsShape<S>>;
	<S, O = DefineOutput<S>>(
		shape: S,
		options?: TypeOptions<DefineOutput<S>, O>,
	): TypeDefination<ArgsShape<S>, O, never>;
	(): TypeDefination<Record<string, any>, Record<string, any>>;
};

type ArrayFn = {
	<E, O = FieldOut<E>[]>(
		element: E,
		options: ArrayOptions<E, O> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<FieldIn<E>[], O | null, null>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options: ArrayOptions<E, O> & {
			optional: true;
			// Defaults are validated as inputs, so they use FieldIn.
			default: DefaultInput<FieldIn<E>[]>;
		},
	): TypeDefination<FieldIn<E>[], O, FieldIn<E>[]>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options: ArrayOptions<E, O> & { optional: true },
	): TypeDefination<FieldIn<E>[], OutOf<O, never, true>, undefined>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options: ArrayOptions<E, O> & { default: NullDefault },
	): TypeDefination<FieldIn<E>[], O | null, null>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options: ArrayOptions<E, O> & { default: DefaultInput<FieldIn<E>[]> },
	): TypeDefination<FieldIn<E>[], O, FieldIn<E>[]>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options?: ArrayOptions<E, O>,
	): TypeDefination<FieldIn<E>[], O, never>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<any[], any[] | null, null>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & {
			optional: true;
			default: DefaultInput<any[]>;
		},
	): TypeDefination<any[], any[], any[]>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & { optional: true },
	): TypeDefination<any[], any[] | undefined | null, undefined>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & {
			default: NullDefault;
		},
	): TypeDefination<any[], any[] | null, null>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & {
			default: DefaultInput<any[]>;
		},
	): TypeDefination<any[], any[], any[]>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]>,
	): TypeDefination<any[], any[], never>;
};

type UnionFn = {
	<const T extends readonly [unknown, ...unknown[]], O = FieldOut<T[number]>>(
		members: T,
		options: UnionOptions<T, O> & {
			optional: true;
			default: NullDefault;
		},
	): TypeDefination<FieldIn<T[number]>, O | null, null>;
	<const T extends readonly [unknown, ...unknown[]], O = FieldOut<T[number]>>(
		members: T,
		options: UnionOptions<T, O> & {
			optional: true;
			default: DefaultInput<FieldIn<T[number]>>;
		},
	): TypeDefination<FieldIn<T[number]>, O, FieldIn<T[number]>>;
	<const T extends readonly [unknown, ...unknown[]], O = FieldOut<T[number]>>(
		members: T,
		options: UnionOptions<T, O> & { optional: true },
	): TypeDefination<FieldIn<T[number]>, OutOf<O, never, true>, undefined>;
	<const T extends readonly [unknown, ...unknown[]], O = FieldOut<T[number]>>(
		members: T,
		options: UnionOptions<T, O> & {
			default: NullDefault;
		},
	): TypeDefination<FieldIn<T[number]>, O | null, null>;
	<const T extends readonly [unknown, ...unknown[]], O = FieldOut<T[number]>>(
		members: T,
		options: UnionOptions<T, O> & {
			default: DefaultInput<FieldIn<T[number]>>;
		},
	): TypeDefination<FieldIn<T[number]>, O, FieldIn<T[number]>>;
	<const T extends readonly [unknown, ...unknown[]], O = FieldOut<T[number]>>(
		members: T,
		options?: UnionOptions<T, O>,
	): TypeDefination<FieldIn<T[number]>, O, never>;
};

export const vTypes = {
	/** An `enum` narrows both sides to the literal union: `v.string({
	 * enum: ["a", "b"] })` types as `"a" | "b"`, not `string`. */
	string: ((options?: any) => build("string", options)) as StringFn,
	number: ((options?: any) => build("number", options)) as NumberFn,
	boolean: ((options?: any) => build("boolean", options)) as BooleanFn,
	/** A Date INSTANCE - checked with `instanceof`, never parsed. */
	date: ((options?: any) => build("date", options)) as DateFn,
	/** Passthrough - validated as-is, never coerced or stripped. */
	any: ((options?: any) => build("any", options)) as AnyFn,
	/** With a SHAPE every field validates; with NO shape (`v.object()`)
	 * any object passes, as-is. */
	object: ((shape?: any, options?: any) =>
		build("object", options, shape === undefined ? {} : { shape })) as ObjectFn,
	/** With an ELEMENT every item validates - all failures report
	 * together, like object fields; with NO element (`v.array()`) any
	 * array passes, as-is. `min`/`max`/`length` count items. */
	array: ((element?: any, options?: any) =>
		build(
			"array",
			options,
			element === undefined ? {} : { shape: element },
		)) as ArrayFn,
	/** Try each option in order - first successful parse wins. All
	 * failing branches report together when none match. */
	union: ((members: any, options?: any) =>
		build("union", options, { shape: members })) as UnionFn,
};
