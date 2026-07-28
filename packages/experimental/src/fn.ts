import { ValidationError } from "./error";
import {
	type ApplyOns,
	collectFns,
	isOn,
	isVarExtension,
	matchesTarget,
	type OnEntry,
	on as onImpl,
	type ModuleFns,
	type Module,
	resolveModules,
	type TargetMatches,
	type VarExtension,
	type VarSetContext,
	type WithDerived,
} from "./module";
import {
	asType,
	type InferArgs,
	type InferInput,
	isVar,
	validate,
	vTypes,
} from "./schema";
import type { ResolvedVars, ScopeOf, VarName, VarScope } from "./scope";
import type { LiteralString, Prettify } from "./types";
import { seedVars } from "./var";

export type ParentContext = { var: any };

export interface FnDefination<
	A,
	R,
	K extends string = string,
	I = unknown,
	P extends readonly string[] = readonly string[],
> {
	(
		...args: [A] extends [void]
			? [input?: undefined, parent?: ParentContext]
			: [input: A, parent?: ParentContext]
	): R;
	/** Brand, so a plugin module can be scanned for its fns. */
	readonly $fn: true;
	/** The name interceptors target - literal, so `ApplyOn` can match it. */
	readonly key: K;
	/** Vars this fn promises to set when ITS OWN body runs - the literal
	 * list, readable by graph tooling at both type and runtime level. */
	readonly provides: P;
	/** Phantom: the raw declared input, so extensions of the vars it
	 * references can widen `c.use` call sites. Never set at runtime. */
	readonly $input?: I;
}

export type ArgsOf<I> = unknown extends I ? void : InferArgs<I>;

export type OptionType<I, O, P, Q, PL, RO extends boolean = boolean> = {
	/**
	 * A readonly fn cannot write vars - not in its handler, not in
	 * anything it calls, not from interceptors mounted on it. Enforced at
	 * the type level (readonly `c.var`, providers stripped from `c.use`)
	 * and at runtime (the whole subtree's store locks).
	 */
	readonly?: RO;
	input?: I;
	output?: O;
	/** Vars this fn guarantees to set. Checked on exit. */
	provides?: P;
	/** Vars that must already be set. Checked on entry, before the body. */
	requires?: Q;
	/**
	 * Module namespaces to pull in. Their vars come into scope, their fns
	 * appear on `c.use` already bound to this context, and their `on`
	 * entries stay active for everything below.
	 */
	use?: PL;
};

/** A used fn, with the parent context already applied. */
type BoundFn<F> =
	F extends FnDefination<infer A, infer R, string>
		? [A] extends [void]
			? () => R
			: (input: A) => R
		: never;

export type UseApi<U> = Prettify<{ [K in keyof U]: BoundFn<U[K]> }>;

/** `c.use` inside a readonly fn: declared writers become uncallable,
 * with the reason on hover instead of a generic type error. */
type ReadUseApi<U> = Prettify<{
	[K in keyof U]: U[K] extends FnDefination<any, any, any, any, infer P>
		? P extends readonly []
			? BoundFn<U[K]>
			: `writes "${P[number] & string}" - not callable from a readonly fn`
		: BoundFn<U[K]>;
}>;

export type Context<
	I,
	RV,
	Required,
	U = unknown,
	FnApi = Fn,
	RO extends boolean = false,
> = {
	input: InferInput<I>;
	var: RO extends true
		? Readonly<VarScope<RV, Required>>
		: VarScope<RV, Required>;
	/** Fns from `use`, each already threaded with this context. */
	use: RO extends true ? ReadUseApi<U> : UseApi<U>;
	/** Define fns from inside: this fn's scope and key carry over, so
	 * anything built here is typed exactly like a chained builder. */
	fn: FnApi;
	/** The schema constructors (string, number, object, ...). */
	types: typeof vTypes;
};

export type InferReturn<O> = unknown extends O ? unknown : InferInput<O>;

export interface Fn<
	Base = unknown,
	BaseFns = unknown,
	BasePL extends readonly Module[] = [],
	Prefix extends string = "",
