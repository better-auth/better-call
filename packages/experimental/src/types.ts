export type LiteralString = string & Record<never, never>;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type UnionToIntersection<U> = (
	U extends unknown
		? (u: U) => void
		: never
) extends (i: infer I) => void
	? I
	: never;

export type Members<P> = P extends readonly unknown[] ? P[number] : never;
