import type { Database } from "bun:sqlite";
import { v } from "../../src";
import {
	storageApplyDDLInput,
	storageCountInput,
	storageCreateInput,
	storageDeleteInput,
	storageFindManyInput,
	storageFindOneInput,
	storageIncrementInput,
	storageUpdateInput,
} from "./schemas";
import type { CleanedWhere } from "./types";
import { adapterVars } from "./vars";

type Row = Record<string, any>;

const storeUse = { use: [adapterVars] };

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

const dbOf = (c: { var: { client: { get: () => unknown } } }): Database => {
	const db = c.var.client.get() as Database | null;
	if (!db) throw new Error("sqlite storage: client var is not set");
	return db;
};

export const buildWhereSql = (where: CleanedWhere[] | undefined) => {
	if (!where?.length) return { sql: "", params: [] as unknown[] };
	const parts: string[] = [];
	const params: unknown[] = [];
	for (let i = 0; i < where.length; i++) {
		const clause = where[i]!;
		const col = quoteIdent(clause.field);
		let fragment = "";
		switch (clause.operator) {
			case "eq":
				fragment = `${col} = ?`;
				params.push(clause.value);
				break;
			case "ne":
				fragment = `${col} != ?`;
				params.push(clause.value);
				break;
			case "lt":
				fragment = `${col} < ?`;
				params.push(clause.value);
				break;
			case "lte":
				fragment = `${col} <= ?`;
				params.push(clause.value);
				break;
			case "gt":
				fragment = `${col} > ?`;
				params.push(clause.value);
				break;
			case "gte":
				fragment = `${col} >= ?`;
				params.push(clause.value);
				break;
			case "in": {
				const values = Array.isArray(clause.value) ? clause.value : [];
				if (!values.length) {
					fragment = "0 = 1";
					break;
				}
				fragment = `${col} IN (${values.map(() => "?").join(", ")})`;
				params.push(...values);
				break;
			}
			case "not_in": {
				const values = Array.isArray(clause.value) ? clause.value : [];
				if (!values.length) {
					fragment = "1 = 1";
					break;
				}
				fragment = `${col} NOT IN (${values.map(() => "?").join(", ")})`;
				params.push(...values);
				break;
			}
			case "contains":
				fragment =
					clause.mode === "insensitive"
						? `LOWER(${col}) LIKE ?`
						: `${col} LIKE ?`;
				params.push(
					`%${clause.mode === "insensitive" ? String(clause.value).toLowerCase() : clause.value}%`,
				);
				break;
			case "starts_with":
				fragment =
					clause.mode === "insensitive"
						? `LOWER(${col}) LIKE ?`
						: `${col} LIKE ?`;
				params.push(
					`${clause.mode === "insensitive" ? String(clause.value).toLowerCase() : clause.value}%`,
				);
				break;
			case "ends_with":
				fragment =
					clause.mode === "insensitive"
						? `LOWER(${col}) LIKE ?`
						: `${col} LIKE ?`;
				params.push(
					`%${clause.mode === "insensitive" ? String(clause.value).toLowerCase() : clause.value}`,
				);
				break;
			default:
				fragment = `${col} = ?`;
				params.push(clause.value);
		}
		if (i === 0) parts.push(fragment);
		else parts.push(`${clause.connector} ${fragment}`);
	}
	return { sql: ` WHERE ${parts.join(" ")}`, params };
};

export const storageCreate = v.fn(
	"storage.create",
	{ input: storageCreateInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const data = c.input.data;
		const keys = Object.keys(data);
		const cols = keys.map(quoteIdent).join(", ");
		const placeholders = keys.map(() => "?").join(", ");
		db.run(
			`INSERT INTO ${quoteIdent(c.input.model)} (${cols}) VALUES (${placeholders})`,
			keys.map((k) => data[k] as any),
		);
		const id = data.id;
		if (id != null) {
			const row = db
				.query(
					`SELECT * FROM ${quoteIdent(c.input.model)} WHERE ${quoteIdent("id")} = ?`,
				)
				.get(id) as Row | null;
			if (row) {
				if (!c.input.select?.length) return row;
				const out: Row = { id: row.id };
				for (const s of c.input.select) out[s] = row[s];
				return out;
			}
		}
		return data;
	},
);