> {
	/* ---- a handler TERMINATES: these four produce a callable fn ---- */
	<R>(
		fn: (
			ctx: Context<
				unknown,
				ScopeOf<[], Base>,
				never,
				BaseFns,
				Fn<Base, BaseFns, BasePL, Prefix>
			>,
		) => R,
	): FnDefination<void, R, Prefix extends "" ? string : Prefix>;
	<K extends LiteralString, R>(
		key: K,
		fn: (
			ctx: Context<
				unknown,
				ScopeOf<[], Base>,
				never,
				BaseFns,
				Fn<Base, BaseFns, BasePL, `${Prefix}${K}`>
			>,
		) => R,
	): FnDefination<void, R, `${Prefix}${K}`>;
	<
		I,
		O,
		R extends InferReturn<O> | Promise<InferReturn<O>>,
		const PL extends readonly Module[] = [],
		const P extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		const Q extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		RO extends boolean = false,
	>(
		options: OptionType<I, O, P, Q, PL, RO>,
		fn: (
			ctx: Context<
				I,
				ScopeOf<PL, Base>,
				WithDerived<PL, BasePL, Q[number]>,
				ApplyOns<ModuleFns<PL>, PL> & BaseFns,
				Fn<
					Base & ResolvedVars<PL>,
					ApplyOns<ModuleFns<PL>, PL> & BaseFns,
					readonly [...BasePL, ...PL],
					Prefix
				>,
				RO
			>,
		) => R,
	): FnDefination<ArgsOf<I>, R, Prefix extends "" ? string : Prefix, I, P>;
	<
		K extends LiteralString,
		I,
		O,
		R extends InferReturn<O> | Promise<InferReturn<O>>,
		const PL extends readonly Module[] = [],
		const P extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		const Q extends readonly VarName<ScopeOf<PL, Base>>[] = readonly [],
		RO extends boolean = false,
	>(
		key: K,
		options: OptionType<I, O, P, Q, PL, RO>,
		fn: (
			ctx: Context<
				I,
				ScopeOf<PL, Base>,
				WithDerived<PL, BasePL, Q[number]>,
				ApplyOns<ModuleFns<PL>, PL> & BaseFns,
				Fn<
					Base & ResolvedVars<PL>,
					ApplyOns<ModuleFns<PL>, PL> & BaseFns,
					readonly [...BasePL, ...PL],
					`${Prefix}${K}`
				>,
				RO
			>,
		) => R,
	): FnDefination<ArgsOf<I>, R, `${Prefix}${K}`, I, P>;

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
		Prefix
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
		`${Prefix}${K}`
	>;
}

const isThenable = (value: any): value is Promise<unknown> =>
	typeof value?.then === "function";

const STORE = Symbol("var-store");
const ACTIVE = Symbol("active-plugins");
const EXTS = Symbol("active-var-extensions");
const READONLY = Symbol("readonly-lock");

/**
 * Var writes are events: setting `c.var.x` dispatches through the active
 * `on` entries matching `var.set.x` BEFORE the write lands. Handlers run
 * SYNCHRONOUSLY (assignment cannot await): call `next()` to let the write
 * proceed, skip it to cancel, throw to abort. The bare "*" target is
 * excluded - it means "every fn", not "every var write"; listen with
 * "var.set.*" (or a narrower pattern) instead.
 */
const dispatchVars = (
	base: Record<string, unknown>,
	entries: OnEntry<string>[],
	frame: string,
) =>
	new Proxy(base, {
		set(target, prop, value) {
			if (typeof prop !== "string") return Reflect.set(target, prop, value);
			const eventKey = `var.set.${prop}`;
			const hooks = entries.filter(
				(e) => e.target !== "*" && matchesTarget(e.target, eventKey),
			);
			if (hooks.length === 0) return Reflect.set(target, prop, value);
			const apply = () => {
				Reflect.set(target, prop, value);
				return Promise.resolve();
			};
			const chain = hooks.reduceRight<() => Promise<void>>(
				(next, entry) => () => {
					const result = entry.handler(
						{ name: prop, value, fn: frame, var: target } as any,
						next as any,
					);
					if (typeof (result as { then?: unknown })?.then === "function") {
						throw new ValidationError(
							`${frame}.var.set`,
							`var-set handlers must be synchronous - "${String(entry.target)}" returned a promise`,
						);
					}
					return Promise.resolve();
				},
				apply,
			);
			chain();
			return true;
		},
	});

