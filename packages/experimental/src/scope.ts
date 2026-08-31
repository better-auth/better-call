import type { ModuleVars, VarArgsInScope, VarExtensionsFor } from "./module";
import type { Collection } from "./storage";
import type { Prettify } from "./types";
import type { VarDefination } from "./var";

export type VarValues<V> = {
	[K in keyof V]: V[K] extends VarDefination<any, infer T, any, any>
		? T
		: never;
};

type MergeExtension<T, E> = T extends object ? Prettify<T & E> : T;

type Merged<PL, Base> = ModuleVars<PL> & Base;

export type ResolvedVars<PL> = {
	[K in keyof ModuleVars<PL>]: MergeExtension<
		ModuleVars<PL>[K],
		VarExtensionsFor<PL, K & string>
	>;
};

/**
 * Row shape a collection uses inside scope `PL`: the model var as the
 * scope sees it (extensions + same-name customize), falling back to the
 * declared row plus any mounted `v.extend` fields.
 */
export type RowInScope<
	R,
	PL,
	N extends string,
> = N extends keyof ResolvedVars<PL>
	? NonNullable<ResolvedVars<PL>[N]>
	: unknown extends VarExtensionsFor<PL, N>
		? R
		: Prettify<R & VarExtensionsFor<PL, N>>;

type WidenSchemaFn<T, PL> = T extends {
	$fnVar?: [infer N extends string];
}
	? T extends (input: infer A) => infer R
		? unknown extends VarArgsInScope<PL, N>
			? T
			: ((input: Prettify<A & VarArgsInScope<PL, N>>) => R) & {
					readonly $fnVar?: [N];
				}
		: T
	: T;

/**
 * Rewrite a `$modelVar`-branded collection so `Where` / returns use the
 * composed model shape - same PL math as {@link WidenSchemaFn} / {@link
 * ResolvedVars}.
 */
type WidenCollection<T, PL> =
	T extends Collection<infer R, infer N>
		? [R] extends [RowInScope<R, PL, N & string>]
			? T
			: Collection<RowInScope<R, PL, N & string>, N & string>
		: T;

export type WidenSchemaFns<T, PL> =
	T extends Collection<any, string>
		? WidenCollection<T, PL>
		: T extends (...args: any[]) => any
			? WidenSchemaFn<T, PL>
			: T extends readonly unknown[]
				? { [K in keyof T]: WidenSchemaFns<T[K], PL> }
				: T extends Date | RegExp | Promise<unknown> | Map<any, any> | Set<any>
					? T
					: T extends object
						? { [K in keyof T]: WidenSchemaFns<T[K], PL> }
						: T;

export type ScopeOf<PL, Base = unknown, ExtPL = PL> = {
	[K in keyof Merged<PL, Base>]: WidenSchemaFns<
		MergeExtension<Merged<PL, Base>[K], VarExtensionsFor<ExtPL, K & string>>,
		ExtPL
	>;
};

export type VarScope<RV, Required, RO extends boolean = false> = RO extends true
	? {
			readonly [K in keyof RV]: K extends Required ? NonNullable<RV[K]> : RV[K];
		}
	: Prettify<{
			[K in keyof RV]: K extends Required ? NonNullable<RV[K]> : RV[K];
		}>;

export type VarName<RV> = keyof RV & string;
