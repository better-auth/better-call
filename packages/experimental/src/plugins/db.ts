import { v } from "..";
import { createRandomStringGenerator } from "../helpers/random";
import {
	attrsOf,
	type DefineOutput,
	type InferArgs,
	type InferInput,
	isType,
	isVar,
	noInput,
	type TypeDefination,
	withAttrs,
} from "../schema";
import { checkModelIndexes, type ModelIndex } from "../storage";
import type { LiteralString } from "../types";
import type { VarDefination } from "../var";

/** Named stand-in for `v.var(name, { default: null, schema })`.
 * Inferring that return from `v.var` exceeds TS7056 on declaration emit. */
type ModelSchema<S> =
	S extends TypeDefination<any, any, any>
		? S
		: TypeDefination<InferArgs<S>, DefineOutput<S>, never> & { shape: S };

type ModelVar<N extends LiteralString, S> = VarDefination<
	N,
	| (S extends TypeDefination<any, any, any> ? InferInput<S> : DefineOutput<S>)
	| null,
	ModelSchema<S>
> & { $attrs: { db: { model: true } } };

/** A `v.var` options bag — not a field shape and not a type. */
type SchemaArg<S> =
	S extends TypeDefination<any, any, any>
		? S
		: S extends { schema: unknown }
			? "default" extends keyof S
				? never
				: S
			: S;

export const generateId = v.fn(
	"db.generate_id",
	{
		input: v.object(
			{ size: v.number({ optional: true, default: 32 }) },
			{ optional: true, default: {} },
		),
		output: v.string(),
	},
	async (c) => {
		return createRandomStringGenerator("a-z", "A-Z", "0-9")(c.input.size);
	},
);

export const unique = <S>(schema: S): S => {
	return withAttrs(schema, "db", { unique: true });
};

export const indexed = <S>(schema: S): S => {
	return withAttrs(schema, "db", { index: true });
};

export const references = <S>(
	schema: S,
	ref: {
		model: string;
		field: string;
		onDelete?: "cascade" | "set null" | "restrict";
	},
): S => {
	return withAttrs(schema, "db", { references: ref });
};

/** Mark a primary key and install {@link generateId} as the field default
 * so validate / v.fn / storage.create all mint an id when the key is omitted.
 * Also tags {@link noInput} so wire / fn callers cannot smuggle an id. */
export const id = <T, O>(
	schema: TypeDefination<T, O, any>,
): TypeDefination<T, O, string> & { $attrs: { v: { noInput: true } } } =>
	noInput(
		withAttrs(
			{ ...schema, default: generateId } as TypeDefination<T, O, string>,
			"db",
			{ id: true },
		),
	) as TypeDefination<T, O, string> & { $attrs: { v: { noInput: true } } };

/** True when {@link schema} stamped this var (`$attrs.db.model`). */
export const isModel = (value: unknown): boolean =>
	isVar(value) && attrsOf(value, "db")?.model === true;

/** Model-level persistence facts - what one field can't declare. */
export type SchemaOptions<S = unknown> = {
	/** Table-level indexes, composite ones included - Better Auth's
	 * `indexes: [{ fields: ["issuer", "accountId"], unique: true }]`.
	 * Stored as `$attrs.db.indexes`; read with `resolveModelIndexes`. */
	indexes?: readonly (Omit<ModelIndex, "fields"> & {
		fields: readonly [FieldName<S>, ...FieldName<S>[]];
	})[];
};

/** Field keys of a plain field object (any string for a prebuilt type). */
type FieldName<S> =
	S extends TypeDefination<any, any, any> ? string : keyof S & string;

/** A model var from a type or a plain field object. Default is always null.
 * Stamped `$attrs.db.model` so tooling (OpenAPI, …) can tell models from
 * option / session vars; `options.indexes` rides along as
 * `$attrs.db.indexes`, validated against the fields. Import from the db
 * plugin: `import { schema } from "better-call/db"`. */
export const schema = <N extends LiteralString, S>(
	name: N,
	schema: SchemaArg<S>,
	options?: SchemaOptions<S>,
): ModelVar<N, S> => {
	const type = isType(schema) ? schema : v.object(schema);
	const indexes = (options?.indexes ?? []) as readonly ModelIndex[];
	checkModelIndexes(name, type, indexes);
	return withAttrs(v.var(name, { default: null, schema: type }), "db", {
		model: true,
		...(indexes.length > 0 ? { indexes: [...indexes] } : {}),
	}) as ModelVar<N, S>;
};

export const db = {
	unique,
	indexed,
	references,
	id,
	schema,
	isModel,
};
