import { describe, expect, expectTypeOf, it } from "vitest";
import { type ModuleEvents, v } from "./index";

describe("v.event", () => {
	it("publishes through direct subscribers and merges next() patches", async () => {
		const signUp = v.event("evt_signup", {
			email: v.object({
				id: v.string(),
				name: v.string(),
				email: v.string(),
			}),
			emailOpt: v.object({ id: v.string(), email: v.string() }),
		});

		const seen: string[] = [];
		const unsubscribe = signUp.subscribe(async (e, next) => {
			seen.push(String(e.type));
			if (e.type === "emailOpt") {
				await next({ email: "patched@example.com" });
				return;
			}
			await next();
		});

		const result = await signUp.publish("emailOpt", {
			id: "1",
			email: "ada@example.com",
		});
		expect(result).toEqual({ id: "1", email: "patched@example.com" });
		expect(seen).toEqual(["emailOpt"]);

		unsubscribe();
		await signUp.publish("email", {
			id: "2",
			name: "Ada",
			email: "ada@example.com",
		});
		expect(seen).toEqual(["emailOpt"]);
	});

	it("validates payloads and rejects unknown kinds", async () => {
		const bus = v.event("evt_validate", {
			ping: v.object({ n: v.number() }),
		});
		expect(() => bus.publish("ping", { n: "x" } as never)).toThrow(
			/expected number/,
		);
		expect(() => (bus as any).publish("pong", { n: 1 })).toThrow(
			/unknown event kind/,
		);
		expect(bus.publish("ping", { n: 1 })).toEqual({ n: 1 });
	});

	it("skips the chain when next is not called (veto)", async () => {
		const bus = v.event("evt_veto", {
			x: v.object({ v: v.number() }),
		});
		const order: string[] = [];
		bus.subscribe(async (_e, next) => {
			order.push("outer");
			await next();
		});
		bus.subscribe(async () => {
			order.push("veto");
		});
		bus.subscribe(async (_e, next) => {
			order.push("inner");
			await next();
		});
		const result = await bus.publish("x", { v: 1 });
		expect(result).toEqual({ v: 1 });
		expect(order).toEqual(["outer", "veto"]);
	});

	it("keeps the chain when next is called without awaiting", async () => {
		const bus = v.event("evt_detach", {
			x: v.object({ v: v.number() }),
		});
		const order: string[] = [];
		bus.subscribe((_e, next) => {
			order.push("outer");
			// Fire-and-forget: publish must still wait for downstream.
			void next();
		});
		bus.subscribe(async (_e, next) => {
			await new Promise((r) => setTimeout(r, 5));
			order.push("inner");
			await next({ v: 2 });
		});
		const result = await bus.publish("x", { v: 1 });
		expect(result).toEqual({ v: 2 });
		expect(order).toEqual(["outer", "inner"]);
	});

	it("re-validates next() patches against the kind schema", async () => {
		const bus = v.event("evt_patch_validate", {
			x: v.object({ v: v.number() }),
		});
		bus.subscribe(async (_e, next) => {
			await next({ v: "nope" } as never);
		});
		await expect(bus.publish("x", { v: 1 })).rejects.toThrow(/expected number/);
	});

	it("does not re-transform untouched fields on next() patches", async () => {
		let transforms = 0;
		const bus = v.event("evt_patch_transform", {
			x: v.object({
				a: v.string({
					transform: (value) => {
						transforms += 1;
						return `${value}!`;
					},
				}),
				b: v.number(),
			}),
		});
		bus.subscribe(async (e, next) => {
			expect(e.data.a).toBe("hi!");
			await next({ b: 2 });
		});
		const result = await bus.publish("x", { a: "hi", b: 1 });
		expect(result).toEqual({ a: "hi!", b: 2 });
		expect(transforms).toBe(1);
	});
});

