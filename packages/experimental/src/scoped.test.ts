import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "./index";

/**
 * Per-instance modules: a factory that mints its own var definitions and
 * fns, called once per instance. Same var NAME, same fn KEYS - only the
 * definitions differ.
 */
const provider = (id: string, tokenUrl: string) => {
	const endpoints = v.var("sv_endpoints", {
		default: { tokenUrl } as { tokenUrl: string },
	});
	const exchange = v.fn(
		`sv.${id}.exchange`,
		{ use: [{ endpoints }] },
		(c) => c.sv_endpoints.tokenUrl,
	);
	return { endpoints, exchange };
};

describe("var defaults resolve from the definition mounted in scope", () => {
	const google = provider("google", "https://google/token");
	const github = provider("github", "https://github/token");

	it("two scopes with same-name vars keep separate defaults", () => {
		expect(google.exchange()).toBe("https://google/token");
		expect(github.exchange()).toBe("https://github/token");
	});

	it("separate defaults hold inside one call tree", async () => {
		const app = v.fn("sv.app", (c) => [
			google.exchange(undefined, c),
			github.exchange(undefined, c),
			google.exchange(undefined, c),
		]);
		expect(await app()).toEqual([
			"https://google/token",
			"https://github/token",
			"https://google/token",
		]);
	});

	it("two instances of one definition factory stay apart", () => {
		const first = provider("google", "https://first/token");
		const second = provider("google", "https://second/token");
		expect(first.exchange()).toBe("https://first/token");
		expect(second.exchange()).toBe("https://second/token");
	});

	it("a v.extend of a scoped var brings that var's default", () => {
		const oidc = (base: ReturnType<typeof provider>) => {
			const withIssuer = v.extend(base.endpoints, { issuer: v.string() });
			return v.fn("sv.oidc.discover", { use: [{ withIssuer }] }, (c) => {
				expectTypeOf(c.sv_endpoints).toEqualTypeOf<{
					tokenUrl: string;
					issuer: string;
				}>();
				return c.sv_endpoints.tokenUrl;
			});
		};
		expect(oidc(google)()).toBe("https://google/token");
		expect(oidc(github)()).toBe("https://github/token");
	});

	it("an extension chain resolves to the base definition it carries", () => {
		const withIssuer = v.extend(github.endpoints, { issuer: v.string() });
		const withJwks = v.extend(github.endpoints, { jwks: v.string() });
		const f = v.fn(
			"sv.chain",
			{ use: [{ withIssuer }, { withJwks }] },
			(c) => c.sv_endpoints.tokenUrl,
		);
		expect(f()).toBe("https://github/token");
	});

	it("a directly mounted definition beats an extension's base", () => {
		const other = v.var("sv_endpoints", {
			default: { tokenUrl: "https://other/token" },
		});
		const withIssuer = v.extend(github.endpoints, { issuer: v.string() });
		const f = v.fn(
			"sv.direct",
			{ use: [{ withIssuer }, { other }] },
			(c) => c.sv_endpoints.tokenUrl,
		);
		expect(f()).toBe("https://other/token");
	});

	it("child scopes inherit the caller's definition", () => {
		// Mounts nothing: the var is untyped here, read it raw.
		const inner = v.fn(
			"sv.inner",
			(c) => (c as unknown as Record<string, unknown>).sv_endpoints,
		);
		const outer = v.fn(
			"sv.outer",
			{ use: [{ endpoints: github.endpoints }] },
			(c) => inner(undefined, c),
		);
		expect(outer()).toEqual({ tokenUrl: "https://github/token" });
		const outerGoogle = v.fn(
			"sv.outer",
			{ use: [{ endpoints: google.endpoints }] },
			(c) => inner(undefined, c),
		);
		expect(outerGoogle()).toEqual({ tokenUrl: "https://google/token" });
	});

	it("the nearest mount wins, and the caller keeps its own after", async () => {
		const outer = v.fn(
			"sv.nearest",
			{ use: [{ endpoints: google.endpoints }] },
			async (c) => {
				const inner = await github.exchange(undefined, c);
				return [c.sv_endpoints.tokenUrl, inner, c.sv_endpoints.tokenUrl];
			},
		);
		expect(await outer()).toEqual([
			"https://google/token",
			"https://github/token",
			"https://google/token",
		]);
	});

	it("hooks see the default of the fn they wrap", async () => {
		const seen: string[] = [];
		const spy = v.on("sv.*.exchange", async (c, next) => {
			seen.push(c.sv_endpoints.tokenUrl);
			return next();
		});
		const app = v.fn("sv.app", { use: [{ spy }] }, async (c) => {
			await google.exchange(undefined, c);
			await github.exchange(undefined, c);
		});
		await app();
		expect(seen).toEqual(["https://google/token", "https://github/token"]);
	});

	it("var-write hooks read the scoped default off c", () => {
		const seen: unknown[] = [];
		const watch = v.on("var.set.sv_note", (c, next) => {
			seen.push(c.sv_endpoints);
			next();
		});
		const note = v.var("sv_note", { default: "" });
		const f = v.fn(
			"sv.watch",
			{ use: [{ endpoints: github.endpoints, note, watch }] },
			(c) => {
				c.sv_note = "x";
			},
		);
		f();
		expect(seen).toEqual([{ tokenUrl: "https://github/token" }]);
	});

	it("a write to one instance's var stays out of another's", async () => {
		const app = v.fn(
			"sv.write",
			{ use: [{ endpoints: google.endpoints }] },
			async (c) => {
				c.sv_endpoints = { tokenUrl: "https://set/token" };
				return [await github.exchange(undefined, c), c.sv_endpoints.tokenUrl];
			},
		);
		expect(await app()).toEqual(["https://github/token", "https://set/token"]);
	});

	it("a write reaches every fn of the same definition", async () => {
		const app = v.fn(
			"sv.write",
			{ use: [{ endpoints: github.endpoints }] },
			async (c) => {
				c.sv_endpoints = { tokenUrl: "https://set/token" };
				return github.exchange(undefined, c);
			},
		);
		expect(await app()).toBe("https://set/token");
	});

	it(".with seeds still override the mounted default", () => {
		expect(
			github.exchange.with({ sv_endpoints: { tokenUrl: "https://seed" } })(),
		).toBe("https://seed");
		expect(github.exchange()).toBe("https://github/token");
	});

	it("derived vars compute off the source definition in scope", () => {
		const make = (n: number) => {
			const count = v.var("sv_count", { default: n });
			const doubled = v.derive("sv_doubled", count, (x) => x * 2);
			return v.fn("sv.derived", { use: [{ count, doubled }] }, (c) => [
				c.sv_doubled,
			]);
		};
		expect(make(2)()).toEqual([4]);
		expect(make(5)()).toEqual([10]);
	});

	it("requires sees the scoped default", () => {
		const make = (user: { id: string } | null) => {
			const current = v.var("sv_user", { default: user });
			return v.fn(
				"sv.requires",
				{ use: [{ current }], requires: ["sv_user"] },
				(c) => c.sv_user.id,
			);
		};
		const present = make({ id: "u1" });
		const absent = make(null);
		expect(present()).toBe("u1");
		expect(() => absent()).toThrow(/required var "sv_user" is not set/);
	});
});

