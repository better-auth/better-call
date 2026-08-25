import { FnError, type Issue, UnexpectedError, ValidationError } from "./error";
import {
	type ApplyOns,
	collectUsable,
	isFn,
	isNamespace,
	isOn,
	isVarExtension,
	type Module,
	type ModuleFns,
	matchesTarget,
	type OnEntry,
	on as onImpl,
	resolveModules,
	type TargetMatches,
	type VarExtension,
	type VarGetContext,
	type VarSetContext,
	type WithDerived,
} from "./module";
import {
	asType,
	type InferArgs,
	type InferInput,
	isVar,
	type OutputSchemaOf,
	outputContract,
	validate,
	vTypes,
} from "./schema";
import type { ResolvedVars, ScopeOf, VarName, VarScope } from "./scope";
import type { LiteralString, Prettify } from "./types";
import {
	type Cells,
	contextScope,
	type Frame,
	readVar,
	readVarThrough,
	type VarDefination,
	writeVar,
} from "./var";

export type ParentContext = Record<string, any>;

/** The call shape: a TUPLE input spreads - one parameter per position,
 * the parent context last. Everything else takes (input?, parent?). */
type CallArgs<A, I> = I extends readonly unknown[]
	? A extends readonly unknown[]
		? [...A] | [...A, ParentContext]
		: never
	: [A] extends [void]
		? [input?: undefined, parent?: ParentContext]
		: [input: A, parent?: ParentContext];

/** The union of a fn's DECLARED errors, as thrown values. */
export type FnErrorsOf<Er> = {
	[T in keyof Er & string]: FnError<T, InferInput<Er[T]>>;
}[keyof Er & string];

/** The declared-error union of a fn - for typing catch sites. */
export type FnErrors<F> =
	F extends FnDefination<any, any, any, any, any, infer Er>
		? FnErrorsOf<Er>
		: never;

type TryResult<R, Er> =
	R extends Promise<infer V>
		? Promise<{ ok: true; value: V } | { ok: false; error: FnErrorsOf<Er> }>
		: { ok: true; value: R } | { ok: false; error: FnErrorsOf<Er> };

/** No declared errors - the default error channel. */
type NoErrors = Record<never, never>;

/** The `use` half of `.with`: fn overrides by name, recursing into
 * GROUPS so a nested binding can be overridden too. A var alias takes a
 * SEED for the var it points at. */
type WithFns<U> = {
	[K in keyof U]?: U[K] extends FnDefination<any, any, any, any, any, any>
		? BoundFn<U[K]>
		: U[K] extends VarDefination<any, infer T, any, any>
			? T
			: WithFns<U[K]>;
};

/** The context `.with` accepts: any var of the fn's WHOLE chain scope
 * (the builder's `use` included, not just the fn's own), plus any `use`
 * fn as an override - and nothing else. Kept as PLAIN mapped types: with
 * `RV`/`U` unknown both halves collapse to `{}`, which keeps every
 * `extends FnDefination<any, ...>` structural check passing.
 *
 * Prefer {@link WithSeed} for values stored on {@link FnDefination} - it
 * is what `v.fn` returns, and stays declaration-emit safe. */
export type WithContext<RV, U> = { [K in keyof RV]?: RV[K] } & WithFns<U>;

/** Storage (or the FnEntries slice of one): anything carrying `$models`.
 * Nested under a module as `{ db }`, it must not flow into `.with` seeds -
 * model schemas alone blow past declaration serialize limits. ModuleFns
 * drops `$adapter`/`$on`/collections, so duck-typing `$models` alone. */
type StorageLike = { $models: object };

/** Flatten `use` members to `.with` overrides: bound call signatures, var
 * alias values, nested groups. Storage is dropped (mount-only). */
type WithFnsSeed<U> = {
	[K in keyof U as U[K] extends StorageLike
		? never
		: K]?: U[K] extends FnDefination<any, any, any, any, any, any>
		? BoundFn<U[K]>
		: U[K] extends VarDefination<any, infer T, any, any>
			? T
			: WithFnsSeed<U[K]>;
};

/**
 * Flat `.with` seed map stored on exported fns. Evaluating ScopeOf /
 * ModuleFns here (instead of embedding those wrappers as type arguments)
 * keeps declaration emit small: `.d.ts` shows leaf var shapes and bound
 * call signatures, not `ScopeOf<ResolvedVars<entire module graph>>`.
 */
export type WithSeed<RV, U> = Prettify<
	{ [K in keyof RV]?: RV[K] } & WithFnsSeed<U>
>;

/** What `v.fn` / `e.fn` returns: contract params plus a flat {@link WithSeed}
 * for `.with`, never the raw ScopeOf / ModuleFns graph. */
type PublicFn<
	A,
	R,
	K extends string,
	I,
	P extends readonly string[],
	Er,
	RV,
	U,
	O = unknown,
> = FnDefination<A, R, K, I, P, Er, WithSeed<RV, U>, O>;

/** What `.with` returns: the same callable, context baked in. */
export interface BoundCall<A, R, I, Er> {
	(...args: CallArgs<A, I>): R;
	try(...args: CallArgs<A, I>): TryResult<R, Er>;
}

export interface FnDefination<
	A,
	R,
	K extends string = string,
	I = unknown,
	P extends readonly string[] = readonly string[],
	Er = NoErrors,
	/** `.with` seed map ({@link WithSeed}). Defaults keep structural
	 * `extends FnDefination<any, ...>` checks passing. */
	W = unknown,
	O = unknown,
