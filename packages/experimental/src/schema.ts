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
	/** Used when the incoming value is `undefined`. */
	default?: D;
	/** When true, `undefined` passes straight through unvalidated. */
	optional?: boolean;
	transform?: (value: any) => O;
	/** Opaque plugin attributes - ignored by validate / Infer*. */
	$attrs?: AttrBag;
}

export type TypeOptions<T, O> = {
	transform?: (value: T) => O;
};

/**
 * `optional` widens the output; `default` keeps it narrow because a value
 * is always produced. Declaring both means optional to send, never absent.
 *
 * Helpers select among these via option-shape overloads rather than `Opt` /
 * `D` type parameters: providing a partial type argument (e.g.
 * `v.string<"a" | "b">`) would lock remaining params to their defaults, so
 * `{ optional: true }` would fail to type-check.
 */
type OutOf<O, D, Opt> = [Opt] extends [true]
	? [D] extends [never]
		? O | undefined
		: O
	: O;

/**
 * Recover a type's output `O`. Plain `infer O` from
 * `TypeDefination<any, infer O, …>` drops `| undefined` because `output?`
 * is optional and TypeScript attributes the undefined to the property.
 * When the third type arg is `undefined` (optional, no default), put
 * `| undefined` back so handlers see the same absence validate produces
 * at runtime.
 */
type OutputOf<F> =
	F extends TypeDefination<any, infer O, infer D>
		? [D] extends [never]
			? O
			: undefined extends D
				? O | undefined
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
 * One input field, in four flavours:
 *  - a `v.var()`, whose shape comes from the var's own `schema`
 *  - a handler-less `v.fn(...)` builder, which types the field as a FN
 *  - a type from `v.string()` / `v.object()` / ...
 *  - a bare nested record, which recurses
 *
 * The record case has to come last: a TypeDefination is itself a record,
 * and so is a builder.
 */
type FieldOut<F> = F extends { $var: true; schema?: infer S }
	? InferInput<NonNullable<S>>
	: F extends { $fnSchema: { input?: infer FI; output?: infer FO } }
		? FnSchemaOut<F, SchemaFnOut<FI, FO> & FnVarBrand<FI>>
		: F extends TypeDefination<any, any, any>
			? OutputOf<F>
			: F extends Record<string, unknown>
				? Prettify<{ [K in keyof F]: FieldOut<F[K]> }>
				: never;

type FieldIn<F> = F extends { $var: true; schema?: infer S }
	? InferArgs<NonNullable<S>>
	: F extends { $fnSchema: { input?: infer FI; output?: infer FO } }
		? SchemaFnIn<FI, FO> & FnVarBrand<FI>
		: F extends TypeDefination<infer T, any, any>
			? T
			: F extends Record<string, unknown>
				? ArgsShape<F>
				: never;

/**
 * `optional: true` on `v.fn.type` widens the same way a type's `optional`
 * does: absent without a default means the value may be `undefined`.
 */
type FnSchemaOut<F, Fn> = F extends { optional: true }
	? F extends { default: infer _D }
		? Fn
		: Fn | undefined
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
			: I extends TypeDefination<infer T, any, any>
				? T
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
 * value type. Core never reads these - only plugin edges do.
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

export const typeOf = (value: unknown) =>
	value === null
		? "null"
		: Array.isArray(value)
			? "array"
			: Number.isNaN(value)
				? "NaN"
				: typeof value;

export const isVar = (value: any): boolean => value?.$var === true;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (path: string, message: string): never => {
	throw new ValidationError(path, message);
};