describe("exact hooks bind to one fn definition", () => {
	const instance = () =>
		v.fn("sx.google.exchange", async () => "body" as string);
	const one = instance();
	const two = instance();

	const run = (hooks: Record<string, unknown>) =>
		v.fn("sx.app", { use: [hooks] }, async (c) => [
			await one(undefined, c),
			await two(undefined, c),
		])();

	it("an exact hook does not fire on a same-key fn from another instance", async () => {
		const exact = v.on(
			one,
			async (_c, next) => {
				expectTypeOf(next).returns.resolves.toEqualTypeOf<string>();
				return `exact:${await next()}`;
			},
			{ exact: true },
		);
		expect(await run({ exact })).toEqual(["exact:body", "body"]);
	});

	it("a reference without exact still matches by key", async () => {
		const byKey = v.on(one, async (_c, next) => `key:${await next()}`);
		expect(await run({ byKey })).toEqual(["key:body", "key:body"]);
	});

	it("key and pattern hooks are unchanged", async () => {
		const key = v.on(
			"sx.google.exchange",
			async (_c, next) => `k:${await next()}`,
		);
		const star = v.on("sx.google.*", async (_c, next) => `s:${await next()}`);
		const mid = v.on("sx.*.exchange", async (_c, next) => `m:${await next()}`);
		expect(await run({ key, star, mid })).toEqual(["k:s:m:body", "k:s:m:body"]);
	});

	it("exact hooks keep input extensions", async () => {
		const tagged = v.on(
			one,
			{ input: { tag: v.string() } },
			async (c, next) => {
				expectTypeOf(c.input.tag).toEqualTypeOf<string>();
				return `${c.input.tag}:${await next()}`;
			},
			{ exact: true },
		);
		const app = v.fn("sx.app", { use: [{ tagged }] }, async (c) => [
			await one({ tag: "t" } as never, c),
			await two(undefined, c),
		]);
		expect(await app()).toEqual(["t:body", "body"]);
	});

	it("in a list, references match exactly and strings by key", async () => {
		const other = v.fn("sx.other", async () => "other");
		const listed = v.on(
			[one, "sx.oth*"],
			async (_c, next) => `l:${await next()}`,
			{ exact: true },
		);
		const app = v.fn("sx.app", { use: [{ listed }] }, async (c) => [
			await one(undefined, c),
			await two(undefined, c),
			await other(undefined, c),
		]);
		expect(await app()).toEqual(["l:body", "body", "l:other"]);
	});

	it("bound .with calls are the same definition", async () => {
		const exact = v.on(one, async (_c, next) => `e:${await next()}`, {
			exact: true,
		});
		const app = v.fn("sx.app", { use: [{ exact }] }, async (c) => [
			await one.with({})(undefined, c),
			await two.with({})(undefined, c),
		]);
		expect(await app()).toEqual(["e:body", "body"]);
	});

	it("a builder's on passes exact through", async () => {
		const b = v.fn("sx.");
		const exact = b.on(one, async (_c, next) => `b:${await next()}`, {
			exact: true,
		});
		expect(await run({ exact })).toEqual(["b:body", "body"]);
	});

	it("exact without a fn reference is rejected", () => {
		expect(() =>
			v.on(
				"sx.google.exchange" as never,
				(async () => {}) as never,
				{
					exact: true,
				} as never,
			),
		).toThrow(/exact/);
	});
});

