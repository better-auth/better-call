import { ValidationError } from "./error";
// Cycle with fn.ts (it imports our cells): fine, `fnImpl` is only touched
// inside the lazy `customize` closure, never during module evaluation.
import { type Fn, fnImpl } from "./fn";
import { matchesTarget, type OnEntry } from "./module";
import {
	type AttrBag,
	asType,
	type DefineOutput,
	type InferArgs,
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
					fn: fnImpl,
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
 * One var's state within a scope: the current value, plus how reads and
 * writes behave for it (derived computation, record accumulation).
 */
export type Cell = {
	value: unknown;
	derive?: { source: string; get: (value: any) => any };
	/** A direct write to a derived var shadows its computation. */
	shadowed: boolean;
	/** Record / merge var: `set()` merges instead of replacing. */
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
		derive: def?.$derive,
		shadowed: false,
		accumulate: def?.$accessor === true || def?.$merge === true,
	};
	cells[name] = cell;
	return cell;
};

/** The current value, deriveds computed off their source. A name never
 * declared and never written reads `undefined` WITHOUT materializing a
 * cell - property probes on the context must not pollute the scope. */
export const readVar = (cells: Cells, name: string): unknown => {
	if (!cells[name] && !varRegistry.has(name)) return undefined;
	const cell = getCell(cells, name);
	if (cell.derive && !cell.shadowed) {
		const src = readVar(cells, cell.derive.source);
		return src == null ? null : cell.derive.get(src);
	}
	return cell.value;
};

/**
 * A handler's `c`: its own fields (`name`, `value`, `fn`) in front, every
 * other property a RAW read of the scope's vars - so a handler reading
 * `c.<var>` cannot recurse into its own get hook.
 */
export const handlerContext = (
	cells: Cells,
	base: Record<string, unknown>,
): Record<string, unknown> =>
	new Proxy(base, {
		get: (t, prop) =>
			prop in t
				? (t as any)[prop]
				: typeof prop === "string"
					? readVar(cells, prop)
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
		if (cell.derive) cell.shadowed = true;
	};
	const hooks = frame.entries.filter(
		(e) => e.target !== "*" && matchesTarget(e.target, `var.set.${name}`),
	);
	if (hooks.length === 0) return apply();
	const chain = hooks.reduceRight<() => void>(
		(proceed, entry) => () => {
			const result = entry.handler(
				handlerContext(frame.cells, {
					name,
					value: next,
					fn: frame.key,
				}) as any,
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
	if (hooks.length === 0) return readVar(frame.cells, name);
	const chain = hooks.reduceRight<() => unknown>(
		(proceed, entry) => () => {
			const result = entry.handler(
				handlerContext(frame.cells, {
					name,
					fn: frame.key,
				}) as any,
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
		() => readVar(frame.cells, name),
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
): unknown => {
	const def = varRegistry.get(name);
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
				return viewMergeVar(prop, readVarThrough(frame, prop), receiver);
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