/** Constraint checks, run after the value's type is known to be right. */
const applyRules = (def: Rules, value: any, path: string) => {
	if (def.enum && !def.enum.includes(value)) {
		fail(path, `expected one of ${def.enum.join(", ")}, received ${value}`);
	}
	if (typeof value === "string") {
		if (def.length !== undefined && value.length !== def.length) {
			fail(path, `expected length ${def.length}, received ${value.length}`);
		}
		if (def.min !== undefined && value.length < def.min) {
			fail(
				path,
				`expected at least ${def.min} characters, received ${value.length}`,
			);
		}
		if (def.max !== undefined && value.length > def.max) {
			fail(
				path,
				`expected at most ${def.max} characters, received ${value.length}`,
			);
		}
		if (def.regex && !def.regex.test(value)) {
			fail(path, `does not match ${def.regex}`);
		}
		if (def.email && !EMAIL.test(value))
			fail(path, "expected an email address");
		if (def.url) {
			try {
				new URL(value);
			} catch {
				fail(path, "expected a URL");
			}
		}
		if (def.startsWith !== undefined && !value.startsWith(def.startsWith)) {
			fail(path, `expected to start with "${def.startsWith}"`);
		}
		if (def.endsWith !== undefined && !value.endsWith(def.endsWith)) {
			fail(path, `expected to end with "${def.endsWith}"`);
		}
	}
	if (Array.isArray(value)) {
		if (def.length !== undefined && value.length !== def.length) {
			fail(path, `expected length ${def.length}, received ${value.length}`);
		}
		if (def.min !== undefined && value.length < def.min) {
			fail(
				path,
				`expected at least ${def.min} items, received ${value.length}`,
			);
		}
		if (def.max !== undefined && value.length > def.max) {
			fail(path, `expected at most ${def.max} items, received ${value.length}`);
		}
	}
	if (typeof value === "number") {
		if (def.int && !Number.isInteger(value)) {
			fail(path, `expected an integer, received ${value}`);
		}
		if (def.min !== undefined && value < def.min) {
			fail(path, `expected >= ${def.min}, received ${value}`);
		}
		if (def.max !== undefined && value > def.max) {
			fail(path, `expected <= ${def.max}, received ${value}`);
		}
	}
	if (def.check) {
		const result = def.check(value);
		if (result !== true) {
			fail(path, typeof result === "string" ? result : "failed check");
		}
	}
};

