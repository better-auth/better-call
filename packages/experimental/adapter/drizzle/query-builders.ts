import type { SQL } from "drizzle-orm";
import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { column, groups, type Schema, type SortBy, type Where } from "../index";

export type Provider = "pg" | "mysql" | "sqlite";

export class AdapterError extends Error {
	constructor(
		readonly tag:
			| "unknown_model"
			| "unknown_field"
			| "invalid_where"
			| "invalid_join"
			| "invalid_operation",
		readonly data: Record<string, string>,
	) {
		super(data.message ?? tag);
		this.name = "AdapterError";
	}
}

const insensitiveLike = (
	field: unknown,
	pattern: string,
	provider: Provider,
): SQL =>
	provider === "pg"
		? ilike(field as never, pattern)
		: sql`LOWER(${field}) LIKE LOWER(${pattern})`;

const insensitiveComparison = (
	field: unknown,
	operator: "=" | "<>",
	value: string,
): SQL =>
	operator === "="
		? sql`LOWER(${field}) = LOWER(${value})`
		: sql`LOWER(${field}) <> LOWER(${value})`;

const insensitiveArray = (
	field: unknown,
	values: string[],
	negated: boolean,
): SQL => {
	if (values.length === 0) return negated ? sql`true` : sql`false`;
	const list = sql.join(
		values.map((value) => sql`LOWER(${value})`),
		sql`, `,
	);
	return negated
		? sql`LOWER(${field}) NOT IN (${list})`
		: sql`LOWER(${field}) IN (${list})`;
};

const invalidArray = (model: string, where: Where): never => {
	throw new AdapterError("invalid_where", {
		model,
		field: where.field,
		message: `The value for "${where.field}" must be an array when using "${where.operator}".`,
	});
};

const predicate = (
	schema: Schema,
	table: Record<string, unknown>,
	model: string,
	where: Where,
	provider: Provider,
): SQL => {
	const fieldName = column(schema, model, where.field);
	const field = table[fieldName];
	if (!field) {
		throw new AdapterError("unknown_field", {
			model,
			field: where.field,
		});
	}

	const operator = where.operator ?? "eq";
	const value = where.value;
	const insensitive =
		where.mode === "insensitive" &&
		(typeof value === "string" ||
			(Array.isArray(value) &&
				value.every((item) => typeof item === "string")));

	switch (operator) {
		case "in":
			if (!Array.isArray(value)) return invalidArray(model, where);
			return insensitive
				? insensitiveArray(field, value as string[], false)
				: value.length === 0
					? sql`false`
					: inArray(field as never, value);
		case "not_in":
			if (!Array.isArray(value)) return invalidArray(model, where);
			return insensitive
				? insensitiveArray(field, value as string[], true)
				: value.length === 0
					? sql`true`
					: notInArray(field as never, value);
		case "contains":
			return insensitive && typeof value === "string"
				? insensitiveLike(field, `%${value}%`, provider)
				: like(field as never, `%${String(value)}%`);
		case "starts_with":
			return insensitive && typeof value === "string"
				? insensitiveLike(field, `${value}%`, provider)
				: like(field as never, `${String(value)}%`);
		case "ends_with":
			return insensitive && typeof value === "string"
				? insensitiveLike(field, `%${value}`, provider)
				: like(field as never, `%${String(value)}`);
		case "lt":
			return lt(field as never, value);
		case "lte":
			return lte(field as never, value);
		case "gt":
			return gt(field as never, value);
		case "gte":
			return gte(field as never, value);
		case "ne":
			if (value === null) return isNotNull(field as never);
			return insensitive && typeof value === "string"
				? insensitiveComparison(field, "<>", value)
				: ne(field as never, value);
		case "eq":
			if (value === null) return isNull(field as never);
			return insensitive && typeof value === "string"
				? insensitiveComparison(field, "=", value)
				: eq(field as never, value);
	}
};

export const buildWhere = (
	schema: Schema,
	table: Record<string, unknown>,
	model: string,
	where: Where[] | undefined,
	provider: Provider,
): SQL | undefined => {
	const grouped = groups(where);
	if (grouped.length === 0) return undefined;
	const expressions = grouped.map((group) =>
		and(
			...group.map((item) => predicate(schema, table, model, item, provider)),
		),
	);
	return expressions.length === 1 ? expressions[0] : or(...expressions);
};

export const buildSelect = (
	schema: Schema,
	table: Record<string, unknown>,
	model: string,
	select: string[] | undefined,
): Record<string, unknown> | undefined => {
	if (!select?.length) return undefined;
	const projection: Record<string, unknown> = {};
	for (const field of select) {
		const fieldName = column(schema, model, field);
		const drizzleField = table[fieldName];
		if (!drizzleField) {
			throw new AdapterError("unknown_field", { model, field });
		}
		projection[fieldName] = drizzleField;
	}
	return projection;
};

export const buildOrderBy = (
	schema: Schema,
	table: Record<string, unknown>,
	model: string,
	sortBy: SortBy | undefined,
): SQL | undefined => {
	if (!sortBy) return undefined;
	const fieldName = column(schema, model, sortBy.field);
	const field = table[fieldName];
	if (!field) {
		throw new AdapterError("unknown_field", {
			model,
			field: sortBy.field,
		});
	}
	return sortBy.direction === "desc"
		? desc(field as never)
		: asc(field as never);
};

const driverCount = (result: unknown): unknown => {
	if (!result || typeof result !== "object") return undefined;
	if ("rowCount" in result) return result.rowCount;
	if ("count" in result && typeof result.count === "number") {
		return result.count;
	}
	if ("affectedRows" in result) return result.affectedRows;
	if ("rowsAffected" in result) return result.rowsAffected;
	if ("changes" in result) return result.changes;
	if ("meta" in result) {
		const meta = result.meta;
		if (meta && typeof meta === "object" && "changes" in meta) {
			return meta.changes;
		}
	}
	return undefined;
};

export const affectedRows = (result: unknown, operation: string): number => {
	let value = driverCount(result);
	if (Array.isArray(result) && value === undefined) {
		value = result.length > 0 ? (driverCount(result[0]) ?? result.length) : 0;
	}
	if (typeof value !== "number") {
		throw new AdapterError("invalid_operation", {
			operation,
			message: `Drizzle returned a non-numeric affected-row result for ${operation}.`,
		});
	}
	return value;
};
