import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "./index";

describe("next({ input }) hands inner layers a different input", () => {
	const double = v.fn("oc.double", { input: { n: v.number() } }, (c) => {
		return c.input.n * 2;
	});

	it("inner hooks and the body see the new input; the outer c.input does not change", async () => {
		const seen: number[] = [];
		const outer = v.on(double, async (c, next) => {
			const result = await next({ input: { n: c.input.n + 1 } });
			seen.push(c.input.n);
			return result;
		});
		const inner = v.on(double, async (c, next) => {
			seen.push(c.input.n);
			return next();
		});
		const app = v.fn("oc.app", { use: [{ outer, inner }] }, (c) =>
			double({ n: 1 }, c),
		);
		expect(await app()).toBe(4);
		expect(seen).toEqual([2, 1]);
	});

	it("next() without an argument passes the input on as is", async () => {
		const pass = v.on(double, (_c, next) => next());
		const app = v.fn("oc.app", { use: [{ pass }] }, (c) => double({ n: 5 }, c));
		expect(await app()).toBe(10);
	});

	it("the override is typed as the fn's input", () => {
		v.on(double, (_c, next) => {
			expectTypeOf(next).toBeCallableWith({ input: { n: 1 } });
			// @ts-expect-error - n must be a number
			return next({ input: { n: "1" } });
		});
	});

	it("string and pattern hooks can override too", async () => {
		const bump = v.on("oc.*", (c, next) =>
			next({ input: { ...c.input, n: 10 } }),
		);
		const app = v.fn("oc.app", { use: [{ bump }] }, (c) => double({ n: 1 }, c));
		expect(await app()).toBe(20);
	});
});

describe("{ local: true } hooks stay with the fn that mounts them", () => {
	it("a local hook runs for its own fn, not for fns it calls", async () => {
		const log: string[] = [];
		const inner = v.fn("ol.inner", () => "inner");
		const spy = v.on(
			"ol.*",
			async (c, next) => {
				log.push(c.fnKey);
				return next();
			},
			{ local: true },
		);
		const outer = v.fn("ol.outer", { use: [{ spy }] }, (c) =>
			inner(undefined, c),
		);
		await outer();
		expect(log).toEqual(["ol.outer"]);
	});

	it("a module of local quirks mounted at the root doesn't hoist them outside the app's hooks", async () => {
		const log: string[] = [];
		const quirk = v.on(
			"ol.step",
			async (_c, next) => {
				log.push("quirk");
				return next();
			},
			{ local: true },
		);
		const quirks = { quirk };
		const step = v.fn("ol.step", { use: [quirks] }, () => {
			log.push("body");
			return "ok";
		});
		const appHook = v.on("ol.step", async (_c, next) => {
			log.push("app");
			return next();
		});
		// The provider module (with its quirks) mounted at the root too.
		const root = v.fn("ol.root", { use: [quirks, { appHook }] }, (c) =>
			step(undefined, c),
		);
		await root();
		expect(log).toEqual(["app", "quirk", "body"]);
	});

	it("local var.set hooks watch only the mounting frame's writes", async () => {
		const note = v.var("ol_note", { default: "" });
		const seen: string[] = [];
		const watch = v.on(
			"var.set.ol_note",
			(c, next) => {
				seen.push(String(c.value));
				next();
			},
			{ local: true },
		);
		const child = v.fn("ol.child", { use: [{ note }] }, (c) => {
			c.ol_note = "child";
		});
		const parent = v.fn("ol.parent", { use: [{ note, watch }] }, async (c) => {
			c.ol_note = "parent";
			await child(undefined, c);
		});
		await parent();
		expect(seen).toEqual(["parent"]);
	});
});

describe("v.on(fnRef) contexts are typed from the target fn", () => {
	const user = v.var("ot_user", { default: null as { id: string } | null });
	const guard = v.fn(
		"ot.guard",
		{
			input: { n: v.number() },
			errors: { too_big: { max: v.number() } },
			use: [{ user }],
		},
		(c) => c.input.n,
	);

	it("c.error mints the target's declared tags, payloads checked", async () => {
		const veto = v.on(guard, async (c) => {
			expectTypeOf(c.fnKey).toEqualTypeOf<"ot.guard">();
			// Type-only: these would throw at runtime.
			const _unchecked = () => {
				// @ts-expect-error - not a declared tag of ot.guard
				c.error("nope");
				// @ts-expect-error - payload must match the declared schema
				c.error("too_big", { max: "1" });
			};
			throw c.error("too_big", { max: 3 });
		});
		const app = v.fn("ot.app", { use: [{ veto }] }, (c) => guard({ n: 9 }, c));
		await expect(app()).rejects.toMatchObject({
			tag: "too_big",
			data: { max: 3 },
		});
	});

	it("vars the target mounts are typed; others read as unknown", () => {
		v.on(guard, (c, next) => {
			expectTypeOf(c.ot_user).toEqualTypeOf<{ id: string } | null>();
			expectTypeOf(c.somethingElse).toEqualTypeOf<unknown>();
			return next();
		});
	});
});

describe("WithSeedFor types .with() and hooks on hand-declared fn types", () => {
	const oauthFetch = v.var("ot_fetch", {
		default: (async () => new Response("real")) as (
			url: string,
		) => Promise<Response>,
	});
	const runtime = { oauthFetch };
	const errors = { failed: {} };
	type Exchange = import("./index").FnDefination<
		{ code: string },
		Promise<string>,
		"ot.exchange",
		{ code: ReturnType<typeof v.string> },
		readonly string[],
		typeof errors,
		import("./index").WithSeedFor<[typeof runtime]>
	>;
	const exchange: Exchange = v.fn(
		"ot.exchange",
		{ input: { code: v.string() }, errors, use: [runtime] },
		async (c) => (await c.ot_fetch(c.input.code)).text(),
	);

	it(".with seeds are checked against the declared modules, no cast", async () => {
		const mock = async () => new Response("mock");
		expect(await exchange.with({ ot_fetch: mock })({ code: "x" })).toBe("mock");
		// @ts-expect-error - not a var or fn of the declared modules
		exchange.with({ nope: 1 });
		// @ts-expect-error - wrong value type for the var
		exchange.with({ ot_fetch: 42 });
	});

	it("v.on on the hand-declared type sees its vars and errors", () => {
		v.on(exchange, (c, next) => {
			expectTypeOf(c.ot_fetch).toEqualTypeOf<
				(url: string) => Promise<Response>
			>();
			const _unchecked = () => {
				// @ts-expect-error - not a declared tag
				c.error("other");
			};
			return next();
		});
	});
});
