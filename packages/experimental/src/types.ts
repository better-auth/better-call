export type LiteralString = string & Record<never, never>;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type UnionToIntersection<U> = (
	U extends unknown
		? (u: U) => void
		: never
) extends (i: infer I) => void
	? I
	: never;

/** The entries of a `use` list. Bare fns (format validators) only check
 * formats - they contribute no vars, fns or extensions, so they drop out. */
export type Members<P> = P extends readonly unknown[]
	? Exclude<P[number], { readonly $fn: true }>
	: never;
