import { describe, expect, expectTypeOf, it } from "vitest";
import { FnError, UnexpectedError, ValidationError, v } from "./index";

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

	it("output: { def } documents without an exit check", () => {
		const f = v.fn(
			"fnt.def",
			{ output: { def: v.object({ ok: v.boolean() }) } },
			() => ({ ok: "nope" }) as never,
		);
		expect(f()).toEqual({ ok: "nope" });
	});

	it("output: { def, validation } checks with the validation schema", () => {
		const make = (result: unknown) =>
			v.fn(
				"fnt.split",
				{
					output: {
						def: v.object({ ok: v.boolean(), note: v.string() }),
						validation: v.object({ ok: v.boolean() }),
					},
				},
				() => result as never,
			);
		// Passes validation while violating def: only validation runs.
		expect(make({ ok: true })()).toEqual({ ok: true });
		expect(() => make({ ok: "nope" })()).toThrow(/fnt\.split\.output/);
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
			c.fnt_counter = c.fnt_counter + 1;
			return c.fnt_counter;
		});
		const app = v.fn({ use: [core] });
		const entry = app.fn({ use: [{ writer }] }, async (c) => c.writer());
		await expect(entry()).resolves.toBe(1);
	});

	it("c.fn carries scope and key prefix", async () => {
		const parent = v.fn("fnt.parent", { use: [core] }, (c) => {
			const child = c.fn(".child", (cc) => cc.fnt_counter);
			return child.key;
		});
		expect(parent()).toBe("fnt.parent.child");
	});
});

describe("scope", () => {
	it("used fns share one scope down the tree", async () => {
		const set = v.fn("fnt.set", { use: [core] }, (c) => {
			c.fnt_session = { userId: "u1" };
		});
		const entry = v.fn({ use: [core, { set }] }).fn(async (c) => {
			await c.set();
			return c.fnt_session;
		});
		await expect(entry()).resolves.toEqual({ userId: "u1" });
	});

	it("root calls are isolated from each other", async () => {
		const bump = v.fn("fnt.iso", { use: [core] }, (c) => {
			c.fnt_counter = c.fnt_counter + 1;
			return c.fnt_counter;
		});
		expect(bump()).toBe(1);
		expect(bump()).toBe(1);
	});

	it("a GROUPED module member becomes a namespace on c", async () => {
		const set = v.fn("fnt.grp.set", { use: [core] }, (c) => {
			c.fnt_session = { userId: "grouped" };
		});
		const read = v.fn("fnt.grp.read", { use: [core] }, (c) => c.fnt_session);
		const entry = v.fn({ use: [core, { sess: { set, read } }] }, async (c) => {
			expectTypeOf(c.sess.read).toEqualTypeOf<
				() => { userId: string } | null
			>();
			await c.sess.set();
			return c.sess.read();
		});
		await expect(entry()).resolves.toEqual({ userId: "grouped" });
	});

	it("a var in a group is a live ALIAS under its export name", async () => {
		const entry = v.fn(
			{ use: [{ auth: { current: session, bump: counter } }] },
			(c) => {
				expectTypeOf(c.auth.current).toEqualTypeOf<{
					userId: string;
				} | null>();
				const before = c.auth.current;
				c.auth.current = { userId: "aliased" };
				c.auth.bump = c.auth.bump + 1;
				// The alias and the declared name are the SAME var.
				return [before, c.auth.current, c.fnt_session, c.auth.bump];
			},
		);
		expect(entry()).toEqual([
			null,
			{ userId: "aliased" },
			{ userId: "aliased" },
			1,
		]);
	});

	it("a var alias is readonly on a readonly fn", () => {
		const f = v.fn(
			"fnt.roAlias",
			{ readonly: true, use: [{ auth: { current: session } }] },
			(c) => {
				(c.auth as { current: unknown }).current = { userId: "x" };
			},
		);
		expect(() => f()).toThrow(/"fnt\.roAlias" is readonly/);
	});

	it(".with seeds a var through its group alias", async () => {
		const read = v.fn(
			{ use: [{ auth: { current: session } }] },
			(c) => c.auth.current,
		);
		expect(read.with({ auth: { current: { userId: "seeded" } } })()).toEqual({
			userId: "seeded",
		});
	});

	it("a grouped module's vars and on entries still mount", async () => {
		const seen: string[] = [];
		const watch = v.on("fnt.grp2.inner", async (_c, next) => {
			seen.push("intercepted");
			return next();
		});
		const inner = v.fn("fnt.grp2.inner", { use: [core] }, (c) => {
			c.fnt_session = { userId: "nested-var" };
			return c.fnt_session;
		});
		const entry = v.fn(
			{ use: [{ tools: { inner, watch, ...core } }] },
			async (c) => {
				const out = await c.tools.inner();
				return [out, c.fnt_session];
			},
		);
		await expect(entry()).resolves.toEqual([
			{ userId: "nested-var" },
			{ userId: "nested-var" },
		]);
		expect(seen).toEqual(["intercepted"]);
	});
});

