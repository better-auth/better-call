import { v } from "../../src";
import type { DBAdapter } from "./types";

/**
 * @deprecated Prefer mounting `createBetterDB(...)` directly. Kept as a
 * bridge from legacy `DBAdapter` objects to `v.fn` modules.
 */
export const toModule = (adapter: DBAdapter) => {
	const create = v.fn("db.create", { input: v.object() }, (c) =>
		adapter.create(c.input as any),
	);
	const findOne = v.fn("db.findOne", { input: v.object() }, (c) =>
		adapter.findOne(c.input as any),
	);
	const findMany = v.fn("db.findMany", { input: v.object() }, (c) =>
		adapter.findMany(c.input as any),
	);
	const count = v.fn("db.count", { input: v.object() }, (c) =>
		adapter.count(c.input as any),
	);
	const update = v.fn("db.update", { input: v.object() }, (c) =>
		adapter.update(c.input as any),
	);
	const updateMany = v.fn("db.updateMany", { input: v.object() }, (c) =>
		adapter.updateMany(c.input as any),
	);
	const deleteOne = v.fn("db.delete", { input: v.object() }, (c) =>
		adapter.delete(c.input as any),
	);
	const deleteMany = v.fn("db.deleteMany", { input: v.object() }, (c) =>
		adapter.deleteMany(c.input as any),
	);
	const consumeOne = v.fn("db.consumeOne", { input: v.object() }, (c) =>
		adapter.consumeOne(c.input as any),
	);
	const incrementOne = v.fn("db.incrementOne", { input: v.object() }, (c) =>
		adapter.incrementOne(c.input as any),
	);

	return {
		create,
		findOne,
		findMany,
		count,
		update,
		updateMany,
		delete: deleteOne,
		deleteMany,
		consumeOne,
		incrementOne,
		adapter,
	};
};