export const storageFindOne = v.fn(
	"storage.findOne",
	{ input: storageFindOneInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const { sql, params } = buildWhereSql(c.input.where);
		const row = db
			.query(`SELECT * FROM ${quoteIdent(c.input.model)}${sql} LIMIT 1`)
			.get(...params) as Row | null;
		if (!row) return null;
		if (!c.input.select?.length) return row;
		const out: Row = {};
		if ("id" in row) out.id = row.id;
		for (const s of c.input.select) out[s] = row[s];
		return out;
	},
);

export const storageFindMany = v.fn(
	"storage.findMany",
	{ input: storageFindManyInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const { sql, params } = buildWhereSql(c.input.where);
		let query = `SELECT * FROM ${quoteIdent(c.input.model)}${sql}`;
		if (c.input.sortBy) {
			query += ` ORDER BY ${quoteIdent(c.input.sortBy.field)} ${c.input.sortBy.direction.toUpperCase()}`;
		}
		query += ` LIMIT ?`;
		params.push(c.input.limit);
		if (c.input.offset) {
			query += ` OFFSET ?`;
			params.push(c.input.offset);
		}
		const rows = db.query(query).all(...params) as Row[];
		if (!c.input.select?.length) return rows;
		return rows.map((row) => {
			const out: Row = {};
			if ("id" in row) out.id = row.id;
			for (const s of c.input.select!) out[s] = row[s];
			return out;
		});
	},
);

export const storageCount = v.fn(
	"storage.count",
	{ input: storageCountInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const { sql, params } = buildWhereSql(c.input.where);
		const row = db
			.query(`SELECT COUNT(*) as count FROM ${quoteIdent(c.input.model)}${sql}`)
			.get(...params) as { count: number };
		return Number(row.count);
	},
);

export const storageUpdate = v.fn(
	"storage.update",
	{ input: storageUpdateInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const keys = Object.keys(c.input.update);
		const { sql, params } = buildWhereSql(c.input.where);
		if (!keys.length) {
			return (
				(db
					.query(`SELECT * FROM ${quoteIdent(c.input.model)}${sql} LIMIT 1`)
					.get(...params) as Row | null) ?? null
			);
		}
		const sets = keys.map((k) => `${quoteIdent(k)} = ?`).join(", ");
		db.run(`UPDATE ${quoteIdent(c.input.model)} SET ${sets}${sql}`, [
			...keys.map((k) => c.input.update[k]),
			...params,
		] as any);
		return (
			(db
				.query(`SELECT * FROM ${quoteIdent(c.input.model)}${sql} LIMIT 1`)
				.get(...params) as Row | null) ?? null
		);
	},
);

export const storageUpdateMany = v.fn(
	"storage.updateMany",
	{ input: storageUpdateInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const keys = Object.keys(c.input.update);
		if (!keys.length) return 0;
		const { sql, params } = buildWhereSql(c.input.where);
		const sets = keys.map((k) => `${quoteIdent(k)} = ?`).join(", ");
		const result = db.run(
			`UPDATE ${quoteIdent(c.input.model)} SET ${sets}${sql}`,
			[...keys.map((k) => c.input.update[k]), ...params] as any,
		);
		return result.changes;
	},
);

export const storageDelete = v.fn(
	"storage.delete",
	{ input: storageDeleteInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const { sql, params } = buildWhereSql(c.input.where);
		db.run(
			`DELETE FROM ${quoteIdent(c.input.model)} WHERE rowid IN (SELECT rowid FROM ${quoteIdent(c.input.model)}${sql} LIMIT 1)`,
			params as any,
		);
	},
);