describe("written values live per definition", () => {
	// A tenant module: its own config var, a fn that writes it, one that
	// reads it - built once per tenant.
	const tenant = (id: string) => {
		const config = v.var("st_config", { default: { id, plan: "free" } });
		const upgrade = v.fn(`st.${id}.upgrade`, { use: [{ config }] }, (c) => {
			c.st_config = { ...c.st_config, plan: "pro" };
		});
		const plan = v.fn(`st.${id}.plan`, { use: [{ config }] }, (c) => {
			return `${c.st_config.id}:${c.st_config.plan}`;
		});
		return { config, upgrade, plan };
	};

	it("two tenants writing same-name vars in one call tree stay apart", async () => {
		const acme = tenant("acme");
		const umbrella = tenant("umbrella");
		const app = v.fn("st.app", async (c) => {
			await acme.upgrade(undefined, c);
			return [await acme.plan(undefined, c), await umbrella.plan(undefined, c)];
		});
		expect(await app()).toEqual(["acme:pro", "umbrella:free"]);
	});

	it("a parent's write reaches children that inherit or mount the definition", async () => {
		const acme = tenant("acme");
		const inherits = v.fn(
			"st.inherits",
			(c) => (c as unknown as { st_config: { plan: string } }).st_config.plan,
		);
		const app = v.fn(
			"st.parent",
			{ use: [{ config: acme.config }] },
			async (c) => {
				c.st_config = { id: "acme", plan: "enterprise" };
				return [await acme.plan(undefined, c), await inherits(undefined, c)];
			},
		);
		expect(await app()).toEqual(["acme:enterprise", "enterprise"]);
	});

	it("a child's write flows back to the caller (provides)", async () => {
		const acme = tenant("acme");
		const app = v.fn(
			"st.back",
			{ use: [{ config: acme.config }] },
			async (c) => {
				await acme.upgrade(undefined, c);
				return c.st_config.plan;
			},
		);
		expect(await app()).toBe("pro");
	});

	it("a customized re-export is the same var", async () => {
		const base = v.var("st_profile", {
			default: null as { id: string } | null,
			schema: v.object({ id: v.string() }),
		});
		const wide = base.customize({
			schema: (t) => t.add({ role: t.string({ optional: true }) }),
		});
		const read = v.fn("st.read", { use: [{ wide }] }, (c) => c.st_profile?.id);
		const app = v.fn("st.write", { use: [{ base }] }, async (c) => {
			c.st_profile = { id: "p1" };
			return read(undefined, c);
		});
		expect(await app()).toBe("p1");
	});

	it("merge vars fold same-name definitions into one value, as documented", async () => {
		const library = v.var("st_db", { merge: true, default: { from: "lib" } });
		const read = v.fn("st.db", { use: [{ library }] }, (c) => c.st_db.from);
		const override = v.var("st_db", { merge: true, default: { from: "app" } });
		const app = v.fn("st.app", { use: [{ db: override }] }, (c) =>
			read(undefined, c),
		);
		expect(await app()).toBe("app");
	});

	it("a frame that mounts nothing writes the latest definition, as before", async () => {
		const only = v.var("st_solo", { default: 0 });
		const read = v.fn("st.solo", { use: [{ only }] }, (c) => c.st_solo);
		const app = v.fn("st.unmounted", async (c) => {
			(c as unknown as { st_solo: number }).st_solo = 7;
			return read(undefined, c);
		});
		expect(await app()).toBe(7);
	});
});

