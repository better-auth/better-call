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
	/**
	 * A mountable SEED: put it in a fn's `use` and the var holds `value`
	 * for that fn's whole subtree - the per-instance counterpart of a
	 * default. It does not redefine the var, so library fns mounting the
	 * var themselves see the seeded value too. Writes to the var inside
	 * the subtree stay in it.
	 */
	with(value: T): VarSeed<N, T>;
}

/** What `var.with(value)` returns - mount it in `use`. */
export type VarSeed<N extends string, T> = {
	$seed: true;
	name: N;
	/** The seeded var - mounting the seed brings it, like `v.extend`. */
	var: VarDefination<N, T, any, any>;
	value: T;
};

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

/**
 * Identity of a var's STATE, shared by every definition that is "the same
 * var": a `customize`d re-export keeps it, a fresh `v.var` of the same name
 * gets its own. Written values live per slot, not per name.
 */
export type VarSlot = { readonly name: string };

export const makeVar = (name: string, options: any = {}): any => {
	const schema =
		options.schema === undefined ? undefined : asType(options.schema);
	const slot: VarSlot = options.slot ?? { name };
	const def: any = {
		$var: true,
		name,
		$slot: slot,
		default: options.default,
		schema,
		...(options.attrs !== undefined ? { $attrs: options.attrs } : {}),
		$accessor: options.accessor === true,
		$merge: options.merge === true,
		$derive: options.derive,
		// `this`: copies (`withAttrs`, views) seed themselves.
		with(this: any, value: unknown) {
			return { $seed: true, name, var: this ?? def, value };
		},
		customize: (opts: any) =>
			makeVar(name, {
				...options,
				slot,
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
	makeVar(name, { derive: { source: source.name, sourceDef: source, get } });

/* ---------------------------------- cells ---------------------------------- */

/**
 * The var DEFINITIONS a frame sees, by name: what its fn mounts through
 * `use` (vars, the bases of `v.extend`s and seeds, var-bound input) on top
 * of what its caller saw - the nearest mount of a name wins. A name nothing
 * in the call chain mounts falls back to the last `v.var` minted.
 */
export type VarDefs = ReadonlyMap<string, any>;

export const resolveVarDef = (name: string, defs: VarDefs | undefined): any =>
	defs?.get(name) ?? varRegistry.get(name);

/**
 * One var's WRITTEN state: the value, plus whether writes merge into it
 * (record / merge vars). A var nobody has written has no cell - reads
 * resolve its default (or derivation) from the definition in scope. A
 * written derived var shadows its computation.
 */
export type Cell = {
	value: unknown;
	/** Record / merge var: `set()` merges instead of replacing. */
	accumulate: boolean;
};

/**
 * A call tree's var state, as a stack of LAYERS. Cells are keyed by the
 * var's SLOT (its definition family), never by bare name: two instances
 * minting their own same-name var never share a value, while every fn
 * mounting the same definition does.
 *
 * - The root layer of a call tree, and an `isolate` layer, own their
 *   writes: nothing written above them lands below.
 * - A seed layer (`fn.with(...)` on a call, a mounted `var.with(value)`)
 *   holds its seeded cells; writes to those stay in it, every other write
 *   passes through to the layer below - so a seeded call still hands back
 *   what it `provides`.
 */
export type Layer = {
	cells: Map<unknown, Cell>;
	parent: Layer | undefined;
	isolate: boolean;
};

export const rootLayer = (): Layer => ({
	cells: new Map(),
	parent: undefined,
	isolate: true,
});

/** A seed layer over `parent`; a fresh root when there is none. */
export const seedLayer = (parent: Layer | undefined): Layer =>
	parent ? { cells: new Map(), parent, isolate: false } : rootLayer();

/** A copy-on-write fork: reads fall through, writes stay here. */
export const isolatedLayer = (parent: Layer | undefined): Layer => ({
	cells: new Map(),
	parent,
	isolate: true,
});

/** Where a definition's state lives; an undeclared name keys by itself. */
const slotOf = (def: any, name: string): unknown => def?.$slot ?? name;

const lookup = (layer: Layer, slot: unknown): Cell | undefined => {
	for (let at: Layer | undefined = layer; at; at = at.parent) {
		const cell = at.cells.get(slot);
		if (cell) return cell;
	}
	return undefined;
};

/** The layer a write to `slot` lands in: the nearest one already holding
 * it, never crossing an isolate boundary. */
const writeTarget = (layer: Layer, slot: unknown): Layer => {
	let at = layer;
	while (!at.cells.has(slot) && !at.isolate && at.parent) at = at.parent;
	return at;
};

const accumulates = (def: any): boolean =>
	def?.$accessor === true || def?.$merge === true;

/** The current value of `def`'s var: the written one, else computed off
 * the definition (a record's `{}` materializes so in-place writes stick). */
const readDef = (
	layer: Layer,
	def: any,
	name: string,
	defs: VarDefs | undefined,
): unknown => {
	const slot = slotOf(def, name);
	const cell = lookup(layer, slot);
	if (cell) return cell.value;
	if (!def) return undefined;
	if (def.$derive) {
		const source =
			def.$derive.sourceDef ?? resolveVarDef(def.$derive.source, defs);
		const src = readDef(layer, source, def.$derive.source, defs);
		return src == null ? null : def.$derive.get(src);
	}
	if (def.$accessor) {
		const fresh: Cell = { value: {}, accumulate: true };
		writeTarget(layer, slot).cells.set(slot, fresh);
		return fresh.value;
	}
	return def.default;
};

/** A name never declared and never written reads `undefined` WITHOUT
 * materializing a cell - property probes must not pollute the scope. */
export const readVar = (layer: Layer, name: string, defs?: VarDefs): unknown =>
	readDef(layer, resolveVarDef(name, defs), name, defs);

/** Has anything WRITTEN `name` in this scope? */
export const hasVar = (layer: Layer, name: string, defs?: VarDefs): boolean =>
	lookup(layer, slotOf(resolveVarDef(name, defs), name)) !== undefined;

/** The value a write of `value` leaves: merged onto the current one for
 * record / merge vars. */
const nextValue = (
	layer: Layer,
	def: any,
	name: string,
	value: unknown,
	defs: VarDefs | undefined,
): { next: unknown; accumulate: boolean } => {
	const accumulate =
		lookup(layer, slotOf(def, name))?.accumulate ?? accumulates(def);
	if (!accumulate) return { next: value, accumulate };
	const current = readDef(layer, def, name, defs);
	const base = typeof current === "object" && current !== null ? current : {};
	return {
		next: { ...base, ...(value as Record<string, unknown>) },
		accumulate,
	};
};

const store = (target: Layer, slot: unknown, cell: Cell) => {
	const existing = target.cells.get(slot);
	if (existing) existing.value = cell.value;
	else target.cells.set(slot, cell);
};

/**
 * SEED `name` in `layer` itself - no readonly lock, no `var.set` hooks: a
 * seed declares a value, like a default does. Record / merge vars merge
 * onto what the layer below holds.
 */
export const seedVar = (
	layer: Layer,
	name: string,
	value: unknown,
	defs?: VarDefs,
) => seedVarDef(layer, resolveVarDef(name, defs), name, value, defs);

/** {@link seedVar} for a known definition - lands in ITS slot even when
 * the frame's nearest mount of the name is a different var. */
export const seedVarDef = (
	layer: Layer,
	def: any,
	name: string,
	value: unknown,
	defs?: VarDefs,
) => {
	const { next, accumulate } = nextValue(layer, def, name, value, defs);
	store(layer, slotOf(def, name), { value: next, accumulate });
};

/**
 * A handler's `c`: its own fields (`name`, `value`, `fn`) in front, every
 * other property a RAW read of the scope's vars - so a handler reading
 * `c.<var>` cannot recurse into its own get hook.
 */
export const handlerContext = (
	layer: Layer,
	base: Record<string, unknown>,
	defs?: VarDefs,
): Record<string, unknown> =>
	new Proxy(base, {
		get: (t, prop) =>
			prop in t
				? (t as any)[prop]
				: typeof prop === "string"
					? readVar(layer, prop, defs)
					: undefined,
		has: (t, prop) =>
			prop in t || (typeof prop === "string" && hasVar(layer, prop, defs)),
	});

/* ---------------------------------- frame ---------------------------------- */

/**
 * What a handle needs to know about the fn frame it was created in: the
 * scope's layer, plus everything write behavior depends on there.
 */
export type Frame = {
	layer: Layer;
	/** The var definitions in scope - which var a name means here. */
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
 * bare "*" target means "every fn", never "every var write". The write
 * lands in the var's slot for the definition this frame sees.
 */
export const writeVar = (frame: Frame, name: string, value: unknown) => {
	if (frame.lockedBy) {
		throw new ValidationError(
			`${frame.key}.readonly`,
			`"${frame.lockedBy}" is readonly: attempted to write var "${name}"`,
		);
	}
	const def = resolveVarDef(name, frame.defs);
	const slot = slotOf(def, name);
	const { next, accumulate } = nextValue(
		frame.layer,
		def,
		name,
		value,
		frame.defs,
	);
	const apply = () =>
		store(writeTarget(frame.layer, slot), slot, { value: next, accumulate });
	const hooks = frame.entries.filter(
		(e) => e.target !== "*" && matchesTarget(e.target, `var.set.${name}`),
	);
	if (hooks.length === 0) return apply();
	const chain = hooks.reduceRight<() => void>(
		(proceed, entry) => () => {
			const result = entry.handler(
				handlerContext(
					frame.layer,
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
	if (hooks.length === 0) return readVar(frame.layer, name, frame.defs);
	const chain = hooks.reduceRight<() => unknown>(
		(proceed, entry) => () => {
			const result = entry.handler(
				handlerContext(frame.layer, { name, fn: frame.key }, frame.defs) as any,
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
		() => readVar(frame.layer, name, frame.defs),
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
