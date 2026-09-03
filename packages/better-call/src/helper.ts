export type RequiredKeysOf<BaseType extends object> = Exclude<
	{
		[Key in keyof BaseType]: BaseType extends Record<Key, BaseType[Key]>
			? Key
			: never;
	}[keyof BaseType],
	undefined
>;

export type HasRequiredKeys<BaseType extends object> =
	RequiredKeysOf<BaseType> extends never ? false : true;

export type Prettify<T> = 0 extends 1 & T
	? any
	: {
			[K in keyof T]: T[K];
		} & {};

export type IsEmptyObject<T> = keyof T extends never ? true : false;

export type UnionToIntersection<Union> = (
	Union extends unknown
		? (distributedUnion: Union) => void
		: never
) extends (mergedIntersection: infer Intersection) => void
	? Intersection & Union
	: never;

export type InferParamPath<Path> =
	Path extends `${infer _Start}:${infer Param}/${infer Rest}`
		? { [K in Param | keyof InferParamPath<Rest>]: string }
		: Path extends `${infer _Start}:${infer Param}`
			? { [K in Param]: string }
			: Path extends `${infer _Start}/${infer Rest}`
				? InferParamPath<Rest>
				: {};

export type InferParamWildCard<Path> = Path extends
	| `${infer _Start}/*:${infer Param}/${infer Rest}`
	| `${infer _Start}/**:${infer Param}/${infer Rest}`
	? { [K in Param | keyof InferParamPath<Rest>]: string }
	: Path extends `${infer _Start}/*`
		? { [K in "_"]: string }
		: Path extends `${infer _Start}/${infer Rest}`
			? InferParamWildCard<Rest>
			: {};
