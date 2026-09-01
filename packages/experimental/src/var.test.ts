import { describe, expect, expectTypeOf, it } from "vitest";
import { memoryAdapter, v } from "./index";

describe("vars", () => {
	const note = v.var("vt_note", { default: "" });

	it("seed from defaults, write per scope", () => {
		const f = v.fn({ use: [{ note }] }, (c) => {
			const before = c.vt_note;
			c.vt_note = "x";
			return [before, c.vt_note];
		});
		expect(f()).toEqual(["", "x"]);
	});

	it("assignment on a readonly frame is rejected loudly", () => {
		const f = v.fn("vt.ro", { readonly: true, use: [{ note }] }, (c) => {
			(c as { vt_note: unknown }).vt_note = "x";
		});
		expect(() => f()).toThrow(/"vt\.ro" is readonly/);
	});
});

describe("derived vars", () => {
	const src = v.var("vt_src", { default: null as { n: number } | null });
	const dbl = v.derive("vt_dbl", src, (s) => s.n * 2);
	const mods = { src, dbl };

	it("computes lazily from the current source, null when unset", () => {
		const f = v.fn({ use: [mods] }, (c) => {
			const before = c.vt_dbl;
			c.vt_src = { n: 21 };
			return [before, c.vt_dbl];
		});
		expect(f()).toEqual([null, 42]);
	});

	it("a direct write shadows the computation for that scope", () => {
		const f = v.fn({ use: [mods] }, (c) => {
			c.vt_src = { n: 1 };
			c.vt_dbl = 999;
			return c.vt_dbl;
		});
		expect(f()).toBe(999);
	});
});

describe("var-bound input", () => {
	const profile = v.var("vt_profile", {
		default: null as { id: string } | null,
		schema: v.object({ id: v.string() }),
	});

	it("whole-var input validates and sets the var", () => {
		const f = v.fn({ input: profile, use: [{ profile }] }, (c) => c.vt_profile);
		expect(f({ id: "p1" })).toEqual({ id: "p1" });
		expect(() => f({ id: 5 } as never)).toThrow(/expected string/);
	});

	it("a var used as a FIELD sets the var from that field", () => {
		const f = v.fn(
			{ input: { who: profile }, use: [{ profile }] },
			(c) => c.vt_profile,
		);
		expect(f({ who: { id: "p2" } })).toEqual({ id: "p2" });
	});
});

describe("var extensions", () => {
	const account = v.var("vt_account", {
		default: null as { id: string } | null,
		schema: v.object({ id: v.string() }),
	});
	const withTag = v.extend(account, { tag: v.string() });

	it("mounted extensions widen a var-bound input at runtime", () => {
		const f = v.fn({ input: account, use: [{ account, withTag }] }, (c) => {
			expectTypeOf(c.input).toEqualTypeOf<{ id: string; tag: string }>();
			return c.vt_account;
		});
		expectTypeOf(f).parameter(0).toEqualTypeOf<{ id: string; tag: string }>();
		expect(f({ id: "a", tag: "vip" })).toEqual({
			id: "a",
			tag: "vip",
		});
		// @ts-expect-error tag required once withTag is mounted
		expect(() => f({ id: "a" })).toThrow(/vt_account/);
	});

	it("unmounted, nothing changes", () => {
		const f = v.fn({ input: account, use: [{ account }] }, (c) => {
			expectTypeOf(c.input).toEqualTypeOf<{ id: string }>();
			return c.vt_account;
		});
		expectTypeOf(f).parameter(0).toEqualTypeOf<{ id: string }>();
		expect(f({ id: "a" })).toEqual({ id: "a" });
	});

	it("builder-mounted extensions widen a later input: var the same way", () => {
		const s = v.fn({ use: [{ account, withTag }] });
		const f = s.fn({ input: account }, (c) => {
			expectTypeOf(c.input).toEqualTypeOf<{ id: string; tag: string }>();
			return c.input;
		});
		expectTypeOf(f).parameter(0).toEqualTypeOf<{ id: string; tag: string }>();
		expect(f({ id: "b", tag: "gold" })).toEqual({ id: "b", tag: "gold" });
	});
});

