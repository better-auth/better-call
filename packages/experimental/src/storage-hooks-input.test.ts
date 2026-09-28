import { describe, expect, it } from "vitest";
import { memoryAdapter, ValidationError, v } from "./index";
import { db, schema } from "./plugins/db";

const now = () => new Date(0);

const user = schema("hk_user", {
	id: db.id(v.string()),
	name: v.string(),
	role: v.string({ default: "member" }),
	createdAt: v.date({ default: now }),
});

describe("create hooks see the caller's data", () => {
	it("defaults and ids are absent in args, present in the result", async () => {
		const seen: unknown[] = [];
		const results: unknown[] = [];
		const store = v
			.storage(memoryAdapter(), { user })
			.$on("user.create", async (c, next) => {
				seen.push({ ...(c.args[0] as object) });
				const out = await next();
				results.push(out);
				return out;
			});
		await store.user.create({ name: "Ada" });
		// Better Auth's `databaseHooks.user.create.before` sees exactly this.
		expect(seen).toEqual([{ name: "Ada" }]);
		expect(results[0]).toMatchObject({
			name: "Ada",
			role: "member",
			createdAt: new Date(0),
		});
		expect(typeof (results[0] as { id: unknown }).id).toBe("string");
	});

	it("what a hook merges into args is validated and defaulted after it", async () => {
		const store = v
			.storage(memoryAdapter(), { user })
			.$on("user.create", (c, next) => {
				const args = c.args as unknown[];
				args[0] = { ...(args[0] as object), role: "admin", extra: "kept" };
				return next();
			});
		const created = await store.user.create({ name: "Grace" });
		expect(created).toMatchObject({ name: "Grace", role: "admin" });
		expect((created as Record<string, unknown>).extra).toBe("kept");
		expect(typeof created.id).toBe("string");

		const bad = v
			.storage(memoryAdapter(), { user })
			.$on("user.create", (c, next) => {
				(c.args as unknown[])[0] = { name: 42 };
				return next();
			});
		await expect(bad.user.create({ name: "x" })).rejects.toBeInstanceOf(
			ValidationError,
		);
	});

	it("a hook that never calls next vetoes before any default runs", async () => {
		let minted = 0;
		const counted = schema("hk_counted", {
			id: v.string({
				default: () => {
					minted++;
					return "id";
				},
			}),
		});
		const store = v
			.storage(memoryAdapter(), { counted })
			.$on("counted.create", () => null);
		expect(await store.counted.create({})).toBeNull();
		expect(minted).toBe(0);
		expect(await store.counted.count()).toBe(0);
	});

	it("without hooks an invalid create still throws at the call site", () => {
		// No async defaults (db.id's generator is async), so validation is sync.
		const plain = schema("hk_plain", { name: v.string() });
		const store = v.storage(memoryAdapter(), { plain });
		expect(() => store.plain.create({ name: 1 } as never)).toThrow(
			ValidationError,
		);
		try {
			store.plain.create({ name: 1 } as never);
		} catch (thrown) {
			// The stack starts at the caller, not inside storage.
			expect((thrown as Error).stack).toContain("storage-hooks-input.test");
		}
	});
});