> {
	(...args: CallArgs<A, I>): R;
	/**
	 * Call with DECLARED errors caught as a value: `{ ok: true, value }`
	 * or `{ ok: false, error }`, narrowed by `error.tag`. Only tagged,
	 * expected errors become results - defects and contract violations
	 * still throw, exactly as they should.
	 */
	try(...args: CallArgs<A, I>): TryResult<R, Er>;
	/**
	 * Call with a HAND-BUILT context. Keys naming a var SEED that var in a
	 * fresh scope; keys naming a `use` fn OVERRIDE that binding for the
	 * whole subtree below. Both are typed from the fn's chain - what the
	 * BUILDER mounted counts, so `signOut.with({ user })` type-checks even
	 * though `signOut` itself never says `use: [user]`. A parent passed to
	 * the bound call is FORKED: its vars are copied in, never written back.
	 */
	with(context: W): BoundCall<A, R, I, Er>;
	/** Brand, so a plugin module can be scanned for its fns. */
	readonly $fn: true;
	/** The name interceptors target - literal, so `ApplyOn` can match it. */
	readonly key: K;
	/** The declared contract, retained AS WRITTEN for runtime
	 * introspection (tool cards, docs renderers): the raw input/output
	 * schemas, error tag map, and required vars. Optional so structural
	 * `extends FnDefination` checks keep passing for hand-built fns. */
	readonly $schema?: {
		input?: unknown;
		output?: unknown;
		errors?: Record<string, unknown>;
		requires?: readonly string[];
		/** Declared idempotence - same args, same result, safe to repeat. */
		idempotent?: boolean;
	};
	/** Vars this fn promises to set when ITS OWN body runs - the literal
	 * list, readable by graph tooling at both type and runtime level. */
	readonly provides: P;
	/** Phantom: the raw declared input, so extensions of the vars it
	 * references can widen used-fn call sites. Never set at runtime. */
	readonly $input?: I;
	/** Phantom: the raw declared output, the counterpart of `$input` - the
	 * schema as written, for type-level introspection. Never set at runtime. */
	readonly $output?: O;
	/** Phantom: declared error tags -> payload schemas. */
	readonly $errors?: Er;
}

export type ArgsOf<I> = I extends readonly unknown[]
	? { -readonly [K in keyof I]: InferArgs<I[K]> }
	: unknown extends I
		? void
		: InferArgs<I>;

export type OptionType<
	I,
	O,
	P,
	Q,
	PL,
	RO extends boolean = boolean,
	Er = any,
