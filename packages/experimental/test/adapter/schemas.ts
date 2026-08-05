import { v } from "../../src";

export const whereOperators = [
	"eq",
	"ne",
	"lt",
	"lte",
	"gt",
	"gte",
	"in",
	"not_in",
	"contains",
	"starts_with",
	"ends_with",
] as const;

type WhereValue = string | number | boolean | string[] | number[] | Date | null;

export const whereClause = v.object({
	field: v.string(),
	value: v.any<WhereValue>(),
	operator: v.enum(whereOperators, { optional: true, default: "eq" }),
	connector: v.enum(["AND", "OR"], { optional: true, default: "AND" }),
	mode: v.enum(["sensitive", "insensitive"], {
		optional: true,
		default: "sensitive",
	}),
});

export const cleanedWhere = v.object({
	field: v.string(),
	value: v.any<WhereValue>(),
	operator: v.enum(whereOperators),
	connector: v.enum(["AND", "OR"]),
	mode: v.enum(["sensitive", "insensitive"]),
});

export const sortBySchema = v.object({
	field: v.string(),
	direction: v.enum(["asc", "desc"]),
});

export const adapterConfig = v.object({
	adapterId: v.string({ optional: true, default: "memory" }),
	adapterName: v.string({ optional: true }),
	supportsNumericIds: v.boolean({ optional: true, default: true }),
	supportsUUIDs: v.boolean({ optional: true, default: true }),
	supportsJSON: v.boolean({ optional: true, default: false }),
	supportsDates: v.boolean({ optional: true, default: true }),
	supportsBooleans: v.boolean({ optional: true, default: true }),
	supportsArrays: v.boolean({ optional: true, default: false }),
	supportsJoins: v.boolean({ optional: true, default: false }),
	/** When false, `db.transaction` runs the callback without begin/commit. */
	supportsTransactions: v.boolean({ optional: true, default: true }),
	disableIdGeneration: v.boolean({ optional: true, default: false }),
	usePlural: v.boolean({ optional: true, default: false }),
	defaultFindManyLimit: v.number({ optional: true, default: 100 }),
});

export const createInput = v.object({
	model: v.string(),
	data: v.record(v.any()),
	select: v.array(v.string(), { optional: true }),
});

export const findOneInput = v.object({
	model: v.string(),
	where: v.array(whereClause),
	select: v.array(v.string(), { optional: true }),
	join: v.record(v.any(), { optional: true }),
});

export const findManyInput = v.object({
	model: v.string(),
	where: v.array(whereClause, { optional: true }),
	limit: v.number({ optional: true }),
	select: v.array(v.string(), { optional: true }),
	sortBy: v.object(
		{ field: v.string(), direction: v.enum(["asc", "desc"]) },
		{ optional: true },
	),
	offset: v.number({ optional: true }),
	join: v.record(v.any(), { optional: true }),
});

export const countInput = v.object({
	model: v.string(),
	where: v.array(whereClause, { optional: true }),
});

export const updateInput = v.object({
	model: v.string(),
	where: v.array(whereClause),
	update: v.record(v.any()),
});

export const updateManyInput = v.object({
	model: v.string(),
	where: v.array(whereClause),
	update: v.record(v.any()),
});

export const deleteInput = v.object({
	model: v.string(),
	where: v.array(whereClause),
});

export const consumeOneInput = v.object({
	model: v.string(),
	where: v.array(whereClause),
});

export const incrementOneInput = v.object({
	model: v.string(),
	where: v.array(whereClause),
	increment: v.record(v.number()),
	set: v.record(v.any(), { optional: true }),
});

export const applySchemaInput = v.object({
	file: v.string({ optional: true }),
	tables: v.record(v.any(), { optional: true }),
});

/** @deprecated Use `applySchemaInput`. */
export const createSchemaInput = applySchemaInput;

export const storageCreateInput = v.object({
	model: v.string(),
	data: v.record(v.any()),
	select: v.array(v.string(), { optional: true }),
});

export const storageFindOneInput = v.object({
	model: v.string(),
	where: v.array(cleanedWhere),
	select: v.array(v.string(), { optional: true }),
});

export const storageFindManyInput = v.object({
	model: v.string(),
	where: v.array(cleanedWhere, { optional: true }),
	limit: v.number(),
	select: v.array(v.string(), { optional: true }),
	sortBy: v.object(
		{ field: v.string(), direction: v.enum(["asc", "desc"]) },
		{ optional: true },
	),
	offset: v.number({ optional: true }),
});

export const storageCountInput = v.object({
	model: v.string(),
	where: v.array(cleanedWhere, { optional: true }),
});

export const storageUpdateInput = v.object({
	model: v.string(),
	where: v.array(cleanedWhere),
	update: v.record(v.any()),
});

export const storageDeleteInput = v.object({
	model: v.string(),
	where: v.array(cleanedWhere),
});

export const storageIncrementInput = v.object({
	model: v.string(),
	where: v.array(cleanedWhere),
	increment: v.record(v.number()),
	set: v.record(v.any(), { optional: true }),
});

export const storageApplyDDLInput = v.object({
	statements: v.array(v.string()),
	file: v.string({ optional: true }),
});

export const unsupportedError = v.object({
	feature: v.string(),
	message: v.string({ optional: true }),
});
