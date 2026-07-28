import { describe, expect, it } from "vitest";
import { v } from "./index";

describe("vars", () => {
	const note = v.var("vt_note", { default: "" });

	it("seed from defaults, write per scope", () => {
		const f = v.fn({ use: [{ note }] }, (c) => {
			const before = c.var.vt_note.get();
			c.var.vt_note.set("x");
			return [before, c.var.vt_note.get()];
		});
		expect(f()).toEqual(["", "x"]);
	});

	it("assignment is rejected loudly - handles only", () => {
		const f = v.fn({ use: [{ note }] }, (c) => {
			(c.var as { vt_note: unknown }).vt_note = "x";
		});
		expect(() => f()).toThrow(/use c\.var\.vt_note\.set/);
	});
});

describe("derived vars", () => {
	const src = v.var("vt_src", { default: null as { n: number } | null });
	const dbl = v.derive("vt_dbl", src, (s) => s.n * 2);
	const mods = { src, dbl };

	it("computes lazily from the current source, null when unset", () => {
		const f = v.fn({ use: [mods] }, (c) => {
			const before = c.var.vt_dbl.get();
			c.var.vt_src.set({ n: 21 });
			return [before, c.var.vt_dbl.get()];
		});
		expect(f()).toEqual([null, 42]);
	});

	it("a direct write shadows the computation for that scope", () => {
		const f = v.fn({ use: [mods] }, (c) => {
			c.var.vt_src.set({ n: 1 });
			c.var.vt_dbl.set(999);
			return c.var.vt_dbl.get();
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
		const f = v.fn({ input: profile, use: [{ profile }] }, (c) =>
			c.var.vt_profile.get(),
		);
		expect(f({ id: "p1" })).toEqual({ id: "p1" });
		expect(() => f({ id: 5 } as never)).toThrow(/expected string/);
	});

	it("a var used as a FIELD sets the var from that field", () => {
		const f = v.fn({ input: { who: profile }, use: [{ profile }] }, (c) =>
			c.var.vt_profile.get(),
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
		const f = v.fn({ input: account, use: [{ account, withTag }] }, (c) =>
			c.var.vt_account.get(),
		);
		expect(f({ id: "a", tag: "vip" } as never)).toEqual({
			id: "a",
			tag: "vip",
		});
		expect(() => f({ id: "a" })).toThrow(/vt_account/);
	});

	it("unmounted, nothing changes", () => {
		const f = v.fn({ input: account, use: [{ account }] }, (c) =>
			c.var.vt_account.get(),
		);
		expect(f({ id: "a" })).toEqual({ id: "a" });
	});
});

describe("record vars", () => {
	const draft = v.record("vt_draft", {
		schema: v.object({ title: v.string(), body: v.string() }),
	});

	it("accumulates across fns in one scope", async () => {
		const addTitle = v.fn("vt.t", { use: [{ draft }] }, (c) => {
			c.var.vt_draft.set({ title: "hi" });
		});
		const entry = v.fn({ use: [{ draft }, { addTitle }] }).fn(async (c) => {
			await c.use.addTitle();
			c.var.vt_draft.set({ body: "there" });
			return c.var.vt_draft.get();
		});
		await expect(entry()).resolves.toEqual({ title: "hi", body: "there" });
	});
});
