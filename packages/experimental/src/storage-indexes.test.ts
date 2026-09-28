import { describe, expect, it } from "vitest";
import {
	type ModelMeta,
	memoryAdapter,
	modelIndexName,
	resolveModelIndexes,
	resolveModelMeta,
	type StorageAdapter,
	UniqueConstraintError,
	v,
} from "./index";
import { db, schema } from "./plugins/db";

const account = schema(
	"idx_account",
	{
		id: db.id(v.string()),
		issuer: v.string(),
		accountId: v.string(),
		providerId: v.string(),
		userId: db.indexed(v.string()),
		scope: v.string({ optional: true }),
	},
	{
		indexes: [
			{ fields: ["issuer", "accountId"], unique: true },
			{ fields: ["providerId", "userId"] },
		],
	},
);

describe("composite indexes", () => {
	it("schema() stores indexes as $attrs.db.indexes next to field attrs", () => {
		expect(account.$attrs.db).toMatchObject({
			model: true,
			indexes: [
				{ fields: ["issuer", "accountId"], unique: true },
				{ fields: ["providerId", "userId"] },
			],
		});
		expect(resolveModelIndexes(account)).toHaveLength(2);
		const meta = resolveModelMeta(account);
		expect(meta.name).toBe("idx_account");
		expect(meta.fields.userId).toEqual({ index: true });
		expect(meta.fields.id).toEqual({ id: true });
	});

	it("rejects indexes no database would build the same way", () => {
		const fields = { a: v.string(), b: v.string({ optional: true }) };
		expect(() =>
			schema("idx_bad1", fields, { indexes: [{ fields: ["a", "c" as "a"] }] }),
		).toThrow(/unknown field "c"/);
		expect(() =>
			schema("idx_bad2", fields, { indexes: [{ fields: ["a", "a"] }] }),
		).toThrow(/more than once/);
		expect(() =>
			schema("idx_bad3", fields, {
				indexes: [{ fields: ["a", "b"], unique: true }],
			}),
		).toThrow(/required fields/);
		expect(() =>
			schema("idx_bad4", fields, {
				indexes: [{ fields: ["a"], name: "1-bad" }],
			}),
		).toThrow(/Index names/);
		// Non-unique over an optional field is fine.
		expect(() =>
			schema("idx_ok", fields, { indexes: [{ fields: ["a", "b"] }] }),
		).not.toThrow();
	});

	it("names indexes the way Better Auth does", () => {
		expect(
			modelIndexName("account", {
				fields: ["issuer", "accountId"],
				unique: true,
			}),
		).toBe("account_issuer_accountId_uidx");
		expect(modelIndexName("account", { fields: ["userId"] })).toBe(
			"account_userId_idx",
		);
		expect(
			modelIndexName("account", { fields: ["userId"], name: "custom" }),
		).toBe("custom");
		const long = modelIndexName("t".repeat(40), {
			fields: ["f".repeat(40)],
			unique: true,
		});
		expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(63);
		expect(long).toMatch(/_[0-9a-f]{8}_uidx$/);
	});

	it("adapters receive model metadata through setup, keyed by name", () => {
		const seen: Record<string, ModelMeta>[] = [];
		const base = memoryAdapter();
		const adapter: StorageAdapter = {
			...base,
			setup: (models) => {
				seen.push(models);
				base.setup?.(models);
			},
		};
		const other = schema("idx_other", { id: db.id(v.string()) });
		const store = v.storage(adapter, { account });
		expect(Object.keys(seen[0] ?? {})).toEqual(["idx_account"]);
		expect(seen[0]?.idx_account?.indexes).toEqual([
			{ fields: ["issuer", "accountId"], unique: true },
			{ fields: ["providerId", "userId"] },
		]);
		store.$extend({ other });
		expect(Object.keys(seen[1] ?? {})).toEqual(["idx_other"]);
	});

	it("ModelConfig.indexes adds to the var's and surfaces on $models", () => {
		const plain = v.var("idx_cfg", {
			default: null,
			schema: v.object({ a: v.string(), b: v.string() }),
		});
		const store = v.storage(memoryAdapter(), {
			item: { schema: plain, indexes: [{ fields: ["a", "b"], unique: true }] },
		});
		expect((store.$models.item as { indexes?: unknown }).indexes).toEqual([
			{ fields: ["a", "b"], unique: true },
		]);
		expect(() =>
			v.storage(memoryAdapter(), {
				item: { schema: plain, indexes: [{ fields: ["zzz"] }] },
			}),
		).toThrow(/unknown field "zzz"/);
	});

	it("memory adapter enforces composite uniqueness on create", async () => {
		const store = v.storage(memoryAdapter(), { account });
		await store.account.create({
			issuer: "local:credential",
			accountId: "u1",
			providerId: "credential",
			userId: "u1",
		});
		// Same accountId, another issuer: fine.
		await store.account.create({
			issuer: "https://idp.example",
			accountId: "u1",
			providerId: "oidc",
			userId: "u1",
		});
		const clash = store.account.create({
			issuer: "local:credential",
			accountId: "u1",
			providerId: "credential",
			userId: "u2",
		});
		await expect(clash).rejects.toBeInstanceOf(UniqueConstraintError);
		await expect(clash).rejects.toMatchObject({
			model: "idx_account",
			fields: ["issuer", "accountId"],
			index: "idx_account_issuer_accountId_uidx",
		});
		expect(await store.account.count()).toBe(2);
	});

	it("memory adapter enforces uniqueness on update and incrementOne", async () => {
		const store = v.storage(memoryAdapter(), { account });
		await store.account.create({
			issuer: "a",
			accountId: "1",
			providerId: "p",
			userId: "u",
		});
		await store.account.create({
			issuer: "b",
			accountId: "1",
			providerId: "p",
			userId: "u",
		});
		await expect(
			store.account.update({ issuer: "b" }, { issuer: "a" }),
		).rejects.toBeInstanceOf(UniqueConstraintError);
		// The failed update left the row untouched.
		expect(await store.account.count({ issuer: "b" })).toBe(1);
		// Updating a row to its own values is not a clash.
		expect(
			await store.account.update({ issuer: "a" }, { issuer: "a" }),
		).toMatchObject({ issuer: "a" });

		const counter = schema(
			"idx_counter",
			{ key: v.string(), n: v.number() },
			{ indexes: [{ fields: ["key", "n"], unique: true }] },
		);
		const counters = v.storage(memoryAdapter(), { counter });
		await counters.counter.create({ key: "k", n: 1 });
		await counters.counter.create({ key: "k", n: 2 });
		await expect(
			counters.counter.incrementOne({ key: "k", n: 1 }, { n: 1 }),
		).rejects.toBeInstanceOf(UniqueConstraintError);
		expect(await counters.counter.count({ n: 1 })).toBe(1);
	});

	it("per-field unique and ids raise the same error; nulls never clash", async () => {
		const user = schema("idx_user", {
			id: db.id(v.string()),
			email: db.unique(v.string()),
			handle: db.unique(v.string({ optional: true })),
		});
		const store = v.storage(memoryAdapter(), { user });
		const first = await store.user.create({ email: "a@x" });
		await store.user.create({ email: "b@x" });
		await expect(store.user.create({ email: "a@x" })).rejects.toMatchObject({
			name: "UniqueConstraintError",
			fields: ["email"],
			index: "idx_user_email_uidx",
		});
		await expect(
			store.user.create({ id: first.id, email: "c@x" } as never),
		).rejects.toMatchObject({ fields: ["id"] });
		await expect(
			store.user.update({ email: "b@x" }, { email: "a@x" }),
		).rejects.toBeInstanceOf(UniqueConstraintError);
		// Two rows without a handle: SQL-style, null is never a duplicate.
		expect(await store.user.count()).toBe(2);
	});

	it("unique fields declared only through ModelConfig.fields are enforced", async () => {
		const item = v.var("idx_cfg_unique", {
			default: null,
			schema: v.object({ slug: v.string() }),
		});
		const store = v.storage(memoryAdapter(), {
			item: { schema: item, fields: { slug: { unique: true } } },
		});
		await store.item.create({ slug: "a" });
		await expect(store.item.create({ slug: "a" })).rejects.toBeInstanceOf(
			UniqueConstraintError,
		);
	});

	it("$adapter swaps hand the new adapter every known model", async () => {
		const store = v.storage(memoryAdapter(), { account });
		store.$adapter(memoryAdapter());
		const row = {
			issuer: "a",
			accountId: "1",
			providerId: "p",
			userId: "u",
		};
		await store.account.create(row);
		await expect(store.account.create(row)).rejects.toBeInstanceOf(
			UniqueConstraintError,
		);
	});
});
