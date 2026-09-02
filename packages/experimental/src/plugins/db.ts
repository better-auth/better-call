import { v } from "..";
import { createRandomStringGenerator } from "../helpers/random";
import { withAttrs } from "../schema";
import type { FieldMeta } from "../storage";

export const unique = <S>(schema: S): S =>
	withAttrs(schema, "db", { unique: true });

export const indexed = <S>(schema: S): S =>
	withAttrs(schema, "db", { index: true });

export const references = <S>(
	schema: S,
	ref: NonNullable<FieldMeta["references"]>,
): S => withAttrs(schema, "db", { references: ref });

export const id = <S>(schema: S): S =>
	withAttrs({ ...schema, default: generateId() }, "db", { id: true });

export const db = {
	unique,
	indexed,
	references,
	id,
};

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
