import type { ModuleVars, VarArgsInScope, VarExtensionsFor } from "./module";
import type { Prettify } from "./types";
import type { VarDefination } from "./var";

export type VarValues<V> = {
	[K in keyof V]: V[K] extends VarDefination<any, infer T, any, any>
		? T
		: never;
};

type MergeExtension<T, E> = T extends object ? Prettify<T & E> : T;

type Merged<PL, Base> = ModuleVars<PL> & Base;

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

export type WidenSchemaFns<T, PL> = T extends (...args: any[]) => any
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

export type ResolvedVars<PL> = {
	[K in keyof ModuleVars<PL>]: MergeExtension<
		ModuleVars<PL>[K],
		VarExtensionsFor<PL, K & string>
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
