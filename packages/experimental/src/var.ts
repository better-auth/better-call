import { ValidationError } from "./error";
import { matchesTarget, type OnEntry, type PersistBinding } from "./module";
import {
	asType,
	type DefineInput,
	type DefineOutput,
	type InferInput,
	type TypeDefination,
	vTypes,
} from "./schema";
import type { LiteralString, Prettify } from "./types";

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
	add: <S>(
		shape: S,
	) => TypeDefination<
		DefineInput<S>,
		Prettify<NonNullable<T> & DefineOutput<S>>
	>;
	replace: <S>(schema: S) => S;
};

export type VarMap = Record<string, VarDefination<any, any, any, any>>;

export const varRegistry = new Map<string, any>();

export const makeVar = (name: string, options: any = {}): any => {
	const def: any = {
		$var: true,
		name,
		default: options.default,
		schema: options.schema === undefined ? undefined : asType(options.schema),
		$accessor: options.accessor === true,
		$derive: options.derive,
		customize: (opts: any) =>
			makeVar(name, {
				default: def.default,
				schema: opts.schema({
					...vTypes,
					add: (shape: any) => ({
						name: "object",
						shape: { ...((def.schema?.shape as any) ?? {}), ...shape },
					}),
					replace: (schema: any) => schema,
				}),
			}),
	};
	varRegistry.set(name, def);
	return def;
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
 * One var's state within a scope. Values used to live as bare properties
 * on a store object; a cell also remembers what the STORE said (loaded,
 * loadedValue) and what changed here (dirty, dirtyFields) - which is
 * exactly what persistence flushes from at root exit.
 */
export type Cell = {
	value: unknown;
	/** A `set()` landed this scope - the scope's value beats any load. */
	written: boolean;
	/** Something to flush: a write happened (input-var seeding included). */
	dirty: boolean;
	/** `null` = the whole value was replaced; a Set = only these fields. */
	dirtyFields: Set<string> | null;
	/** The persist load settled (even when it answered null). */
	loaded: boolean;
	/** What the store answered - the `prev` a save receives. */
	loadedValue: unknown;
	/** In-flight load, memoized so N concurrent gets are one query. */
	loading: Promise<unknown> | null;
	derive?: { source: string; get: (value: any) => any };
	/** A direct write to a derived var shadows its computation. */
	shadowed: boolean;
	/** Record var: `set()` merges instead of replacing. */
	accumulate: boolean;
};

export type Cells = Record<string, Cell>;

/** Cells materialize lazily from the registry on first touch. */
export const getCell = (cells: Cells, name: string): Cell => {
	const existing = cells[name];
	if (existing) return existing;
	const def = varRegistry.get(name);
	const cell: Cell = {
		value: def?.$derive ? undefined : def?.$accessor ? {} : def?.default,
		written: false,
		dirty: false,
		dirtyFields: null,
		loaded: false,
		loadedValue: undefined,
		loading: null,
		derive: def?.$derive,
		shadowed: false,
		accumulate: def?.$accessor === true,
	};
	cells[name] = cell;
	return cell;
};

/** The current value, deriveds computed off their source. */
export const readVar = (cells: Cells, name: string): unknown => {
	const cell = getCell(cells, name);
	if (cell.derive && !cell.shadowed) {
		const src = readVar(cells, cell.derive.source);
		return src == null ? null : cell.derive.get(src);
	}
	return cell.value;
};

/** A read-only plain-value view - what `var.set` handlers see as `c.var`. */
export const valuesView = (cells: Cells): Record<string, unknown> =>
	new Proxy(
		{},
		{
			get: (_t, prop) =>
				typeof prop === "string" ? readVar(cells, prop) : undefined,
			has: (_t, prop) => typeof prop === "string" && prop in cells,
		},
	);

/* ---------------------------------- frame ---------------------------------- */

/**
 * What a handle needs to know about the fn frame it was created in: the
 * scope's cells, plus everything write/load behavior depends on there.
 */
export type Frame = {
	cells: Cells;
	key: string;
	lockedBy: string | undefined;
	entries: readonly OnEntry<string>[];
	bindings: ReadonlyMap<string, PersistBinding>;
	/** The frame's context, for `load(c)` - a getter since it exists later. */
	ctx: () => unknown;
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
	const cell = getCell(frame.cells, name);
	const merged = () => {
		const current =
			cell.derive && !cell.shadowed ? readVar(frame.cells, name) : cell.value;
		const base = typeof current === "object" && current !== null ? current : {};
		return { ...base, ...(value as Record<string, unknown>) };
	};
	const next = cell.accumulate ? merged() : value;
	const apply = () => {
		cell.value = next;
		// Which columns changed: a record merge names the patch's keys, a
		// whole replace wipes the distinction.
		const fields = cell.accumulate
			? Object.keys((value as Record<string, unknown>) ?? {})
			: null;
		if (fields === null) cell.dirtyFields = null;
		else if (!cell.dirty) cell.dirtyFields = new Set(fields);
		else if (cell.dirtyFields) for (const f of fields) cell.dirtyFields.add(f);
		cell.written = true;
		cell.dirty = true;
		if (cell.derive) cell.shadowed = true;
	};
	const hooks = frame.entries.filter(
		(e) => e.target !== "*" && matchesTarget(e.target, `var.set.${name}`),
	);
	if (hooks.length === 0) return apply();
	const chain = hooks.reduceRight<() => void>(
		(proceed, entry) => () => {
			const result = entry.handler(
				{
					name,
					value: next,
					fn: frame.key,
					var: valuesView(frame.cells),
				} as any,
				proceed as any,
			);
			if (isThenable(result)) {
				throw new ValidationError(
					`${frame.key}.var.set`,
					`var-set handlers must be synchronous - "${String(entry.target)}" returned a promise`,
				);
			}
		},
		apply,
	);
	chain();
};

/**
 * Start (or join) the scope's ONE load for a persisted var. Returns the
 * in-flight promise, or null when there is nothing to await - no binding,
 * already loaded, already written, or a store that answered synchronously.
 * The scope's value always beats the store's: a load never overwrites a
 * value someone `set()` while it was in flight.
 */
export const triggerLoad = (
	frame: Frame,
	name: string,
): Promise<unknown> | null => {
	const cell = getCell(frame.cells, name);
	if (cell.loading) return cell.loading;
	const binding = frame.bindings.get(name);
	if (!binding || cell.loaded || cell.written) return null;
	const settle = (value: unknown) => {
		cell.loaded = true;
		cell.loading = null;
		cell.loadedValue = value == null ? null : value;
		if (!cell.written && value != null) cell.value = value;
	};
	const result = binding.load(frame.ctx() as never);
	if (isThenable(result)) {
		cell.loading = result.then((value) => {
			settle(value);
			return value;
		});
		return cell.loading;
	}
	settle(result);
	return null;
};

/* --------------------------------- handles --------------------------------- */

/**
 * `c.var` for one frame: every var is a HANDLE, and `.get()` / `.set()`
 * are its WHOLE surface - a property read is never the value, so there is
 * nothing to mistake (`c.var.session.get().userId`, never
 * `c.var.session.userId`). Reads of an unloaded persisted var return the
 * memoized load promise; writes are always synchronous and land in the
 * scope, flushed at root exit.
 */
export const createVarScope = (frame: Frame): any => {
	const handles = new Map<string, unknown>();
	return new Proxy(
		{},
		{
			get(_t, name) {
				if (typeof name !== "string") return undefined;
				let handle = handles.get(name);
				if (!handle) {
					handle = createHandle(frame, name);
					handles.set(name, handle);
				}
				return handle;
			},
			set(_t, prop) {
				if (frame.lockedBy) {
					throw new ValidationError(
						`${frame.key}.readonly`,
						`"${frame.lockedBy}" is readonly: attempted to write var "${String(prop)}"`,
					);
				}
				throw new ValidationError(
					`${frame.key}.var`,
					`assignment is not a write - use c.var.${String(prop)}.set(...)`,
				);
			},
			has: (_t, prop) => typeof prop === "string",
		},
	);
};

const createHandle = (frame: Frame, name: string) => {
	const read = (): unknown => {
		const cell = getCell(frame.cells, name);
		if (!cell.derive || cell.shadowed) {
			const pending = triggerLoad(frame, name);
			if (pending) return pending.then(() => readVar(frame.cells, name));
		}
		return readVar(frame.cells, name);
	};
	return {
		get: read,
		set: (value: unknown) => writeVar(frame, name, value),
	};
};
