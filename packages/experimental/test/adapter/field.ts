import { v } from "../../src";

/**
 * Column attributes aligned with better-auth `DBFieldAttribute`.
 * Shared by DDL mappers and the adapter `schema` var.
 * `type` stays a string so dialect mappers can return null for unknowns.
 */
export const fieldAttribute = v.object({
	type: v.string({ default: "string" }),
	required: v.boolean({ optional: true, default: true }),
	returned: v.boolean({ optional: true, default: true }),
	input: v.boolean({ optional: true, default: true }),
	unique: v.boolean({ optional: true, default: false }),
	bigint: v.boolean({ optional: true, default: false }),
	sortable: v.boolean({ optional: true, default: false }),
	fieldName: v.string({ optional: true }),
	defaultValue: v.any({ optional: true }),
	references: v.object(
		{
			model: v.string(),
			field: v.string(),
			onDelete: v.enum(
				["no action", "restrict", "cascade", "set null", "set default"],
				{ optional: true },
			),
		},
		{ optional: true },
	),
});

/** A named table: field name → attributes. */
export const tableAttribute = v.object({
	name: v.string(),
	fields: v.record(fieldAttribute),
});

/** Better Auth schema: logical model → table def. */
export const dbTable = v.object({
	modelName: v.string({ optional: true }),
	fields: v.record(fieldAttribute),
});

export const dbSchema = v.record(dbTable);
