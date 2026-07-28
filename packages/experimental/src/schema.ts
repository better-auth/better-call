import { ValidationError } from "./error";
import type { LiteralString, Prettify } from "./types";

/** Constraints carried on a type and checked by `validate`. */
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

export interface TypeDefination<T, O, D = never> extends Rules {
	name: LiteralString;
	type?: T;
	output?: O;
	shape?: unknown;
	/** Used when the incoming value is `undefined`. */
	default?: D;
	/** When true, `undefined` passes straight through unvalidated. */
	optional?: boolean;
	transform?: (value: any) => O;
}

export type TypeOptions<T, O> = {
	transform?: (value: T) => O;
};

type WithDefault<D> = { default?: D };

type WithOptional<Opt> = { optional?: Opt };

/**
 * `optional` widens the output; `default` keeps it narrow because a value
 * is always produced. Declaring both means optional to send, never absent.
 */
type OutOf<O, D, Opt> = [Opt] extends [true]
	? [D] extends [never]
		? O | undefined
		: O
	: O;

/** Either marker makes the key omittable in `InferArgs`. */
type DefOf<D, Opt> = [Opt] extends [true]
	? [D] extends [never]
		? undefined
		: D
	: D;

type StringOptions<O> = TypeOptions<string, O> &
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
	> & { enum?: readonly string[] };

type NumberOptions<O> = TypeOptions<number, O> &
	Pick<Rules, "min" | "max" | "int" | "check"> & {
		enum?: readonly number[];
	};

export type InferType<T> =
	T extends TypeDefination<infer T2, any, any> ? T2 : never;

export type InferOutput<T> =
	T extends TypeDefination<any, infer O, any> ? O : never;

export type DefineInput<I> = Prettify<{
	[K in keyof I]: FieldIn<I[K]>;
}>;

export type DefineOutput<O> = Prettify<{
	[K in keyof O]: FieldOut<O[K]>;
}>;

/**
 * One input field, in three flavours:
 *  - a `v.var()`, whose shape comes from the var's own `schema`
 *  - a type from `v.string()` / `v.object()` / ...
 *  - a bare nested record, which recurses
 *
 * The record case has to come last: a TypeDefination is itself a record.
 */
type FieldOut<F> = F extends { $var: true; schema?: infer S }
	? InferInput<NonNullable<S>>
	: F extends TypeDefination<any, infer O, any>
		? O
		: F extends Record<string, unknown>
			? Prettify<{ [K in keyof F]: FieldOut<F[K]> }>
			: never;

type FieldIn<F> = F extends { $var: true; schema?: infer S }
	? InferArgs<NonNullable<S>>
	: F extends TypeDefination<infer T, any, any>
		? T
		: F extends Record<string, unknown>
			? ArgsShape<F>
			: never;

/**
 * A field's declared default, looked through a var to its schema. Only a
 * TYPE's default counts - a var's own default is its initial value, not a
 * licence to omit the input.
 */
type DefaultOf<F> = F extends { $var: true; schema?: infer S }
	? NonNullable<S> extends TypeDefination<any, any, infer D>
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
 * into that branch reads the var's VALUE type instead of its schema.
 */
export type InferInput<I> = I extends { $var: true; schema?: infer S }
	? InferInput<NonNullable<S>>
	: I extends TypeDefination<any, infer O, any>
		? O
		: Prettify<{ [K in keyof I]: FieldOut<I[K]> }>;

/** Pre-transform shape - what a caller sends. Same `$var`-first rule. */
export type InferArgs<I> = I extends { $var: true; schema?: infer S }
	? InferArgs<NonNullable<S>>
	: I extends TypeDefination<infer T, any, any>
		? T
		: ArgsShape<I>;

export const isType = (value: any): value is TypeDefination<any, any> =>
	typeof value?.name === "string";

export const asType = (value: any): TypeDefination<any, any> =>
	// A var's own `name` ("user") would duck-match isType, so unwrap first.
	isVar(value)
		? asType(value.schema ?? {})
		: isType(value)
			? value
			: { name: "object", shape: value };

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
	// then to `optional`, which passes it through untouched.
	if (value === undefined) {
		if (def.default !== undefined) value = def.default;
		else if (def.optional) return undefined;
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
	if (def.name === "object") {
		if (typeOf(value) !== "object") {
			throw new ValidationError(
				path,
				`expected object, received ${typeOf(value)}`,
			);
		}
		const parsed: Record<string, unknown> = {};
		for (const [field, child] of Object.entries(def.shape ?? {})) {
			parsed[field] = validate(
				asType(child),
				(value as Record<string, unknown>)[field],
				`${path}.${field}`,
			);
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

export const vTypes = {
	string: <O = string, D = never, Opt extends boolean = false>(
		options?: StringOptions<O> & WithDefault<D> & WithOptional<Opt>,
	): TypeDefination<string, OutOf<O, D, Opt>, DefOf<D, Opt>> =>
		build("string", options),
	number: <O = number, D = never, Opt extends boolean = false>(
		options?: NumberOptions<O> & WithDefault<D> & WithOptional<Opt>,
	): TypeDefination<number, OutOf<O, D, Opt>, DefOf<D, Opt>> =>
		build("number", options),
	boolean: <O = boolean, D = never, Opt extends boolean = false>(
		options?: TypeOptions<boolean, O> & WithDefault<D> & WithOptional<Opt>,
	): TypeDefination<boolean, OutOf<O, D, Opt>, DefOf<D, Opt>> =>
		build("boolean", options),
	/** Passthrough - validated as-is, never coerced or stripped. */
	any: <T = unknown, D = never, Opt extends boolean = false>(
		options?: TypeOptions<T, T> & WithDefault<D> & WithOptional<Opt>,
	): TypeDefination<T, OutOf<T, D, Opt>, DefOf<D, Opt>> =>
		build("any", options),
	object: <S, O = DefineOutput<S>, D = never, Opt extends boolean = false>(
		shape: S,
		options?: TypeOptions<DefineOutput<S>, O> &
			WithDefault<D> &
			WithOptional<Opt>,
		// Args use ArgsShape, not DefineInput, so a defaulted field inside
		// an object is optional to send there too.
	): TypeDefination<ArgsShape<S>, OutOf<O, D, Opt>, DefOf<D, Opt>> =>
		build("object", options, { shape }),
} satisfies Record<string, (...args: any[]) => TypeDefination<any, any>>;
