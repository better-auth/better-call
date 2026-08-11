import { describe, expect, it } from "vitest";
import { v } from "../index";
import * as http from "./http";

const app = v.fn({ use: [http] });

const whoami = app.fn("httpt.whoami", { requires: ["req"] }, (c) => {
	const req = c.req;
	return {
		method: req.method,
		path: req.path,
		ua: req.headers.get("user-agent"),
		q: req.query,
		cookie: req.cookies.theme ?? null,
		body: req.body ?? null,
	};
});

describe("fromRequest (web adapter)", () => {
	it("derives everything from one request var", async () => {
		const entry = v.fn({ use: [http, { whoami }] }).fn(async (c) => {
			await c.fromRequest({
				request: new Request("http://x.test/me?tag=a&tag=b&on=1", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"user-agent": "test/1",
						cookie: "theme=dark; lang=en",
					},
					body: JSON.stringify({ hello: 1 }),
				}),
			});
			return c.whoami();
		});
		await expect(entry()).resolves.toEqual({
			method: "POST",
			path: "/me",
			ua: "test/1",
			q: { tag: ["a", "b"], on: "1" },
			cookie: "dark",
			body: { hello: 1 },
		});
	});

	it("guards fns that require a request", () => {
		expect(() => whoami()).toThrow(/required var "req" is not set/);
	});
});

describe("cookies", () => {
	it("reads, sets, and deletes cookies through the scope", async () => {
		const entry = app.fn(
			"httpt.cookies",
			{ input: { request: v.any<Request>() } },
			async (c) => {
				await c.fromRequest({ request: c.input.request });
				const before = c.getCookie("theme");
				c.setCookie({
					name: "theme",
					value: "dark",
					options: { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 },
				});
				c.deleteCookie({ name: "old", options: { path: "/" } });
				return {
					before,
					after: c.getCookie("theme"),
					setCookies: c.res?.headers.getSetCookie() ?? [],
				};
			},
		);
		await expect(
			entry({
				request: new Request("http://x.test/", {
					headers: { cookie: "theme=light; old=1" },
				}),
			}),
		).resolves.toEqual({
			before: "light",
			after: "dark",
			setCookies: [
				"theme=dark; Max-Age=60; Path=/; HttpOnly; SameSite=Lax",
				"old=; Max-Age=0; Path=/",
			],
		});
	});

	it("getCookie returns null without a request in scope", () => {
		const bare = v.fn("httpt.bare", { use: [http] }, (c) =>
			c.getCookie("theme"),
		);
		expect(bare()).toBeNull();
	});
});

describe("cookieOptions var - scope-level defaults", () => {
	it("defaults set anywhere in scope apply below; per-call options win", async () => {
		const entry = app.fn("httpt.ck_defaults", async (c) => {
			c.cookieOptions = { path: "/", secure: true, sameSite: "strict" };
			c.setCookie({ name: "sid", value: "s1" });
			c.setCookie({
				name: "csrf",
				value: "t",
				options: { sameSite: "lax" },
			});
			return c.res?.headers.getSetCookie() ?? [];
		});
		await expect(entry()).resolves.toEqual([
			"sid=s1; Path=/; Secure; SameSite=Strict",
			"csrf=t; Path=/; Secure; SameSite=Lax",
		]);
	});
});

describe("cookie options schema", () => {
	it("options validate at the door - a bad sameSite is refused", () => {
		const entry = app.fn("httpt.ck_bad", (c) => {
			c.setCookie({
				name: "sid",
				value: "s1",
				options: { sameSite: "sideways" as never },
			});
		});
		expect(() => entry()).toThrow(/sameSite/);
	});

	it("expires must be a real Date", () => {
		const entry = app.fn("httpt.ck_date", (c) => {
			c.setCookie({
				name: "sid",
				value: "s1",
				options: { expires: "tomorrow" as never },
			});
		});
		expect(() => entry()).toThrow(/expected date/);
	});
});
