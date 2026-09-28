import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type Collection,
	isVarExtension,
	type ModelMeta,
	memoryAdapter,
	mergeModelMeta,
	resolveModelFields,
	resolveModelIndexes,
	UniqueConstraintError,
	v,
} from "./index";
import { db, schema } from "./plugins/db";
import { attrsOf, withAttrs } from "./schema";

const defaultNow = () => new Date(0);

/** v2's user table and its email extension, verbatim in shape. */
const user = schema("ext_user", {
	id: db.id(v.string({ description: "The user's ID" })),
	name: v.string({ description: "The user's name" }),
	image: v.string({ optional: true }),
	createdAt: v.noInput(v.date({ default: defaultNow })),
	updatedAt: v.noInput(v.date({ default: defaultNow })),
});

const userWithEmail = v.extend(user, {
	email: v.noInput(db.unique(v.string({ format: "email" }))),
	emailVerified: v.noInput(v.boolean({ default: false })),
});

const account = schema(
	"ext_account",
	{
		id: db.id(v.string()),
		issuer: v.string(),
		accountId: v.string(),
		userId: db.indexed(v.string()),
	},
	{ indexes: [{ fields: ["issuer", "accountId"], unique: true }] },
);

describe("v.extend carries the model's attrs", () => {
	it("keeps db.model and db.indexes from the base var", () => {
		const extended = v.extend(account, { scope: v.string({ optional: true }) });
		expect(isVarExtension(extended)).toBe(true);
		expect(attrsOf(extended, "db")).toEqual({
			model: true,
			indexes: [{ fields: ["issuer", "accountId"], unique: true }],
		});
		// Extending a var without attrs adds none.
		const plain = v.var("ext_plain", { default: null });
		expect("$attrs" in v.extend(plain, { a: v.string() })).toBe(false);
	});

	it("withAttrs on an extension merges and keeps it an extension", () => {
		const tagged = withAttrs(userWithEmail, "db", { extra: 1 });
		expect(isVarExtension(tagged)).toBe(true);
		expect(tagged.base).toBe(user);
		expect(attrsOf(tagged, "db")).toEqual({ model: true, extra: 1 });
		// The original is untouched.
		expect(attrsOf(userWithEmail, "db")).toEqual({ model: true });
	});

	it("a storage built from userWithEmail enforces the unique email", async () => {
		const store = v.storage(memoryAdapter(), { user: userWithEmail });
		expect(resolveModelFields(store.$models.user)?.email).toEqual({
			unique: true,
		});
		const first = await store.user.create({ name: "Ada", email: "a@x.dev" });
		expect(first).toMatchObject({
			name: "Ada",
			email: "a@x.dev",
			emailVerified: false,
			createdAt: new Date(0),
		});
		expect(typeof first.id).toBe("string");
		expectTypeOf(first.email).toEqualTypeOf<string>();
		expectTypeOf(first.name).toEqualTypeOf<string>();

		const clash = store.user.create({ name: "Eve", email: "a@x.dev" });
		await expect(clash).rejects.toBeInstanceOf(UniqueConstraintError);
		await expect(clash).rejects.toMatchObject({
			model: "ext_user",
			fields: ["email"],
		});
		await store.user.create({ name: "Bob", email: "b@x.dev" });
		await expect(
			store.user.update({ email: "b@x.dev" }, { email: "a@x.dev" }),
		).rejects.toBeInstanceOf(UniqueConstraintError);
		// Base-field facts survive too: the id is still unique.
		await expect(
			store.user.create({ id: first.id, name: "Dup", email: "c@x.dev" }),
		).rejects.toMatchObject({ fields: ["id"] });
		expect(await store.user.count()).toBe(2);

		// Extensions go through $extend and ModelConfig.schema the same way.
		const bare = v
			.storage(memoryAdapter(), {})
			.$extend({ user: userWithEmail });
		await bare.user.create({ name: "A", email: "same@x.dev" });
		await expect(
			bare.user.create({ name: "B", email: "same@x.dev" }),
		).rejects.toBeInstanceOf(UniqueConstraintError);
		const configured = v.storage(memoryAdapter(), {
			user: {
				schema: userWithEmail,
				// Keyed by the combined row - base and extension fields.
				fields: { name: { index: true } },
			},
		});
		expect(resolveModelFields(configured.$models.user)).toMatchObject({
			name: { index: true },
			email: { unique: true },
		});
		const made = await configured.user.create({
			name: "A",
			email: "same@x.dev",
		});
		expectTypeOf(made.email).toEqualTypeOf<string>();
		expectTypeOf(made.emailVerified).toEqualTypeOf<boolean>();
		await expect(
			configured.user.create({ name: "B", email: "same@x.dev" }),
		).rejects.toBeInstanceOf(UniqueConstraintError);
		// Op subscriptions mount off an extension model too.
		const subscribed = v.storage(memoryAdapter(), {
			user: { schema: userWithEmail, create: () => [] },
		});
		expect(subscribed.user).toBeDefined();
	});

	it("composite indexes survive an extend", async () => {
		const extended = v.extend(account, { scope: v.string({ optional: true }) });
		const store = v.storage(memoryAdapter(), { account: extended });
		expect(resolveModelIndexes(store.$models.account)).toEqual([
			{ fields: ["issuer", "accountId"], unique: true },
		]);
		expect(resolveModelFields(store.$models.account)?.userId).toEqual({
			index: true,
		});
		await store.account.create({
			issuer: "local:credential",
			accountId: "1",
			userId: "u",
			scope: "openid",
		});
		await expect(
			store.account.create({
				issuer: "local:credential",
				accountId: "1",
				userId: "u2",
			}),
		).rejects.toMatchObject({
			name: "UniqueConstraintError",
			fields: ["issuer", "accountId"],
		});
	});

	it("an extension can add its own index over base and added fields", async () => {
		const tenanted = db.extend(
			account,
			{ tenantId: v.string(), handle: v.string() },
			{
				indexes: [
					{ fields: ["tenantId", "handle"], unique: true },
					{ fields: ["tenantId", "userId"] },
				],
			},
		);
		expect(isVarExtension(tenanted)).toBe(true);
		// Appended to the base's; the base var itself is unchanged.
		expect(resolveModelIndexes(tenanted)).toEqual([
			{ fields: ["issuer", "accountId"], unique: true },
			{ fields: ["tenantId", "handle"], unique: true },
			{ fields: ["tenantId", "userId"] },
		]);
		expect(resolveModelIndexes(account)).toHaveLength(1);

		const store = v.storage(memoryAdapter(), { account: tenanted });
		const row = { issuer: "i", userId: "u", tenantId: "t1", handle: "h" };
		await store.account.create({ ...row, accountId: "1" });
		// The extension's own index.
		await expect(
			store.account.create({ ...row, accountId: "2" }),
		).rejects.toMatchObject({ fields: ["tenantId", "handle"] });
		// The base's index is still enforced.
		await expect(
			store.account.create({ ...row, accountId: "1", tenantId: "t2" }),
		).rejects.toMatchObject({ fields: ["issuer", "accountId"] });
		await store.account.create({ ...row, accountId: "3", tenantId: "t2" });
		expect(await store.account.count()).toBe(2);

		// Validated against the combined shape.
		expect(() =>
			db.extend(
				account,
				{ tenantId: v.string() },
				{ indexes: [{ fields: ["tenantId", "nope" as "tenantId"] }] },
			),
		).toThrow(/unknown field "nope"/);
		expect(() =>
			db.extend(
				account,
				{ nick: v.string({ optional: true }) },
				{ indexes: [{ fields: ["nick"], unique: true }] },
			),
		).toThrow(/required fields/);
	});

	it("a second extension of a model adds constraints, never drops them", async () => {
		const withHandle = v.extend(user, { handle: db.unique(v.string()) });
		const withEmail = v.extend(user, { email: db.unique(v.string()) });
		const first = v.storage(memoryAdapter(), { user: withHandle });
		// Same model name, different extension: registering it must not
		// replace the handle rule the first view relies on.
		const both = first.$extend({ alt: withEmail });
		await first.user.create({ name: "A", handle: "h" });
		await expect(
			first.user.create({ name: "B", handle: "h" }),
		).rejects.toMatchObject({ fields: ["handle"] });
		await both.alt.create({ name: "C", email: "c@x.dev" });
		await expect(
			both.alt.create({ name: "D", email: "c@x.dev" }),
		).rejects.toMatchObject({ fields: ["email"] });

		// Two keys naming one model in a single storage merge as well.
		const twin = v.storage(memoryAdapter(), {
			user: withHandle,
			alt: withEmail,
		});
		await twin.user.create({ name: "A", handle: "h" });
		await expect(
			twin.user.create({ name: "B", handle: "h" }),
		).rejects.toBeInstanceOf(UniqueConstraintError);
	});

	it("storages sharing an adapter keep each other's constraints", async () => {
		const adapter = memoryAdapter();
		const withHandle = v.extend(user, { handle: db.unique(v.string()) });
		const withEmail = v.extend(user, { email: db.unique(v.string()) });
		const a = v.storage(adapter, { user: withHandle });
		v.storage(adapter, { user: withEmail });
		await a.user.create({ name: "A", handle: "h" });
		await expect(
			a.user.create({ name: "B", handle: "h" }),
		).rejects.toMatchObject({ fields: ["handle"] });
	});

	it("mergeModelMeta unions fields, indexes and schema shapes", () => {
		const meta = (over: Partial<ModelMeta>): ModelMeta => ({
			name: "m",
			schema: v.object({ a: v.string() }),
			fields: {},
			indexes: [],
			...over,
		});
		const merged = mergeModelMeta(
			meta({
				fields: { a: { unique: true } },
				indexes: [{ fields: ["a"] }],
			}),
			meta({
				schema: v.object({ b: v.string() }),
				fields: { a: { index: true }, b: { unique: true } },
				indexes: [{ fields: ["a"] }, { fields: ["b"], unique: true }],
			}),
		);
		expect(merged.fields).toEqual({
			a: { unique: true, index: true },
			b: { unique: true },
		});
		expect(merged.indexes).toEqual([
			{ fields: ["a"] },
			{ fields: ["b"], unique: true },
		]);
		expect(Object.keys((merged.schema as { shape: object }).shape)).toEqual([
			"a",
			"b",
		]);
		// An explicit later `false` still wins for that fact.
		expect(
			mergeModelMeta(
				meta({ fields: { a: { unique: true } } }),
				meta({ fields: { a: { unique: false } } }),
			).fields.a,
		).toEqual({ unique: false });
	});

	it("a mounted extension with attrs still widens a base storage in scope", async () => {
		// v2's pattern: the storage holds the BASE var; modules mount the
		// extension. Carrying $attrs must not change how it mounts.
		const store = v.storage(memoryAdapter(), { user });
		const run = v.fn(
			{ use: [{ user, userWithEmail, db: store }] },
			async (c) => {
				// Defaulted extension fields (`emailVerified`) are omittable;
				// required ones (`email`) are not - even though both are
				// `noInput`, which only bars wire callers.
				const created = await c.db.user.create({
					name: "Ada",
					email: "a@x.dev",
				});
				expectTypeOf(created.email).toEqualTypeOf<string>();
				expectTypeOf(created.emailVerified).toEqualTypeOf<boolean>();
				type CreateIn =
					typeof c.db.user extends Collection<any, any, infer C> ? C : never;
				expectTypeOf<CreateIn>().toEqualTypeOf<{
					id?: string | undefined;
					name: string;
					image?: string | null | undefined;
					createdAt?: Date | undefined;
					updatedAt?: Date | undefined;
					email: string;
					emailVerified?: boolean | undefined;
				}>();
				if (false as boolean) {
					// @ts-expect-error - `email` has no default.
					await c.db.user.create({ name: "No email" });
				}
				return c.db.user.findOne({ email: "a@x.dev" });
			},
		);
		expect(await run()).toMatchObject({ name: "Ada", email: "a@x.dev" });
	});
});
