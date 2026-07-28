import { describe, expect, it, vi } from "vitest";
import { v } from "./index";

const user = (userId: string) => ({ userId });

describe("persist: loading", () => {
	it("lazy get fires the load once per scope, everyone shares it", async () => {
		const sess = v.var("pt_lazy", {
			default: null as { userId: string } | null,
		});
		const load = vi.fn(async () => user("u1"));
		const bind = v.persist(sess, { load, save: async () => {} });
		const inner = v.fn("pt.lazy.inner", { use: [{ sess, bind }] }, async (c) =>
			c.var.pt_lazy.get(),
		);
		const entry = v.fn({ use: [{ sess, bind, inner }] }).fn(async (c) => {
			const [a, b] = await Promise.all([
				c.var.pt_lazy.get(),
				c.var.pt_lazy.get(),
			]);
			const nested = await c.use.inner();
			return [a, b, nested];
		});
		await expect(entry()).resolves.toEqual([
			user("u1"),
			user("u1"),
			user("u1"),
		]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("requires loads eagerly - the body sees a plain sync value", async () => {
		const sess = v.var("pt_req", {
			default: null as { userId: string } | null,
		});
		const load = vi.fn(async () => user("u9"));
		const bind = v.persist(sess, { load, save: async () => {} });
		const f = v.fn(
			"pt.req",
			{ use: [{ sess, bind }], requires: ["pt_req"] },
			(c) => c.var.pt_req.get().userId,
		);
		await expect(f()).resolves.toBe("u9");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("a load that answers null leaves requires unsatisfied", async () => {
		const sess = v.var("pt_null", {
			default: null as { userId: string } | null,
		});
		const bind = v.persist(sess, {
			load: async () => null,
			save: async () => {},
		});
		const f = v.fn(
			"pt.null",
			{ use: [{ sess, bind }], requires: ["pt_null"] },
			(c) => c.var.pt_null.get(),
		);
		await expect(f()).rejects.toThrow(/required var "pt_null" is not set/);
	});

	it("a sync store stays sync end to end", () => {
		const sess = v.var("pt_sync", {
			default: null as { userId: string } | null,
		});
		const bind = v.persist(sess, { load: () => user("s1"), save: () => {} });
		const f = v.fn("pt.sync", { use: [{ sess, bind }] }, (c) =>
			c.var.pt_sync.get(),
		);
		expect(f()).toEqual(user("s1"));
	});

	it("a scope write beats the store - no load once set", async () => {
		const sess = v.var("pt_beat", {
			default: null as { userId: string } | null,
		});
		const load = vi.fn(async () => user("db"));
		const save = vi.fn();
		const bind = v.persist(sess, { load, save });
		const f = v.fn("pt.beat", { use: [{ sess, bind }] }, async (c) => {
			c.var.pt_beat.set(user("mem"));
			return c.var.pt_beat.get();
		});
		await expect(f()).resolves.toEqual(user("mem"));
		expect(load).not.toHaveBeenCalled();
		expect(save).toHaveBeenCalledTimes(1);
		// prev is null: the store was never consulted
		expect(save).toHaveBeenCalledWith(user("mem"), null, expect.anything(), {
			fields: null,
		});
	});
});

describe("persist: flushing", () => {
	it("dirty vars flush ONCE at root exit - last write wins", async () => {
		const store = new Map([["row", user("u1")]]);
		const sess = v.var("pt_flush", {
			default: null as { userId: string } | null,
		});
		const load = vi.fn(async () => store.get("row") ?? null);
		const save = vi.fn(async (value: any) => {
			store.set("row", value);
		});
		const bind = v.persist(sess, { load, save });
		const bump = v.fn("pt.flush.bump", { use: [{ sess, bind }] }, async (c) => {
			const current = await c.var.pt_flush.get();
			c.var.pt_flush.set(user(`${current?.userId}+`));
		});
		const entry = v.fn({ use: [{ sess, bind, bump }] }).fn(async (c) => {
			await c.use.bump();
			await c.use.bump();
			return c.var.pt_flush.get();
		});
		await expect(entry()).resolves.toEqual(user("u1++"));
		expect(load).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledTimes(1);
		// last write wins, prev = what the load answered
		expect(save).toHaveBeenCalledWith(
			user("u1++"),
			user("u1"),
			expect.anything(),
			{
				fields: null,
			},
		);
		expect(store.get("row")).toEqual(user("u1++"));
	});

	it("a throw anywhere discards the writes - nothing stores", async () => {
		const sess = v.var("pt_throw", {
			default: null as { userId: string } | null,
		});
		const save = vi.fn();
		const bind = v.persist(sess, { load: async () => null, save });
		const f = v.fn("pt.throw", { use: [{ sess, bind }] }, async (c) => {
			c.var.pt_throw.set(user("doomed"));
			throw new Error("nope");
		});
		await expect(f()).rejects.toThrow("nope");
		expect(save).not.toHaveBeenCalled();
	});

	it("loaded but never written - no save at all", async () => {
		const sess = v.var("pt_clean", {
			default: null as { userId: string } | null,
		});
		const save = vi.fn();
		const bind = v.persist(sess, { load: async () => user("u1"), save });
		const f = v.fn("pt.clean", { use: [{ sess, bind }] }, async (c) =>
			c.var.pt_clean.get(),
		);
		await expect(f()).resolves.toEqual(user("u1"));
		expect(save).not.toHaveBeenCalled();
	});

	it("a binding mounted DEEP still flushes when the root returns", async () => {
		const sess = v.var("pt_deep", {
			default: null as { userId: string } | null,
		});
		const save = vi.fn();
		const bind = v.persist(sess, { load: async () => null, save });
		const writer = v.fn("pt.deep.writer", { use: [{ sess, bind }] }, (c) => {
			c.var.pt_deep.set(user("w"));
		});
		const entry = v.fn({ use: [{ writer }] }).fn(async (c) => {
			await c.use.writer();
			return "done";
		});
		await expect(entry()).resolves.toBe("done");
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith(user("w"), null, expect.anything(), {
			fields: null,
		});
	});
});

describe("persist: dirty fields", () => {
	it("a whole set reports no field distinction", async () => {
		const profile = v.var("pt_whole", {
			default: null as { userId: string; name: string } | null,
		});
		const save = vi.fn();
		const bind = v.persist(profile, { load: async () => null, save });
		const f = v.fn("pt.whole", { use: [{ profile, bind }] }, (c) => {
			c.var.pt_whole.set({ userId: "u2", name: "c" });
		});
		await f();
		expect(save).toHaveBeenCalledWith(
			{ userId: "u2", name: "c" },
			null,
			expect.anything(),
			{ fields: null },
		);
	});

	it("record vars accumulate and report every patched key", async () => {
		const draft = v.record("pt_record", {
			schema: v.object({ title: v.string(), body: v.string() }),
		});
		const save = vi.fn();
		const bind = v.persist(draft, { load: async () => null, save });
		const f = v.fn("pt.record", { use: [{ draft, bind }] }, (c) => {
			c.var.pt_record.set({ title: "hi" });
			c.var.pt_record.set({ body: "there" });
		});
		await f();
		expect(save).toHaveBeenCalledWith(
			{ title: "hi", body: "there" },
			null,
			expect.anything(),
			{ fields: ["title", "body"] },
		);
	});
});

describe("persist: scope.flush", () => {
	it("mounted scope.flush entries wrap the saves - a transaction plugin", async () => {
		const log: string[] = [];
		const sess = v.var("pt_tx", { default: null as { userId: string } | null });
		const bind = v.persist(sess, {
			load: async () => null,
			save: async () => {
				log.push("save");
			},
		});
		const transactions = {
			tx: v.on("scope.flush", async (_c, next) => {
				log.push("tx:begin");
				await next();
				log.push("tx:commit");
			}),
		};
		const f = v.fn("pt.tx", { use: [{ sess, bind }, transactions] }, (c) => {
			c.var.pt_tx.set(user("x"));
		});
		await f();
		expect(log).toEqual(["tx:begin", "save", "tx:commit"]);
	});

	it("no dirty vars, no flush dispatch", async () => {
		const log: string[] = [];
		const transactions = {
			tx: v.on("scope.flush", async (_c, next) => {
				log.push("tx");
				await next();
			}),
		};
		const f = v.fn("pt.notx", { use: [transactions] }, () => "ok");
		expect(f()).toBe("ok");
		expect(log).toEqual([]);
	});
});
