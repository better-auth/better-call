import { describe, expect, expectTypeOf, it } from "vitest";
import { FnError, UnexpectedError, v } from "../../index";
import {
	applyRedirect,
	asResponse,
	createHandler,
	type HttpResponse,
	http,
	Redirect,
	redirect,
} from "./index";

const app = v.fn({ use: [http] });

describe("http.redirect", () => {
	it("writes Location + 302 onto res, then throws Redirect", () => {
		const entry = app.fn("httpt.redirect.default", (c) => {
			c.res = { headers: new Headers() };
			c.redirect({ url: "/dashboard" });
		});

		try {
			entry();
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Redirect);
			expect(thrown).not.toBeInstanceOf(FnError);
			expect(thrown).not.toBeInstanceOf(UnexpectedError);
			if (!(thrown instanceof Redirect)) return;
			expect(thrown.url).toBe("/dashboard");
			expect(thrown.status).toBe(302);
		}
	});

	it("accepts an explicit redirect status", () => {
		const entry = app.fn(
			"httpt.redirect.see_other",
			{ use: [{ redirect }] },
			(c) => {
				c.redirect({ url: "/done", status: 303 });
			},
		);

		expect(() => entry()).toThrow(Redirect);
		try {
			entry();
		} catch (thrown) {
			expect(thrown).toMatchObject({ url: "/done", status: 303 });
		}
	});

	it("creates res when none is in scope yet", () => {
		const entry = app.fn("httpt.redirect.no_res", (c) => {
			try {
				c.redirect({ url: "/x" });
			} catch (thrown) {
				expect(c.res?.status).toBe(302);
				expect(c.res?.headers.get("location")).toBe("/x");
				throw thrown;
			}
		});
		expect(() => entry()).toThrow(Redirect);
	});

	it("crosses a parent that declares errors without becoming UnexpectedError", () => {
		const leave = app.fn("httpt.redirect.leave", (c) => {
			c.redirect({ url: "/out" });
		});

		const gated = app.fn(
			"httpt.redirect.gated",
			{
				errors: { denied: {} },
				use: [{ leave }],
			},
			(c) => c.leave(),
		);

		try {
			gated();
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Redirect);
			expect(thrown).not.toBeInstanceOf(UnexpectedError);
			if (thrown instanceof Redirect) {
				expect(thrown.url).toBe("/out");
				expect(thrown.status).toBe(302);
			}
		}
	});

	it(".try does not catch Redirect - only declared FnErrors", () => {
		const bounce = app.fn(
			"httpt.redirect.try",
			{ errors: { nope: {} } },
			(c) => {
				c.redirect({ url: "/away" });
			},
		);

		expect(() => bounce.try()).toThrow(Redirect);
	});

	it("rejects a non-redirect status at the door", () => {
		const entry = app.fn("httpt.redirect.bad_status", (c) => {
			c.redirect({ url: "/x", status: 200 as never });
		});
		expect(() => entry()).toThrow(/one of|enum|status/i);
	});

	it("applyRedirect writes status + Location onto a response", () => {
		const response: HttpResponse = { headers: new Headers() };
		applyRedirect(response, new Redirect("/home", 301));
		expect(response.status).toBe(301);
		expect(response.headers.get("location")).toBe("/home");
	});

	it("asResponse turns Redirect into a fetch Response", () => {
		const response: HttpResponse = { headers: new Headers() };
		response.headers.set("x-powered-by", "better-call");
		const out = asResponse(new Redirect("/home", 303), response);
		expect(out.status).toBe(303);
		expect(out.headers.get("location")).toBe("/home");
		expect(out.headers.get("x-powered-by")).toBe("better-call");
	});

	it("asResponse rethrows non-Redirect values", () => {
		expect(() => asResponse(new Error("nope"))).toThrow(/nope/);
	});

	it("createHandler catches Redirect and returns a 3xx Response", async () => {
		const handle = createHandler((c) => {
			c.redirect({ url: "/dashboard" });
		});
		const response = await handle(new Request("http://x.test/"));
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/dashboard");
	});

	it("mounted c.handler catches Redirect from run", async () => {
		const entry = app.fn(
			"httpt.redirect.mounted_handler",
			{ input: { request: v.any<Request>() } },
			async (c) =>
				c.handler({
					request: c.input.request,
					run: (ctx) => {
						ctx.redirect({ url: "/in", status: 303 });
					},
				}),
		);
		const response = await entry({
			request: new Request("http://x.test/"),
		});
		expect(response).toBeInstanceOf(Response);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/in");
	});

	it("createHandler preserves cookies set before redirect", async () => {
		const handle = createHandler((c) => {
			c.setCookie({ name: "sid", value: "1", options: { path: "/" } });
			c.redirect({ url: "/app", status: 303 });
		});
		const response = await handle(new Request("http://x.test/"));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/app");
		expect(response.headers.getSetCookie()).toEqual(["sid=1; Path=/"]);
	});

	it("createHandler passes through a returned Response", async () => {
		const handle = createHandler(() => Response.json({ ok: true }));
		const response = await handle(new Request("http://x.test/"));
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("createHandler mounts options.use onto the same c that run receives", async () => {
		const whoami = app.fn("httpt.whoami_edge", { requires: ["req"] }, (c) => ({
			path: c.req.path,
		}));
		const handle = createHandler(
			(c) => {
				expectTypeOf(c.whoami).toBeCallableWith();
				return c.whoami();
			},
			{ use: [{ whoami }] },
		);
		const response = await handle(new Request("http://x.test/me"));
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ path: "/me" });
	});

	it("redirect is mounted on the http module", () => {
		expect(http.redirect).toBe(redirect);
		expect(http.Redirect).toBe(Redirect);
		expect(http.createHandler).toBe(createHandler);
		expect(http.handler).toBeDefined();
	});
});
