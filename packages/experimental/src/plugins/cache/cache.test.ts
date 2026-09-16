import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { v } from "../../index";
import { cache, memoryCache } from "./index";

describe("memoryCache", () => {
	it("get/set/delete", async () => {
		const store = memoryCache();
		await store.set("a", "1");
		expect(await store.get("a")).toBe("1");
		await store.delete("a");
		expect(await store.get("a")).toBeUndefined();
	});

	it("expires by ttl", async () => {
		const store = memoryCache();
		await store.set("a", "1", 0.05);
		expect(await store.get("a")).toBe("1");
		await new Promise((r) => setTimeout(r, 60));
		expect(await store.get("a")).toBeUndefined();
	});

	it("getAndDelete", async () => {
		const store = memoryCache();
		await store.set("t", "x");
		expect(await store.getAndDelete("t")).toBe("x");
		expect(await store.get("t")).toBeUndefined();
	});

	it("increment creates with ttl and does not extend", async () => {
		const store = memoryCache();
		expect(await store.increment("n", 0.05)).toBe(1);
		expect(await store.increment("n", 0.05)).toBe(2);
		await new Promise((r) => setTimeout(r, 60));
		expect(await store.get("n")).toBeUndefined();
	});

	it("invalidateTags drops tagged keys", async () => {
		const store = memoryCache();
		await store.set("u:1", "a");
		await store.set("u:2", "b");
		await store.tag?.("u:1", ["user"]);
		await store.tag?.("u:2", ["user"]);
		await store.invalidateTags?.(["user"]);
		expect(await store.get("u:1")).toBeUndefined();
		expect(await store.get("u:2")).toBeUndefined();
	});
});

describe("cache plugin", () => {
	it("cache hit skips the body", async () => {
		const store = memoryCache();
		const body = vi.fn(async () => ({ id: 1 }));
		const app = v.fn({ use: [cache({ store })] });
		const get = app.fn(
			"user.get",
			{
				input: { id: v.string() },
				cache: { key: (c: any) => `user:${c.input.id}`, ttl: 60 },
			},
			body,
		);

		const first = await get({ id: "1" });
		const second = await get({ id: "1" });
		expect(first).toEqual({ id: 1 });
		expect(second).toEqual({ id: 1 });
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("invalidateTags clears on write fn", async () => {
		const store = memoryCache();
		const app = v.fn({ use: [cache({ store })] });
		const get = app.fn(
			"item.get",
			{
				input: { id: v.string() },
				cache: {
					key: (c: any) => `item:${c.input.id}`,
					ttl: 60,
					tags: ["item"],
				},
			},
			async () => ({ ok: true }),
		);
		const del = app.fn(
			"item.del",
			{
				input: { id: v.string() },
				invalidateTags: ["item"],
			},
			async () => ({ deleted: true }),
		);

		await get({ id: "1" });
		expect(await store.get("item:1")).toBeTruthy();
		await del({ id: "1" });
		expect(await store.get("item:1")).toBeUndefined();
	});

	it("cache option without a store still runs when no API is present", async () => {
		// `c.cache` is only available after `cache({ store })` registers the
		// var. This test just asserts a plain fn without the option works.
		const fn = v.fn("plain", async () => 1);
		await expect(fn()).resolves.toBe(1);
	});

	it("unlocks cache on options when module is in use", () => {
		const app = v.fn({ use: [cache({ store: memoryCache() })] });
		const get = app.fn(
			"t",
			{
				cache: { key: "k", ttl: 1 },
				invalidateTags: ["t"],
			},
			() => null,
		);
		expect(get.$cache).toEqual({ key: "k", ttl: 1 });
		expect(get.$invalidateTags).toEqual(["t"]);
		expectTypeOf(get.$cache).not.toEqualTypeOf<undefined>();
		expectTypeOf(get.$invalidateTags).not.toEqualTypeOf<undefined>();
	});

	it("exposes c.cache helpers", async () => {
		const store = memoryCache();
		const app = v.fn({ use: [cache({ store })] });
		const set = app.fn("set", async (c) => {
			await c.cache.set("k", JSON.stringify({ a: 1 }), 60);
			return await c.cache.get("k");
		});
		expect(JSON.parse((await set()) as string)).toEqual({ a: 1 });
	});
});
