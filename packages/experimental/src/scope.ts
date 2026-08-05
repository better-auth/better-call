import type {
	ModuleVars,
	VarExtensionArgsFor,
	VarExtensionsFor,
} from "./module";
import type { Prettify } from "./types";
import type { VarDefination } from "./var";

declare const __varSet: unique symbol;

/**
 * Phantom wrapper pairing a stored/read shape (`Get`) with a write/args
 * shape (`Set`). Only used in the type system - runtime values are plain.
 */
export type VarSlot<Get, Set = Get> = Get & {
	readonly [__varSet]?: Set;
};

export type VarGet<V> = V extends VarSlot<infer G, any> ? G : V;
export type VarSetVal<V> =
	V extends VarSlot<any, infer S> ? ([unknown] extends [S] ? VarGet<V> : S) : V;

export type VarValues<V> = {
	[K in keyof V]: V[K] extends VarDefination<any, infer T, any, any>
		? VarGet<T>
		: never;
};

type MergeOnto<T, E> = [E] extends [never]
	? T
	: unknown extends E
		? T
		: T extends object
			? Prettify<T & E>
			: T;

type MergeVarValue<T, GetE, SetE> =
	T extends VarSlot<infer G, infer S>
		? VarSlot<MergeOnto<G, GetE>, MergeOnto<S, SetE>>
		: MergeOnto<T, GetE>;

type Merged<PL, Base> = ModuleVars<PL> & Base;

/**
 * Every var in scope for a fn: the modules it (or its builder) mounts,
 * with mounted var extensions merged in by the var's declared name.
 */
export type ScopeOf<PL, Base = unknown> = {
	[K in keyof Merged<PL, Base>]: MergeVarValue<
		Merged<PL, Base>[K],
		VarExtensionsFor<PL, K & string>,
		VarExtensionArgsFor<PL, K & string>
	>;
};

/**
 * A module set's own vars with its own extensions applied - what a
 * builder carries as its base scope.
 */
export type ResolvedVars<PL> = {
	[K in keyof ModuleVars<PL>]: MergeVarValue<
		ModuleVars<PL>[K],
		VarExtensionsFor<PL, K & string>,
		VarExtensionArgsFor<PL, K & string>
	>;
};

/** Names listed in `requires` become non-nullable. */
export type VarScope<RV, Required> = Prettify<{
	[K in keyof RV]: K extends Required
		? NonNullable<VarGet<RV[K]>>
		: VarGet<RV[K]>;
}>;

export type VarName<RV> = keyof RV & string;

/* --------------------------------- handles --------------------------------- */

/**
 * What `c.var.<name>` is: a handle, and NOTHING else - `.get()` and
 * `.set()` are the whole surface, so a property read can never be
 * mistaken for the value (`c.var.session.userId` is a type error; it is
 * `c.var.session.get().userId`). `set` is always synchronous, and absent
 * entirely on a readonly frame.
 *
 * Schema vars wrap `VarSlot<InferInput, InferArgs>` so `.get()` sees the
 * stored/post-validation shape while `.set()` accepts the caller args
 * shape (optional / defaulted fields may be omitted).
 */
export type VarHandle<T, RO extends boolean = false> = Prettify<
	{ get(): VarGet<T> } & (RO extends true
		? unknown
		: { set(value: VarSetVal<T>): void })
>;

/** The scope as handles. A var listed in `requires` is non-null. */
export type HandleScope<RV, Required, RO extends boolean = false> = {
	[K in keyof RV]: K extends Required
		? VarHandle<NonNullable<RV[K]>, RO>
		: VarHandle<RV[K], RO>;
};