/** A view of the store that refuses every mutation, naming the locker. */
const lockVars = (
	store: Record<string, unknown>,
	lockedBy: string,
	frame: string,
) =>
	new Proxy(store, {
		set(_t, prop) {
			throw new ValidationError(
				`${frame}.readonly`,
				`"${lockedBy}" is readonly: attempted to write var "${String(prop)}"`,
			);
		},
		deleteProperty(_t, prop) {
			throw new ValidationError(
				`${frame}.readonly`,
				`"${lockedBy}" is readonly: attempted to delete var "${String(prop)}"`,
			);
		},
		defineProperty(_t, prop) {
			throw new ValidationError(
				`${frame}.readonly`,
				`"${lockedBy}" is readonly: attempted to define var "${String(prop)}"`,
			);
		},
	});

const defineFn = (
	key: string,
	options: OptionType<any, any, any, any, any>,
	declared: (c: any) => any,
) => {
	const modules = resolveModules((options.use ?? []) as Module[]);

	// Interceptors and var extensions this fn brings, from its modules.
	const own: OnEntry<string>[] = [];
	const ownExts: VarExtension<string, any>[] = [];
	for (const mod of modules) {
		for (const value of Object.values(mod)) {
			if (isOn(value)) own.push(value);
			if (isVarExtension(value)) ownExts.push(value);
		}
	}

	const usable = collectFns(modules);

	// Input that references vars: a var FIELD sets that var from the field
	// value; a whole-var input (`input: user`) sets it from the whole args.
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

	const callable = (input?: unknown, parent?: any) => {
		const raw: Record<string, unknown> = parent?.[STORE] ?? seedVars();
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

		// Store view for this frame: locked beats dispatching beats raw.
		// (A locked frame never reaches var-set hooks - nothing to observe.)
		const hasVarHooks = active.some((e) =>
			e.target instanceof RegExp ? true : e.target.startsWith("var."),
		);
		const store = lockedBy
			? lockVars(raw, lockedBy, key)
			: hasVarHooks
				? dispatchVars(raw, active, key)
				: raw;

		const inheritedExts: VarExtension<string, any>[] = parent?.[EXTS] ?? [];
		const exts =
			ownExts.length === 0
				? inheritedExts
				: [
						...inheritedExts,
						...ownExts.filter((e) => !inheritedExts.includes(e)),
					];

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

		let parsed =
			options.input === undefined
				? input
				: validate(asType(options.input), input, key);

		// Mounted extensions widen the accepted input: each validates its
		// own fields off the same raw input and merges onto `parsed`.
		for (const entry of chain) {
			if (!entry.extend?.input) continue;
			const extra = validate(asType(entry.extend.input), input, `${key}.on`);
			parsed = { ...((parsed as Record<string, unknown>) ?? {}), ...extra };
		}

		// A whole-var input IS the var: the merged value becomes both the
		// parsed input and the var for the rest of the call tree.
		if (wholeVar !== undefined && parsed !== undefined) {
			parsed = extendValue(wholeVar, input, parsed);
			store[wholeVar] = parsed;
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
			store[name] = merged;
		}

		for (const name of options.requires ?? []) {
			if (store[name] === undefined || store[name] === null) {
				throw new ValidationError(
					`${key}.requires.${name}`,
					`required var "${name}" is not set${parent === undefined ? " - called without a parent context" : ""}`,
				);
			}
		}

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
			if (options.output !== undefined) {
				validate(asType(options.output), result, `${key}.output`);
			}
			if (bodyRan) {
				for (const name of options.provides ?? []) {
					if (store[name] === undefined || store[name] === null) {
						throw new ValidationError(
							`${key}.provides.${name}`,
							`declared to provide "${name}" but it was left unset`,
						);
					}
				}
			}
			return result;
		};

		const ctx: any = {
			input: parsed,
			var: store,
			[STORE]: raw,
			[ACTIVE]: active,
			[EXTS]: exts,
			[READONLY]: lockedBy,
			use: {},
			fn: builderFn(key === "anonymous" ? "" : key, {
				use: options.use ?? [],
			}),
			types: vTypes,
		};
		// Bound to `ctx`, so a used fn shares this store and active set
		// without the caller having to thread `c` by hand.
		for (const [name, used] of Object.entries(usable)) {
			ctx.use[name] = (i?: unknown) => (used as any)(i, ctx);
		}

		const result = body(ctx);

		// A sync handler stays sync: only chain when the body is thenable.
		return isThenable(result) ? result.then(finish) : finish(result);
	};

	return Object.assign(callable, {
		$fn: true as const,
		key,
		provides: (options.provides ?? []) as readonly string[],
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
	| "*";

type FnTargetSuggest<Fns, Prefix extends string> = {
	[K in keyof Fns]: Fns[K] extends FnDefination<any, any, infer FK, any, any>
		? FK extends `${Prefix}${infer Rest}`
			? Rest
			: never
		: never;
}[keyof Fns];

type VarNameOfT<T extends string> = T extends `var.set.${infer N}`
	? N extends `${string}*${string}`
		? string
		: N
	: string;

/** The fns among `Fns` whose key the (already prefixed) target hits. */
type MatchedFn<Fns, T extends string> = {
	[K in keyof Fns]: Fns[K] extends FnDefination<any, any, infer FK, any, any>
		? TargetMatches<T, FK & string> extends true
			? Fns[K]
			: never
		: never;
}[keyof Fns];

/** The intercepted input: the matched fn's (a union under wildcards),
 * or an open record when the target names nothing the builder knows. */
type MatchedInput<F> = [F] extends [never]
	? Record<string, any>
	: F extends FnDefination<any, any, any, infer I, any>
		? InferInput<I>
		: never;

/** What `next()` resolves to: the matched fn's own result. */
type MatchedResult<F> = [F] extends [never]
	? any
	: F extends FnDefination<any, infer R, any, any, any>
		? Awaited<R>
		: never;

/** What a builder-scoped `on` handler sees: vars, `use` and `types` from
 * the builder, `input` from the TARGET fn when the builder knows it. */
type OnContext<Base, BaseFns, F, Ext = unknown> = {
	input: MatchedInput<F> & (unknown extends Ext ? unknown : InferInput<Ext>);
	var: VarScope<ScopeOf<[], Base>, never>;
	use: UseApi<BaseFns>;
	types: typeof vTypes;
	fn: unknown;
};

/** `v.on`, scoped: string targets get the builder's key prefix; the
 * handler's `c` and `next()` are typed against the matched target fn. */
export interface InstanceOn<Base, BaseFns, Prefix extends string> {
	/** A fn REFERENCE targets its own key - never prefixed, fully typed
	 * from the fn itself plus the builder's scope. */
	<F extends FnDefination<any, any, string, any, any>>(
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
			c: VarSetContext<VarNameOfT<T>> & {
				value: VarNameOfT<T> extends keyof ScopeOf<[], Base>
					? ScopeOf<[], Base>[VarNameOfT<T>]
					: unknown;
			},
			next: () => void,
		) => void,
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
> = {
	/** Same as `v.fn`, with this builder's key prefix and options baked in. */
	fn: Fn<Base, BaseFns, PL, Prefix>;
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
	readonly ctx: Context<unknown, ScopeOf<[], Base>, never, BaseFns, unknown>;
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
});

const builderFn =
	(baseKey: string, base: Record<string, any>) =>
	(...args: any[]) => {
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
				on: (target: any, a?: any, b?: any) =>
					(onImpl as any)(
						// var events live in a global namespace - no prefix.
						typeof target === "string" && !target.startsWith("var.")
							? key + target
							: target,
						a,
						b,
					),
			};
		}
		return defineFn(key || "anonymous", options, handler);
	};

export const fnImpl = builderFn("", {});