export const validate = (
	def: TypeDefination<any, any, any>,
	value: unknown,
	path: string,
): any => {
	// `undefined` falls back to the declared default before anything else,
	// then to `optional`, which passes it through untouched. A shaped
	// object with no default treats omit as `{}` so all-optional fields
	// can be left off the call without a dummy payload.
	if (value === undefined) {
		if (def.default !== undefined) value = def.default;
		else if (def.optional) return undefined;
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
			throw new ValidationError(
				path,
				`expected date, received ${typeOf(value)}`,
			);
		}
		return def.transform ? def.transform(value) : value;
	}
	if (def.name === "function") {
		if (typeof value !== "function") {
			throw new ValidationError(
				path,
				`expected function, received ${typeOf(value)}`,
			);
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
			throw new ValidationError(
				path,
				`expected array, received ${typeOf(value)}`,
			);
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
		const items: unknown[] = [];
		const problems: Issue[] = [];
		for (let index = 0; index < value.length; index++) {
			try {
				items.push(validate(elementType, value[index], `${path}[${index}]`));
			} catch (thrown) {
				if (!(thrown instanceof ValidationError)) throw thrown;
				problems.push(...thrown.issues);
			}
		}
		const firstProblem = problems[0];
		if (firstProblem) {
			throw new ValidationError(
				firstProblem.path,
				firstProblem.message,
				problems,
			);
		}
		return def.transform ? def.transform(items) : items;
	}
	if (def.name === "object") {
		if (typeOf(value) !== "object") {
			throw new ValidationError(
				path,
				`expected object, received ${typeOf(value)}`,
			);
		}
		// No declared shape (`v.object()`): ANY object - passed through
		// as-is, nothing stripped.
		if (def.shape === undefined) {
			return def.transform ? def.transform(value) : value;
		}
		// Every field validates - ALL failures report together, not just
		// the first. Three bad fields is one error with three issues.
		const parsed: Record<string, unknown> = {};
		const issues: Issue[] = [];
		for (const [field, child] of Object.entries(
			def.shape as Record<string, unknown>,
		)) {
			try {
				const parsedField = validate(
					asType(child),
					(value as Record<string, unknown>)[field],
					`${path}.${field}`,
				);
				// An absent optional field stays ABSENT - materializing the key
				// as `undefined` would clobber values it gets spread over.
				if (parsedField !== undefined) parsed[field] = parsedField;
			} catch (thrown) {
				if (!(thrown instanceof ValidationError)) throw thrown;
				issues.push(...thrown.issues);
			}
		}
		const firstIssue = issues[0];
		if (firstIssue) {
			throw new ValidationError(firstIssue.path, firstIssue.message, issues);
		}
		return def.transform ? def.transform(parsed) : parsed;
	}
	if (typeOf(value) !== def.name) {
		throw new ValidationError(
			path,
			`expected ${def.name}, received ${typeOf(value)}`,
		);
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

/**
 * Call signatures for the type helpers. Option-shape overloads replace
 * `Opt` / `D` type parameters so a partial type argument (literal narrowing)
 * does not lock `optional` / `default` to their defaults.
 */
type StringFn = {
	<const E extends string, O = E>(
		options: StringOptions<E, O> & { optional: true; default: string },
	): TypeDefination<E, O, string>;
	<const E extends string, O = E>(
		options: StringOptions<E, O> & { optional: true },
	): TypeDefination<E, OutOf<O, never, true>, undefined>;
	<const E extends string, O = E>(
		options: StringOptions<E, O> & { default: string },
	): TypeDefination<E, O, string>;
	<const E extends string, O = E>(
		options?: StringOptions<E, O>,
	): TypeDefination<E, O, never>;
};

type NumberFn = {
	<O = number>(
		options: NumberOptions<O> & { optional: true; default: number },
	): TypeDefination<number, O, number>;
	<O = number>(
		options: NumberOptions<O> & { optional: true },
	): TypeDefination<number, OutOf<O, never, true>, undefined>;
	<O = number>(
		options: NumberOptions<O> & { default: number },
	): TypeDefination<number, O, number>;
	<O = number>(options?: NumberOptions<O>): TypeDefination<number, O, never>;
};

type BooleanFn = {
	<O = boolean>(
		options: TypeOptions<boolean, O> & { optional: true; default: boolean },
	): TypeDefination<boolean, O, boolean>;
	<O = boolean>(
		options: TypeOptions<boolean, O> & { optional: true },
	): TypeDefination<boolean, OutOf<O, never, true>, undefined>;
	<O = boolean>(
		options: TypeOptions<boolean, O> & { default: boolean },
	): TypeDefination<boolean, O, boolean>;
	<O = boolean>(
		options?: TypeOptions<boolean, O>,
	): TypeDefination<boolean, O, never>;
};

type DateFn = {
	<O = Date>(
		options: TypeOptions<Date, O> & { optional: true; default: Date },
	): TypeDefination<Date, O, Date>;
	<O = Date>(
		options: TypeOptions<Date, O> & { optional: true },
	): TypeDefination<Date, OutOf<O, never, true>, undefined>;
	<O = Date>(
		options: TypeOptions<Date, O> & { default: Date },
	): TypeDefination<Date, O, Date>;
	<O = Date>(options?: TypeOptions<Date, O>): TypeDefination<Date, O, never>;
};

type AnyFn = {
	<T = unknown>(
		options: TypeOptions<T, T> & { optional: true; default: T },
	): TypeDefination<T, T, T>;
	<T = unknown>(
		options: TypeOptions<T, T> & { optional: true },
	): TypeDefination<T, OutOf<T, never, true>, undefined>;
	<T = unknown>(
		options: TypeOptions<T, T> & { default: T },
	): TypeDefination<T, T, T>;
	<T = unknown>(options?: TypeOptions<T, T>): TypeDefination<T, T, never>;
};

type ObjectFn = {
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & {
			optional: true;
			// Defaults are validated as inputs, so they use ArgsShape.
			default: ArgsShape<S>;
		},
	): TypeDefination<ArgsShape<S>, O, ArgsShape<S>>;
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & { optional: true },
	): TypeDefination<ArgsShape<S>, OutOf<O, never, true>, undefined>;
	<S, O = DefineOutput<S>>(
		shape: S,
		options: TypeOptions<DefineOutput<S>, O> & { default: ArgsShape<S> },
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
			// Defaults are validated as inputs, so they use FieldIn.
			default: FieldIn<E>[];
		},
	): TypeDefination<FieldIn<E>[], O, FieldIn<E>[]>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options: ArrayOptions<E, O> & { optional: true },
	): TypeDefination<FieldIn<E>[], OutOf<O, never, true>, undefined>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options: ArrayOptions<E, O> & { default: FieldIn<E>[] },
	): TypeDefination<FieldIn<E>[], O, FieldIn<E>[]>;
	<E, O = FieldOut<E>[]>(
		element: E,
		options?: ArrayOptions<E, O>,
	): TypeDefination<FieldIn<E>[], O, never>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & {
			optional: true;
			default: any[];
		},
	): TypeDefination<any[], any[], any[]>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & { optional: true },
	): TypeDefination<any[], any[] | undefined, undefined>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]> & { default: any[] },
	): TypeDefination<any[], any[], any[]>;
	(
		element?: undefined,
		options?: ArrayOptions<undefined, any[]>,
	): TypeDefination<any[], any[], never>;
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
};
