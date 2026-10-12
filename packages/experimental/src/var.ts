import { ValidationError } from "./error";
// Cycle with fn.ts (fn → fn-options → makeVar): do not value-import fnImpl
// at module load. Link it after fn finishes initializing.
import type { Fn } from "./fn";
import { matchesTarget, type OnEntry } from "./module";
import {
	type AttrBag,
	asType,
	attachViews,
	type DefineOutput,
	type InferArgs,
	type InferInput,
	type SchemaInputOf,
	type SchemaOutputOf,
	type TypeDefination,
	vTypes,
} from "./schema";
import type { LiteralString, Prettify } from "./types";

/**
 * A var after `.input` / `.output` projection — same surface as
 * {@link VarDefination} except further `.input` / `.output` are gone.
 * `$view` brands the projection so fn input typing/validation treat it as
 * the contract as written (see {@link SchemaInputOf}).
 */
export type VarView<
	N extends LiteralString,
	T,
	Schema = unknown,
	Source extends string = never,
> = Omit<VarDefination<N, T, Schema, Source>, "input" | "output"> & {
	$view: true;
};

export interface VarDefination<
	N extends LiteralString,
	T,
	Schema = unknown,
	Source extends string = never,
> {
	$var: true;
	name: N;
	default?: T;
	/** Kept in the type so the var can also be used as an input field. */
	schema?: Schema;
	type?: T;
	/** Phantom: the var this one derives from - `requires` on the source
	 * makes this one non-null too. */
	$source?: Source;
	/** Whole-var plugin attributes (field attrs live on the schema). */
	$attrs?: AttrBag;
	/**
	 * Object contributions from `use` modules merge instead of replacing:
	 * same-name var defaults and same-export-key namespaces shallow-merge
	 * onto this value (storage default + helpers). Writes accumulate too.
	 * `v.var(..., { merge: true })` brands this as `true` so context types
	 * fold same-key helpers onto the value.
	 */
	$merge?: true | boolean;
	/**
	 * Fields without `noInput`. Projects inner `schema`; value type `T`
	 * stays the full row. Terminal — does not chain.
	 */
	readonly input: VarView<N, T, SchemaInputOf<Schema>, Source>;
	/**
	 * Fields without `noOutput`. Projects inner `schema`; value type `T`
	 * stays the full row. Terminal — does not chain.
	 */
	readonly output: VarView<N, T, SchemaOutputOf<Schema>, Source>;
	customize: <S>(options: {
		schema: (v: VarCustomizer<T>) => S;
	}) => VarDefination<N, InferInput<S>, S>;
}

export type ValueOfVar<SV> =
	SV extends VarDefination<any, infer T, any, any> ? T : never;

export type NameOfVar<SV> =
	SV extends VarDefination<infer N, any, any, any> ? N : never;

/**
 * The toolkit a `customize` callback receives. It is a SUPERSET of `v`'s
 * type constructors on purpose - the callback parameter shadows `v`, so
 * `(v) => v.add({ role: v.string() })` has to keep working.
 */
export type VarCustomizer<T> = typeof vTypes & {
	/** Declare a fn-typed field: bare `fn` is "any function",
	 * `fn({ input, output })` a specific signature. */
	fn: Fn;
	// The args side goes through InferArgs, not a plain key-for-key map, so
	// an `optional`/defaulted added field is optional to SEND as well - the
	// same rule `v.object` applies to its shape.
	add: <S>(
		shape: S,
	) => TypeDefination<InferArgs<S>, Prettify<NonNullable<T> & DefineOutput<S>>>;
	replace: <S>(schema: S) => S;
};

export type VarMap = Record<string, VarDefination<any, any, any, any>>;

export const varRegistry = new Map<string, any>();

/** Set from `fn.ts` once `fnImpl` exists — breaks var ↔ fn init cycle. */
let linkedFnImpl: ((...args: any[]) => any) | null = null;
export const linkFnImpl = (impl: (...args: any[]) => any) => {
	linkedFnImpl = impl;
};

export const makeVar = (name: string, options: any = {}): any => {
	const schema =
		options.schema === undefined ? undefined : asType(options.schema);
	const def: any = {
		$var: true,
		name,
		default: options.default,
		schema,
		...(options.attrs !== undefined ? { $attrs: options.attrs } : {}),
		$accessor: options.accessor === true,
		$merge: options.merge === true,
		$derive: options.derive,
		customize: (opts: any) =>
			makeVar(name, {
				...options,
				default: def.default,
				// Carry whole-var attrs through customize (including any
				// attached after mint via withAttrs-rebinding, which goes
				// through its own path; this covers options.attrs).
				...(def.$attrs !== undefined ? { attrs: def.$attrs } : {}),
				schema: opts.schema({
					...vTypes,
					fn: linkedFnImpl as (...args: any[]) => any,
					add: (shape: any) => ({
						name: "object",
						shape: { ...((def.schema?.shape as any) ?? {}), ...shape },
					}),
					replace: (schema: any) => schema,
				}),
			}),
	};
	varRegistry.set(name, def);
	return attachViews(def);
};

