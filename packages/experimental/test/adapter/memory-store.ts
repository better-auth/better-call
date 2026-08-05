import type { CleanedWhere, SortBy } from "./types";

type Row = Record<string, any>;
type Tables = Map<string, Row[]>;

export type MemoryClient = {
	tables: Tables;
};

export type MemoryTrx = {
	tables: Tables;
};

const matchClause = (row: Row, clause: CleanedWhere): boolean => {
	const raw = row[clause.field];
	const value = clause.value;
	const left =
		clause.mode === "insensitive" && typeof raw === "string"
			? raw.toLowerCase()
			: raw;
	const right =
		clause.mode === "insensitive" && typeof value === "string"
			? value.toLowerCase()
			: value;

	switch (clause.operator) {
		case "eq":
			return left === right;
		case "ne":
			return left !== right;
		case "lt":
			return left < (right as any);
		case "lte":
			return left <= (right as any);
		case "gt":
			return left > (right as any);
		case "gte":
			return left >= (right as any);
		case "in":
			return Array.isArray(right) && right.includes(left as never);
		case "not_in":
			return Array.isArray(right) && !right.includes(left as never);
		case "contains":
			return (
				typeof left === "string" &&
				typeof right === "string" &&
				left.includes(right)
			);
		case "starts_with":
			return (
				typeof left === "string" &&
				typeof right === "string" &&
				left.startsWith(right)
			);
		case "ends_with":
			return (
				typeof left === "string" &&
				typeof right === "string" &&
				left.endsWith(right)
			);
		default:
			return left === right;
	}
};

export const matchWhere = (row: Row, where: CleanedWhere[] | undefined) => {
	if (!where?.length) return true;
	let result = matchClause(row, where[0]!);
	for (let i = 1; i < where.length; i++) {
		const clause = where[i]!;
		const next = matchClause(row, clause);
		result = clause.connector === "OR" ? result || next : result && next;
	}
	return result;
};

const sortRows = (rows: Row[], sortBy?: SortBy) => {
	if (!sortBy) return rows;
	const { field, direction } = sortBy;
	return [...rows].sort((a, b) => {
		const av = a[field];
		const bv = b[field];
		if (av === bv) return 0;
		if (av == null) return 1;
		if (bv == null) return -1;
		const cmp = av < bv ? -1 : 1;
		return direction === "asc" ? cmp : -cmp;
	});
};

const pick = (row: Row, select?: string[]) => {
	if (!select?.length) return { ...row };
	const out: Row = {};
	if ("id" in row) out.id = row.id;
	for (const key of select) out[key] = row[key];
	return out;
};

const tableOf = (tables: Tables, model: string) => {
	let rows = tables.get(model);
	if (!rows) {
		rows = [];
		tables.set(model, rows);
	}
	return rows;
};

const cloneTables = (tables: Tables): Tables => {
	const out: Tables = new Map();
	for (const [name, rows] of tables) {
		out.set(
			name,
			rows.map((r) => ({ ...r })),
		);
	}
	return out;
};

/** Active tables: transaction journal if present, else client. */
export const activeTables = (
	client: MemoryClient | null,
	trx: MemoryTrx | null,
): Tables => {
	if (trx?.tables) return trx.tables;
	if (!client?.tables) {
		throw new Error("memory storage: client var is not set");
	}
	return client.tables;
};

export const createMemoryClient = (): MemoryClient => ({
	tables: new Map(),
});

export const beginMemoryTrx = (client: MemoryClient): MemoryTrx => ({
	tables: cloneTables(client.tables),
});

export const commitMemoryTrx = (client: MemoryClient, trx: MemoryTrx) => {
	client.tables = trx.tables;
};

export { pick, sortRows, tableOf };
