import { type EventDefination, extendEvent, isEvent, makeEvent } from "./event";
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

/** `v.extend`: vars gain fields; events gain kinds. */
function extend<N extends LiteralString, S, BaseT>(
	target: VarDefination<N, BaseT, any, any>,
	schema: S,
): import("./module").VarExtension<N, S, BaseT>;
function extend<N extends LiteralString, S>(
	target: N,
	schema: S,
): import("./module").VarExtension<N, S>;
function extend<
	N extends LiteralString,
	T extends Record<string, unknown>,
	const E extends Record<string, unknown>,
>(
	target: EventDefination<N, T>,
	types: E,
): import("./event").EventExtension<N, E, T>;
function extend(target: any, schemaOrTypes: any): any {
	return isEvent(target)
		? extendEvent(target, schemaOrTypes)
		: extendVar(target, schemaOrTypes);
}

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
	 * An event CATEGORY: several kinds under one namespace, each with a
	 * payload schema. Subscribe via `.subscribe` or `v.on`; widen kinds with
	 * `.extend` / `v.extend`. Same-name declarations across modules merge.
	 */
	event: <
		N extends LiteralString,
		const T extends Record<string, unknown> = Record<string, never>,
	>(
		name: N,
		types?: T,
	) => EventDefination<N, T>;
	/**
	 * MANY instances of a var, queryable: each named var becomes a
	 * COLLECTION of rows shaped like its value - `db.user.create(row)`,
	 * `db.user.findOne({ email })`, findMany/update/delete/count. The
	 * adapter is the translation seam a real database implements;
	 * `memoryAdapter()` is the built-in dummy.
	 */
	storage: typeof makeStorage;
	on: typeof on;
	extend: typeof extend;
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
	event: makeEvent as V["event"],
	storage: makeStorage,
	on,
	extend,
	...vTypes,
};

export {
	ControlFlow,
	captureCallerStack,
	FnError,
	getErrors,
	type Issue,
	UnexpectedError,
	ValidationError,
} from "./error";
export type {
	EventDefination,
	EventExtension,
	EventHandler,
	EventMessage,
	EventNext,
	EventOnEntry,
	EventPayloads,
	EventsFrom,
	ModuleEvents,
} from "./event";
export {
	extendEvent,
	isEvent,
	isEventExtension,
	isEventOn,
	makeEvent,
} from "./event";
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
	PublicFn,
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
	type FieldPred,
	type InferArgs,
	type InferInput,
	type InferOutput,
	type InferType,
	omitFields,
	type ParseFieldsOptions,
	parseFields,
	rejectFields,
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