describe("seeding a subtree", () => {
	const session = v.var("ss_session", {
		default: null as { user: string } | null,
	});
	const result = v.var("ss_result", { default: null as string | null });
	const complete = v.fn(
		"ss.complete",
		{ use: [{ session, result }], provides: ["ss_result"] },
		(c) => {
			c.ss_result = `done:${c.ss_session?.user ?? "anon"}`;
			return c.ss_session?.user;
		},
	);

	it("fn.with(seeds)(input, c) keeps the seed in the subtree and hands back what it provides", async () => {
		const app = v.fn("ss.app", { use: [{ session, result }] }, async (c) => {
			c.ss_session = { user: "outer" };
			const inner = await complete.with({ ss_session: { user: "seeded" } })(
				undefined,
				c,
			);
			return [inner, c.ss_session?.user, c.ss_result];
		});
		expect(await app()).toEqual(["seeded", "outer", "done:seeded"]);
	});

	it("a write to a seeded var inside the call stays inside", async () => {
		const logout = v.fn("ss.logout", { use: [{ session }] }, (c) => {
			c.ss_session = null;
		});
		const app = v.fn("ss.app", { use: [{ session }] }, async (c) => {
			c.ss_session = { user: "outer" };
			await logout.with({ ss_session: { user: "seeded" } })(undefined, c);
			return c.ss_session?.user;
		});
		expect(await app()).toBe("outer");
	});
});

describe("mounted seeds: var.with(value)", () => {
	// A library: fns that mount the library's own var.
	const registry = v.var("ms_registry", { default: [] as string[] });
	const list = v.fn("ms.list", { use: [{ registry }] }, (c) =>
		c.ms_registry.join(","),
	);
	const add = v.fn(
		"ms.add",
		{ input: { id: v.string() }, use: [{ registry }] },
		(c) => {
			c.ms_registry = [...c.ms_registry, c.input.id];
		},
	);
	// An instance: a root that seeds the library var for everything below.
	const instance = (providers: string[]) =>
		v.fn("ms.root", { use: [registry.with(providers), { list, add }] });

	it("library fns see the instance's seed, not the library default", async () => {
		const google = instance(["google"]);
		const github = instance(["github", "apple"]);
		const run = (root: typeof google) => root.fn("call", (c) => c.list())();
		expect(await run(google)).toBe("google");
		expect(await run(github)).toBe("github,apple");
		expect(list()).toBe("");
	});

	it("the seed types the var on c", () => {
		const root = v.fn({ use: [registry.with(["x"])] });
		root.fn((c) => {
			expectTypeOf(c.ms_registry).toEqualTypeOf<string[]>();
		});
	});

	it("writes inside the subtree land in the seeded value", async () => {
		const root = instance(["google"]);
		const f = root.fn("call", async (c) => {
			await c.add({ id: "okta" });
			return c.list();
		});
		expect(await f()).toBe("google,okta");
		// The next call starts from the seed again.
		expect(await root.fn("again", (c) => c.list())()).toBe("google");
	});

	it("a nested mount reseeds its own subtree only", async () => {
		const tenantList = v.fn(
			"ms.tenant",
			{ use: [registry.with(["tenant"]), { list }] },
			(c) => c.list(),
		);
		const root = instance(["google"]);
		const f = root.fn("call", async (c) => [
			await tenantList(undefined, c),
			await c.list(),
		]);
		expect(await f()).toEqual(["tenant", "google"]);
	});

	it("the same seed mounted again below does not reset the subtree", async () => {
		const seed = registry.with(["google"]);
		const again = v.fn("ms.again", { use: [seed, { list }] }, (c) => c.list());
		const root = v.fn("ms.root", { use: [seed, { add }] });
		const f = root.fn("call", async (c) => {
			await c.add({ id: "okta" });
			return again(undefined, c);
		});
		expect(await f()).toBe("google,okta");
	});

	it("a seed is a declaration - a readonly subtree still sees it", () => {
		const ro = v.fn(
			"ms.ro",
			{ readonly: true, use: [registry.with(["ro"]), { list }] },
			(c) => c.list(),
		);
		expect(ro()).toBe("ro");
	});
});
