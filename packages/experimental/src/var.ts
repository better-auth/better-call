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

/**
 * A var you accumulate into rather than assign. Endpoints `.set()` the
 * fields they know about, plugins `.set()` theirs, and whoever persists it
 * calls `.get()` on the merged whole - so no one has to know the full shape.
 */
export type Accessor<T> = {
	set: (patch: Partial<T> & Record<string, unknown>) => void;
	get: () => T & Record<string, unknown>;
};

export type VarMap = Record<string, VarDefination<any, any, any, any>>;

export const createAccessor = (): Accessor<any> => {
	let value: Record<string, unknown> = {};
	return {
		set: (patch) => {
			value = { ...value, ...patch };
		},
		get: () => value as any,
	};
};

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

export const seedVars = () => {
	const vars: Record<string, unknown> = {};
	const derived: Array<[string, { source: string; get: (v: any) => any }]> = [];
	for (const [name, def] of varRegistry) {
		if (def.$derive) {
			derived.push([name, def.$derive]);
			continue;
		}
		// Accessors are per-scope, so each request accumulates its own.
		vars[name] = def.$accessor ? createAccessor() : def.default;
	}
	for (const [name, spec] of derived) {
		let shadow: unknown;
		let hasShadow = false;
		Object.defineProperty(vars, name, {
			enumerable: true,
			configurable: true,
			get() {
				if (hasShadow) return shadow;
				const src = (vars as Record<string, unknown>)[spec.source];
				return src == null ? null : spec.get(src);
			},
			set(value) {
				hasShadow = true;
				shadow = value;
			},
		});
	}
	return vars;
};