/**
 * Derive a var from another: computed lazily off the source on every read,
 * so setting the source "sets" every var derived from it. Writing a
 * derived var directly shadows the computation for that scope.
 */
export const deriveVar = (name: string, source: any, get: any): any =>
	makeVar(name, { derive: { source: source.name, get } });

/* ---------------------------------- cells ---------------------------------- */

/**
 * The var DEFINITIONS a frame sees, by name: what its fn mounts through
 * `use` (vars, the bases of `v.extend`s, var-bound input) on top of what
 * its caller saw. A default is read off the definition in scope, so two
 * fns mounting different same-name vars each get their own; only a name
 * nothing in the call chain mounts falls back to the last `v.var` minted.
 */
export type VarDefs = ReadonlyMap<string, any>;

export const resolveVarDef = (name: string, defs: VarDefs | undefined): any =>
	defs?.get(name) ?? varRegistry.get(name);

/**
 * One var's WRITTEN state within a call tree: the value, plus whether
 * writes merge into it (record / merge vars). A var nobody has written
 * has no cell - reads resolve its default (or derivation) from the
 * definition in scope at read time. A written derived var shadows its
 * computation.
 */
export type Cell = {
	value: unknown;
	/** Record / merge var: `set()` merges instead of replacing. */
	accumulate: boolean;
};

export type Cells = Record<string, Cell>;

const accumulates = (def: any): boolean =>
	def?.$accessor === true || def?.$merge === true;

/** The cell for `name`, materialized from the definition in scope. */
export const getCell = (cells: Cells, name: string, defs?: VarDefs): Cell => {
	const existing = cells[name];
	if (existing) return existing;
	const def = resolveVarDef(name, defs);
	const cell: Cell = {
		value: def?.$accessor ? {} : readVar(cells, name, defs),
		accumulate: accumulates(def),
	};
	cells[name] = cell;
	return cell;
};

/** The current value: the written one, else computed off the definition
 * in scope (a record's `{}` materializes so in-place writes stick). A name
 * never declared and never written reads `undefined` WITHOUT materializing
 * a cell - property probes on the context must not pollute the scope. */
export const readVar = (
	cells: Cells,
	name: string,
	defs?: VarDefs,
): unknown => {
	const cell = cells[name];
	if (cell) return cell.value;
	const def = resolveVarDef(name, defs);
	if (!def) return undefined;
	if (def.$derive) {
		const src = readVar(cells, def.$derive.source, defs);
		return src == null ? null : def.$derive.get(src);
	}
	if (def.$accessor) return getCell(cells, name, defs).value;
	return def.default;
};

/**
 * A handler's `c`: its own fields (`name`, `value`, `fn`) in front, every
 * other property a RAW read of the scope's vars - so a handler reading
 * `c.<var>` cannot recurse into its own get hook.
 */
export const handlerContext = (
	cells: Cells,
	base: Record<string, unknown>,
	defs?: VarDefs,
): Record<string, unknown> =>
	new Proxy(base, {
		get: (t, prop) =>
			prop in t
				? (t as any)[prop]
				: typeof prop === "string"
					? readVar(cells, prop, defs)
					: undefined,
		has: (t, prop) => prop in t || (typeof prop === "string" && prop in cells),
	});

/* ---------------------------------- frame ---------------------------------- */

/**
 * What a handle needs to know about the fn frame it was created in: the
 * scope's cells, plus everything write behavior depends on there.
 */
export type Frame = {
	cells: Cells;
	/** The var definitions in scope - where unwritten vars read from. */
	defs?: VarDefs;
	key: string;
	lockedBy: string | undefined;
	entries: readonly OnEntry<string>[];
};

const isThenable = (value: any): value is Promise<unknown> =>
	typeof value?.then === "function";

/**
 * Every write funnels here: the readonly lock beats everything, then the
 * matching `var.set.<name>` entries run SYNCHRONOUSLY around the actual
 * write - call `next()` to land it, skip to cancel, throw to abort. The
 * bare "*" target means "every fn", never "every var write".
 */