describe("requires / provides", () => {
	it("requires throws at entry when the var is unset", () => {
		const f = v.fn(
			"fnt.needs",
			{ use: [core], requires: ["fnt_session"] },
			(c) => c.fnt_session.userId,
		);
		expect(() => f()).toThrow(/required var "fnt_session" is not set/);
	});

	it("requires narrows the var type", () => {
		v.fn("fnt.narrow", { use: [core], requires: ["fnt_session"] }, (c) => {
			expectTypeOf(c.fnt_session).toEqualTypeOf<{ userId: string }>();
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
				c.fnt_session = { userId: "u" };
			},
		);
		await expect(provider()).resolves.toBeNull();
	});

	it("the provides list is exposed", () => {
		const p = v.fn(
			"fnt.pl",
			{ use: [core], provides: ["fnt_session"] },
			(c) => {
				c.fnt_session = { userId: "u" };
			},
		);
		expect(p.provides).toEqual(["fnt_session"]);
	});
});

describe("readonly option", () => {
	it("locks direct writes", () => {
		const f = v.fn("fnt.ro", { readonly: true, use: [core] }, (c) => {
			(c as unknown as { fnt_counter: number }).fnt_counter = 9;
		});
		expect(() => f()).toThrow(/"fnt\.ro" is readonly/);
	});

	it("locks transitively - a nested normal fn cannot write", async () => {
		const deep = v.fn("fnt.deep", { use: [core] }, (c) => {
			c.fnt_counter = 9;
		});
		const read = v.fn(
			"fnt.roDeep",
			{ readonly: true, use: [core, { deep }] },
			async (c) => c.deep(),
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

describe("tuple input - positional args", () => {
	it("calls with one arg per position, validated per position", () => {
		const add = v.fn(
			{ input: [v.number(), v.number()] },
			(c) => c.input[0] + c.input[1],
		);
		expect(add(2, 3)).toBe(5);
		expect(() => add(2, "x" as never)).toThrow(ValidationError);
	});

	it("positions are typed, c.input is the parsed tuple", () => {
		const join = v.fn(
			{ input: [v.string(), v.number()] },
			(c) => `${c.input[0]}:${c.input[1]}`,
		);
		expectTypeOf(join("a", 1)).toEqualTypeOf<string>();
		expect(join("a", 1)).toBe("a:1");
	});

	it("position rules apply - a bad position names its index", () => {
		const f = v.fn(
			"fnt.pos",
			{ input: [v.string({ min: 3 })] },
			(c) => c.input[0],
		);
		expect(() => f("ab")).toThrow(/fnt\.pos\[0\]/);
	});

	it("used fns forward positional args and still share the scope", async () => {
		const bump = v.fn(
			"fnt.addBoth",
			{ input: [v.number(), v.number()], use: [core] },
			(c) => {
				c.fnt_counter = c.input[0] + c.input[1];
				return c.fnt_counter;
			},
		);
		const outer = v.fn({ use: [core, { bump }] }, (c) => c.bump(20, 22));
		expect(outer()).toBe(42);
	});
});

describe("fn as input schema", () => {
	it("whole input can be a fn - the value IS the fn", () => {
		const apply = v.fn({ input: v.fn({ input: { n: v.number() } }) }, (c) =>
			c.input({ n: 21 }),
		);
		expect(apply((i) => i.n * 2)).toBe(42);
		expectTypeOf(apply)
			.parameter(0)
			.parameter(0)
			.toEqualTypeOf<{ n: number }>();
	});

	it("refuses a non-function", () => {
		const apply = v.fn({ input: v.fn({ input: { n: v.number() } }) }, (c) =>
			c.input({ n: 1 }),
		);
		expect(() => apply("nope" as never)).toThrow(/expected function/);
	});

	it("a plain closure gets the declared input validated at its door", () => {
		const run = v.fn(
			"fnt.runner",
			{ input: { execute: v.fn({ input: { n: v.number() } }) } },
			(c) => c.input.execute({ n: "x" } as never),
		);
		expect(() => run({ execute: (i) => i.n })).toThrow(
			/fnt\.runner\.execute\(\)/,
		);
	});

	it("a branded fn passes through unwrapped and validates itself", () => {
		const target = v.fn(
			"fnt.target",
			{ input: { n: v.number() } },
			(c) => c.input.n + 1,
		);
		const run = v.fn(
			{ input: { execute: v.fn({ input: { n: v.number() } }) } },
			(c) => c.input.execute({ n: 1 }),
		);
		expect(run({ execute: target })).toBe(2);
	});

	it("composes with tuple input - a positional fn arg", () => {
		const call = v.fn(
			{ input: [v.string(), v.fn({ input: { n: v.number() } })] },
			(c) => `${c.input[0]}:${c.input[1]({ n: 2 })}`,
		);
		expect(call("out", (i) => i.n * 3)).toBe("out:6");
	});

	it("bare v.fn declares ANY function - only typeof is checked", () => {
		const run = v.fn({ input: { cb: v.fn } }, (c) => c.input.cb("x", 2));
		expect(run({ cb: (a: string, n: number) => a.repeat(n) })).toBe("xx");
		expect(() => run({ cb: 42 as never })).toThrow(/expected function/);
		expectTypeOf(run)
			.parameter(0)
			.toEqualTypeOf<{ readonly cb: (...args: any[]) => any }>();
	});

	it("v.fn.type declares a SIGNATURE and composes inline in schemas", () => {
		const store = v.var("fnt_store", {
			schema: v.object({
				user: v.object({
					create: v.fn.type({
						input: { id: v.string() },
						output: v.object({ id: v.string() }),
					}),
				}),
			}),
		});
		const good = v.fn({ input: { store }, use: [{ store }] }, (c) => {
			const s = c.fnt_store;
			expectTypeOf(s)
				.exclude<undefined>()
				.toHaveProperty("user")
				.toHaveProperty("create")
				.parameter(0)
				.toEqualTypeOf<{ id: string }>();
			return s?.user.create({ id: "7" });
		});
		expect(good({ store: { user: { create: (i) => i } } })).toEqual({
			id: "7",
		});
		expect(() => good({ store: { user: { create: 42 } } as never })).toThrow(
			/expected function/,
		);
	});

	it("customize toolkit carries fn", () => {
		const base = v.var("fnt_custom", { schema: v.object({}) });
		const widened = base.customize({
			schema: (t) =>
				t.add({ create: t.fn.type({ input: { id: v.string() } }) }),
		});
		const run = v.fn({ input: { fnt_custom: widened } }, (c) =>
			c.input.fnt_custom.create({ id: "1" }),
		);
		expect(run({ fnt_custom: { create: (i) => i.id } })).toBe("1");
	});
});

describe("fn schema var widening", () => {
	it("a customized re-export in scope widens a fn schema's var input", async () => {
		const wuser = v.var("fnt_wuser", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const wuserFull = wuser.customize({
			schema: (t) =>
				t.add({ email: t.string(), name: t.string({ optional: true }) }),
		});
		const wdb = v.var("fnt_wdb", {
			schema: v.object({
				createUser: v.fn.type({
					input: wuser,
					output: v.object({ id: v.string() }),
				}),
			}),
		});
		// The db declares against the BASE var; the app mounts the customized
		// re-export on the builder - the fn still sees the widened signature.
		const s = v.fn({ use: [{ wuser, wuserFull }] });
		const f = s.fn("fnt.widen", { use: [{ wdb }] }, async (c) => {
			const u = c.fnt_wuser;
			expectTypeOf(u).exclude<null>().toEqualTypeOf<{
				id: string;
				email: string;
				name?: string;
			}>();
			const d = c.fnt_wdb;
			expectTypeOf(d)
				.exclude<undefined>()
				.toHaveProperty("createUser")
				.parameter(0)
				.toEqualTypeOf<{ id: string; email: string; name?: string }>();
			return d?.createUser({ id: "1", email: "a@b.c" });
		});
		const impl = { createUser: async (i: { id: string }) => i };
		expect(await f.with({ fnt_wdb: impl })()).toEqual({
			id: "1",
			email: "a@b.c",
		});
	});

	it("a mounted v.extend widens a fn schema's var input the same way", () => {
		const xuser = v.var("fnt_xuser", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const withRole = v.extend(xuser, { role: v.string() });
		const xdb = v.var("fnt_xdb", {
			schema: v.object({ createUser: v.fn.type({ input: xuser }) }),
		});
		v.fn({ use: [{ withRole, xdb }] }, (c) => {
			expectTypeOf(c.fnt_xdb)
				.exclude<undefined>()
				.toHaveProperty("createUser")
				.parameter(0)
				.toEqualTypeOf<{ id: string; role: string }>();
		})();
	});

	it("a scope mounting nothing on the var leaves the signature alone", () => {
		const puser = v.var("fnt_puser", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const pdb = v.var("fnt_pdb", {
			schema: v.object({ createUser: v.fn.type({ input: puser }) }),
		});
		v.fn({ use: [{ pdb }] }, (c) => {
			expectTypeOf(c.fnt_pdb)
				.exclude<undefined>()
				.toHaveProperty("createUser")
				.parameter(0)
				.toEqualTypeOf<{ id: string }>();
		})();
	});
});

describe("declared errors", () => {
	const guard = v.fn(
		"fnt.guard",
		{
			input: { n: v.number() },
			errors: { too_big: { max: v.number() }, denied: {} },
		},
		(c) => {
			if (c.input.n > 10) throw c.error("too_big", { max: 10 });
			if (c.input.n < 0) throw c.error("denied");
			return c.input.n * 2;
		},
	);

	it("throws a tagged FnError with validated payload and trail", () => {
		try {
			guard({ n: 99 });
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(FnError);
			const err = thrown as FnError;
			expect(err.tag).toBe("too_big");
			expect(err.data).toEqual({ max: 10 });
			expect(err.trail).toEqual(["fnt.guard"]);
		}
	});

	it("an empty payload schema makes data optional", () => {
		expect(() => guard({ n: -1 })).toThrow(/fnt\.guard: denied/);
	});

	it("the payload is a contract - a bad one fails at mint", () => {
		const liar = v.fn(
			"fnt.liar",
			{ errors: { oops: { code: v.number() } } },
			(c) => {
				throw c.error("oops", { code: "not-a-number" } as never);
			},
		);
		expect(() => liar()).toThrow(/fnt\.liar\.errors\.oops\.code/);
	});

	it("an undeclared tag is refused at mint", () => {
		const rogue = v.fn("fnt.rogue", { errors: { known: {} } }, (c) => {
			throw (c.error as (tag: string) => Error)("unknown_tag");
		});
		expect(() => rogue()).toThrow(/not a declared error/);
	});

	it("untagged throws become UnexpectedError once errors are declared", () => {
		const buggy = v.fn("fnt.buggy", { errors: { nope: {} } }, () => {
			throw new TypeError("boom");
		});
		try {
			buggy();
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(UnexpectedError);
			expect((thrown as UnexpectedError).cause).toBeInstanceOf(TypeError);
			expect((thrown as Error).message).toMatch(/fnt\.buggy: unexpected/);
		}
	});

	it("no declared errors = raw throws pass untouched", () => {
		const plain = v.fn(() => {
			throw new TypeError("raw");
		});
		expect(() => plain()).toThrow(TypeError);
	});

	it("the trail collects every frame an error crosses", async () => {
		const inner = v.fn("fnt.trailInner", { errors: { denied: {} } }, (c) => {
			throw c.error("denied");
		});
		const outer = v.fn("fnt.trailOuter", { use: [{ inner }] }, (c) =>
			c.inner(),
		);
		try {
			outer();
			expect.unreachable();
		} catch (thrown) {
			expect((thrown as FnError).trail).toEqual([
				"fnt.trailInner",
				"fnt.trailOuter",
			]);
		}
	});

	it("tagged errors serialize as data - they survive a wire", () => {
		try {
			guard({ n: 99 });
			expect.unreachable();
		} catch (thrown) {
			expect(JSON.parse(JSON.stringify(thrown))).toEqual({
				name: "FnError",
				tag: "too_big",
				data: { max: 10 },
				trail: ["fnt.guard"],
			});
		}
	});
});

describe(".try", () => {
	const guard = v.fn(
		"fnt.tryGuard",
		{
			input: { n: v.number() },
			errors: { too_big: { max: v.number() } },
		},
		(c) => {
			if (c.input.n > 10) throw c.error("too_big", { max: 10 });
			return c.input.n * 2;
		},
	);

	it("success and declared failure as a narrowable result", () => {
		const ok = guard.try({ n: 2 });
		expect(ok).toEqual({ ok: true, value: 4 });

		const bad = guard.try({ n: 99 });
		expect(bad.ok).toBe(false);
		if (!bad.ok) {
			expect(bad.error.tag).toBe("too_big");
			expect(bad.error.data).toEqual({ max: 10 });
			expectTypeOf(bad.error.data).toEqualTypeOf<{ max: number }>();
		}
	});

	it("async fns resolve to the same result shape", async () => {
		const af = v.fn({ errors: { nope: {} } }, async (c) => {
			throw c.error("nope");
		});
		const result = await af.try();
		expect(result.ok).toBe(false);
	});

	it("defects still throw - only declared errors become results", () => {
		const buggy = v.fn({ errors: { nope: {} } }, () => {
			throw new Error("bug");
		});
		expect(() => buggy.try()).toThrow(UnexpectedError);
	});

	it("contract violations still throw too", () => {
		expect(() => guard.try({ n: "x" } as never)).toThrow(ValidationError);
	});

	it("a used fn that declares errors stays on c", async () => {
		const refuse = v.fn(
			"fnt.refuse",
			{ errors: { nope: { n: v.number() } } },
			(c) => {
				throw c.error("nope", { n: 1 });
			},
		);
		const wrap = v.fn({ use: [{ refuse }] }, async (c) => c.refuse());
		await expect(wrap()).rejects.toMatchObject({ tag: "nope" });
	});
});

describe("v.array", () => {
	it("validates every element against the declared type", () => {
		const f = v.fn(
			"fnt.arr",
			{ input: { tags: v.array(v.string({ min: 2 })) } },
			(c) => c.input.tags,
		);
		expect(f({ tags: ["ab", "cd"] })).toEqual(["ab", "cd"]);
		expectTypeOf(f)
			.parameter(0)
			.toHaveProperty("tags")
			.toEqualTypeOf<string[]>();
		expectTypeOf(f).returns.toEqualTypeOf<string[]>();
		expect(() => f({ tags: ["ab", 3] } as never)).toThrow(ValidationError);
		expect(() => f({ tags: "ab" } as never)).toThrow(/expected array/);
	});

	it("elements can be nested shapes, with defaults applied", () => {
		const f = v.fn(
			"fnt.arrShape",
			{
				input: {
					rows: v.array({ id: v.string(), n: v.number({ default: 1 }) }),
				},
			},
			(c) => c.input.rows,
		);
		expect(f({ rows: [{ id: "a" }, { id: "b", n: 5 }] })).toEqual([
			{ id: "a", n: 1 },
			{ id: "b", n: 5 },
		]);
	});

	it("no element type accepts any array as-is", () => {
		const f = v.fn(
			"fnt.arrAny",
			{ input: { xs: v.array() } },
			(c) => c.input.xs,
		);
		const mixed = [1, "a", null];
		expect(f({ xs: mixed })).toEqual(mixed);
		expect(() => f({ xs: {} } as never)).toThrow(/expected array/);
	});

	it("min/max/length count items; optional and default apply", () => {
		const f = v.fn(
			"fnt.arrRules",
			{ input: { xs: v.array(v.number(), { min: 1, max: 2 }) } },
			(c) => c.input.xs,
		);
		expect(f({ xs: [1] })).toEqual([1]);
		expect(() => f({ xs: [] })).toThrow(/at least 1/);
		expect(() => f({ xs: [1, 2, 3] })).toThrow(/at most 2/);

		const g = v.fn(
			"fnt.arrDef",
			{ input: { xs: v.array(v.number(), { default: [0] }) } },
			(c) => c.input.xs,
		);
		expect(g({})).toEqual([0]);

		const h = v.fn(
			"fnt.arrOpt",
			{ input: { xs: v.array(v.number(), { optional: true }) } },
			(c) => c.input.xs,
		);
		expect(h({})).toBeUndefined();
	});
});

describe("multi-issue validation", () => {
	it("every bad field reports together", () => {
		const f = v.fn(
			"fnt.multi",
			{ input: { a: v.string(), b: v.number(), c: v.boolean() } },
			(c) => c.input,
		);
		try {
			f({ a: 1, b: "x", c: true } as never);
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(ValidationError);
			const err = thrown as ValidationError;
			expect(err.issues).toHaveLength(2);
			expect(err.message).toMatch(/fnt\.multi\.a.*fnt\.multi\.b/s);
		}
	});

	it("every bad array element reports together", () => {
		const f = v.fn(
			"fnt.multiArr",
			{ input: { tags: v.array(v.string()) } },
			(c) => c.input.tags,
		);
		try {
			f({ tags: [1, "ok", true] } as never);
			expect.unreachable();
		} catch (thrown) {
			const err = thrown as ValidationError;
			expect(err.issues.map((issue) => issue.path)).toEqual([
				"fnt.multiArr.tags[0]",
				"fnt.multiArr.tags[2]",
			]);
		}
	});

	it("every bad tuple position reports together", () => {
		const f = v.fn(
			"fnt.multiPos",
			{ input: [v.string(), v.number()] },
			(c) => c.input,
		);
		try {
			f(1 as never, "x" as never);
			expect.unreachable();
		} catch (thrown) {
			const err = thrown as ValidationError;
			expect(err.issues.map((issue) => issue.path)).toEqual([
				"fnt.multiPos[0]",
				"fnt.multiPos[1]",
			]);
		}
	});
});