describe("record vars", () => {
	const draft = v.record("vt_draft", {
		schema: v.object({ title: v.string(), body: v.string() }),
	});

	it("accumulates across fns in one scope", async () => {
		const addTitle = v.fn("vt.t", { use: [{ draft }] }, (c) => {
			c.vt_draft = { title: "hi" };
		});
		const entry = v.fn({ use: [{ draft }, { addTitle }] }).fn(async (c) => {
			await c.addTitle();
			c.vt_draft = { body: "there" };
			return c.vt_draft;
		});
		await expect(entry()).resolves.toEqual({ title: "hi", body: "there" });
	});
});

describe("merge vars", () => {
	it("use modules merge helpers onto a storage default under the same key", async () => {
		const row = v.var("vt_merge_row", {
			default: null,
			schema: v.object({ id: v.string(), tag: v.string() }),
		});
		const store = v.storage(memoryAdapter(), { row });
		const db = v.var("vt_merge_db", {
			merge: true,
			default: store,
		});
		const byTag = v.fn(
			"vt.merge.byTag",
			{
				input: { tag: v.string() },
				use: [{ db, row }],
			},
			async (c) => c.vt_merge_db.row.findMany({ tag: c.input.tag }),
		);
		const core = { db, row };
		const plugin = { db: { byTag } };
		const entry = v.fn({ use: [core, plugin] }, async (c) => {
			await c.vt_merge_db.row.create({ id: "1", tag: "a" });
			await c.vt_merge_db.row.create({ id: "2", tag: "b" });
			return c.vt_merge_db.byTag({ tag: "a" });
		});
		await expect(entry()).resolves.toEqual([{ id: "1", tag: "a" }]);
	});

	it("later use module wins on a conflicting helper key", async () => {
		const base = v.var("vt_merge_obj", {
			merge: true,
			default: { n: 0, from: "base" },
		});
		const first = v.fn("vt.merge.first", () => "first");
		const second = v.fn("vt.merge.second", () => "second");
		const entry = v.fn(
			{
				use: [{ obj: base }, { obj: { who: first } }, { obj: { who: second } }],
			},
			// Conflicting same-key helpers collapse to `never` under
			// UnionToIntersection; runtime still last-wins via collectMergeSeeds.
			(c) => (c.vt_merge_obj as { who: () => string }).who(),
		);
		expect(entry()).toBe("second");
	});

	it("same-key namespace helpers are typed on the merge var", async () => {
		const db = v.var("db", {
			merge: true,
			default: { storage: true as const },
		});
		const createUser = v.fn(
			"db.create_user",
			{
				input: { id: v.string() },
				output: v.object({ id: v.string() }),
			},
			(c) => c.input,
		);
		const e = v.fn("auth.", {
			use: [{ db }, { db: { createUser } }] as const,
		});
		const signUp = e.fn("sign_up", async (c) => {
			expectTypeOf(c.db).toHaveProperty("storage");
			expectTypeOf(c.db).toHaveProperty("createUser");
			expectTypeOf(c.db.createUser).toBeCallableWith({ id: "1" });
			return c.db.createUser({ id: "1" });
		});
		await expect(signUp()).resolves.toEqual({ id: "1" });
	});

	it("helpers are typed on the declared name when export key differs", async () => {
		const store = v.var("vt_alias_db", {
			merge: true,
			default: { storage: true as const },
		});
		const ping = v.fn("vt.alias.ping", () => "pong" as const);
		v.fn({ use: [{ db: store }, { db: { ping } }] as const }, (c) => {
			expectTypeOf(c.vt_alias_db).toHaveProperty("ping");
			expectTypeOf(c.db).toHaveProperty("ping");
			return c.vt_alias_db.ping();
		});
	});
});