describe("event extension + modules", () => {
	it("v.extend / .extend widen kinds; modules mount listeners", async () => {
		const signUp = v.event("evt_mod_signup", {
			email: v.object({ id: v.string(), email: v.string() }),
		});
		const withOauth = signUp.extend({
			oauth: v.object({ provider: v.string(), id: v.string() }),
		});
		const oauthExt = v.extend(signUp, {
			oauth: v.object({ provider: v.string(), id: v.string() }),
		});

		expectTypeOf<keyof typeof withOauth.types>().toEqualTypeOf<
			"email" | "oauth"
		>();

		const log: string[] = [];
		const onSignUp = v.on(signUp, async (e, next) => {
			log.push(`on:${String(e.type)}`);
			await next();
		});
		const onKey = v.on("event.evt_mod_signup", async (e, next) => {
			log.push(`key:${String(e.type)}`);
			await next();
		});

		const core = { signUp, oauthExt };
		const hooks = { onSignUp, onKey };

		// Mounting a fn that uses the module registers event listeners.
		v.fn("evt_mod.app", { use: [core, hooks] }, () => "ok");

		const fromEmail = await signUp.publish("email", {
			id: "1",
			email: "a@b.co",
		});
		expect(fromEmail).toEqual({ id: "1", email: "a@b.co" });

		const fromOauth = await withOauth.publish("oauth", {
			provider: "github",
			id: "42",
		});
		expect(fromOauth).toEqual({ provider: "github", id: "42" });
		expect(log).toEqual(["on:email", "key:email", "on:oauth", "key:oauth"]);
	});

	it("ModuleEvents merges kind maps by declared name across modules", () => {
		const a = {
			signUp: v.event("evt_infer", {
				email: v.object({ id: v.string() }),
			}),
		};
		const b = {
			more: v.extend(a.signUp, {
				oauth: v.object({ provider: v.string() }),
			}),
		};
		type Merged = ModuleEvents<[typeof a, typeof b]>;
		type KindMap = Merged extends { evt_infer: infer K } ? K : never;
		// Structural assignability both ways = equal payload maps.
		const _forward = null as unknown as KindMap;
		const _expected = null as unknown as {
			email: { id: string };
			oauth: { provider: string };
		};
		const _a: typeof _expected = _forward;
		const _b: KindMap = _expected;
		void _a;
		void _b;
	});

	it("lands on context when mounted via use", async () => {
		const bus = v.event("evt_ctx", {
			ping: v.object({ n: v.number() }),
		});
		const seen: number[] = [];
		bus.subscribe(async (e, next) => {
			if (e.type === "ping") seen.push(e.data.n);
			await next();
		});
		const f = v.fn({ use: [{ bus }] }, async (c) => {
			return c.bus.publish("ping", { n: 7 });
		});
		await expect(f()).resolves.toEqual({ n: 7 });
		expect(seen).toEqual([7]);
	});

	it("mounted var extensions widen a kind whose payload is that var", async () => {
		const account = v.var("evt_var_account", {
			schema: v.object({ id: v.string() }),
		});
		const withTag = v.extend(account, { tag: v.string() });
		const bus = v.event("evt_var_payload", {
			created: account,
		});

		const seen: unknown[] = [];
		bus.subscribe(async (e, next) => {
			if (e.type === "created") seen.push(e.data);
			await next();
		});

		const f = v.fn({ use: [{ bus, account, withTag }] }, async (c) => {
			const result = c.bus.publish("created", { id: "1", tag: "vip" });
			expectTypeOf(result).toEqualTypeOf<
				{ id: string; tag: string } | Promise<{ id: string; tag: string }>
			>();
			return result;
		});
		await expect(f()).resolves.toEqual({ id: "1", tag: "vip" });
		expect(seen).toEqual([{ id: "1", tag: "vip" }]);

		expect(() =>
			v.fn({ use: [{ bus, account, withTag }] }, (c) =>
				// @ts-expect-error tag required once withTag is mounted
				c.bus.publish("created", { id: "1" }),
			)(),
		).toThrow(/evt_var_account|tag/);
	});

	it("unmounted, a var-payload kind stays the base shape", async () => {
		const account = v.var("evt_var_bare", {
			schema: v.object({ id: v.string() }),
		});
		const bus = v.event("evt_var_bare_bus", { created: account });
		const f = v.fn({ use: [{ bus, account }] }, async (c) => {
			const result = c.bus.publish("created", { id: "1" });
			expectTypeOf(result).toEqualTypeOf<
				{ id: string } | Promise<{ id: string }>
			>();
			return result;
		});
		await expect(f()).resolves.toEqual({ id: "1" });
	});

	it("a var field on an event kind widens the same way", async () => {
		const account = v.var("evt_var_field_account", {
			schema: v.object({ id: v.string() }),
		});
		const withTag = v.extend(account, { tag: v.string() });
		const bus = v.event("evt_var_field", {
			created: { account },
		});
		const f = v.fn({ use: [{ bus, account, withTag }] }, async (c) => {
			return c.bus.publish("created", {
				account: { id: "2", tag: "gold" },
			});
		});
		await expect(f()).resolves.toEqual({
			account: { id: "2", tag: "gold" },
		});
		expect(() =>
			v.fn({ use: [{ bus, account, withTag }] }, (c) =>
				c.bus.publish("created", { account: { id: "2" } } as never),
			)(),
		).toThrow(/tag/);
	});
});
