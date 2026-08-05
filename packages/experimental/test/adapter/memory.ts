import { v } from "../../src";
import type { MemoryClient, MemoryTrx } from "./memory-store";
import {
	activeTables,
	beginMemoryTrx,
	commitMemoryTrx,
	createMemoryClient,
	matchWhere,
	pick,
	sortRows,
	tableOf,
} from "./memory-store";
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
import { adapterVars } from "./vars";

const storeUse = { use: [adapterVars] };

const readStore = (c: {
	var: { client: { get: () => unknown }; trx: { get: () => unknown } };
}) =>
	activeTables(
		c.var.client.get() as MemoryClient | null,
		c.var.trx.get() as MemoryTrx | null,
	);

export const storageCreate = v.fn(
	"storage.create",
	{ input: storageCreateInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const rows = tableOf(tables, c.input.model);
		const row = { ...c.input.data };
		rows.push(row);
		return pick(row, c.input.select);
	},
);

export const storageFindOne = v.fn(
	"storage.findOne",
	{ input: storageFindOneInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const row = tableOf(tables, c.input.model).find((r) =>
			matchWhere(r, c.input.where),
		);
		return row ? pick(row, c.input.select) : null;
	},
);

export const storageFindMany = v.fn(
	"storage.findMany",
	{ input: storageFindManyInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		let rows = tableOf(tables, c.input.model).filter((r) =>
			matchWhere(r, c.input.where),
		);
		rows = sortRows(rows, c.input.sortBy);
		const start = c.input.offset ?? 0;
		return rows
			.slice(start, start + c.input.limit)
			.map((r) => pick(r, c.input.select));
	},
);

export const storageCount = v.fn(
	"storage.count",
	{ input: storageCountInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		return tableOf(tables, c.input.model).filter((r) =>
			matchWhere(r, c.input.where),
		).length;
	},
);

export const storageUpdate = v.fn(
	"storage.update",
	{ input: storageUpdateInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const rows = tableOf(tables, c.input.model);
		const idx = rows.findIndex((r) => matchWhere(r, c.input.where));
		if (idx < 0) return null;
		rows[idx] = { ...rows[idx], ...c.input.update };
		return { ...rows[idx] };
	},
);

export const storageUpdateMany = v.fn(
	"storage.updateMany",
	{ input: storageUpdateInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const rows = tableOf(tables, c.input.model);
		let count = 0;
		for (let i = 0; i < rows.length; i++) {
			if (!matchWhere(rows[i]!, c.input.where)) continue;
			rows[i] = { ...rows[i], ...c.input.update };
			count++;
		}
		return count;
	},
);

export const storageDelete = v.fn(
	"storage.delete",
	{ input: storageDeleteInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const rows = tableOf(tables, c.input.model);
		const idx = rows.findIndex((r) => matchWhere(r, c.input.where));
		if (idx >= 0) rows.splice(idx, 1);
	},
);

export const storageDeleteMany = v.fn(
	"storage.deleteMany",
	{ input: storageDeleteInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const rows = tableOf(tables, c.input.model);
		const keep: Record<string, any>[] = [];
		let deleted = 0;
		for (const row of rows) {
			if (matchWhere(row, c.input.where)) deleted++;
			else keep.push(row);
		}
		tables.set(c.input.model, keep);
		return deleted;
	},
);

/** Fallback: find + delete in one shot against the active store. */
export const storageConsumeOne = v.fn(
	"storage.consumeOne",
	{ input: storageDeleteInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const rows = tableOf(tables, c.input.model);
		const idx = rows.findIndex((r) => matchWhere(r, c.input.where));
		if (idx < 0) return null;
		const [row] = rows.splice(idx, 1);
		return row ? { ...row } : null;
	},
);

/** Fallback: read-modify-write increment. */
export const storageIncrementOne = v.fn(
	"storage.incrementOne",
	{ input: storageIncrementInput, ...storeUse },
	(c) => {
		const tables = readStore(c);
		const rows = tableOf(tables, c.input.model);
		const idx = rows.findIndex((r) => matchWhere(r, c.input.where));
		if (idx < 0) return null;
		const row = { ...rows[idx], ...(c.input.set ?? {}) };
		for (const [field, delta] of Object.entries(c.input.increment)) {
			row[field] = Number(row[field] ?? 0) + delta;
		}
		rows[idx] = row;
		return { ...row };
	},
);

export const storageApplyDDL = v.fn(
	"storage.applyDDL",
	{ input: storageApplyDDLInput, ...storeUse },
	() => {
		/* memory has no DDL to execute */
		return { applied: 0 };
	},
);

export const storageBegin = v.fn(
	"storage.begin",
	{ input: v.object({}), ...storeUse },
	(c) => {
		if (c.var.trx.get() != null) {
			throw new Error("nested transactions are not supported");
		}
		const client = c.var.client.get() as MemoryClient | null;
		if (!client) throw new Error("memory storage: client var is not set");
		const journal = beginMemoryTrx(client);
		c.var.trx.set(journal);
		return { ok: true };
	},
);

export const storageCommit = v.fn(
	"storage.commit",
	{ input: v.object({}), ...storeUse },
	(c) => {
		const client = c.var.client.get() as MemoryClient | null;
		const journal = c.var.trx.get() as MemoryTrx | null;
		if (!client || !journal) return { ok: false };
		commitMemoryTrx(client, journal);
		c.var.trx.set(null);
		return { ok: true };
	},
);

export const storageRollback = v.fn(
	"storage.rollback",
	{ input: v.object({}), ...storeUse },
	(c) => {
		c.var.trx.set(null);
		return { ok: true };
	},
);

/**
 * Storage module for `createDbApi` / drivers.
 * Export names are camelCase (`storageCreate`) for flat `c.use`; fn keys stay
 * dotted (`storage.create`) for interceptors.
 */
export const memoryStorage = {
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
};

export { createMemoryClient };
