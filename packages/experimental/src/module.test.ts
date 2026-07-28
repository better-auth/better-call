import { describe, expect, it } from "vitest";
import { v } from "./index";
import { readOnly } from "./plugins/read-only";

const flag = v.var("plt_flag", { default: 0 });
const core = { flag };

describe("on matching", () => {
	it("exact, wildcard, path and regex targets fire; others do not", async () => {
		const log: string[] = [];
		const hooks = {
			exact: v.on("plt.one", async (c, next) => {
				log.push("exact");
				return next();
			}),
			wild: v.on("plt.*", async (c, next) => {
				log.push("wild");
				return next();
			}),
			path: v.on("/plt/*", async (c, next) => {
				log.push("path");
				return next();
			}),
			rx: v.on(/two$/, async (c, next) => {
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
			a: v.on("plt.order", async (c, next) => {
				log.push("a:in");
				const r = await next();
				log.push("a:out");
				return r;
			}),
			b: v.on("plt.order", async (c, next) => {
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
			c.var.plt_flag = 7;
			return c.var.plt_flag;
		});
		expect(f()).toBe(7);
		expect(seen).toEqual(["plt_flag=7@plt.writer"]);
	});

	it("skipping next() cancels the write", () => {
		const veto = v.on("var.set.plt_flag", () => {});
		const f = v.fn({ use: [core, { veto }] }, (c) => {
			c.var.plt_flag = 9;
			return c.var.plt_flag;
		});
		expect(f()).toBe(0);
	});

	it("async var-set handlers are rejected loudly", () => {
		const lazy = v.on("var.set.*", (async (_c: unknown, next: () => void) =>
			next()) as never);
		const f = v.fn({ use: [core, { lazy }] }, (c) => {
			c.var.plt_flag = 1;
		});
		expect(() => f()).toThrow(/must be synchronous/);
	});

	it('the bare "*" fn wildcard does not fire on var writes', () => {
		const calls: string[] = [];
		const all = v.on("*", async (c, next) => {
			calls.push("fn");
			return next();
		});
		const f = v.fn({ use: [core, { all }] }, (c) => {
			c.var.plt_flag = 3;
		});
		f();
		expect(calls).toEqual(["fn"]);
	});
});

describe("read-only plugin", () => {
	it("blocks the whole subtree from writing vars", async () => {
		const deep = v.fn("plt.deepWrite", { use: [core] }, (c) => {
			c.var.plt_flag = 1;
		});
		const guarded = v.fn(
			"plt.view",
			{ use: [core, { deep }, readOnly] },
			async (c) => c.use.deep(),
		);
		await expect(guarded()).rejects.toThrow(
			/readonly scope: attempted to set var "plt_flag"/,
		);
	});

	it("reading stays allowed", () => {
		const f = v.fn({ use: [core, readOnly] }, (c) => c.var.plt_flag);
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
