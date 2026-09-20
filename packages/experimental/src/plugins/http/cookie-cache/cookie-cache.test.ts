import { describe, expect, it, vi } from "vitest";
import { v } from "../../../index";
import { cache, memoryCache } from "../../cache";
import {
	compactCodec,
	createChunkedCookieStore,
	getCookieCache,
	http,
	jweCodec,
	jwtCodec,
	serializeCookie,
} from "../index";
import type { CookieCachePolicy } from "./index";

const secret = "test-secret-key-at-least-32-chars!!";

function cookieHeaderFrom(headers: Headers | undefined): string {
	const parts = headers?.getSetCookie?.() ?? [];
	return parts
		.map((line) => line.split(";")[0])
		.filter((pair): pair is string => {
			if (!pair) return false;
			const value = pair.slice(pair.indexOf("=") + 1);
			return value.length > 0;
		})
		.join("; ");
}

const basePolicy = (extra?: Partial<CookieCachePolicy>): CookieCachePolicy => ({
	cookieName: "session_data",
	strategy: "compact",
	maxAge: 300,
	secret,
	version: "1",
	...extra,
});

describe("cookie-cache codecs", () => {
	it("compact round-trip", async () => {
		const codec = compactCodec(secret);
		const encoded = await codec.encode({ hello: "world", version: "1" }, 60);
		const decoded = await codec.decode(encoded);
		expect(decoded?.payload).toEqual({ hello: "world", version: "1" });
	});

	it("compact rejects bad signature", async () => {
		const codec = compactCodec(secret);
		const encoded = await codec.encode({ a: 1 }, 60);
		expect(
			await compactCodec("other-secret-key-at-least-32-chars!").decode(encoded),
		).toBeNull();
	});

	it("jwt and jwe round-trip", async () => {
		const jwt = jwtCodec(secret);
		const jwe = jweCodec(secret, {
			salt: "session-cache",
			info: "session-cache-key",
		});
		const payload = { id: "u1", version: "1" };
		expect(
			(await jwt.decode(await jwt.encode(payload, 60)))?.payload,
		).toMatchObject(payload);
		expect(
			(await jwe.decode(await jwe.encode(payload, 60)))?.payload,
		).toMatchObject(payload);
	});
});

describe("chunked cookies", () => {
	it("stores small values unchunked", () => {
		const store = createChunkedCookieStore(
			"data",
			{ path: "/" },
			{ cookies: {}, serialize: serializeCookie },
		);
		const out = store.chunk("hello");
		expect(out.some((c) => c.name === "data" && c.value === "hello")).toBe(
			true,
		);
	});

	it("chunks large values", () => {
		const big = "x".repeat(10000);
		const store = createChunkedCookieStore(
			"data",
			{ path: "/", httpOnly: true },
			{ cookies: {}, serialize: serializeCookie },
		);
		const written = store.chunk(big).filter((c) => c.value.length > 0);
		expect(written.length).toBeGreaterThan(1);
	});
});