export const writeVar = (frame: Frame, name: string, value: unknown) => {
	if (frame.lockedBy) {
		throw new ValidationError(
			`${frame.key}.readonly`,
			`"${frame.lockedBy}" is readonly: attempted to write var "${name}"`,
		);
	}
	const accumulate =
		frame.cells[name]?.accumulate ??
		accumulates(resolveVarDef(name, frame.defs));
	const merged = () => {
		const current = readVar(frame.cells, name, frame.defs);
		const base = typeof current === "object" && current !== null ? current : {};
		return { ...base, ...(value as Record<string, unknown>) };
	};
	const next = accumulate ? merged() : value;
	const apply = () => {
		const cell = frame.cells[name];
		if (cell) cell.value = next;
		else frame.cells[name] = { value: next, accumulate };
	};
	const hooks = frame.entries.filter(
		(e) => e.target !== "*" && matchesTarget(e.target, `var.set.${name}`),
	);
	if (hooks.length === 0) return apply();
	const chain = hooks.reduceRight<() => void>(
		(proceed, entry) => () => {
			const result = entry.handler(
				handlerContext(
					frame.cells,
					{ name, value: next, fn: frame.key },
					frame.defs,
				) as any,
				proceed as any,
			);
			if (isThenable(result)) {
				throw new ValidationError(
					`${frame.key}.set`,
					`var-set handlers must be synchronous - "${String(entry.target)}" returned a promise`,
				);
			}
		},
		apply,
	);
	chain();
};

/**
 * Context reads funnel here: matching `var.get.<name>` entries run
 * SYNCHRONOUSLY around the raw read - `next()` yields the stored value and
 * whatever the handler returns becomes the read result. Internal reads
 * stay raw: derive sources, handler contexts (so a handler reading a var
 * off `c` cannot recurse into itself) and contract checks all see the
 * cell as-is.
 */
export const readVarThrough = (frame: Frame, name: string): unknown => {
	const hooks = frame.entries.filter(
		(e) => e.target !== "*" && matchesTarget(e.target, `var.get.${name}`),
	);
	if (hooks.length === 0) return readVar(frame.cells, name, frame.defs);
	const chain = hooks.reduceRight<() => unknown>(
		(proceed, entry) => () => {
			const result = entry.handler(
				handlerContext(frame.cells, { name, fn: frame.key }, frame.defs) as any,
				proceed as any,
			);
			if (isThenable(result)) {
				throw new ValidationError(
					`${frame.key}.get`,
					`var-get handlers must be synchronous - "${String(entry.target)}" returned a promise`,
				);
			}
			return result;
		},
		() => readVar(frame.cells, name, frame.defs),
	);
	return chain();
};

/* ---------------------------------- scope ---------------------------------- */

/**
 * Merge-var reads expose a shallow view that binds any `$fn` member into
 * this context - helpers contributed via `use` call like usable fns.
 */
export const viewMergeVar = (
	name: string,
	value: unknown,
	ctx: unknown,
	defs?: VarDefs,
): unknown => {
	const def = resolveVarDef(name, defs);
	if (!def?.$merge || value == null || typeof value !== "object") return value;
	return new Proxy(value as object, {
		get: (t, prop, receiver) => {
			const member = Reflect.get(t, prop, receiver);
			if (
				typeof member !== "function" ||
				(member as { $fn?: boolean }).$fn !== true
			) {
				return member;
			}
			const usedArity = (member as { $arity?: number }).$arity;
			return usedArity === undefined
				? (i?: unknown) => (member as any)(i, ctx)
				: (...args: unknown[]) => {
						const padded = args.slice(0, usedArity);
						while (padded.length < usedArity) padded.push(undefined);
						return (member as any)(...padded, ctx);
					};
		},
	});
};

/**
 * The fn context for one frame: `base` carries the fixed surface (input,
 * error, fn, types, the bound `use` fns, internal symbols) and EVERY
 * other property is a var - read it directly (`c.session.userId`) and
 * write it by plain assignment (`c.session = {...}`). Reads route through
 * the `var.get` entries, writes through `writeVar` (readonly lock,
 * `var.set` entries), and both are always synchronous. Base keys shadow
 * vars of the same name, both ways.
 */
export const contextScope = (frame: Frame, base: object): any =>
	new Proxy(base, {
		get: (t, prop, receiver) => {
			if (prop in t) return Reflect.get(t, prop, receiver);
			if (typeof prop === "string") {
				return viewMergeVar(
					prop,
					readVarThrough(frame, prop),
					receiver,
					frame.defs,
				);
			}
			return undefined;
		},
		set: (t, prop, value, receiver) => {
			if (typeof prop !== "string" || prop in t) {
				return Reflect.set(t, prop, value, receiver);
			}
			writeVar(frame, prop, value);
			return true;
		},
		has: (t, prop) => prop in t || typeof prop === "string",
	});
