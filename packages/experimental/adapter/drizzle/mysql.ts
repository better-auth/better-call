import { eq, sql } from "drizzle-orm";
import { column, type Row, type Schema, type Where } from "../index";
import type { QueryTools } from "./relations";
import type { Client } from "./types";

const lastInsertId = (result: unknown): unknown => {
	if (!result || typeof result !== "object") return undefined;
	if ("insertId" in result) return result.insertId;
	if (Array.isArray(result) && result[0]) return lastInsertId(result[0]);
	return undefined;
};

export const mysqlTarget = async (
	client: Client,
	model: string,
	where: Where[],
	convertWhere: QueryTools["convertWhere"],
	lock = false,
) => {
	const resolved = await convertWhere(client, model, where);
	let query = client.select().from(resolved.value);
	if (resolved.expression) query = query.where(resolved.expression);
	if (lock) query = query.for("update");
	return { resolved, row: (await query.limit(1))[0] as Row | undefined };
};

export const mysqlCreateResult = async (
	client: Client,
	models: Schema,
	model: string,
	table: Record<string, any>,
	data: Row,
	writeResult: unknown,
): Promise<Row | null> => {
	const idName = column(models, model, "id");
	const id = data[idName] ?? lastInsertId(writeResult);
	if (id !== undefined && id !== null && table[idName]) {
		const rows = await client
			.select()
			.from(table)
			.where(eq(table[idName], id))
			.limit(1);
		return rows[0] ?? null;
	}
	for (const [name, definition] of Object.entries(
		models[model]?.fields ?? {},
	)) {
		if (!definition.unique) continue;
		const dbName = column(models, model, name);
		if (data[dbName] === undefined || !table[dbName]) continue;
		const rows = await client
			.select()
			.from(table)
			.where(eq(table[dbName], data[dbName]))
			.limit(1);
		if (rows[0]) return rows[0];
	}
	const clauses = Object.entries(data)
		.filter(([name, value]) => value !== undefined && table[name])
		.map(([name, value]) => eq(table[name], value));
	if (clauses.length) {
		const rows = await client
			.select()
			.from(table)
			.where(sql.join(clauses, sql` AND `))
			.limit(2);
		if (rows.length === 1) return rows[0];
	}
	return null;
};