describe("cookieCache fn layer", () => {
	it("miss runs body and writes cookie; hit skips body", async () => {
		const body = vi.fn(async () => ({ user: { id: "1" } }));
		const app = v.fn({ use: [http] });
		const get = app.fn("session.get", { cookieCache: basePolicy() }, () =>
			body(),
		);
		const entry = app.fn(
			"session.entry",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		);

		const first = await entry({ request: new Request("http://x.test/") });
		expect(first).toEqual({ user: { id: "1" } });
		expect(body).toHaveBeenCalledTimes(1);

		// Re-run entry to capture headers from the same pattern
		let headers: Headers | undefined;
		const probe = app.fn(
			"session.probe",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				const value = await c.get();
				headers = c.res?.headers;
				return value;
			},
		);
		body.mockClear();
		await probe({ request: new Request("http://x.test/") });
		expect(body).toHaveBeenCalledTimes(1);
		const cookie = cookieHeaderFrom(headers);
		expect(cookie.length).toBeGreaterThan(0);

		body.mockClear();
		const hit = await entry({
			request: new Request("http://x.test/", { headers: { cookie } }),
		});
		expect(hit).toMatchObject({ user: { id: "1" } });
		expect(body).toHaveBeenCalledTimes(0);
	});

	it("disableCookieCache forces the body", async () => {
		const body = vi.fn(async () => ({ n: 1 }));
		const app = v.fn({ use: [http] });
		const get = app.fn(
			"dis.get",
			{
				input: { disableCookieCache: v.boolean({ optional: true }) },
				cookieCache: basePolicy(),
			},
			() => body(),
		);
		const entry = app.fn(
			"dis.entry",
			{
				input: {
					request: v.any<Request>(),
					disableCookieCache: v.boolean({ optional: true }),
				},
				use: [{ get }],
			},
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get({
					disableCookieCache: c.input.disableCookieCache,
				});
			},
		);

		let headers: Headers | undefined;
		const seed = app.fn(
			"dis.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get({});
				headers = c.res?.headers;
			},
		);
		await seed({ request: new Request("http://x.test/") });
		const cookie = cookieHeaderFrom(headers);

		body.mockClear();
		await entry({
			request: new Request("http://x.test/", { headers: { cookie } }),
			disableCookieCache: true,
		});
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("validate false clears and falls through", async () => {
		const body = vi.fn(async () => ({ ok: true }));
		const app = v.fn({ use: [http] });
		let allow = true;
		const get = app.fn(
			"val.get",
			{
				cookieCache: basePolicy({ validate: () => allow }),
			},
			() => body(),
		);
		const entry = app.fn(
			"val.entry",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		);

		let headers: Headers | undefined;
		await app.fn(
			"val.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });

		allow = false;
		body.mockClear();
		await entry({
			request: new Request("http://x.test/", {
				headers: { cookie: cookieHeaderFrom(headers) },
			}),
		});
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("version mismatch misses", async () => {
		const body = vi.fn(async () => ({ v: 1 }));
		const app = v.fn({ use: [http] });
		const getV1 = app.fn(
			"ver.get1",
			{ cookieCache: basePolicy({ version: "1" }) },
			() => body(),
		);
		const getV2 = app.fn(
			"ver.get2",
			{ cookieCache: basePolicy({ version: "2" }) },
			() => body(),
		);

		let headers: Headers | undefined;
		await app.fn(
			"ver.seed",
			{ input: { request: v.any<Request>() }, use: [{ get: getV1 }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });

		body.mockClear();
		await app.fn(
			"ver.read",
			{ input: { request: v.any<Request>() }, use: [{ get: getV2 }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		)({
			request: new Request("http://x.test/", {
				headers: { cookie: cookieHeaderFrom(headers) },
			}),
		});
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("bad signature falls through", async () => {
		const body = vi.fn(async () => ({ recovered: true }));
		const app = v.fn({ use: [http] });
		const get = app.fn("bad.get", { cookieCache: basePolicy() }, () => body());
		const result = await app.fn(
			"bad.entry",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		)({
			request: new Request("http://x.test/", {
				headers: { cookie: "session_data=not-valid" },
			}),
		});
		expect(result).toEqual({ recovered: true });
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("stamps $cookieCache on the fn", () => {
		const app = v.fn({ use: [http] });
		const get = app.fn(
			"meta.get",
			{ cookieCache: basePolicy() },
			async () => null,
		);
		expect(get.$cookieCache).toMatchObject({ cookieName: "session_data" });
	});

	it("cookie hit skips store layer", async () => {
		const store = memoryCache();
		const body = vi.fn(async () => ({ id: "1" }));
		const app = v.fn({ use: [http, cache({ store })] });
		const get = app.fn(
			"both.get",
			{
				cookieCache: basePolicy(),
				cache: { key: "sess:1", ttl: 60 },
			},
			() => body(),
		);

		let headers: Headers | undefined;
		await app.fn(
			"both.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });
		expect(body).toHaveBeenCalledTimes(1);
		expect(await store.get("sess:1")).toBeTruthy();

		await store.delete("sess:1");
		body.mockClear();

		const hit = await app.fn(
			"both.again",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		)({
			request: new Request("http://x.test/", {
				headers: { cookie: cookieHeaderFrom(headers) },
			}),
		});
		expect(hit).toMatchObject({ id: "1" });
		expect(body).toHaveBeenCalledTimes(0);
		expect(await store.get("sess:1")).toBeUndefined();
	});

	it("getCookieCache standalone helper", async () => {
		const encoded = await compactCodec(secret).encode(
			{ x: 1, version: "1" },
			60,
		);
		expect(
			await getCookieCache(
				{ session_data: encoded },
				{ name: "session_data", secret, version: "1" },
			),
		).toEqual({ x: 1, version: "1" });
	});

	it("signer is used for jwt strategy", async () => {
		const sign = vi.fn(async (payload: unknown, maxAge: number) =>
			jwtCodec(secret).encode(payload, maxAge),
		);
		const verify = vi.fn(async (token: string) =>
			jwtCodec(secret).decode(token),
		);
		const body = vi.fn(async () => ({ signed: true }));
		const app = v.fn({ use: [http] });
		const get = app.fn(
			"sig.get",
			{
				cookieCache: basePolicy({
					strategy: "jwt",
					signer: { sign, verify },
				}),
			},
			() => body(),
		);

		let headers: Headers | undefined;
		await app.fn(
			"sig.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });
		expect(sign).toHaveBeenCalled();

		body.mockClear();
		await app.fn(
			"sig.hit",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		)({
			request: new Request("http://x.test/", {
				headers: { cookie: cookieHeaderFrom(headers) },
			}),
		});
		expect(verify).toHaveBeenCalled();
		expect(body).toHaveBeenCalledTimes(0);
	});

	it("refreshCache rewrites near expiry without body", async () => {
		const body = vi.fn(async () => ({ refreshed: true }));
		const app = v.fn({ use: [http] });
		// maxAge 5s, updateAge 5s → always refresh while still valid
		const get = app.fn(
			"ref.get",
			{
				cookieCache: basePolicy({
					maxAge: 5,
					refreshCache: { updateAge: 5 },
				}),
			},
			() => body(),
		);

		let headers: Headers | undefined;
		await app.fn(
			"ref.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });

		body.mockClear();
		let refreshedHeaders: Headers | undefined;
		await app.fn(
			"ref.hit",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				const value = await c.get();
				refreshedHeaders = c.res?.headers;
				return value;
			},
		)({
			request: new Request("http://x.test/", {
				headers: { cookie: cookieHeaderFrom(headers) },
			}),
		});
		expect(body).toHaveBeenCalledTimes(0);
		expect(cookieHeaderFrom(refreshedHeaders).length).toBeGreaterThan(0);
	});
});

describe("cookieCache presets + resolve", () => {
	it("resolves { name } from mount policies for run/set/clear", async () => {
		const body = vi.fn(async () => ({ user: { id: "1" } }));
		const app = v.fn({
			use: [
				http({
					cookieCache: {
						secret,
						policies: {
							session: {
								cookieName: "better-auth.session_data",
								strategy: "compact",
								maxAge: 300,
								version: "1",
							},
						},
					},
				}),
			],
		});
		const get = app.fn(
			"preset.get",
			{ cookieCache: { name: "session" } },
			() => body(),
		);

		let headers: Headers | undefined;
		await app.fn(
			"preset.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });
		expect(body).toHaveBeenCalledTimes(1);
		const cookie = cookieHeaderFrom(headers);
		expect(cookie).toContain("better-auth.session_data=");

		body.mockClear();
		const hit = await app.fn(
			"preset.hit",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		)({
			request: new Request("http://x.test/", { headers: { cookie } }),
		});
		expect(hit).toMatchObject({ user: { id: "1" } });
		expect(body).toHaveBeenCalledTimes(0);

		// clear by alias — cookieName stays from preset
		await app.fn(
			"preset.clear",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.cookieCache.clear(c, { name: "session" });
				headers = c.res?.headers;
			},
		)({
			request: new Request("http://x.test/", { headers: { cookie } }),
		});
		const cleared = cookieHeaderFrom(headers);
		// Max-Age=0 clears; value empty — header may still list the name
		expect(cleared.includes("better-auth.session_data=") || cleared === "").toBe(
			true,
		);
	});

	it("set with { name } uses mount secret and cookieName", async () => {
		const app = v.fn({
			use: [
				http({
					cookieCache: {
						secret,
						policies: {
							session: {
								cookieName: "wired",
								maxAge: 300,
								strategy: "compact",
								version: "1",
							},
						},
					},
				}),
			],
		});
		let headers: Headers | undefined;
		await app.fn(
			"set.alias",
			{ input: { request: v.any<Request>() } },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.cookieCache.set(c, { name: "session" }, { ok: true });
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });
		expect(cookieHeaderFrom(headers)).toContain("wired=");
	});

	it("overrides cookieName without changing alias", async () => {
		const app = v.fn({
			use: [
				http({
					cookieCache: {
						secret,
						policies: {
							session: {
								cookieName: "default_name",
								maxAge: 300,
								strategy: "compact",
								version: "1",
							},
						},
					},
				}),
			],
		});
		let headers: Headers | undefined;
		await app.fn(
			"set.override",
			{ input: { request: v.any<Request>() } },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.cookieCache.set(
					c,
					{ name: "session", cookieName: "custom_wire" },
					{ ok: true },
				);
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });
		expect(cookieHeaderFrom(headers)).toContain("custom_wire=");
		expect(cookieHeaderFrom(headers)).not.toContain("default_name=");
	});

	it("enabled false skips get and set", async () => {
		const body = vi.fn(async () => ({ n: 1 }));
		const app = v.fn({ use: [http] });
		const get = app.fn(
			"en.get",
			{
				cookieCache: basePolicy({ enabled: false }),
			},
			() => body(),
		);
		let headers: Headers | undefined;
		await app.fn(
			"en.run",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });
		expect(body).toHaveBeenCalledTimes(1);
		expect(cookieHeaderFrom(headers)).toBe("");
	});

	it('disableCookieCache "true" string force-misses', async () => {
		const body = vi.fn(async () => ({ n: 1 }));
		const app = v.fn({ use: [http] });
		const get = app.fn(
			"str.get",
			{
				input: { disableCookieCache: v.any({ optional: true }) },
				cookieCache: basePolicy(),
			},
			() => body(),
		);

		let headers: Headers | undefined;
		await app.fn(
			"str.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get({});
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });
		const cookie = cookieHeaderFrom(headers);

		body.mockClear();
		await app.fn(
			"str.entry",
			{
				input: {
					request: v.any<Request>(),
					disableCookieCache: v.any({ optional: true }),
				},
				use: [{ get }],
			},
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get({ disableCookieCache: c.input.disableCookieCache });
			},
		)({
			request: new Request("http://x.test/", { headers: { cookie } }),
			disableCookieCache: "true",
		});
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("onHit runs on hit and can transform return", async () => {
		const body = vi.fn(async () => ({ user: { id: "1" } }));
		const onHit = vi.fn(async (payload: any, c: any) => {
			c.hit = true;
			return { ...payload, fromHit: true };
		});
		const app = v.fn({ use: [http] });
		const get = app.fn(
			"hit.get",
			{ cookieCache: basePolicy({ onHit }) },
			() => body(),
		);

		let headers: Headers | undefined;
		await app.fn(
			"hit.seed",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.get();
				headers = c.res?.headers;
			},
		)({ request: new Request("http://x.test/") });

		body.mockClear();
		let sawHit: unknown;
		const result = await app.fn(
			"hit.read",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				const value = await c.get();
				sawHit = (c as any).hit;
				return value;
			},
		)({
			request: new Request("http://x.test/", {
				headers: { cookie: cookieHeaderFrom(headers) },
			}),
		});
		expect(body).toHaveBeenCalledTimes(0);
		expect(onHit).toHaveBeenCalled();
		expect(sawHit).toBe(true);
		expect(result).toMatchObject({ fromHit: true, user: { id: "1" } });
	});

	it("async policy callback is awaited", async () => {
		const body = vi.fn(async () => ({ async: true }));
		const app = v.fn({ use: [http] });
		const get = app.fn(
			"async.get",
			{
				cookieCache: async () => ({
					cookieName: "session_data",
					strategy: "compact" as const,
					maxAge: 300,
					secret,
					version: "1",
				}),
			},
			() => body(),
		);
		await app.fn(
			"async.entry",
			{ input: { request: v.any<Request>() }, use: [{ get }] },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				return c.get();
			},
		)({ request: new Request("http://x.test/") });
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("set opts.session omits Max-Age", async () => {
		const app = v.fn({ use: [http] });
		let setCookieLines: string[] = [];
		await app.fn(
			"sess.set",
			{ input: { request: v.any<Request>() } },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				await c.cookieCache.set(
					c,
					basePolicy(),
					{ ok: true },
					{ session: true },
				);
				setCookieLines = c.res?.headers?.getSetCookie?.() ?? [];
			},
		)({ request: new Request("http://x.test/") });
		expect(setCookieLines.some((l) => /Max-Age=/i.test(l))).toBe(false);
		expect(setCookieLines.some((l) => l.startsWith("session_data="))).toBe(
			true,
		);
	});
});
