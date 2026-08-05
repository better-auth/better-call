import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { ValidationError, v } from "../../src";
import type { BetterDBModule } from "./assemble";
import { createBetterDB } from "./assemble";
import { memoryDriver } from "./driver";
import { memoryDb, sqliteDb, testSchema } from "./helpers";
import type { BetterAuthDBSchema } from "./types";

const runContract = (
	name: string,
	create: () => Promise<BetterDBModule> | BetterDBModule,
) => {
	describe(`db.* contract (${name})`, () => {
		it("create + findOne + findMany", async () => {
			const db = await create();
			const user = await db.create({
				model: "user",
				data: { name: "Ada", email: "ada@example.com", age: 36 },
			});
			expect(user).toMatchObject({
				name: "Ada",
				email: "ada@example.com",
				age: 36,
			});
			expect(user.id).toBeTruthy();

			const found = await db.findOne({
				model: "user",
				where: [{ field: "email", value: "ada@example.com" }],
			});
			expect(found).toMatchObject({ name: "Ada", email: "ada@example.com" });

			await db.create({
				model: "user",
				data: { name: "Bob", email: "bob@example.com", age: 20 },
			});
			const many = await db.findMany({
				model: "user",
				where: [{ field: "age", operator: "gt", value: 30 }],
				sortBy: { field: "name", direction: "asc" },
			});
			expect(many).toHaveLength(1);
			expect(many[0]?.name).toBe("Ada");
		});

		it("supports where operators", async () => {
			const db = await create();
			await db.create({
				model: "user",
				data: { name: "Ada", email: "ada@example.com", age: 36 },
			});
			await db.create({
				model: "user",
				data: { name: "Bob", email: "bob@example.com", age: 20 },
			});

			const byIn = await db.findMany({
				model: "user",
				where: [{ field: "name", operator: "in", value: ["Ada", "Zoe"] }],
			});
			expect(byIn.map((u: any) => u.name).sort()).toEqual(["Ada"]);

			const contains = await db.findMany({
				model: "user",
				where: [{ field: "email", operator: "contains", value: "bob" }],
			});
			expect(contains).toHaveLength(1);
			expect(contains[0]?.name).toBe("Bob");
		});

		it("update / updateMany / delete / deleteMany / count", async () => {
			const db = await create();
			const a = await db.create({
				model: "user",
				data: { name: "Ada", email: "ada@example.com", age: 36 },
			});
			await db.create({
				model: "user",
				data: { name: "Bob", email: "bob@example.com", age: 20 },
			});

			const updated = await db.update({
				model: "user",
				where: [{ field: "id", value: a.id }],
				update: { age: 37 },
			});
			expect(updated?.age).toBe(37);

			const n = await db.updateMany({
				model: "user",
				where: [{ field: "age", operator: "lt", value: 30 }],
				update: { active: false },
			});
			expect(n).toBe(1);

			expect(await db.count({ model: "user" })).toBe(2);

			await db.delete({
				model: "user",
				where: [{ field: "id", value: a.id }],
			});
			expect(await db.count({ model: "user" })).toBe(1);

			const deleted = await db.deleteMany({
				model: "user",
				where: [{ field: "name", value: "Bob" }],
			});
			expect(deleted).toBe(1);
			expect(await db.count({ model: "user" })).toBe(0);
		});

		it("consumeOne and incrementOne", async () => {
			const db = await create();
			const token = await db.create({
				model: "token",
				data: { value: "abc", remaining: 2 },
			});

			const consumed = await db.consumeOne({
				model: "token",
				where: [{ field: "id", value: token.id }],
			});
			expect(consumed?.value).toBe("abc");
			expect(
				await db.findOne({
					model: "token",
					where: [{ field: "id", value: token.id }],
				}),
			).toBeNull();

			const t2 = await db.create({
				model: "token",
				data: { value: "xyz", remaining: 3 },
			});
			const inc = await db.incrementOne({
				model: "token",
				where: [{ field: "id", value: t2.id }],
				increment: { remaining: -1 },
			});
			expect(inc?.remaining).toBe(2);
		});

		it("join fallback attaches related rows", async () => {
			const db = await create();
			const user = await db.create({
				model: "user",
				data: { name: "Ada", email: "ada@example.com" },
			});
			await db.create({
				model: "session",
				data: { userId: user.id, token: "s1" },
			});
			await db.create({
				model: "session",
				data: { userId: user.id, token: "s2" },
			});

			const found = await db.findOne({
				model: "user",
				where: [{ field: "id", value: user.id }],
				join: { session: true },
			});
			expect(found?.name).toBe("Ada");
			expect(Array.isArray(found?.session)).toBe(true);
			expect(found?.session).toHaveLength(2);
			expect(found?.session.map((s: any) => s.token).sort()).toEqual([
				"s1",
				"s2",
			]);
		});

		it("rejects unknown fields on create", async () => {
			const db = await create();
			await expect(
				db.create({
					model: "user",
					data: {
						name: "Ada",
						email: "ada@example.com",
						nope: true,
					} as any,
				}),
			).rejects.toThrow(ValidationError);
		});

		it("transaction scopes writes via bound tx", async () => {
			const db = await create();
			await db.transaction(async (tx) => {
				await tx.create({
					model: "user",
					data: { name: "Ada", email: "ada@example.com" },
				});
			});
			expect(await db.count({ model: "user" })).toBe(1);

			await expect(
				db.transaction(async (tx) => {
					await tx.create({
						model: "user",
						data: { name: "Bob", email: "bob@example.com" },
					});
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			expect(await db.count({ model: "user" })).toBe(1);
		});
	});
};

runContract("memory", () => memoryDb());

runContract("sqlite", async () => {
	const raw = new Database(":memory:");
	const db = sqliteDb(raw);
	await db.applySchema({ tables: testSchema });
	return db;
});

describe("sqlite applySchema", () => {
	it("creates tables via generateTable", async () => {
		const raw = new Database(":memory:");
		const db = sqliteDb(raw);
		const result = await db.applySchema({ tables: testSchema });
		expect(result.code).toContain("CREATE TABLE user");
		expect(result.code).toContain("CREATE TABLE token");

		await db.create({
			model: "user",
			data: { name: "Ada", email: "ada@example.com" },
		});
		expect(await db.count({ model: "user" })).toBe(1);
	});
});

describe("module composition", () => {
	it("mounts db.* via use without leaking storage/pipeline", async () => {
		const mod = memoryDb();
		expect(mod).not.toHaveProperty("storageCreate");
		expect(mod).not.toHaveProperty("transformInput");
		expect(mod).not.toHaveProperty("client");

		const app = v.fn({ use: [mod] }).fn(async (c) => {
			const user = await c.use.create({
				model: "user",
				data: { name: "Ada", email: "ada@example.com" },
			});
			return c.use.findOne({
				model: "user",
				where: [{ field: "id", value: user.id }],
			});
		});
		const row = await app();
		expect(row).toMatchObject({ name: "Ada", email: "ada@example.com" });
	});
});

describe("instance isolation", () => {
	it("keeps schema and client separate across drivers", async () => {
		const schemaA: BetterAuthDBSchema = {
			user: {
				fields: {
					name: { type: "string", required: true },
					email: { type: "string", required: true },
				},
			},
		};
		const schemaB: BetterAuthDBSchema = {
			account: {
				fields: {
					handle: { type: "string", required: true },
				},
			},
		};
		const a = createBetterDB({
			driver: memoryDriver(),
			schema: schemaA,
		});
		const b = createBetterDB({
			driver: memoryDriver(),
			schema: schemaB,
		});

		await a.create({
			model: "user",
			data: { name: "Ada", email: "ada@example.com" },
		});
		await b.create({
			model: "account",
			data: { handle: "bob" },
		});

		expect(await a.count({ model: "user" })).toBe(1);
		expect(await b.count({ model: "account" })).toBe(1);
		await expect(
			a.create({ model: "account", data: { handle: "x" } } as any),
		).rejects.toThrow();
		await expect(
			b.create({
				model: "user",
				data: { name: "Zoe", email: "z@example.com" },
			} as any),
		).rejects.toThrow();
	});
});

describe("create id handling", () => {
	it("keeps a provided id on create", async () => {
		const db = memoryDb();
		const user = await db.create({
			model: "user",
			data: { id: "custom-ada", name: "Ada", email: "ada@example.com" },
		});
		expect(user.id).toBe("custom-ada");
		const found = await db.findOne({
			model: "user",
			where: [{ field: "id", value: "custom-ada" }],
		});
		expect(found?.name).toBe("Ada");
	});
});

describe("custom generateId", () => {
	it("uses createBetterDB({ generateId }) for new rows", async () => {
		let n = 0;
		const db = createBetterDB({
			driver: memoryDriver(),
			schema: testSchema,
			generateId: ({ model }) => `${model}-${++n}`,
		});
		const user = await db.create({
			model: "user",
			data: { name: "Ada", email: "ada@example.com" },
		});
		expect(user.id).toBe("user-1");
		const token = await db.create({
			model: "token",
			data: { value: "abc", remaining: 1 },
		});
		expect(token.id).toBe("token-2");
	});
});

describe("transaction guards", () => {
	it("throws on nested transaction", async () => {
		const db = memoryDb();
		await expect(
			db.transaction(async (tx) => {
				await tx.transaction(async () => {});
			}),
		).rejects.toThrow(/nested transactions are not supported/);
	});

	it("documents that unbound db.create is not isolated by the txn", async () => {
		const db = memoryDb();
		await expect(
			db.transaction(async () => {
				// Wrong: module-level create does not participate in this txn.
				await db.create({
					model: "user",
					data: { name: "Leak", email: "leak@example.com" },
				});
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		// Survives rollback — wrote outside the journal.
		expect(await db.count({ model: "user" })).toBe(1);
	});
});
