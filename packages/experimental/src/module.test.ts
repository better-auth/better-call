import { describe, expect, it } from "vitest";
import { v } from "./index";
import { readOnly } from "./plugins/read-only";

const flag = v.var("plt_flag", { default: 0 });
const core = { flag };

describe("on matching", () => {
	it("exact, wildcard, path and regex targets fire; others do not", async () => {
		const log: string[] = [];
		const hooks = {
			exact: v.on("plt.one", async (_c, next) => {
				log.push("exact");
				return next();
			}),
			wild: v.on("plt.*", async (_c, next) => {
				log.push("wild");
				return next();
			}),
			path: v.on("/plt/*", async (_c, next) => {
				log.push("path");
				return next();
			}),
			rx: v.on(/two$/, async (_c, next) => {
				log.push("rx");
				return next();
			}),
		};
		await v.fn("plt.one", { use: [hooks] }, () => "1")();
		await v.fn("plt.two", { use: [hooks] }, () => "2")();
		await v.fn("/plt/x", { use: [hooks] }, () => "3")();
		await v.fn("elsewhere", { use: [hooks] }, () => "4")();
		expect(log).toEqual(["exact", "wild", "wild", "rx", "path"]);
	});

	it("interceptors nest in mount order - first is outermost", async () => {
		const log: string[] = [];
		const hooks = {
			a: v.on("plt.order", async (_c, next) => {
				log.push("a:in");
				const r = await next();
				log.push("a:out");
				return r;
			}),
			b: v.on("plt.order", async (_c, next) => {
				log.push("b:in");
				const r = await next();
				log.push("b:out");
				return r;
			}),
		};
		await v.fn("plt.order", { use: [hooks] }, () => {
			log.push("body");
			return "r";
		})();
		expect(log).toEqual(["a:in", "b:in", "body", "b:out", "a:out"]);
	});

	it("an ARRAY of targets mounts one handler on several events", async () => {
		const log: string[] = [];
		const both = v.on(["plt.first", "plt.sec*"], async (_c, next) => {
			log.push("hit");
			return next();
		});
		await v.fn("plt.first", { use: [{ both }] }, () => 1)();
		await v.fn("plt.second", { use: [{ both }] }, () => 2)();
		await v.fn("plt.other", { use: [{ both }] }, () => 3)();
		expect(log).toEqual(["hit", "hit"]);
	});

	it("a veto (no next) replaces the result", async () => {
		const cut = v.on("plt.cut", async () => "vetoed");
		await expect(
			v.fn("plt.cut", { use: [{ cut }] }, () => "body")(),
		).resolves.toBe("vetoed");
	});
});

describe("on input extensions", () => {
	it("extension fields validate and land on c.input", async () => {
		const seen: unknown[] = [];
		const ext = v.on(
			"plt.ext",
			{ input: { ref: v.string() } },
			async (c, next) => {
				seen.push(c.input.ref);
				return next();
			},
		);
		const f = v.fn(
			"plt.ext",
			{ input: { id: v.string() }, use: [{ ext }] },
			(c) => c.input,
		);
		await expect(f({ id: "a", ref: "friend" } as never)).resolves.toMatchObject(
			{ id: "a", ref: "friend" },
		);
		expect(seen).toEqual(["friend"]);
		await expect(async () => f({ id: "a" })).rejects.toThrow(
			/plt\.ext\.on\.ref/,
		);
	});
});

describe("var.set events", () => {
	it("fires with name, value and frame; next() applies the write", () => {
		const seen: string[] = [];
		const watch = v.on("var.set.plt_flag", (c, next) => {
			seen.push(`${c.name}=${c.value}@${c.fn}`);
			next();
		});
		const f = v.fn("plt.writer", { use: [core, { watch }] }, (c) => {
			c.plt_flag = 7;
			return c.plt_flag;
		});
		expect(f()).toBe(7);
		expect(seen).toEqual(["plt_flag=7@plt.writer"]);
	});

	it("skipping next() cancels the write", () => {
		const veto = v.on("var.set.plt_flag", () => {});
		const f = v.fn({ use: [core, { veto }] }, (c) => {
			c.plt_flag = 9;
			return c.plt_flag;
		});
		expect(f()).toBe(0);
	});

	it("async var-set handlers are rejected loudly", () => {
		const lazy = v.on("var.set.*", (async (_c: unknown, next: () => void) =>
			next()) as never);
		const f = v.fn({ use: [core, { lazy }] }, (c) => {
			c.plt_flag = 1;
		});
		expect(() => f()).toThrow(/must be synchronous/);
	});

	it('the bare "*" fn wildcard does not fire on var writes', () => {
		const calls: string[] = [];
		const all = v.on("*", async (_c, next) => {
			calls.push("fn");
			return next();
		});
		const f = v.fn({ use: [core, { all }] }, (c) => {
			c.plt_flag = 3;
		});
		f();
		expect(calls).toEqual(["fn"]);
	});
});

describe("var.get events", () => {
	it("wraps handle reads: next() yields the stored value, the return IS the read", () => {
		const seen: string[] = [];
		const watch = v.on("var.get.plt_flag", (c, next) => {
			const value = next();
			seen.push(`${c.name}=${value}@${c.fn}`);
			return (value as number) + 1;
		});
		const f = v.fn("plt.reader", { use: [core, { watch }] }, (c) => {
			c.plt_flag = 7;
			return c.plt_flag;
		});
		expect(f()).toBe(8);
		expect(seen).toEqual(["plt_flag=7@plt.reader"]);
	});

	it("internal reads stay raw: reading vars inside the handler does not recurse", () => {
		let sawInHandler: unknown;
		const spy = v.on("var.get.plt_flag", (c, next) => {
			sawInHandler = c.plt_flag;
			return next();
		});
		const f = v.fn({ use: [core, { spy }] }, (c) => {
			c.plt_flag = 5;
			return c.plt_flag;
		});
		expect(f()).toBe(5);
		expect(sawInHandler).toBe(5);
	});

	it("async var-get handlers are rejected loudly", () => {
		const lazy = v.on("var.get.*", (async (_c: unknown, next: () => unknown) =>
			next()) as never);
		const f = v.fn({ use: [core, { lazy }] }, (c) => c.plt_flag);
		expect(() => f()).toThrow(/must be synchronous/);
	});

	it('the bare "*" fn wildcard does not fire on var reads', () => {
		const calls: string[] = [];
		const all = v.on("*", async (_c, next) => {
			calls.push("fn");
			return next();
		});
		const f = v.fn({ use: [core, { all }] }, (c) => c.plt_flag);
		f();
		expect(calls).toEqual(["fn"]);
	});
});

describe("read-only plugin", () => {
	it("blocks the whole subtree from writing vars", async () => {
		const deep = v.fn("plt.deepWrite", { use: [core] }, (c) => {
			c.plt_flag = 1;
		});
		const guarded = v.fn(
			"plt.view",
			{ use: [core, { deep }, readOnly] },
			async (c) => c.deep(),
		);
		await expect(guarded()).rejects.toThrow(
			/readonly scope: attempted to set var "plt_flag"/,
		);
	});

	it("reading stays allowed", () => {
		const f = v.fn({ use: [core, readOnly] }, (c) => c.plt_flag);
		expect(f()).toBe(0);
	});
});

describe("module list guard", () => {
	it("bare members are rejected with the fix in the message", () => {
		expect(() => v.fn({ use: [flag as never] }, () => null)).toThrow(
			/wrap the member/,
		);
	});
});
