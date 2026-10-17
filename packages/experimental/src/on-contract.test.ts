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
