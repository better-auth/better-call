import { describe, expect, it } from "vitest";
import {
	memoryAdapter,
	resolveModelFields,
	type StorageAdapter,
	v,
} from "./index";
import { db, indexed, references, unique } from "./plugins/db";

describe("v.storage", () => {
	it("many instances of a var: CRUD in the var's shape", async () => {
		const item = v.var("stg_item", {
			default: null,
			schema: v.object({ id: v.string(), tag: v.string() }),
		});
		const db = v.storage(memoryAdapter(), { item });

		await db.item.create({ id: "1", tag: "a" });
		await db.item.create({ id: "2", tag: "a" });
		await db.item.create({ id: "3", tag: "b" });

		expect(await db.item.findOne({ id: "2" })).toEqual({ id: "2", tag: "a" });
		expect(await db.item.findOne({ id: "9" })).toBeNull();
		expect(await db.item.findMany({ tag: "a" })).toHaveLength(2);
		expect(await db.item.count()).toBe(3);

		expect(await db.item.update({ id: "3" }, { tag: "c" })).toEqual({
			id: "3",
			tag: "c",
		});
		expect(await db.item.update({ id: "9" }, { tag: "x" })).toBeNull();

		expect(await db.item.delete({ tag: "a" })).toBe(2);
		expect(await db.item.count()).toBe(1);
	});

	it("create keeps EXTENDED fields through the round-trip", async () => {
		const base = v.var("stg_base", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const db = v.storage(memoryAdapter(), { base });
		const created = await db.base.create({ id: "1", extra: "kept" });
		expect(created.extra).toBe("kept");
		expect(await db.base.findOne({ id: "1" })).toEqual({
			id: "1",
			extra: "kept",
		});
	});

	it("$adapter swaps the backend IN PLACE - captured references included", async () => {
		const item = v.var("stg_swap", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const db = v.storage(memoryAdapter(), { item });
		const captured = db.item; // what a module would have closed over
		await captured.create({ id: "old" });

		const seen: string[] = [];
		const replacement = memoryAdapter();
		db.$adapter({
			...replacement,
			create: (model, data) => {
				seen.push(model);
				return replacement.create(model, data);
			},
		});

		await captured.create({ id: "new" });
		expect(seen).toEqual(["stg_swap"]);
		// The old backend's rows are gone with it.
		expect(await db.item.findOne({ id: "old" })).toBeNull();
		expect(await db.item.findOne({ id: "new" })).toEqual({ id: "new" });
	});

	it("$on hooks: exact and wildcard targets compose around the op", async () => {
		const item = v.var("stg_hooked", {
			default: null,
			schema: v.object({ id: v.string(), n: v.number() }),
		});
		const log: string[] = [];
		const db = v
			.storage(memoryAdapter(), { item })
			.$on("item.create", async (c, next) => {
				log.push(`create:${(c.args[0] as { id: string }).id}`);
				return next();
			})
			.$on("*", async (c, next) => {
				log.push(`any:${c.model}.${c.op}`);
				return next();
			});

		await db.item.create({ id: "1", n: 1 });
		await db.item.findOne({ id: "1" });
		expect(log).toEqual(["create:1", "any:item.create", "any:item.findOne"]);
	});

	it("$on hooks TRANSFORM (the return is the result) and VETO (skip next)", async () => {
		const item = v.var("stg_shaped", {
			default: null,
			schema: v.object({ id: v.string(), secret: v.string() }),
		});
		const db = v
			.storage(memoryAdapter(), { item })
			.$on("item.findOne", async (_c, next) => {
				const row = (await next()) as { secret: string } | null;
				return row && { ...row, secret: "[redacted]" };
			})
			.$on("item.delete", async () => 0); // veto: nothing ever deletes

		await db.item.create({ id: "1", secret: "hunter2" });
		expect(await db.item.findOne({ id: "1" })).toEqual({
			id: "1",
			secret: "[redacted]",
		});
		expect(await db.item.delete({ id: "1" })).toBe(0);
		expect(await db.item.count()).toBe(1);
	});

	it("$omit/$pick/$extend derive views over the SAME state", async () => {
		const a = v.var("stg_view_a", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const b = v.var("stg_view_b", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const c = v.var("stg_view_c", {
			default: null,
			schema: v.object({ id: v.string() }),
		});

		const db = v.storage(memoryAdapter(), { a, b });
		const noB = db.$omit("b");
		expect("b" in noB).toBe(false);

		// Views share the backend: a row created through the full storage
		// is visible through the narrowed one.
		await db.a.create({ id: "1" });
		expect(await noB.a.findOne({ id: "1" })).toEqual({ id: "1" });

		const onlyB = db.$pick("b");
		expect(Object.keys(onlyB.$models)).toEqual(["b"]);

		const withC = db.$extend({ c });
		await withC.c.create({ id: "c1" });
		expect(await withC.c.count()).toBe(1);

		// Hooks mounted on ANY view apply to ALL of them - shared state.
		const log: string[] = [];
		noB.$on("a.create", async (_c, next) => {
			log.push("hook");
			return next();
		});
		await db.a.create({ id: "2" });
		expect(log).toEqual(["hook"]);
	});

	it("a model DECLARES its persistence: op subscriptions mount with the storage", async () => {
		const item = v.var("stg_declared", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const db = v.storage(memoryAdapter(), {
			item: {
				schema: item,
				create: (create) =>
					v.on("stg.make", async (_c, next) =>
						create((await next()) as { id: string }),
					),
			},
		});

		// Mounting the STORAGE mounts the subscriptions it declared.
		const make = v.fn("stg.make", { use: [db] }, () => ({ id: "made" }));
		await make();
		expect(await db.item.findOne({ id: "made" })).toEqual({ id: "made" });

		// Views share subscription IDENTITY: double-mounting dedups.
		const view = db.$pick("item");
		const twice = v.fn("stg.make", { use: [db, view] }, () => ({
			id: "twice",
		}));
		await twice();
		expect(await db.item.count({ id: "twice" })).toBe(1);
	});

	it("where operators: a bare value is equality, an operator object is not", async () => {
		const item = v.var("stg_ops", {
			default: null,
			schema: v.object({
				id: v.string(),
				n: v.number(),
				at: v.date({ optional: true }),
			}),
		});
		const db = v.storage(memoryAdapter(), { item });
		await db.item.create({ id: "a", n: 1, at: new Date(1000) });
		await db.item.create({ id: "b", n: 2, at: new Date(2000) });
		await db.item.create({ id: "c", n: 3, at: new Date(3000) });

		expect(await db.item.findMany({ n: { lt: 3 } })).toHaveLength(2);
		expect(await db.item.findMany({ n: { gte: 2 } })).toHaveLength(2);
		expect(await db.item.findMany({ n: { ne: 2 } })).toHaveLength(2);
		expect(await db.item.findMany({ id: { in: ["a", "c"] } })).toHaveLength(2);
		expect(await db.item.findMany({ id: { notIn: ["a"] } })).toHaveLength(2);
		expect(await db.item.findMany({ id: { contains: "b" } })).toHaveLength(1);
		// Dates order by their instant - the expiry sweep shape.
		expect(await db.item.count({ at: { lt: new Date(2500) } })).toBe(2);
		// Operators AND with plain equality in the same where.
		expect(await db.item.findOne({ id: "b", n: { gt: 1 } })).toMatchObject({
			id: "b",
		});
		expect(await db.item.findOne({ id: "b", n: { gt: 2 } })).toBeNull();
	});

	it("findMany shapes: sortBy, then offset/limit window", async () => {
		const item = v.var("stg_shape_opts", {
			default: null,
			schema: v.object({ id: v.string(), n: v.number() }),
		});
		const db = v.storage(memoryAdapter(), { item });
		await db.item.create({ id: "b", n: 2 });
		await db.item.create({ id: "c", n: 3 });
		await db.item.create({ id: "a", n: 1 });

		const sorted = await db.item.findMany(undefined, {
			sortBy: { field: "n" },
		});
		expect(sorted.map((row) => row.id)).toEqual(["a", "b", "c"]);

		const paged = await db.item.findMany(undefined, {
			sortBy: { field: "n", direction: "desc" },
			offset: 1,
			limit: 1,
		});
		expect(paged.map((row) => row.id)).toEqual(["b"]);
	});

	it("consumeOne: the row comes back and is GONE - a token spends once", async () => {
		const token = v.var("stg_token", {
			default: null,
			schema: v.object({ value: v.string() }),
		});
		const db = v.storage(memoryAdapter(), { token });
		await db.token.create({ value: "t1" });

		expect(await db.token.consumeOne({ value: "t1" })).toEqual({
			value: "t1",
		});
		expect(await db.token.consumeOne({ value: "t1" })).toBeNull();
		expect(await db.token.count()).toBe(0);
	});

	it("incrementOne: the where doubles as the GUARD - check-and-bump is one op", async () => {
		const bucket = v.var("stg_bucket", {
			default: null,
			schema: v.object({ key: v.string(), count: v.number() }),
		});
		const db = v.storage(memoryAdapter(), { bucket });
		await db.bucket.create({ key: "ip:1", count: 0 });

		// The rate-limit shape: bump only while under the max.
		expect(
			await db.bucket.incrementOne(
				{ key: "ip:1", count: { lt: 2 } },
				{ count: 1 },
			),
		).toEqual({ key: "ip:1", count: 1 });
		await db.bucket.incrementOne(
			{ key: "ip:1", count: { lt: 2 } },
			{ count: 1 },
		);
		expect(
			await db.bucket.incrementOne(
				{ key: "ip:1", count: { lt: 2 } },
				{ count: 1 },
			),
		).toBeNull();
		expect(await db.bucket.findOne({ key: "ip:1" })).toEqual({
			key: "ip:1",
			count: 2,
		});
	});

	it("optional verbs FALL BACK to the required six on a bare adapter", async () => {
		const { consumeOne, incrementOne, transaction, ...bare } = memoryAdapter();
		const item = v.var("stg_bare", {
			default: null,
			schema: v.object({ id: v.string(), n: v.number() }),
		});
		const db = v.storage(bare, { item });
		await db.item.create({ id: "1", n: 0 });
		await db.item.create({ id: "1", n: 9 });

		// consumeOne deletes THE found row by its own fields, not the where -
		// the identical-looking sibling survives.
		expect(await db.item.consumeOne({ id: "1" })).toEqual({ id: "1", n: 0 });
		expect(await db.item.count({ id: "1" })).toBe(1);

		expect(
			await db.item.incrementOne({ id: "1", n: { lt: 10 } }, { n: 1 }),
		).toEqual({ id: "1", n: 10 });
		expect(
			await db.item.incrementOne({ id: "1", n: { lt: 10 } }, { n: 1 }),
		).toBeNull();
	});

	it("$transaction: a throw rolls the whole block back", async () => {
		const item = v.var("stg_tx", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const db = v.storage(memoryAdapter(), { item });
		await db.item.create({ id: "kept" });

		await expect(
			db.$transaction(async (tx) => {
				await tx.item.create({ id: "doomed" });
				await tx.item.delete({ id: "kept" });
				throw new Error("abort");
			}),
		).rejects.toThrow("abort");

		expect(await db.item.findOne({ id: "kept" })).toEqual({ id: "kept" });
		expect(await db.item.findOne({ id: "doomed" })).toBeNull();

		// Committed work lands, and hooks apply INSIDE the block.
		const log: string[] = [];
		db.$on("item.create", async (c, next) => {
			log.push(`create:${(c.args[0] as { id: string }).id}`);
			return next();
		});
		await db.$transaction(async (tx) => {
			await tx.item.create({ id: "landed" });
		});
		expect(await db.item.findOne({ id: "landed" })).toEqual({ id: "landed" });
		expect(log).toEqual(["create:landed"]);

		// An adapter without `transaction` runs the block plainly.
		const { transaction, ...bare } = memoryAdapter();
		const plain = v.storage(bare, { item });
		const answer = await plain.$transaction(async (tx) => {
			await tx.item.create({ id: "plain" });
			return "ran";
		});
		expect(answer).toBe("ran");
		expect(await plain.item.findOne({ id: "plain" })).toEqual({ id: "plain" });
	});

	it("hooks target the NEW ops like any other", async () => {
		const token = v.var("stg_hooked_consume", {
			default: null,
			schema: v.object({ value: v.string() }),
		});
		const log: string[] = [];
		const db = v
			.storage(memoryAdapter(), { token })
			.$on("token.consumeOne", async (c, next) => {
				log.push(`consume:${(c.args[0] as { value: string }).value}`);
				return next();
			});
		await db.token.create({ value: "t1" });
		await db.token.consumeOne({ value: "t1" });
		expect(log).toEqual(["consume:t1"]);
	});

	it("field metadata rides on the model config, exposed through $models", () => {
		const item = v.var("stg_meta", {
			default: null,
			schema: v.object({ id: v.string(), email: v.string() }),
		});
		const db = v.storage(memoryAdapter(), {
			item: {
				schema: item,
				fields: {
					email: { unique: true, index: true },
					id: {
						references: { model: "other", field: "id", onDelete: "cascade" },
					},
				},
			},
		});
		const config = db.$models.item as { fields?: Record<string, unknown> };
		expect(config.fields?.email).toEqual({ unique: true, index: true });
	});

	it("db attrs on the schema surface through $models; fields: overrides", () => {
		const item = v.var("stg_attr_meta", {
			default: null,
			schema: v.object({
				id: v.string(),
				email: db.unique(db.indexed(v.string())),
				ownerId: db.references(v.string(), {
					model: "owner",
					field: "id",
				}),
			}),
		});
		const fromSchema = v.storage(memoryAdapter(), {
			item: { schema: item },
		});
		const fields = (
			fromSchema.$models.item as { fields?: Record<string, unknown> }
		).fields;
		expect(fields?.email).toEqual({ unique: true, index: true });
		expect(fields?.ownerId).toEqual({
			references: { model: "owner", field: "id" },
		});

		const overridden = v.storage(memoryAdapter(), {
			item: {
				schema: item,
				fields: { email: { unique: false } },
			},
		});
		expect(
			(overridden.$models.item as { fields?: Record<string, unknown> }).fields
				?.email,
		).toEqual({ unique: false });
	});

	it("bare var stays a var on $models; resolveModelFields reads attrs", () => {
		const item = v.var("stg_bare_attr", {
			default: null,
			schema: v.object({
				id: v.string(),
				slug: unique(v.string()),
			}),
		});
		const store = v.storage(memoryAdapter(), { item });
		const model = store.$models.item as {
			$var?: boolean;
			name?: string;
		};
		expect(model.$var).toBe(true);
		expect(model.name).toBe("stg_bare_attr");
		expect(resolveModelFields(store.$models.item)?.slug).toEqual({
			unique: true,
		});
	});

	it("indexed and references wrappers write $attrs.db", () => {
		expect(indexed(v.string())).toMatchObject({
			$attrs: { db: { index: true } },
		});
		expect(
			references(v.string(), { model: "u", field: "id", onDelete: "cascade" }),
		).toMatchObject({
			$attrs: {
				db: {
					references: { model: "u", field: "id", onDelete: "cascade" },
				},
			},
		});
	});

	it("adapters are addressed by the VAR name, not the export key", async () => {
		const models: string[] = [];
		const spy: StorageAdapter = {
			create: (model, data) => {
				models.push(model);
				return data;
			},
			findOne: () => null,
			findMany: () => [],
			update: () => null,
			delete: () => 0,
			count: () => 0,
		};
		const named = v.var("stg_named", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const db = v.storage(spy, { alias: named });
		await db.alias.create({ id: "1" });
		expect(models).toEqual(["stg_named"]);
	});
});
