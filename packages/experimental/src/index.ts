import { type Fn, fnImpl } from "./fn";
import { extendVar, on } from "./module";

import { type InferInput, vTypes } from "./schema";
import { makeStorage } from "./storage";
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
	var: <
		N extends LiteralString,
		S = undefined,
		D = undefined,
		const M extends boolean | undefined = undefined,
	>(
		name: N,
		options?: { default?: D; schema?: S; merge?: M },
		// A default the schema already covers (e.g. `{}` against an
		// all-optional shape) is absorbed; `default: null` still unions in.
		// `merge: true` - object contributions from `use` modules (same-name
		// defaults, same-key namespaces) shallow-merge onto the value;
		// writes accumulate the same way. Brand `$merge: true` so scope
		// types can fold those helpers onto the var.
	) => VarDefination<
		N,
		[S] extends [undefined]
			? D
			: InferInput<S> | ([D] extends [InferInput<S>] ? never : D),
		S
	> &
		(M extends true ? { $merge: true } : unknown);
	/** A var you accumulate into: `set()` merges instead of replacing. */
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
	 * MANY instances of a var, queryable: each named var becomes a
	 * COLLECTION of rows shaped like its value - `db.user.create(row)`,
	 * `db.user.findOne({ email })`, findMany/update/delete/count. The
	 * adapter is the translation seam a real database implements;
	 * `memoryAdapter()` is the built-in dummy.
	 */
	storage: typeof makeStorage;
	on: typeof on;
	extend: typeof extendVar;
	string: (typeof vTypes)["string"];
	number: (typeof vTypes)["number"];
	boolean: (typeof vTypes)["boolean"];
	date: (typeof vTypes)["date"];
	object: (typeof vTypes)["object"];
	array: (typeof vTypes)["array"];
	union: (typeof vTypes)["union"];
	any: (typeof vTypes)["any"];
}

export const v: V = {
	fn: fnImpl as Fn,
	var: makeVar as V["var"],
	record: ((name: string, options: any = {}) =>
		makeVar(name, { ...options, accessor: true })) as V["record"],
	derive: deriveVar as V["derive"],
	storage: makeStorage,
	on,
	extend: extendVar,
	...vTypes,
};

export {
	ControlFlow,
	captureCallerStack,
	FnError,
	type Issue,
	UnexpectedError,
	ValidationError,
} from "./error";
export type {
	BoundCall,
	Context,
	Fn,
	FnDefination,
	FnErrors,
	FnErrorsOf,
	Instance,
	OptionType,
	ParentContext,
	UseApi,
	WidenedArgs,
	WithContext,
	WithSeed,
} from "./fn";
export {
	type ApplyOn,
	type ApplyOns,
	collectFns,
	collectUsable,
	type ExtendedArgs,
	type InputVarExtra,
	type InputVarExtraOut,
	type Interceptor,
	isFn,
	isNamespace,
	isOn,
	isVarExtension,
	type Module,
	type ModuleFns,
	type ModuleVars,
	type OnDefaultContext,
	type OnEntry,
	type VarExtension,
	type VarExtensionsFor,
	type VarGetContext,
	type VarSetContext,
	type VarsFrom,
} from "./module";
export {
	type AttrBag,
	attrsOf,
	type InferArgs,
	type InferInput,
	type InferOutput,
	type InferType,
	type TypeDefination,
	withAttrs,
} from "./schema";
export type {
	ResolvedVars,
	RowInScope,
	ScopeOf,
	VarName,
	VarScope,
} from "./scope";
export {
	type Collection,
	type Condition,
	conditionsOf,
	type FieldMeta,
	type FindManyOptions,
	fieldsFromSchema,
	isStorage,
	type ModelConfig,
	matchesWhere,
	memoryAdapter,
	resolveModelFields,
	type Storage,
	type StorageAdapter,
	type StorageApi,
	type StorageHook,
	type StorageHookContext,
	type StorageModels,
	type StorageOp,
	type StorageTarget,
	type Where,
	type WhereOp,
	type WhereOps,
} from "./storage";
export type { LiteralString, Prettify } from "./types";
export type { VarCustomizer, VarDefination, VarMap } from "./var";
