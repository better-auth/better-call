import type { FnDefination } from "./fn";
import { type InferArgs, type InferInput, isVar, type vTypes } from "./schema";
import type {
	LiteralString,
	Members,
	Prettify,
	UnionToIntersection,
} from "./types";
import type { VarDefination } from "./var";

export type Interceptor = (c: any, next: () => Promise<any>) => any;

/**
 * What a GLOBAL `v.on` handler sees. Without a builder there is no scope
 * to infer, but the context's shape is always the same - so the default
 * is structured with loose leaves, never `any`: `c.input.code` works,
 * `c.tpyo` does not. Mount the entry on a builder's `on` for real types.
 */
export type OnDefaultContext = {
	input: Record<string, any>;
	types: typeof vTypes;
	fn: unknown;
	/** Vars and used fns live directly on `c` - untyped here; mount the
	 * entry on a builder's `on` for real types. */
	[key: string]: any;
};

export type OnEntry<N extends string, Ext = unknown> = {
	$on: true;
	/** Exact key, a `*` wildcard pattern, a RegExp, or a LIST of any of
	 * those - one handler mounted on several events at once. */
	target: N | RegExp | readonly (string | RegExp)[];
	/** Extra input fields this mount adds to the target fn. */
	extend?: { input?: Ext };
	handler: Interceptor;
};

/**
 * Does an `on` target hit fn key `key`? Exact match, `*` wildcards
 * ("*", "sign_up.*", "/sign-up/*" - a `*` spans anything), a RegExp, or a
 * list (any member hitting counts).
 */
