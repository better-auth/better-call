import type {
	CookieCacheFnOptionObject,
	SoftAlias,
} from "./cookie-cache/options";
import { collectRoutes, getRouteMeta, http, httpOptions, route } from "./index";
import { v } from "../../index";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("httpOptions — path on fn options", () => {
	it("unlocks path when http is in parent use", () => {
		const e = v.fn("auth.", { use: [http] });
		const signUpEmail = e.fn(
			"signUpEmail",
			{ path: "/sign-up/email" },
			async () => ({ ok: true }),
		);

		expect(getRouteMeta(signUpEmail)).toEqual({
			path: "/sign-up/email",
			method: "GET",
			invalidate: [],
		});
		expectTypeOf(signUpEmail.$route!.path).toEqualTypeOf<"/sign-up/email">();
		expectTypeOf(signUpEmail.$route!.method).toEqualTypeOf<"GET">();
	});

	it("unlocks path with use: [{ httpOptions }]", () => {
		const ping = v.fn(
			"ping",
			{ use: [{ httpOptions }], path: "/ping", method: "GET" },
			() => "pong",
		);
		expect(getRouteMeta(ping)).toEqual({
			path: "/ping",
			method: "GET",
			invalidate: [],
		});
		expectTypeOf(ping.$route!.path).toEqualTypeOf<"/ping">();
	});

	it("unlocks path with bare use: [httpOptions]", () => {
		const ping = v.fn(
			"ping",
			{ use: [httpOptions], path: "/ping", method: "GET" },
			() => "pong",
		);
		expect(getRouteMeta(ping)).toEqual({
			path: "/ping",
			method: "GET",
			invalidate: [],
		});
		expectTypeOf(ping.$route!.path).toEqualTypeOf<"/ping">();
	});

	it("defaults method to POST when input is declared", () => {
		const e = v.fn("auth.", { use: [http] });
		const signIn = e.fn(
			"signIn",
			{
				path: "/sign-in/email",
				input: { email: v.string(), password: v.string() },
			},
			(c) => ({ email: c.input.email }),
		);

		expect(getRouteMeta(signIn)?.method).toBe("POST");
		expectTypeOf(signIn.$route!.method).toEqualTypeOf<"POST">();
	});

	it("explicit method wins over the default", () => {
		const e = v.fn({ use: [http] });
		const list = e.fn(
			"list",
			{
				path: "/items",
				method: "GET",
				input: { q: v.string({ optional: true }) },
			},
			() => [],
		);

		expect(getRouteMeta(list)).toMatchObject({
			path: "/items",
			method: "GET",
		});
		expectTypeOf(list.$route!.method).toEqualTypeOf<"GET">();
	});

	it("same-call use: [http] unlocks path", () => {
		const ping = v.fn(
			"ping",
			{ use: [http], path: "/ping", method: "GET" },
			() => "pong",
		);
		expect(getRouteMeta(ping)).toEqual({
			path: "/ping",
			method: "GET",
			invalidate: [],
		});
	});

	it("collectRoutes finds path-option routes", () => {
		const e = v.fn({ use: [http] });
		const whoami = e.fn("whoami", { path: "/me", method: "GET" }, () => ({
			id: "1",
		}));
		const table = collectRoutes({ whoami });
		expect(table).toEqual([
			expect.objectContaining({
				name: "whoami",
				path: "/me",
				method: "GET",
			}),
		]);
	});

	it("route() still stamps $route", () => {
		const legacy = v.fn(
			"legacy",
			{ use: [route({ path: "/legacy", method: "PUT" })] },
			() => null,
		);
		expect(getRouteMeta(legacy)).toEqual({
			path: "/legacy",
			method: "PUT",
			invalidate: [],
		});
		expectTypeOf(legacy.$route!.path).toEqualTypeOf<"/legacy">();
	});

	it("rejects path without http in use (type)", () => {
		// @ts-expect-error path is not a core OptionType key
		v.fn("nope", { path: "/nope" }, () => null);
	});

	it("core option keys still typecheck without http", () => {
		const echo = v.fn(
			"echo",
			{
				input: { msg: v.string() },
				output: { msg: v.string() },
				errors: { bad: v.object({ reason: v.string() }) },
				summary: "Echo",
				description: "Returns the message",
				tags: ["demo"],
				idempotent: true,
			},
			(c) => ({ msg: c.input.msg }),
		);
		expect(echo.$schema?.input).toBeDefined();
		expectTypeOf(echo).toBeFunction();
	});

	it("cookieCache option infers sub-keys", () => {
		const e = v.fn({ use: [http] });
		const get = e.fn(
			"session.get",
			{
				cookieCache: {
					cookieName: "session_data",
					maxAge: 300,
					strategy: "jwe",
					secret: "x",
					version: "1",
					refreshCache: { updateAge: 60 },
					jwe: { salt: "s", info: "i" },
					validate: (payload) => payload != null,
					enabled: () => true,
					prepare: (value) => value,
					onHit: (value) => value,
				},
			},
			async () => null,
		);
		expect(get.$cookieCache).toMatchObject({
			cookieName: "session_data",
			strategy: "jwe",
		});
		// Empty object stays assignable so `{ | }` keeps contextual IntelliSense.
		e.fn("scratch", { cookieCache: {} }, async () => null);

		expectTypeOf<CookieCacheFnOptionObject>().toMatchTypeOf<{
			name?: string | null;
			cookieName?: string | null;
			strategy?: "compact" | "jwt" | "jwe" | null;
			validate?: ((...args: any[]) => boolean | Promise<boolean>) | null;
		}>();
	});

	it("cookieCache.name soft-types preset aliases", () => {
		const mod = http({
			cookieCache: {
				secret: "x",
				policies: {
					session: {
						cookieName: "better-auth.session_data",
						maxAge: 300,
					},
				},
			},
		});
		const e = v.fn({ use: [mod] });
		e.fn("ok", { cookieCache: { name: "session" } }, async () => null);
		// Ad-hoc alias still assignable (soft typing).
		e.fn(
			"adhoc",
			{
				cookieCache: {
					name: "other",
					cookieName: "other_cookie",
					maxAge: 60,
					secret: "x",
				},
			},
			async () => null,
		);
		type SessionAlias = SoftAlias<"session">;
		expectTypeOf<"session">().toMatchTypeOf<SessionAlias>();
		expectTypeOf<"ad_hoc">().toMatchTypeOf<SessionAlias>();
	});
});
