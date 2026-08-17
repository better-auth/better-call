import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DBAdapter as BetterAuthDBAdapter } from "@better-auth/core/db/adapter";
import { type Client, createClient } from "@libsql/client";
import { relations } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
} from "vitest";
import { v } from "../src";
import { drizzleAdapter } from "./drizzle";
import { affectedRows } from "./drizzle/query-builders";
import type { AdapterModule, DBAdapter } from "./index";

const user = sqliteTable("users", {
	id: text("id").primaryKey(),
	emailAddress: text("email_address").notNull().unique(),
	name: text("name").notNull(),
	active: integer("active", { mode: "boolean" }).notNull(),
	meta: text("meta"),
	tags: text("tags"),
	attempts: integer("attempts").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

const session = sqliteTable("sessions", {
	id: text("id").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id),
	token: text("token").notNull().unique(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
}));
const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

const drizzleSchema = { user, session, userRelations, sessionRelations };
const models = {
	user: {
		fields: {
			id: { type: "string" as const },
			email: {
				type: "string" as const,
				column: "emailAddress",
				unique: true,
			},
			name: { type: "string" as const },
			active: { type: "boolean" as const, default: true },
			meta: { type: "json" as const },
			tags: { type: "string[]" as const },
			attempts: { type: "number" as const, default: 0 },
			createdAt: {
				type: "date" as const,
				default: () => new Date(),
			},
			updatedAt: {
				type: "date" as const,
				default: () => new Date(),
				onUpdate: () => new Date(),
			},
		},
	},
	session: {
		fields: {
			id: { type: "string" as const },
			userId: {
				type: "string" as const,
				references: { model: "user", field: "id" },
			},
			token: { type: "string" as const, unique: true },
			createdAt: {
				type: "date" as const,
				default: () => new Date(),
			},
		},
	},
};

type TestDatabase = LibSQLDatabase<typeof drizzleSchema>;

describe("drizzleAdapter", () => {
	let client: Client;
	let database: TestDatabase;
	let adapter: AdapterModule;
	let databasePath: string;

	beforeEach(async () => {
		databasePath = join(tmpdir(), `better-call-${randomUUID()}.db`);
		client = createClient({ url: `file:${databasePath}` });
		await client.batch(
			[
				`CREATE TABLE users (
					id TEXT PRIMARY KEY,
					email_address TEXT NOT NULL UNIQUE,
					name TEXT NOT NULL,
					active INTEGER NOT NULL,
					meta TEXT,
					tags TEXT,
					attempts INTEGER NOT NULL DEFAULT 0,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				)`,
				`CREATE TABLE sessions (
					id TEXT PRIMARY KEY,
					user_id TEXT NOT NULL REFERENCES users(id),
					token TEXT NOT NULL UNIQUE,
					created_at INTEGER NOT NULL
				)`,
			],
			"write",
		);
		database = drizzle(client, { schema: drizzleSchema });
		adapter = drizzleAdapter(database, {
			provider: "sqlite",
			schema: { user, session },
			models,
			transaction: true,
			joins: false,
		});
	});

	afterEach(async () => {
		client.close();
		await rm(databasePath, { force: true });
	});

	it("is callable like Better Auth while remaining keyed fns", () => {
		expect(adapter.id).toBe("drizzle");
		expect((adapter.findOne as unknown as { key: string }).key).toBe(
			"db.find_one",
		);
		expect((adapter.updateMany as unknown as { key: string }).key).toBe(
			"db.update_many",
		);
		expectTypeOf(adapter).toMatchTypeOf<DBAdapter>();
		type BetterAuthMethods = Pick<
			BetterAuthDBAdapter,
			| "create"
			| "findOne"
			| "findMany"
			| "count"
			| "update"
			| "updateMany"
			| "delete"
			| "deleteMany"
			| "consumeOne"
			| "incrementOne"
			| "transaction"
		>;
		const betterAuthMethods: BetterAuthMethods = adapter;
		expect(betterAuthMethods.findOne).toBe(adapter.findOne);
	});

	it("composes through c.use and db.* interceptors", async () => {
		await adapter.create({
			model: "user",
			data: { email: "module@example.com", name: "Module" },
		});
		const calls: string[] = [];
		const audit = v.on("db.find_one", async (_c, next) => {
			calls.push("findOne");
			return next();
		});
		const entry = v.fn({ use: [adapter, { audit }] }, (c) =>
			c.findOne({
				model: "user",
				where: [{ field: "email", value: "module@example.com" }],
			}),
		);

		await expect(entry()).resolves.toMatchObject({ name: "Module" });
		expect(calls).toEqual(["findOne"]);
	});

	it("creates, maps, transforms, selects, and reads rows", async () => {
		const createdAt = new Date("2026-01-02T03:04:05.000Z");
		const created = await adapter.create<{
			id: string;
			email: string;
			name: string;
			active: boolean;
			meta: { role: string };
			tags: string[];
			createdAt: Date;
			updatedAt: Date;
		}>({
			model: "user",
			data: {
				email: "Ping@Example.com",
				name: "Ping",
				active: true,
				meta: { role: "admin" },
				tags: ["auth", "drizzle"],
				createdAt,
				updatedAt: createdAt,
			},
		});

		expect(created.id).toEqual(expect.any(String));
		expect(created).toMatchObject({
			email: "Ping@Example.com",
			active: true,
			meta: { role: "admin" },
			tags: ["auth", "drizzle"],
			createdAt,
		});

		await expect(
			adapter.findOne({
				model: "user",
				where: [
					{
						field: "email",
						value: "ping@example.com",
						mode: "insensitive",
					},
				],
				select: ["email", "name"],
			}),
		).resolves.toEqual({
			email: "Ping@Example.com",
			name: "Ping",
		});
	});

	it("supports operators, sorting, pagination, and counts", async () => {
		for (const [name, attempts] of [
			["Alpha", 1],
			["beta", 2],
			["Gamma", 3],
		] as const) {
			await adapter.create({
				model: "user",
				data: {
					email: `${name}@example.com`,
					name,
					active: true,
					attempts,
				},
			});
		}

		const rows = await adapter.findMany<{ name: string; attempts: number }>({
			model: "user",
			where: [
				{ field: "attempts", value: 1, operator: "gt" },
				{
					field: "name",
					value: ["beta"],
					operator: "not_in",
					connector: "AND",
				},
			],
			sortBy: { field: "attempts", direction: "desc" },
			limit: 1,
			offset: 0,
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Gamma");
		await expect(
			adapter.count({
				model: "user",
				where: [
					{
						field: "name",
						value: "a",
						operator: "contains",
						mode: "insensitive",
					},
				],
			}),
		).resolves.toBe(3);
	});

	it("supports every comparison, pattern, null, and OR predicate", async () => {
		await adapter.create({
			model: "user",
			data: {
				email: "Alpha@Example.com",
				name: "Alpha",
				active: true,
				attempts: 1,
				meta: null,
			},
		});
		await adapter.create({
			model: "user",
			data: {
				email: "beta@example.com",
				name: "Beta",
				active: false,
				attempts: 3,
				meta: { populated: true },
			},
		});

		const cases: Array<[string, Parameters<DBAdapter["count"]>[0], number]> = [
			[
				"lt",
				{
					model: "user",
					where: [{ field: "attempts", value: 2, operator: "lt" }],
				},
				1,
			],
			[
				"lte",
				{
					model: "user",
					where: [{ field: "attempts", value: 1, operator: "lte" }],
				},
				1,
			],
			[
				"gte",
				{
					model: "user",
					where: [{ field: "attempts", value: 3, operator: "gte" }],
				},
				1,
			],
			[
				"in",
				{
					model: "user",
					where: [
						{
							field: "attempts",
							value: [1, 3],
							operator: "in",
						},
					],
				},
				2,
			],
			[
				"starts_with",
				{
					model: "user",
					where: [
						{
							field: "name",
							value: "al",
							operator: "starts_with",
							mode: "insensitive",
						},
					],
				},
				1,
			],
			[
				"ends_with",
				{
					model: "user",
					where: [
						{
							field: "email",
							value: "EXAMPLE.COM",
							operator: "ends_with",
							mode: "insensitive",
						},
					],
				},
				2,
			],
			[
				"eq null",
				{
					model: "user",
					where: [{ field: "meta", value: null }],
				},
				1,
			],
			[
				"ne null",
				{
					model: "user",
					where: [{ field: "meta", value: null, operator: "ne" }],
				},
				1,
			],
			[
				"insensitive in",
				{
					model: "user",
					where: [
						{
							field: "email",
							value: ["alpha@example.com"],
							operator: "in",
							mode: "insensitive",
						},
					],
				},
				1,
			],
			[
				"OR",
				{
					model: "user",
					where: [
						{ field: "attempts", value: 99 },
						{
							field: "name",
							value: "Beta",
							connector: "OR",
						},
					],
				},
				1,
			],
		];
		for (const [name, input, expected] of cases) {
			await expect(adapter.count(input), name).resolves.toBe(expected);
		}
	});

	it("honors forceAllowId and custom id generation", async () => {
		const ignored = await adapter.create<{ id: string }>({
			model: "user",
			data: {
				id: "ignored",
				email: "ignored@example.com",
				name: "Ignored",
			} as never,
		});
		expect(ignored.id).not.toBe("ignored");

		const forced = await adapter.create<{ id: string }>({
			model: "user",
			data: {
				id: "forced-id",
				email: "forced@example.com",
				name: "Forced",
			} as never,
			forceAllowId: true,
		});
		expect(forced.id).toBe("forced-id");

		const generated = drizzleAdapter(database, {
			provider: "sqlite",
			schema: { user, session },
			models,
			generateId: (model) => `${model}-generated`,
		});
		await expect(
			generated.create<{ id: string }>({
				model: "user",
				data: { email: "generated@example.com", name: "Generated" },
			}),
		).resolves.toMatchObject({ id: "user-generated" });
	});

	it("returns declared adapter errors for bad models, fields, and predicates", async () => {
		await expect(
			adapter.findOne({ model: "missing", where: [] }),
		).rejects.toMatchObject({ tag: "unknown_model" });
		await expect(
			adapter.findOne({
				model: "user",
				where: [{ field: "missing", value: "x" }],
			}),
		).rejects.toMatchObject({ tag: "unknown_field" });
		await expect(
			adapter.findOne({
				model: "user",
				where: [
					{
						field: "name",
						value: "x",
						operator: "in",
					},
				],
			}),
		).rejects.toMatchObject({ tag: "invalid_where" });
	});

	it("updates one or many and deletes one or many", async () => {
		const first = await adapter.create<{ id: string }>({
			model: "user",
			data: { email: "first@example.com", name: "First" },
		});
		await adapter.create({
			model: "user",
			data: { email: "second@example.com", name: "Second" },
		});

		const updated = await adapter.update<{ id: string; name: string }>({
			model: "user",
			where: [{ field: "id", value: first.id }],
			update: { name: "Renamed" },
		});
		expect(updated?.name).toBe("Renamed");

		await expect(
			adapter.updateMany({
				model: "user",
				where: [{ field: "active", value: true }],
				update: { active: false },
			}),
		).resolves.toBe(2);
		await expect(
			adapter.deleteMany({
				model: "user",
				where: [{ field: "active", value: false }],
			}),
		).resolves.toBe(2);
		await expect(adapter.count({ model: "user" })).resolves.toBe(0);
	});

	it("loads one-to-many and reverse one-to-one joins", async () => {
		const created = await adapter.create<{ id: string }>({
			model: "user",
			data: { email: "join@example.com", name: "Joined" },
		});
		await adapter.create({
			model: "session",
			data: { userId: created.id, token: "session-1" },
		});
		await adapter.create({
			model: "session",
			data: { userId: created.id, token: "session-2" },
		});

		const withSessions = await adapter.findOne<{
			id: string;
			session: Array<{ token: string }>;
		}>({
			model: "user",
			where: [{ field: "id", value: created.id }],
			join: { session: { limit: 1 } },
		});
		expect(withSessions?.session).toHaveLength(1);

		const withUser = await adapter.findOne<{
			token: string;
			user: { id: string };
		}>({
			model: "session",
			where: [{ field: "token", value: "session-1" }],
			join: { user: true },
		});
		expect(withUser?.user.id).toBe(created.id);
	});

	it("rolls back real transactions", async () => {
		await expect(
			adapter.transaction(async (trx) => {
				await trx.create({
					model: "user",
					data: { email: "rollback@example.com", name: "Rollback" },
				});
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		await expect(
			adapter.count({
				model: "user",
				where: [{ field: "email", value: "rollback@example.com" }],
			}),
		).resolves.toBe(0);
	});

	it("provides Better Auth's sequential transaction fallback", async () => {
		const sequential = drizzleAdapter(database, {
			provider: "sqlite",
			schema: { user, session },
			models,
			transaction: false,
		});
		await expect(
			sequential.transaction(async (trx) => {
				await trx.create({
					model: "user",
					data: { email: "sequential@example.com", name: "Sequential" },
				});
				throw new Error("no rollback without transaction support");
			}),
		).rejects.toThrow("no rollback");
		await expect(
			adapter.count({
				model: "user",
				where: [{ field: "email", value: "sequential@example.com" }],
			}),
		).resolves.toBe(1);
	});

	it("atomically consumes once and performs guarded increments", async () => {
		const created = await adapter.create<{ id: string }>({
			model: "user",
			data: {
				email: "atomic@example.com",
				name: "Atomic",
				attempts: 1,
			},
		});
		const incremented = await adapter.incrementOne<{
			id: string;
			attempts: number;
		}>({
			model: "user",
			where: [
				{ field: "id", value: created.id },
				{ field: "attempts", value: 0, operator: "gt" },
			],
			increment: { attempts: -1 },
			set: { name: "Consumed" },
		});
		expect(incremented?.attempts).toBe(0);
		await expect(
			adapter.incrementOne({
				model: "user",
				where: [
					{ field: "id", value: created.id },
					{ field: "attempts", value: 0, operator: "gt" },
				],
				increment: { attempts: -1 },
			}),
		).resolves.toBeNull();

		const consumed = await adapter.consumeOne<{ id: string }>({
			model: "user",
			where: [{ field: "id", value: created.id }],
		});
		expect(consumed?.id).toBe(created.id);
		await expect(
			adapter.consumeOne({
				model: "user",
				where: [{ field: "id", value: created.id }],
			}),
		).resolves.toBeNull();
	});
});

describe("dialect result compatibility", () => {
	it.each([
		[{ rowCount: 2 }, 2],
		[Object.assign([], { count: 3 }), 3],
		[[{ affectedRows: 4 }], 4],
		[{ rowsAffected: 5 }, 5],
		[{ changes: 6 }, 6],
		[{ meta: { changes: 7 } }, 7],
	])("normalizes affected rows from %j", (result, expected) => {
		expect(affectedRows(result, "test")).toBe(expected);
	});

	it("rejects non-numeric driver results", () => {
		expect(() => affectedRows({}, "test")).toThrow(/non-numeric/);
	});

	it("uses MySQL's execute path for creates", async () => {
		const row = {
			id: "mysql-id",
			emailAddress: "mysql@example.com",
			name: "MySQL",
		};
		const returning = vi.fn();
		const execute = vi.fn().mockResolvedValue([{ insertId: "mysql-id" }]);
		const limit = vi.fn().mockResolvedValue([row]);
		const mysqlDb = {
			_: { fullSchema: { user } },
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({ execute, returning }),
			}),
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({ limit }),
				}),
			}),
			transaction: vi.fn((callback) => callback(mysqlDb)),
		};
		const mysql = drizzleAdapter(mysqlDb, {
			provider: "mysql",
			schema: { user },
			models,
		});

		await expect(
			mysql.create({
				model: "user",
				data: { email: "mysql@example.com", name: "MySQL" },
			}),
		).resolves.toMatchObject({ id: "mysql-id" });
		expect(execute).toHaveBeenCalledOnce();
		expect(returning).not.toHaveBeenCalled();
	});

	it("uses PostgreSQL/SQLite returning for creates", async () => {
		const returning = vi.fn().mockResolvedValue([
			{
				id: "pg-id",
				emailAddress: "pg@example.com",
				name: "Postgres",
			},
		]);
		const execute = vi.fn();
		const pgDb = {
			_: { fullSchema: { user } },
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({ execute, returning }),
			}),
		};
		const pg = drizzleAdapter(pgDb, {
			provider: "pg",
			schema: { user },
			models,
		});

		await expect(
			pg.create({
				model: "user",
				data: { email: "pg@example.com", name: "Postgres" },
			}),
		).resolves.toMatchObject({ id: "pg-id" });
		expect(returning).toHaveBeenCalledOnce();
		expect(execute).not.toHaveBeenCalled();
	});

	it("uses native Drizzle relation queries when available", async () => {
		const findFirst = vi.fn().mockResolvedValue({
			id: "user-id",
			emailAddress: "native@example.com",
			name: "Native",
			sessions: [
				{
					id: "session-id",
					userId: "user-id",
					token: "native-session",
				},
			],
		});
		const nativeDb = {
			_: { fullSchema: { user, session } },
			query: { user: { findFirst } },
		};
		const native = drizzleAdapter(nativeDb, {
			provider: "sqlite",
			schema: { user, session },
			models,
		});

		const result = await native.findOne<{
			id: string;
			session: Array<{ token: string }>;
		}>({
			model: "user",
			where: [{ field: "id", value: "user-id" }],
			join: { session: { limit: 1 } },
		});
		expect(result?.session[0]?.token).toBe("native-session");
		expect(findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				with: { sessions: { limit: 1 } },
			}),
		);
	});

	it("locks and deletes one row for MySQL consumeOne", async () => {
		const row = {
			id: "mysql-consume",
			emailAddress: "consume@example.com",
			name: "Consume",
		};
		const limit = vi.fn().mockResolvedValue([row]);
		const forUpdate = vi.fn().mockReturnValue({ limit });
		const whereSelect = vi.fn().mockReturnValue({ for: forUpdate });
		const whereDelete = vi.fn().mockReturnValue({
			execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
		});
		const tx = {
			_: { fullSchema: { user } },
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({ where: whereSelect }),
			}),
			delete: vi.fn().mockReturnValue({ where: whereDelete }),
		};
		const mysqlDb = {
			_: { fullSchema: { user } },
			transaction: vi.fn((callback) => callback(tx)),
		};
		const mysql = drizzleAdapter(mysqlDb, {
			provider: "mysql",
			schema: { user },
			models,
		});

		await expect(
			mysql.consumeOne({
				model: "user",
				where: [{ field: "id", value: "mysql-consume" }],
			}),
		).resolves.toMatchObject({ id: "mysql-consume" });
		expect(forUpdate).toHaveBeenCalledWith("update");
		expect(mysqlDb.transaction).toHaveBeenCalledOnce();
	});
});