export const matchesTarget = (
	target: string | RegExp | readonly (string | RegExp)[],
	key: string,
): boolean => {
	if (Array.isArray(target)) {
		return (target as readonly (string | RegExp)[]).some((member) =>
			matchesTarget(member, key),
		);
	}
	if (target instanceof RegExp) return target.test(key);
	// Array.isArray cannot narrow a readonly array out of the union.
	const name = target as string;
	if (name === key) return true;
	if (!name.includes("*")) return false;
	const pattern = name
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${pattern}$`).test(key);
};

/**
 * The type-level half of `matchesTarget`, for input extensions: exact
 * keys and single-`*` patterns narrow call sites; RegExp targets (typed
 * `string`) intercept and validate at runtime but cannot narrow.
 */
export type TargetMatches<N, K extends string> = N extends "*"
	? true
	: N extends `${infer Pre}*${infer Suf}`
		? K extends `${Pre}${string}`
			? Suf extends ""
				? true
				: K extends `${string}${Suf}`
					? true
					: false
			: false
		: N extends K
			? true
			: false;

/**
 * A module is the unit of composition: a RECORD of members - vars, fns,
 * `on` entries, var extensions - usually just what a file exports
 * (`import * as twoFactor`) or a curated bundle. "Plugin" is not a
 * concept, only a usage: mounting someone else's module. Always an
 * object, never a bare member: `use: [{ createUser }]`, not
 * `use: [createUser]`. The `never` marks reject bare members at the type
 * level; `resolveModules` rejects them at runtime.
 */
export type Module = Record<string, unknown> & {
	$var?: never;
	$varExtend?: never;
	/** Rejects a bare `on` ENTRY (`$on: true`) while letting a storage
	 * through - its `$on` is the hook-mounting METHOD, not the brand. */
	$on?: (...args: never[]) => unknown;
	$fn?: never;
};

/** A module member that can NEST other members: a plain record that is
 * not itself branded. Fn defs are callable, so they never match. */
type GroupMember<V> = V extends
	| { $var: true }
	| { $on: true }
	| { $varExtend: true }
	| ((...args: any[]) => any)
	| readonly unknown[]
	? never
	: V extends Record<string, unknown>
		? V
		: never;

type VarEntryUnion<M> = {
	[K in keyof M]: M[K] extends VarDefination<infer N, infer T, any, any>
		? { [P in N]: T }
		: M[K] extends VarExtension<infer N, any, infer BT>
			? unknown extends BT
				? never
				: { [P in N]: BT }
			: [GroupMember<M[K]>] extends [never]
				? never
				: VarEntryUnion<GroupMember<M[K]>>;
}[keyof M];

/**
 * Vars a module exports, keyed by their DECLARED name, not export name.
 * Distributes over `M`: without that, a union of modules collapses to
 * `keyof A & keyof B` and every var is lost. The `[never]` guard matters
 * too - `UnionToIntersection<never>` is `unknown`, and one var-less module
 * in the union would absorb every other module's vars into `unknown`.
 */
export type VarsFrom<M> = M extends unknown
	? [VarEntryUnion<M>] extends [never]
		? never
		: UnionToIntersection<VarEntryUnion<M>>
	: never;

export type ModuleVars<PL> = UnionToIntersection<VarsFrom<Members<PL>>>;

/** Depth budget for nested groups: unbranded records can be arbitrarily
 * deep (schema shapes, values), so the walk stops after a few levels
 * instead of blowing the instantiation limit. */
type GroupDepth = [never, 0, 1, 2];

/** A nested GROUP's fns: only real groups holding at least one fn
 * (within the depth budget) survive - everything else drops from the
 * surface. */
type GroupFns<V, D extends number> = [D] extends [never]
	? never
	: [GroupMember<V>] extends [never]
		? never
		: [keyof FnEntries<GroupMember<V>, D>] extends [never]
			? never
			: FnEntries<GroupMember<V>, D>;

type FnEntries<M, D extends number = 3> = {
	[K in keyof M as M[K] extends FnDefination<any, any, any, any, any, any>
		? K
		: M[K] extends VarDefination<any, any, any, any>
			? K
			: [GroupFns<M[K], GroupDepth[D]>] extends [never]
				? never
				: K]: M[K] extends FnDefination<any, any, any, any, any, any>
		? M[K]
		: M[K] extends VarDefination<any, any, any, any>
			? M[K]
			: GroupFns<M[K], GroupDepth[D]>;
};

/** Fns and vars a module exports, keyed by EXPORT name. A plain-record
 * member is a GROUP: its members stay nested under the member's name
 * (`use: [{ cookie: { setCookie } }]` -> `c.cookie.setCookie`). A var
 * member is an ALIAS onto the var - `{ cookie: { options: cookieOptions } }`
 * reads and writes the `cookieOptions` var through `c.cookie.options`. */
export type FnsFrom<M> = M extends unknown ? FnEntries<M> : never;

export type ModuleFns<PL> = UnionToIntersection<FnsFrom<Members<PL>>>;

export const isFn = (value: any): value is FnDefination<any, any> =>
	typeof value === "function" && value?.$fn === true;

/**
 * Guard the module list: modules are plain records, and passing a bare
 * fn/var/extension/`on` entry is almost always a mistake (a bare fn would
 * otherwise look like a factory and get CALLED). Fail loudly instead.
 */
export const resolveModules = (
	modules: readonly Module[],
): Record<string, unknown>[] =>
	modules.map((mod) => {
		if (isFn(mod) || isVar(mod) || isVarExtension(mod) || isOn(mod)) {
			const bare = mod as { key?: string; name?: string; target?: unknown };
			const name =
				bare.key ??
				bare.name ??
				(bare.target !== undefined ? String(bare.target) : "member");
			throw new Error(
				`modules are objects - wrap the member: use([{ ${name} }]), not use([${name}])`,
			);
		}
		return (mod ?? {}) as Record<string, unknown>;
	});

/** Collect every exported fn from a set of plugin modules. */
export const collectFns = (
	modules: readonly Module[],
): Record<string, FnDefination<any, any>> => {
	const fns: Record<string, FnDefination<any, any>> = {};
	for (const mod of resolveModules(modules)) {
		for (const [name, value] of Object.entries(mod)) {
			if (isFn(value)) fns[name] = value;
		}
	}
	return fns;
};

/**
 * A plain-record member that GROUPS other members - not itself branded
 * (fn, var, on entry, var extension) but holding at least one such member,
 * transitively. Storages and other `$`-surfaced objects fail the member
 * test and stay opaque values.
 */
export const isNamespace = (
	value: unknown,
): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return false;
	if (isVar(value) || isOn(value) || isVarExtension(value)) return false;
	return Object.values(value).some(
		(m) =>
			isFn(m) || isVar(m) || isOn(m) || isVarExtension(m) || isNamespace(m),
	);
};

/**
 * Every exported fn AND var, with plain-record GROUPS kept as nested
 * namespaces: `use: [{ cookie: { setCookie } }]` lands the fn on
 * `c.cookie.setCookie`. A var member becomes an ALIAS under its export
 * name (`{ cookie: { options: cookieOptions } }` -> `c.cookie.options`
 * reads/writes the var). Groups holding nothing (however deep) drop out.
 */
export const collectUsable = (
	modules: readonly Module[],
): Record<string, unknown> => {
	const walk = (mod: Record<string, unknown>): Record<string, unknown> => {
		const out: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(mod)) {
			if (isFn(value) || isVar(value)) {
				out[name] = value;
			} else if (isNamespace(value)) {
				const nested = walk(value);
				if (Object.keys(nested).length > 0) out[name] = nested;
			}
		}
		return out;
	};
	const fns: Record<string, unknown> = {};
	for (const mod of resolveModules(modules)) Object.assign(fns, walk(mod));
	return fns;
};

export const isOn = (value: any): value is OnEntry<string> =>
	value?.$on === true;

/**
 * Mount onto another fn by name. The handler replaces that fn's body and
 * receives `next` - call it to delegate, or don't.
 *
 * Sounder than a before/after hook: it has the target's signature, runs
 * INSIDE the target's contract checks (so skipping `next` still has to
 * satisfy `provides`), and composes as a stack.
 *
 * The middle argument extends the target's INPUT: those fields are
 * validated alongside the fn's own, land on `c.input`, and - through
 * `ApplyOns` - become required at every call site that mounts this entry.
 */
/** The var name a `var.set.…`/`var.get.…` target addresses - literal when
 * exact. */
type VarNameOf<T extends string> = T extends `var.${"set" | "get"}.${infer N}`
	? N extends `${string}*${string}`
		? string
		: N
	: string;

/** What a `var.set.…` handler receives. Writes are synchronous, so the
 * handler must be too - call `next()` to let the write land, skip it to
 * cancel, throw to abort. */
export type VarSetContext<N extends string = string> = {
	/** The var being written. */
	name: N;
	/** The incoming value. */
	value: unknown;
	/** The fn frame performing the write. */
	fn: string;
	/** Every other property reads the scope's vars directly. */
	[key: string]: unknown;
};

/** What a `var.get.…` handler receives. Reads are synchronous, so the
 * handler must be too - `next()` yields the stored value and whatever the
 * handler returns becomes the read result. */
export type VarGetContext<N extends string = string> = {
	/** The var being read. */
	name: N;
	/** The fn frame performing the read. */
	fn: string;
	/** Every other property reads the scope's vars (raw - no get hooks). */
	[key: string]: unknown;
};

type FnInputOf<F> =
	F extends FnDefination<any, any, any, infer I, any, any>
		? InferInput<I>
		: never;

type FnResultOf<F> =
	F extends FnDefination<any, infer R, any, any, any, any> ? Awaited<R> : never;

export function on<T extends "var.set.*" | `var.set.${string}`>(
	target: T,
	handler: (c: VarSetContext<VarNameOf<T>>, next: () => void) => void,
): OnEntry<T>;
export function on<T extends "var.get.*" | `var.get.${string}`>(
	target: T,
	handler: (c: VarGetContext<VarNameOf<T>>, next: () => unknown) => unknown,
): OnEntry<T>;
export function on<F extends FnDefination<any, any, string, any, any, any>>(
	target: F,
	handler: (
		c: Omit<OnDefaultContext, "input"> & { input: FnInputOf<F> },
		next: () => Promise<FnResultOf<F>>,
	) => any,
): OnEntry<F["key"]>;
export function on<
	F extends FnDefination<any, any, string, any, any, any>,
	const Ext,
>(
	target: F,
	extend: { input: Ext },
	handler: (
		c: Omit<OnDefaultContext, "input"> & {
			input: FnInputOf<F> & InferInput<Ext>;
		},
		next: () => Promise<FnResultOf<F>>,
	) => any,
): OnEntry<F["key"], Ext>;
export function on(
	targets: readonly (
		| LiteralString
		| RegExp
		| FnDefination<any, any, string, any, any, any>
	)[],
	handler: (c: OnDefaultContext, next: () => Promise<any>) => any,
): OnEntry<string>;
export function on(
	target: RegExp,
	handler: (c: OnDefaultContext, next: () => Promise<any>) => any,
): OnEntry<string>;
export function on<N extends "*" | LiteralString>(
	target: N,
	handler: (c: OnDefaultContext, next: () => Promise<any>) => any,
): OnEntry<N>;
export function on<const Ext>(
	target: RegExp,
	extend: { input: Ext },
	handler: (
		c: Omit<OnDefaultContext, "input"> & {
			input: InferInput<Ext> & Record<string, any>;
		},
		next: () => Promise<any>,
	) => any,
): OnEntry<string, Ext>;
export function on<N extends LiteralString, const Ext>(
	target: N,
	extend: { input: Ext },
	handler: (
		c: Omit<OnDefaultContext, "input"> & {
			input: InferInput<Ext> & Record<string, any>;
		},
		next: () => Promise<any>,
	) => any,
): OnEntry<N, Ext>;
export function on(
	target:
		| string
		| RegExp
		| FnDefination<any, any, string, any, any, any>
		| readonly (
				| string
				| RegExp
				| FnDefination<any, any, string, any, any, any>
		  )[],
	extendOrHandler: any,
	maybeHandler?: any,
): OnEntry<string, any> {
	// A fn reference targets its own key - no string to typo. A LIST
	// resolves member-wise: one handler, several events.
	const resolveOne = (member: unknown) =>
		isFn(member)
			? (member as { key: string }).key
			: (member as string | RegExp);
	const resolved = (
		Array.isArray(target) ? target.map(resolveOne) : resolveOne(target)
	) as string | RegExp | readonly (string | RegExp)[];
	return typeof extendOrHandler === "function"
		? { $on: true, target: resolved, handler: extendOrHandler }
		: {
				$on: true,
				target: resolved,
				extend: extendOrHandler,
				handler: maybeHandler,
			};
}

/* ----------------------------- var extension ------------------------------ */

export type VarExtension<N extends string, S, BaseT = unknown> = {
	$varExtend: true;
	name: N;
	schema: S;
	/** The var being extended, when handed by reference. */
	base?: VarDefination<N, BaseT, any, any>;
};

export const isVarExtension = (
	value: any,
): value is VarExtension<string, any> => value?.$varExtend === true;

/**
 * Extend a var's shape from a module. Where `customize` mints a NEW var
 * definition to re-export, an extension is a mountable value: every scope
 * or fn that `use`s the module containing it sees the var widened, and
 * nothing that doesn't mount it is affected.
 *
 * Handed the var by REFERENCE, the extension carries it: mounting just
 * the extension brings the var itself, merged by its declared key - no
 * need to also mount the base var.
 */
export function extendVar<N extends LiteralString, S, BaseT>(
	target: VarDefination<N, BaseT, any, any>,
	schema: S,
): VarExtension<N, S, BaseT>;
export function extendVar<N extends LiteralString, S>(
	target: N,
	schema: S,
): VarExtension<N, S>;
export function extendVar(
	target: VarDefination<string, any, any, any> | string,
	schema: any,
): VarExtension<string, any, any> {
	return typeof target === "string"
		? { $varExtend: true, name: target, schema }
		: { $varExtend: true, name: target.name, schema, base: target };
}

type VarExtEntry<M, K extends string> = M extends unknown
	? {
			[P in keyof M]: M[P] extends VarExtension<K, infer S>
				? InferInput<S>
				: never;
		}[keyof M]
	: never;

/**
 * Shape additions modules in `PL` mount on var `K`. Resolves to `unknown`
 * when none - which intersects away harmlessly.
 */
export type VarExtensionsFor<PL, K extends string> = UnionToIntersection<
	VarExtEntry<Members<PL>, K>
>;

type VarExtArgsEntry<M, K extends string> = M extends unknown
	? {
			[P in keyof M]: M[P] extends VarExtension<K, infer S>
				? InferArgs<S>
				: never;
		}[keyof M]
	: never;

/** The ARGS side of the same extensions - what a caller must send. */
export type VarExtensionArgsFor<PL, K extends string> = UnionToIntersection<
	VarExtArgsEntry<Members<PL>, K>
>;

/** The args side of every VAR named `K` a module set declares - a
 * `customize`d re-export shadows by NAME, so mounting it counts as a
 * declaration about the same var. Schema-less vars contribute nothing. */
type VarShadowArgsEntry<M, K extends string> = M extends unknown
	? {
			[P in keyof M]: M[P] extends VarDefination<K, any, infer S, any>
				? unknown extends S
					? never
					: [NonNullable<S>] extends [never]
						? never
						: InferArgs<NonNullable<S>>
				: never;
		}[keyof M]
	: never;

/**
 * Everything a module set says about var `K`'s ARGS side: extensions
 * mounted on it, intersected with every same-name var declaration. This is
 * what widens a fn schema whose input references `K` (see `WidenSchemaFns`)
 * - `unknown` when the scope adds nothing, which intersects away.
 */
export type VarArgsInScope<PL, K extends string> = VarExtensionArgsFor<PL, K> &
	([VarShadowArgsEntry<Members<PL>, K>] extends [never]
		? unknown
		: UnionToIntersection<VarShadowArgsEntry<Members<PL>, K>>);

type VarFieldKeys<I> = {
	[K in keyof I]: I[K] extends { $var: true } ? K : never;
}[keyof I];

/**
 * Extra args a fn must accept because its INPUT references vars that `PL`
 * extends. Whole-var input (`input: user`) merges at the top level; a var
 * used as a field widens that field. `unknown` when nothing applies.
 */
export type InputVarExtra<PL, I> = I extends {
	$var: true;
	name: infer N extends string;
}
	? VarExtensionArgsFor<PL, N>
	: [VarFieldKeys<I>] extends [never]
		? unknown
		: {
				[K in keyof I as I[K] extends { $var: true }
					? K
					: never]: I[K] extends {
					$var: true;
					name: infer N extends string;
				}
					? VarExtensionArgsFor<PL, N>
					: unknown;
			};

/* ------------------------------- extension -------------------------------- */

type ExtEntryArgs<M, K extends string> = M extends unknown
	? {
			[P in keyof M]: M[P] extends OnEntry<infer N, infer E>
				? unknown extends E
					? never
					: TargetMatches<N, K> extends true
						? InferArgs<E>
						: never
				: never;
		}[keyof M]
	: never;

/** Args added onto fn `K` by every extending `on` entry in `PL`. */
export type ExtendedArgs<PL, K extends string> = UnionToIntersection<
	ExtEntryArgs<Members<PL>, K>
>;

/**
 * Rewrite a fn's type with the input extensions the module set `PL`
 * mounts on it. This is how a plugin's extra field becomes REQUIRED at
 * the call site, even though the fn itself never declared it.
 */
export type ApplyOn<F, PL> =
	F extends FnDefination<
		infer A,
		infer R,
		infer K,
		infer I,
		infer P,
		infer Er,
		infer W,
		infer O
	>
		? unknown extends ExtendedArgs<PL, K & string> & InputVarExtra<PL, I>
			? F
			: FnDefination<
					Prettify<
						([A] extends [void] ? unknown : A) &
							ExtendedArgs<PL, K & string> &
							InputVarExtra<PL, I>
					>,
					R,
					K & string,
					I,
					P,
					Er,
					W,
					O
				>
		: F;

export type ApplyOns<Fns, PL> = { [P in keyof Fns]: ApplyOn<Fns[P], PL> };

/* -------------------------------- derived --------------------------------- */

type DerivedNamesEntry<Mod, Q> = Mod extends unknown
	? {
			[K in keyof Mod]: Mod[K] extends VarDefination<
				infer N,
				any,
				any,
				infer Src
			>
				? [Src] extends [never]
					? never
					: Src extends Q
						? N
						: never
				: never;
		}[keyof Mod]
	: never;

/**
 * Expand a `requires` set with every var DERIVED from a required source:
 * requiring `request` makes `method`, `path`, ... non-null too, because
 * they are computed from it.
 */
export type WithDerived<PL, BasePL, Q> =
	| Q
	| DerivedNamesEntry<Members<PL> | Members<BasePL>, Q>;
