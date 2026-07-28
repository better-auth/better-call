import { type Fn, fnImpl } from "./fn";
import { extendVar, on, persistVar } from "./module";
import { type InferInput, vTypes } from "./schema";
import type { LiteralString } from "./types";
import {
	deriveVar,
	makeVar,
	type NameOfVar,
	type ValueOfVar,
	type VarDefination,
} from "./var";

interface V {
	fn: Fn;
	var: <N extends LiteralString, S = undefined, D = undefined>(
		name: N,
		options?: { default?: D; schema?: S },
	) => VarDefination<N, [S] extends [undefined] ? D : InferInput<S> | D, S>;
	/** A var you accumulate into: `set()` merges instead of replacing, and
	 * each patch's keys count as dirty FIELDS for persistence. */
	record: <N extends LiteralString, S = undefined>(
		name: N,
		options?: { schema?: S },
	) => VarDefination<
		N,
		[S] extends [undefined] ? Record<string, unknown> : Partial<InferInput<S>>,
		S
	>;
	/**
	 * A var computed from another. Reads run the getter against the current
	 * source; `requires` on the SOURCE makes derived vars non-null too.
	 */
	derive: <
		N extends LiteralString,
		SV extends VarDefination<any, any, any, any>,
		R,
	>(
		name: N,
		source: SV,
		get: (value: NonNullable<ValueOfVar<SV>>) => R,
	) => VarDefination<
		N,
		R | Extract<ValueOfVar<SV>, null | undefined>,
		unknown,
		NameOfVar<SV>
	>;
	/**
	 * Bind a var to a store - a MOUNTABLE member, like `v.extend`, so the
	 * var stays storage-agnostic and each scope picks where it lives.
	 * `load` runs once per scope: eagerly when a fn `requires` the var
	 * (sync, non-null in the body), lazily on first `.get()` otherwise
	 * (the handle's get is a promise then). Written vars flush through
	 * `save` exactly once when the ROOT fn returns - wrapped by any
	 * `scope.flush` interceptors - and a throw anywhere means no flush.
	 */
	persist: typeof persistVar;
	on: typeof on;
	extend: typeof extendVar;
	string: (typeof vTypes)["string"];
	number: (typeof vTypes)["number"];
	boolean: (typeof vTypes)["boolean"];
	object: (typeof vTypes)["object"];
	any: (typeof vTypes)["any"];
}

export const v: V = {
	fn: fnImpl as Fn,
	var: makeVar as V["var"],
	record: ((name: string, options: any = {}) =>
		makeVar(name, { ...options, accessor: true })) as V["record"],
	derive: deriveVar as V["derive"],
	persist: persistVar,
	on,
	extend: extendVar,
	...vTypes,
};

export { ValidationError } from "./error";
export type {
	Context,
	Fn,
	FnDefination,
	Instance,
	OptionType,
	ParentContext,
	UseApi,
} from "./fn";
export {
	type ApplyOn,
	type ApplyOns,
	type AsyncPersisted,
	collectFns,
	type ExtendedArgs,
	type Interceptor,
	isFn,
	isOn,
	isVarExtension,
	isVarPersist,
	type Module,
	type ModuleFns,
	type ModuleVars,
	type OnDefaultContext,
	type OnEntry,
	type PersistBinding,
	type PersistContext,
	persistVar,
	type VarExtension,
	type VarExtensionsFor,
	type VarsFrom,
} from "./module";
export type {
	HandleScope,
	ResolvedVars,
	ScopeOf,
	VarHandle,
	VarName,
	VarScope,
} from "./scope";
export type { LiteralString, Prettify } from "./types";
export type { VarCustomizer, VarDefination, VarMap } from "./var";
