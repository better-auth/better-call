import { describe, expect, expectTypeOf, it } from "vitest";
import { ValidationError, v } from "./index";

const session = v.var("fnt_session", {
	default: null as { userId: string } | null,
});
const counter = v.var("fnt_counter", { default: 0 });
const core = { session, counter };

describe("v.fn call forms", () => {
	it("bare handler", async () => {
		const f = v.fn(() => 42);
		expect(f()).toBe(42);
	});

	it("key + handler exposes the key", () => {
		const f = v.fn("fnt.keyed", () => "ok");
		expect(f.key).toBe("fnt.keyed");
	});

	it("options + handler validates input", async () => {
		const f = v.fn({ input: { n: v.number() } }, (c) => c.input.n * 2);
		expect(f({ n: 21 })).toBe(42);
		expect(() => f({ n: "x" } as never)).toThrow(ValidationError);
	});

	it("sync handlers stay sync, async stay async", async () => {
		const sync = v.fn({ input: { n: v.number() } }, (c) => c.input.n);
		const asy = v.fn({ input: { n: v.number() } }, async (c) => c.input.n);
		expect(sync({ n: 1 })).toBe(1);
		await expect(asy({ n: 1 })).resolves.toBe(1);
	});

	it("output contract is enforced", async () => {
		const f = v.fn(
			"fnt.out",
			{ output: v.object({ ok: v.boolean() }) },
			() => ({ ok: "nope" }) as never,
		);
		expect(() => f()).toThrow(/fnt\.out\.output/);
	});
});

describe("builder", () => {
	it("keys concatenate down the chain", () => {
		const leaf = v
			.fn("a", {})
			.fn(".b", {})
			.fn(".c", () => null);
		expect(leaf.key).toBe("a.b.c");
		expectTypeOf(leaf.key).toEqualTypeOf<"a.b.c">();
	});

	it("a handler terminates: no .fn on a defined fn", () => {
		const f = v.fn(() => null);
		expect((f as { fn?: unknown }).fn).toBeUndefined();
	});

	it("builder options merge - use accumulates", async () => {
		const writer = v.fn("fnt.bump", { use: [core] }, (c) => {
			c.var.fnt_counter += 1;
			return c.var.fnt_counter;
		});
		const app = v.fn({ use: [core] });
		const entry = app.fn({ use: [{ writer }] }, async (c) => c.use.writer());
		await expect(entry()).resolves.toBe(1);
	});

	it("c.fn carries scope and key prefix", async () => {
		const parent = v.fn("fnt.parent", { use: [core] }, (c) => {
			const child = c.fn(".child", (cc) => cc.var.fnt_counter);
			return child.key;
		});
		expect(parent()).toBe("fnt.parent.child");
	});
});

describe("scope", () => {
	it("c.use shares one scope down the tree", async () => {
		const set = v.fn("fnt.set", { use: [core] }, (c) => {
			c.var.fnt_session = { userId: "u1" };
		});
		const entry = v.fn({ use: [core, { set }] }).fn(async (c) => {
			await c.use.set();
			return c.var.fnt_session;
		});
		await expect(entry()).resolves.toEqual({ userId: "u1" });
	});

	it("root calls are isolated from each other", async () => {
		const bump = v.fn("fnt.iso", { use: [core] }, (c) => {
			c.var.fnt_counter += 1;
			return c.var.fnt_counter;
		});
		expect(bump()).toBe(1);
		expect(bump()).toBe(1);
	});
});

describe("requires / provides", () => {
	it("requires throws at entry when the var is unset", () => {
		const f = v.fn(
			"fnt.needs",
			{ use: [core], requires: ["fnt_session"] },
			(c) => c.var.fnt_session.userId,
		);
		expect(() => f()).toThrow(/required var "fnt_session" is not set/);
	});

	it("requires narrows the var type", () => {
		v.fn("fnt.narrow", { use: [core], requires: ["fnt_session"] }, (c) => {
			expectTypeOf(c.var.fnt_session).toEqualTypeOf<{ userId: string }>();
			return null;
		});
	});

	it("provides throws when the body ran but did not deliver", () => {
		const liar = v.fn(
			"fnt.liar",
			{ use: [core], provides: ["fnt_session"] },
			() => null,
		);
		expect(() => liar()).toThrow(/declared to provide "fnt_session"/);
	});

	it("a vetoing interceptor waives provides", async () => {
		const cut = v.on("fnt.provider", async () => null);
		const provider = v.fn(
			"fnt.provider",
			{ use: [core, { cut }], provides: ["fnt_session"] },
			(c) => {
				c.var.fnt_session = { userId: "u" };
			},
		);
		await expect(provider()).resolves.toBeNull();
	});

	it("the provides list is exposed", () => {
		const p = v.fn(
			"fnt.pl",
			{ use: [core], provides: ["fnt_session"] },
			(c) => {
				c.var.fnt_session = { userId: "u" };
			},
		);
		expect(p.provides).toEqual(["fnt_session"]);
	});
});

describe("readonly option", () => {
	it("locks direct writes", () => {
		const f = v.fn("fnt.ro", { readonly: true, use: [core] }, (c) => {
			(c.var as { fnt_counter: number }).fnt_counter = 9;
		});
		expect(() => f()).toThrow(/"fnt\.ro" is readonly/);
	});

	it("locks transitively - a nested normal fn cannot write", async () => {
		const deep = v.fn("fnt.deep", { use: [core] }, (c) => {
			c.var.fnt_counter = 9;
		});
		const read = v.fn(
			"fnt.roDeep",
			{ readonly: true, use: [core, { deep }] },
			async (c) => c.use.deep(),
		);
		await expect(read()).rejects.toThrow(/"fnt\.roDeep" is readonly/);
	});

	it("readonly + provides is rejected at definition", () => {
		expect(() =>
			v.fn(
				"fnt.roLiar",
				{ readonly: true, provides: ["fnt_session"], use: [core] },
				() => null,
			),
		).toThrow(/cannot declare provides/);
	});

	it("readonly + var-bound input is rejected at definition", () => {
		expect(() =>
			v.fn("fnt.roInput", { readonly: true, input: session }, () => null),
		).toThrow(/cannot bind input to vars/);
	});
});