export const storageDeleteMany = v.fn(
	"storage.deleteMany",
	{ input: storageDeleteInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const { sql, params } = buildWhereSql(c.input.where);
		const result = db.run(
			`DELETE FROM ${quoteIdent(c.input.model)}${sql}`,
			params as any,
		);
		return result.changes;
	},
);

/** Fallback consume via delete-returning pattern. */
export const storageConsumeOne = v.fn(
	"storage.consumeOne",
	{ input: storageDeleteInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const { sql, params } = buildWhereSql(c.input.where);
		const row = db
			.query(`SELECT * FROM ${quoteIdent(c.input.model)}${sql} LIMIT 1`)
			.get(...params) as Row | null;
		if (!row) return null;
		db.run(
			`DELETE FROM ${quoteIdent(c.input.model)} WHERE rowid IN (SELECT rowid FROM ${quoteIdent(c.input.model)}${sql} LIMIT 1)`,
			params as any,
		);
		return row;
	},
);

export const storageIncrementOne = v.fn(
	"storage.incrementOne",
	{ input: storageIncrementInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		const { sql, params } = buildWhereSql(c.input.where);
		const row = db
			.query(`SELECT * FROM ${quoteIdent(c.input.model)}${sql} LIMIT 1`)
			.get(...params) as Row | null;
		if (!row) return null;
		const update: Record<string, unknown> = { ...(c.input.set ?? {}) };
		for (const [field, delta] of Object.entries(c.input.increment)) {
			update[field] = Number(row[field] ?? 0) + delta;
		}
		const keys = Object.keys(update);
		const sets = keys.map((k) => `${quoteIdent(k)} = ?`).join(", ");
		const id = row.id;
		db.run(
			`UPDATE ${quoteIdent(c.input.model)} SET ${sets} WHERE ${quoteIdent("id")} = ?`,
			[...keys.map((k) => update[k]), id] as any,
		);
		return (
			(db
				.query(
					`SELECT * FROM ${quoteIdent(c.input.model)} WHERE ${quoteIdent("id")} = ?`,
				)
				.get(id) as Row | null) ?? null
		);
	},
);

export const storageApplyDDL = v.fn(
	"storage.applyDDL",
	{ input: storageApplyDDLInput, ...storeUse },
	(c) => {
		const db = dbOf(c);
		for (const statement of c.input.statements) {
			db.run(statement);
		}
		return { applied: c.input.statements.length, file: c.input.file };
	},
);

export const storageBegin = v.fn(
	"storage.begin",
	{ input: v.object({}), ...storeUse },
	(c) => {
		if (c.var.trx.get() != null) {
			throw new Error("nested transactions are not supported");
		}
		dbOf(c).run("BEGIN");
		c.var.trx.set({ active: true });
		return { ok: true };
	},
);

export const storageCommit = v.fn(
	"storage.commit",
	{ input: v.object({}), ...storeUse },
	(c) => {
		dbOf(c).run("COMMIT");
		c.var.trx.set(null);
		return { ok: true };
	},
);

export const storageRollback = v.fn(
	"storage.rollback",
	{ input: v.object({}), ...storeUse },
	(c) => {
		try {
			dbOf(c).run("ROLLBACK");
		} catch {
			/* no active transaction */
		}
		c.var.trx.set(null);
		return { ok: true };
	},
);

export const createSqliteStorage = (_db?: Database) => ({
	storageCreate,
	storageFindOne,
	storageFindMany,
	storageCount,
	storageUpdate,
	storageUpdateMany,
	storageDelete,
	storageDeleteMany,
	storageConsumeOne,
	storageIncrementOne,
	storageApplyDDL,
	storageBegin,
	storageCommit,
	storageRollback,
});

export const sqliteStorage = createSqliteStorage();
