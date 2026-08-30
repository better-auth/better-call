import { withAttrs } from "../schema";
import type { FieldMeta } from "../storage";

/** Persistence: no two rows share this value. */
export const unique = <S>(schema: S): S =>
	withAttrs(schema, "db", { unique: true });

/** Persistence: worth an index. */
export const indexed = <S>(schema: S): S =>
	withAttrs(schema, "db", { index: true });

/** Persistence: foreign key to `model.field`. */
export const references = <S>(
	schema: S,
	ref: NonNullable<FieldMeta["references"]>,
): S => withAttrs(schema, "db", { references: ref });

export const db = {
	unique,
	indexed,
	references,
};
