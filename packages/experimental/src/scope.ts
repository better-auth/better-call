import type { ModuleVars, VarExtensionsFor } from "./module";
import type { Prettify } from "./types";
import type { VarDefination } from "./var";

export type VarValues<V> = {
	[K in keyof V]: V[K] extends VarDefination<any, infer T, any, any>
		? T
		: never;
};

type MergeExtension<T, E> = T extends object ? Prettify<T & E> : T;

type Merged<PL, Base> = ModuleVars<PL> & Base;

/**
 * Every var in scope for a fn: the modules it (or its builder) mounts,
 * with mounted var extensions merged in by the var's declared name.
 */
export type ScopeOf<PL, Base = unknown> = {
	[K in keyof Merged<PL, Base>]: MergeExtension<
		Merged<PL, Base>[K],
		VarExtensionsFor<PL, K & string>
	>;
};

/**
 * A module set's own vars with its own extensions applied - what a
 * builder carries as its base scope.
 */
export type ResolvedVars<PL> = {
	[K in keyof ModuleVars<PL>]: MergeExtension<
		ModuleVars<PL>[K],
		VarExtensionsFor<PL, K & string>
	>;
};

/** Names listed in `requires` become non-nullable. */
export type VarScope<RV, Required> = Prettify<{
	[K in keyof RV]: K extends Required ? NonNullable<RV[K]> : RV[K];
}>;

export type VarName<RV> = keyof RV & string;
