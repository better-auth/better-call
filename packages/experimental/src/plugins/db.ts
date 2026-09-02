import { v } from "..";
import { createRandomStringGenerator } from "../helpers/random";
import { type TypeDefination, withAttrs } from "../schema";

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
 * so validate / v.fn / storage.create all mint an id when the key is omitted. */
export const id = <T, O>(
	schema: TypeDefination<T, O, any>,
): TypeDefination<T, O, string> =>
	withAttrs(
		{ ...schema, default: generateId } as TypeDefination<T, O, string>,
		"db",
		{ id: true },
	) as TypeDefination<T, O, string>;

export const db = {
	unique,
	indexed,
	references,
	id,
};