> = {
	/**
	 * The fn's DECLARED failures: tag -> payload schema. The THIRD
	 * contract door - input validates on entry, output on exit, errors at
	 * `throw c.error(tag, data)`. Once declared, any UNTAGGED throw
	 * escaping the body is a defect and comes out as `UnexpectedError` -
	 * callers can tell a domain refusal from a bug without string
	 * matching.
	 */
	errors?: Er;
	/**
	 * A readonly fn cannot write vars - not in its handler, not in
	 * anything it calls, not from interceptors mounted on it. Enforced at
	 * the type level (vars readonly on `c`, declared writers uncallable)
	 * and at runtime (the whole subtree's store locks).
	 */
	readonly?: RO;
	/**
	 * Declared idempotence: calling with the same args always produces the
	 * same result and repeating the call is harmless - a read, a lookup, a
	 * pure computation. Part of the retained contract (`$schema`), so
	 * hosts may DEDUPE calls: the script engine serves repeated
	 * same-args calls to an idempotent fn from one dispatch per session.
	 * Note this is a different promise than `readonly` (writes no vars) -
	 * an fn can be readonly and still hit a non-idempotent API.
	 */
	idempotent?: boolean;
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

/** A used fn, with the parent context already applied. A tuple-input fn
 * keeps its positional signature. */
type BoundFn<F> =
	F extends FnDefination<infer A, infer R, string, infer I, any, any>
		? I extends readonly unknown[]
			? A extends readonly unknown[]
				? (...args: [...A]) => R
				: never
			: [A] extends [void]
				? () => R
				: (input: A) => R
		: never;

/** Keys of a usable map whose member is a VAR alias. */
type UseVarKeys<U> = {
	[K in keyof U]: U[K] extends VarDefination<any, any, any, any> ? K : never;
}[keyof U];

/** A var alias' surface: the var's VALUE, read and written in place. */
type UseVarValue<V> =
	V extends VarDefination<any, infer T, any, any> ? T : never;

export type UseApi<U> = Prettify<
	{
		[K in Exclude<keyof U, UseVarKeys<U>>]: U[K] extends FnDefination<
			any,
			any,
			any,
			any,
			any,
			any
		>
			? BoundFn<U[K]>
			: UseApi<U[K]>;
	} & { [K in UseVarKeys<U>]: UseVarValue<U[K]> }
>;

/** Used fns inside a readonly fn: declared writers become uncallable,
 * with the reason on hover instead of a generic type error; var aliases
 * become readonly properties. */
type ReadUseApi<U> = Prettify<
	{
		[K in Exclude<keyof U, UseVarKeys<U>>]: U[K] extends FnDefination<
			any,
			any,
			any,
			any,
			infer P,
			any
		>
			? P extends readonly []
				? BoundFn<U[K]>
				: `writes "${P[number] & string}" - not callable from a readonly fn`
			: ReadUseApi<U[K]>;
	} & { readonly [K in UseVarKeys<U>]: UseVarValue<U[K]> }
>;

export type Context<
	I,
	RV,
	Required,
	U = unknown,
	FnApi = Fn,
	RO extends boolean = false,
	Errs = NoErrors,
> = {
	input: InferInput<I>;
	/**
	 * Mint a DECLARED error - tag-checked, payload validated at creation:
	 * `throw c.error("invalid_credentials", { attempts: 3 })`. Only tags
	 * from this fn's `errors` exist; the payload validates like input.
	 */
	error: <T extends keyof Errs & string>(
		tag: T,
		...data: Record<never, never> extends InferArgs<Errs[T]>
			? [data?: InferArgs<Errs[T]>]
			: [data: InferArgs<Errs[T]>]
	) => FnError<T, InferInput<Errs[T]>>;
	/** Define fns from inside: this fn's scope and key carry over, so
	 * anything built here is typed exactly like a chained builder. */
	fn: FnApi;
	/** The schema constructors (string, number, object, ...). */
	types: typeof vTypes;
} & /** Every var in scope, directly on `c`: read `c.session`, write by
 * plain assignment (`c.session = {...}`). Every var is a readonly
 * property on a readonly fn. */ VarScope<RV, Required, RO> &
	/** Fns from `use`, directly on `c` and already threaded with this
	 * context: `c.createUser({...})`. */
	(RO extends true ? ReadUseApi<U> : UseApi<U>);

export type InferReturn<O> = unknown extends O
	? unknown
	: InferInput<OutputSchemaOf<O>>;

export interface Fn<
	Base = unknown,
	BaseFns = unknown,
	BasePL extends readonly Module[] = [],
	Prefix extends string = "",
> {
	/**
	 * The builder FN is a schema too: `create: v.fn` (never called) declares
	 * "any function" - typed `(...args: any[]) => any`, runtime checks only
	 * `typeof value === "function"`.
	 */
	readonly $fnSchema: { input?: unknown; output?: unknown };
	/**
	 * "A fn with THIS signature", as a schema: `create: v.fn.type({ input,
	 * output })` types the field as that fn and validates what a signature
	 * CAN be validated for - the value is a function, and a plain closure
	 * gets the declared input checked at its door on every call.
	 *
	 * This exists apart from a handler-less `v.fn({ input, output })` for
	 * INLINE use: `v.fn`'s handler overloads return a callable, which makes
	 * TypeScript defer any inline `v.fn(...)` call inside another generic
	 * call's arguments (higher-order inference) - the enclosing `v.object`/
	 * `v.var` then loses its shape inference entirely. `v.fn.type` returns a
	 * plain carrier, so it composes inline anywhere.
	 */
	readonly type: <I = unknown, O = unknown>(signature?: {
		input?: I;
		output?: O;
	}) => { readonly $fnSchema: { input?: I; output?: O } };

	/* ---- a handler TERMINATES: these four produce a callable fn ---- */
	<R>(
		fn: (
			ctx: Context<
				unknown,
				ScopeOf<[], Base, BasePL>,
				never,
				BaseFns,
				Fn<Base, BaseFns, BasePL, Prefix>
			>,
		) => R,
	): PublicFn<
		void,
		R,
		Prefix extends "" ? string : Prefix,
		unknown,
		readonly string[],
		NoErrors,
		ScopeOf<[], Base, BasePL>,
		BaseFns
	>;
	<K extends LiteralString, R>(
		key: K,
		fn: (
			ctx: Context<
				unknown,
				ScopeOf<[], Base, BasePL>,
				never,
				BaseFns,
				Fn<Base, BaseFns, BasePL, `${Prefix}${K}`>
			>,
		) => R,
	): PublicFn<
		void,
		R,
		`${Prefix}${K}`,
		unknown,
		readonly string[],
		NoErrors,
		ScopeOf<[], Base, BasePL>,
		BaseFns
	>;

	<
		const I,
		O,
		R extends InferReturn<O> | Promise<InferReturn<O>>,
		const PL extends readonly Module[] = [],
		const P extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		const Q extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		RO extends boolean = false,
		Er extends Record<string, unknown> = NoErrors,
	>(
		options: OptionType<I, O, P, Q, PL, RO, Er>,
		fn: (
			ctx: Context<
				I,
				ScopeOf<PL, Base, readonly [...BasePL, ...PL]>,
				WithDerived<PL, BasePL, Q[number]>,
				ApplyOns<ModuleFns<PL>, PL> & BaseFns,
				Fn<
					Base & ResolvedVars<PL>,
					ApplyOns<ModuleFns<PL>, PL> & BaseFns,
					readonly [...BasePL, ...PL],
					Prefix
				>,
				RO,
				Er
			>,
		) => R,
	): PublicFn<
		ArgsOf<I>,
		R,
		Prefix extends "" ? string : Prefix,
		I,
		P,
		Er,
		ScopeOf<PL, Base, readonly [...BasePL, ...PL]>,
		ApplyOns<ModuleFns<PL>, PL> & BaseFns,
		O
	>;
	<
		K extends LiteralString,
		const I,
		O,
		R extends InferReturn<O> | Promise<InferReturn<O>>,
		const PL extends readonly Module[] = [],
		const P extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		const Q extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		RO extends boolean = false,
		Er extends Record<string, unknown> = NoErrors,
	>(
		key: K,
		options: OptionType<I, O, P, Q, PL, RO, Er>,
		fn: (
			ctx: Context<
				I,
				ScopeOf<PL, Base, readonly [...BasePL, ...PL]>,
				WithDerived<PL, BasePL, Q[number]>,
				ApplyOns<ModuleFns<PL>, PL> & BaseFns,
				Fn<
					Base & ResolvedVars<PL>,
					ApplyOns<ModuleFns<PL>, PL> & BaseFns,
					readonly [...BasePL, ...PL],
					`${Prefix}${K}`
				>,
				RO,
				Er
			>,
		) => R,
	): PublicFn<
		ArgsOf<I>,
		R,
		`${Prefix}${K}`,
		I,
		P,
		Er,
		ScopeOf<PL, Base, readonly [...BasePL, ...PL]>,
		ApplyOns<ModuleFns<PL>, PL> & BaseFns,
		O
	>;

	/* ---- NO handler: a builder. Keys concatenate, `use` accumulates,
	   and its `.fn` follows the same rule recursively. ---- */
	<K extends LiteralString>(
		key: K,
	): Instance<Base, BaseFns, BasePL, `${Prefix}${K}`>;
	<
		I,
		O,
		const PL extends readonly Module[] = [],
		const P extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		const Q extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
	>(
		options: OptionType<I, O, P, Q, PL>,
	): Instance<
		Base & ResolvedVars<PL>,
		BaseFns & ApplyOns<ModuleFns<PL>, PL>,
		readonly [...BasePL, ...PL],
		Prefix,
		I,
		O
	>;
	<
		K extends LiteralString,
		I,
		O,
		const PL extends readonly Module[] = [],
		const P extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		const Q extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
	>(
		key: K,
		options: OptionType<I, O, P, Q, PL>,
	): Instance<
		Base & ResolvedVars<PL>,
		BaseFns & ApplyOns<ModuleFns<PL>, PL>,
		readonly [...BasePL, ...PL],
		`${Prefix}${K}`,
		I,
		O
	>;
}

const isThenable = (value: any): value is Promise<unknown> =>
	typeof value?.then === "function";

const STORE = Symbol("var-store");
const ACTIVE = Symbol("active-plugins");
const EXTS = Symbol("active-var-extensions");
const READONLY = Symbol("readonly-lock");
const WITH = Symbol("with-overrides");

const defineFn = (
	key: string,
	options: OptionType<any, any, any, any, any>,
	declared: (c: any) => any,
) => {
	const modules = resolveModules((options.use ?? []) as Module[]);

	// Interceptors and var extensions this fn brings, from its modules -
	// nested GROUPS included. The SAME entry mounted twice (two views of
	// one storage, a module and its re-export) applies once - identity
	// dedup, like inheritance.
	const own: OnEntry<string>[] = [];
	const ownExts: VarExtension<string, any>[] = [];
	const scanMembers = (mod: Record<string, unknown>) => {
		for (const value of Object.values(mod)) {
			if (isOn(value) && !own.includes(value)) own.push(value);
			else if (isVarExtension(value)) ownExts.push(value);
			else if (isNamespace(value)) scanMembers(value);
		}
	};
	for (const mod of modules) scanMembers(mod);

	const usable = collectUsable(modules);

	// A tuple input means POSITIONAL args: the callable takes one arg per
	// declared position, then the parent context.
	const tupleInput = Array.isArray(options.input)
		? (options.input as unknown[])
		: undefined;

	// Declared errors: tag -> payload schema, the THIRD contract door
	// (input on entry, output on exit, errors at throw). Declaring any
	// also flips the defect rule on: untagged throws come out wrapped.
	const declaredErrors = options.errors as Record<string, unknown> | undefined;

	// Only the VALIDATION half of the output contract is checked on exit -
	// a `{ def }`-only output is a documented promise, never a check.
	const outputValidation = outputContract(options.output).validation;
	const errorTypes = declaredErrors
		? Object.fromEntries(
				Object.entries(declaredErrors).map(([tag, schema]) => [
					tag,
					asType(schema),
				]),
			)
		: undefined;

	// Input that references vars: a var FIELD sets that var from the field
	// value; a whole-var input (`input: user`) sets it from the whole args.
	// For a tuple the "fields" are the positions ("0", "1", ...).
	const inputVars: Array<[field: string, name: string]> = [];
	const declaredInput = options.input as Record<string, any> | undefined;
	const wholeVar: string | undefined =
		declaredInput && isVar(declaredInput)
			? (declaredInput as { name: string }).name
			: undefined;
	if (declaredInput && !wholeVar) {
		for (const [field, def] of Object.entries(declaredInput)) {
			if (isVar(def)) inputVars.push([field, def.name]);
		}
	}

	// Contradictions caught at DEFINITION, not first call: a readonly fn
	// promising to set vars, or binding input into vars, makes no sense.
	if (options.readonly) {
		if (options.provides?.length) {
			throw new ValidationError(
				`${key}.readonly`,
				"a readonly fn cannot declare provides - it promises writes",
			);
		}
		if (wholeVar !== undefined || inputVars.length > 0) {
			throw new ValidationError(
				`${key}.readonly`,
				"a readonly fn cannot bind input to vars - that is a write",
			);
		}
	}

	const callable = (...callArgs: any[]) => {
		const input: unknown = tupleInput
			? callArgs.slice(0, tupleInput.length)
			: callArgs[0];
		const parent: any = tupleInput ? callArgs[tupleInput.length] : callArgs[1];
		const cells: Cells = parent?.[STORE] ?? {};
		// The lock travels the whole subtree: once any frame above is
		// readonly, every write below throws - handlers, nested fns,
		// interceptors, input-var seeding, all of it.
		const lockedBy: string | undefined = options.readonly
			? key
			: parent?.[READONLY];

		// The active set travels down the call tree, so a fn that declares
		// plugins keeps them in force for everything it calls with `c`.
		// Deduped by identity: an instance mounts its modules on every fn,
		// so a nested call would otherwise stack the same entry twice.
		const inherited: OnEntry<string>[] = parent?.[ACTIVE] ?? [];
		const active =
			own.length === 0
				? inherited
				: [...inherited, ...own.filter((e) => !inherited.includes(e))];
		const chain = active.filter((entry) => matchesTarget(entry.target, key));

		// Fn overrides from `.with`, travelling down like the active set: a
		// mocked `use` fn stays mocked for the whole subtree.
		const withFns: Record<string, unknown> | undefined = parent?.[WITH];

		const inheritedExts: VarExtension<string, any>[] = parent?.[EXTS] ?? [];
		const exts =
			ownExts.length === 0
				? inheritedExts
				: [
						...inheritedExts,
						...ownExts.filter((e) => !inheritedExts.includes(e)),
					];

		let ctx: any;
		const frame: Frame = {
			cells,
			key,
			lockedBy,
			entries: active,
		};

		// Widen a var-referencing input with the mounted extensions of that
		// var: their fields validate off the same raw value and merge in.
		const extendValue = (name: string, raw: unknown, value: unknown) => {
			let merged = value;
			for (const ext of exts) {
				if (ext.name !== name) continue;
				const extra = validate(asType(ext.schema), raw, `${key}.${name}`);
				merged = { ...(merged as Record<string, unknown>), ...extra };
			}
			return merged;
		};

		// Tuple positions validate like object fields: every bad position
		// reports, together, in one error.
		let parsed: any;
		if (tupleInput) {
			const issues: Issue[] = [];
			parsed = tupleInput.map((def, index) => {
				try {
					return validate(
						asType(def),
						(input as unknown[])[index],
						`${key}[${index}]`,
					);
				} catch (thrown) {
					if (!(thrown instanceof ValidationError)) throw thrown;
					issues.push(...thrown.issues);
					return undefined;
				}
			});
			const firstIssue = issues[0];
			if (firstIssue) {
				throw new ValidationError(firstIssue.path, firstIssue.message, issues);
			}
		} else {
			parsed =
				options.input === undefined
					? input
					: validate(asType(options.input), input, key);
		}

		// Mounted extensions widen the accepted input: each validates its
		// own fields off the same raw input and merges onto `parsed`.
		// Extensions extend RECORD inputs - positional args have no field
		// to merge into, so a tuple fn skips them.
		for (const entry of chain) {
			if (!entry.extend?.input || tupleInput) continue;
			const extra = validate(asType(entry.extend.input), input, `${key}.on`);
			parsed = { ...((parsed as Record<string, unknown>) ?? {}), ...extra };
		}

		// A whole-var input IS the var: the merged value becomes both the
		// parsed input and the var for the rest of the call tree.
		if (wholeVar !== undefined && parsed !== undefined) {
			parsed = extendValue(wholeVar, input, parsed);
			writeVar(frame, wholeVar, parsed);
		}

		// An absent field leaves the var alone, so its default (or whatever
		// a parent already set) survives. Only `undefined` counts as absent -
		// an explicit `null` is a value and does overwrite.
		for (const [field, name] of inputVars) {
			const raw = (input as Record<string, unknown>)?.[field];
			const value = (parsed as Record<string, unknown>)?.[field];
			if (value === undefined) continue;
			const merged = extendValue(name, raw, value);
			(parsed as Record<string, unknown>)[field] = merged;
			writeVar(frame, name, merged);
		}

		// The context's FIXED surface; everything not on it is a var, read
		// and written straight on `c` through the proxy below.
		const base: any = {
			input: parsed,
			// Mint a declared error: tag must be declared, payload validates
			// at creation - an error is a contract too.
			error: (tag: string, data?: unknown) => {
				const schema = errorTypes?.[tag];
				if (!schema) {
					throw new ValidationError(
						`${key}.errors.${tag}`,
						errorTypes
							? `"${tag}" is not a declared error of "${key}"`
							: `"${key}" declares no errors`,
					);
				}
				return new FnError(
					tag,
					validate(schema, data ?? {}, `${key}.errors.${tag}`),
					key,
				);
			},
			[STORE]: cells,
			[ACTIVE]: active,
			[EXTS]: exts,
			[READONLY]: lockedBy,
			[WITH]: withFns,
			fn: builderFn(key === "anonymous" ? "" : key, {
				use: options.use ?? [],
			}),
			types: vTypes,
		};
		ctx = contextScope(frame, base);
		// Used fns land DIRECTLY on the context (`c.createUser(...)`), bound
		// to `ctx` so they share this store and active set without the caller
		// having to thread `c` by hand. A GROUP binds recursively and lands
		// as a namespace (`c.cookie.setCookie(...)`); a VAR member becomes a
		// live ALIAS under its export name (`c.cookie.options` reads and
		// writes the var, hooks and readonly lock included). A tuple-input
		// fn gets its args padded to full arity so the context always lands
		// in the parent slot, however many args the caller actually passed.
		const bindUsable = (
			target: any,
			map: Record<string, unknown>,
			overrides: Record<string, unknown> | undefined,
		) => {
			for (const [name, used] of Object.entries(map)) {
				const override = overrides?.[name];
				if (isVar(used)) {
					const varName = (used as { name: string }).name;
					Object.defineProperty(target, name, {
						get: () => readVarThrough(frame, varName),
						set: (value: unknown) => writeVar(frame, varName, value),
						enumerable: true,
						configurable: true,
					});
					continue;
				}
				if (!isFn(used)) {
					const group: any = {};
					bindUsable(
						group,
						used as Record<string, unknown>,
						isFn(override) ? undefined : (override as any),
					);
					target[name] = group;
					continue;
				}
				// A `.with` override REPLACES the binding - a fn override still
				// joins this context, a plain function is called as given.
				if (override !== undefined) {
					target[name] = isFn(override)
						? (i?: unknown) => (override as any)(i, ctx)
						: override;
					continue;
				}
				const usedArity = (used as { $arity?: number }).$arity;
				target[name] =
					usedArity === undefined
						? (i?: unknown) => (used as any)(i, ctx)
						: (...args: unknown[]) => {
								const padded = args.slice(0, usedArity);
								while (padded.length < usedArity) padded.push(undefined);
								return (used as any)(...padded, ctx);
							};
			}
		};
		bindUsable(base, usable, withFns);

		const missing = (name: string) => {
			const value = readVar(cells, name);
			return value === undefined || value === null;
		};
		const checkRequires = () => {
			for (const name of options.requires ?? []) {
				if (missing(name)) {
					throw new ValidationError(
						`${key}.requires.${name}`,
						`required var "${name}" is not set${parent === undefined ? " - called without a parent context" : ""}`,
					);
				}
			}
		};

		// Interceptors replace the BODY. `provides` is only enforced when
		// the DECLARED body actually ran: an interceptor that returns
		// without `next()` visibly takes the contract over - that is a
		// veto, not a bug - while an author whose own body forgets to set
		// a promised var still fails loudly.
		let bodyRan = false;
		const declaredTracked = (c: any) => {
			bodyRan = true;
			return declared(c);
		};
		const body = chain.reduceRight<(c: any) => any>(
			(next, entry) => (c) => entry.handler(c, () => next(c)),
			declaredTracked,
		);

		// Exit contracts run after the body, whether or not it was async.
		const finish = (result: unknown) => {
			if (outputValidation !== undefined) {
				validate(asType(outputValidation), result, `${key}.output`);
			}
			if (bodyRan) {
				for (const name of options.provides ?? []) {
					if (missing(name)) {
						throw new ValidationError(
							`${key}.provides.${name}`,
							`declared to provide "${name}" but it was left unset`,
						);
					}
				}
			}
			return result;
		};

		// Errors crossing this frame: tagged errors and defects collect the
		// TRAIL (origin fn first, then every frame outward). Once a fn
		// declares `errors`, anything untagged escaping its body is a
		// DEFECT - wrapped with the cause kept - so a domain refusal and a
		// bug are never the same shape.
		const decorate = (thrown: unknown): unknown => {
			if (thrown instanceof FnError || thrown instanceof UnexpectedError) {
				if (thrown.trail[thrown.trail.length - 1] !== key) {
					thrown.trail.push(key);
				}
				return thrown;
			}
			return errorTypes ? new UnexpectedError(thrown, key) : thrown;
		};

		const run = () => {
			checkRequires();
			let result: unknown;
			try {
				result = body(ctx);
			} catch (thrown) {
				throw decorate(thrown);
			}
			// A sync handler stays sync: only chain when something is thenable.
			return isThenable(result)
				? result.then(finish, (thrown) => {
						throw decorate(thrown);
					})
				: finish(result);
		};

		return run();
	};

	/** `.try`: declared errors as a value, everything else still throws. */
	const tryCall = (...callArgs: any[]) => {
		const settle = (thrown: unknown) => {
			if (thrown instanceof FnError) {
				return { ok: false as const, error: thrown };
			}
			throw thrown;
		};
		try {
			const result = callable(...callArgs);
			return isThenable(result)
				? result.then((value) => ({ ok: true as const, value }), settle)
				: { ok: true as const, value: result };
		} catch (thrown) {
			return settle(thrown);
		}
	};

	/**
	 * `.with`: a hand-built context. Keys naming one of this fn's `use`
	 * fns become OVERRIDES (carried by the subtree via `WITH`); everything
	 * else SEEDS a var in a fresh store. A parent given to the bound call
	 * is forked - its cells are copied, so seeds and writes inside never
	 * leak back into it.
	 */
	const withCall = (context: Record<string, unknown>) => {
		const makeParent = (given: any) => {
			const source: Cells = given?.[STORE] ?? {};
			const cells: Cells = Object.fromEntries(
				Object.entries(source).map(([name, cell]) => [name, { ...cell }]),
			);
			const seedFrame: Frame = {
				cells,
				key: `${key}.with`,
				lockedBy: undefined,
				entries: [],
			};
			const overrides: Record<string, unknown> = { ...given?.[WITH] };
			// Walk the given context against the usable tree: a fn member is
			// an OVERRIDE, a var member (top-level or inside a group) SEEDS
			// the var under its DECLARED name, a group recurses, and anything
			// unknown seeds a var by the given key.
			const applyWith = (
				map: Record<string, unknown> | undefined,
				entries: Record<string, unknown>,
				target: Record<string, unknown>,
			) => {
				for (const [name, value] of Object.entries(entries)) {
					const member = map?.[name];
					if (member === undefined) {
						writeVar(seedFrame, name, value);
					} else if (isVar(member)) {
						writeVar(seedFrame, (member as { name: string }).name, value);
					} else if (isFn(member) || typeof value !== "object" || !value) {
						target[name] = value;
					} else {
						const existing = target[name];
						const sub =
							existing && typeof existing === "object"
								? (existing as Record<string, unknown>)
								: {};
						target[name] = sub;
						applyWith(
							member as Record<string, unknown>,
							value as Record<string, unknown>,
							sub,
						);
					}
				}
			};
			applyWith(usable, context, overrides);
			return {
				[STORE]: cells,
				[ACTIVE]: given?.[ACTIVE],
				[EXTS]: given?.[EXTS],
				[READONLY]: given?.[READONLY],
				[WITH]: Object.keys(overrides).length > 0 ? overrides : undefined,
			};
		};
		const rewrite = (callArgs: any[]) => {
			if (tupleInput) {
				const padded = callArgs.slice(0, tupleInput.length);
				while (padded.length < tupleInput.length) padded.push(undefined);
				return [...padded, makeParent(callArgs[tupleInput.length])];
			}
			return [callArgs[0], makeParent(callArgs[1])];
		};
		const bound = (...callArgs: any[]) => callable(...rewrite(callArgs));
		bound.try = (...callArgs: any[]) => tryCall(...rewrite(callArgs));
		return bound;
	};

	return Object.assign(callable, {
		$fn: true as const,
		key,
		provides: (options.provides ?? []) as readonly string[],
		try: tryCall,
		with: withCall,
		// Positional arg count, so used-fn bindings know where ctx goes.
		...(tupleInput ? { $arity: tupleInput.length } : {}),
		// The declared contract, as written - introspectable by hosts that
		// render the fn to an authorizer or an authoring model.
		$schema: {
			...(options.input !== undefined ? { input: options.input } : {}),
			...(options.output !== undefined ? { output: options.output } : {}),
			...(declaredErrors ? { errors: declaredErrors } : {}),
			...(options.requires?.length
				? { requires: options.requires as readonly string[] }
				: {}),
			...(options.idempotent === true ? { idempotent: true } : {}),
		},
	});
};

/* --------------------------------- create --------------------------------- */

/** Every target worth suggesting on a builder's `on`: the mounted fns'
 * keys (prefix-stripped, so they are valid RELATIVE targets), the scope's
 * var-write events by name, and the two wildcards. Arbitrary strings stay
 * legal - these only feed completion. */
type OnTargetSuggest<Base, BaseFns, Prefix extends string> =
	| FnTargetSuggest<BaseFns, Prefix>
	| `var.set.${keyof ScopeOf<[], Base> & string}`
	| "var.set.*"
	| `var.get.${keyof ScopeOf<[], Base> & string}`
	| "var.get.*"
	| "*";

type FnTargetSuggest<Fns, Prefix extends string> = {
	[K in keyof Fns]: Fns[K] extends FnDefination<
		any,
		any,
		infer FK,
		any,
		any,
		any
	>
		? FK extends `${Prefix}${infer Rest}`
			? Rest
			: never
		: never;
}[keyof Fns];

type VarNameOfT<T extends string> = T extends `var.${"set" | "get"}.${infer N}`
	? N extends `${string}*${string}`
		? string
		: N
	: string;

/** The scope's value for a var-event target - `unknown` when inexact. */
type VarValueOfT<T extends string, Base> =
	VarNameOfT<T> extends keyof ScopeOf<[], Base>
		? ScopeOf<[], Base>[VarNameOfT<T>]
		: unknown;

/** The fns among `Fns` whose key the (already prefixed) target hits. */
type MatchedFn<Fns, T extends string> = {
	[K in keyof Fns]: Fns[K] extends FnDefination<
		any,
		any,
		infer FK,
		any,
		any,
		any
	>
		? TargetMatches<T, FK & string> extends true
			? Fns[K]
			: never
		: never;
}[keyof Fns];

/** The intercepted input: the matched fn's (a union under wildcards),
 * or an open record when the target names nothing the builder knows. */
type MatchedInput<F> = [F] extends [never]
	? Record<string, any>
	: F extends FnDefination<any, any, any, infer I, any, any>
		? InferInput<I>
		: never;

/** What `next()` resolves to: the matched fn's own result. */
type MatchedResult<F> = [F] extends [never]
	? any
	: F extends FnDefination<any, infer R, any, any, any, any>
		? Awaited<R>
		: never;

/** What a builder-scoped `on` handler sees: vars and `use` fns directly
 * on `c` from the builder, `input` from the TARGET fn when known. */
type OnContext<Base, BaseFns, F, Ext = unknown> = {
	input: MatchedInput<F> & (unknown extends Ext ? unknown : InferInput<Ext>);
	types: typeof vTypes;
	fn: unknown;
} & VarScope<ScopeOf<[], Base>, never> &
	UseApi<BaseFns>;

/** `v.on`, scoped: string targets get the builder's key prefix; the
 * handler's `c` and `next()` are typed against the matched target fn. */
export interface InstanceOn<Base, BaseFns, Prefix extends string> {
	/** A fn REFERENCE targets its own key - never prefixed, fully typed
	 * from the fn itself plus the builder's scope. */
	<F extends FnDefination<any, any, string, any, any, any>>(
		target: F,
		handler: (
			c: OnContext<Base, BaseFns, F>,
			next: () => Promise<MatchedResult<F>>,
		) => any,
	): OnEntry<F["key"]>;
	/** Var-write events: never prefixed (vars are global), and `value`
	 * is typed from the builder's scope when the target is exact. */
	<
		T extends
			| `var.set.${keyof ScopeOf<[], Base> & string}`
			| "var.set.*"
			| `var.set.${string}`,
	>(
		target: T,
		handler: (
			c: VarSetContext<VarNameOfT<T>> & { value: VarValueOfT<T, Base> },
			next: () => void,
		) => void,
	): OnEntry<T>;
	/** Var-read events: `next()` yields the stored value and the handler's
	 * return becomes the read result - typed from the scope when exact. */
	<
		T extends
			| `var.get.${keyof ScopeOf<[], Base> & string}`
			| "var.get.*"
			| `var.get.${string}`,
	>(
		target: T,
		handler: (
			c: VarGetContext<VarNameOfT<T>>,
			next: () => VarValueOfT<T, Base>,
		) => VarValueOfT<T, Base>,
	): OnEntry<T>;
	(
		target: RegExp,
		handler: (
			c: OnContext<Base, BaseFns, never>,
			next: () => Promise<any>,
		) => any,
	): OnEntry<string>;
	<N extends OnTargetSuggest<Base, BaseFns, Prefix> | LiteralString>(
		target: N,
		handler: (
			c: OnContext<Base, BaseFns, MatchedFn<BaseFns, `${Prefix}${N}`>>,
			next: () => Promise<MatchedResult<MatchedFn<BaseFns, `${Prefix}${N}`>>>,
		) => any,
	): OnEntry<`${Prefix}${N}`>;
	<const Ext>(
		target: RegExp,
		extend: { input: Ext },
		handler: (
			c: OnContext<Base, BaseFns, never, Ext>,
			next: () => Promise<any>,
		) => any,
	): OnEntry<string, Ext>;
	<N extends OnTargetSuggest<Base, BaseFns, Prefix> | LiteralString, const Ext>(
		target: N,
		extend: { input: Ext },
		handler: (
			c: OnContext<Base, BaseFns, MatchedFn<BaseFns, `${Prefix}${N}`>, Ext>,
			next: () => Promise<MatchedResult<MatchedFn<BaseFns, `${Prefix}${N}`>>>,
		) => any,
	): OnEntry<`${Prefix}${N}`, Ext>;
}

export type Instance<
	Base,
	BaseFns,
	PL extends readonly Module[] = [],
	Prefix extends string = "",
	I = unknown,
	O = unknown,
> = {
	/** Same as `v.fn`, with this builder's key prefix and options baked in. */
	fn: Fn<Base, BaseFns, PL, Prefix>;
	/**
	 * A handler-less builder doubles as an input SCHEMA: used as `input`
	 * (or an input field) it declares "a FN from `input` to `output`" -
	 * the value crossing is the fn itself. Carries the declared schemas
	 * for inference here and validation at runtime (see `isFnSchema`).
	 */
	readonly $fnSchema: { input?: I; output?: O };
	/** Same as `v.on`, with the prefix on string targets and the handler
	 * typed against the matched target fn. */
	on: InstanceOn<Base, BaseFns, Prefix>;
	/**
	 * The context a handler on this builder receives - a TYPE carrier for
	 * `typeof f.ctx` (helper signatures, plugin contracts). Every handler
	 * context on this builder is assignable to it: `input` and `fn` are
	 * loosened since they vary per fn. A real context only exists per
	 * invocation, so this is `undefined` at runtime.
	 */
	readonly ctx: Context<
		unknown,
		ScopeOf<[], Base, PL>,
		never,
		BaseFns,
		unknown
	>;
};

/**
 * The builder half of `v.fn`: no handler yet, so calls accumulate. Keys
 * CONCATENATE ("auth" then ".create" -> "auth.create"), `use`/`requires`/
 * `provides` merge, other options child-wins - and the returned `.fn`
 * follows the same one rule recursively: a handler terminates, anything
 * else keeps building.
 */
const mergeOptions = (
	base: Record<string, any>,
	child: Record<string, any>,
) => ({
	...base,
	...child,
	use: [...(base.use ?? []), ...(child.use ?? [])],
	requires: [...(base.requires ?? []), ...(child.requires ?? [])],
	provides: [...(base.provides ?? []), ...(child.provides ?? [])],
	// Error declarations accumulate tag-wise, child wins per tag. Only
	// materialized when declared somewhere - an empty `errors` would flip
	// the defect-wrapping rule on for every fn.
	...(base.errors || child.errors
		? { errors: { ...(base.errors ?? {}), ...(child.errors ?? {}) } }
		: {}),
});

const builderFn = (baseKey: string, base: Record<string, any>) => {
	const build = (...args: any[]) => {
		const hasKey = typeof args[0] === "string";
		const childKey: string = hasKey ? args[0] : "";
		const rest = hasKey ? args.slice(1) : args;
		const first = rest[0];
		const handler = typeof first === "function" ? first : rest[1];
		const childOptions = typeof first === "function" ? {} : (first ?? {});
		const key = baseKey + childKey;
		const options = mergeOptions(base, childOptions);
		if (typeof handler !== "function") {
			return {
				fn: builderFn(key, options),
				// A handler-less builder doubles as an input schema: "a fn
				// from `input` to `output`" (see `isFnSchema`).
				$fnSchema: {
					input: (options as OptionType<any, any, any, any, any>).input,
					output: (options as OptionType<any, any, any, any, any>).output,
				},
				on: (target: any, a?: any, b?: any) =>
					(onImpl as any)(
						// var and scope events live in a global namespace - no prefix.
						typeof target === "string" &&
							!target.startsWith("var.") &&
							!target.startsWith("scope.")
							? key + target
							: target,
						a,
						b,
					),
			};
		}
		return defineFn(key || "anonymous", options, handler);
	};
	// The builder FN doubles as a schema itself: bare `v.fn` (never called)
	// declares "any function", `v.fn.type({ input, output })` a specific
	// signature, and a chained builder's `.fn` carries whatever input/output
	// it has accumulated - same contract as the handler-less builder object
	// (see `isFnSchema`).
	return Object.assign(build, {
		$fnSchema: { input: base.input, output: base.output },
		type: (signature: { input?: unknown; output?: unknown } = {}) => ({
			$fnSchema: { input: signature.input, output: signature.output },
		}),
	});
};

export const fnImpl = builderFn("", {});
