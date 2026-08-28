import { describe, expect, it } from "vitest";
import { FnError, UnexpectedError, v } from "../../index";
import { applyRedirect, http, Redirect, redirect } from "./index";

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
		const response = { headers: new Headers() };
		applyRedirect(response, new Redirect("/home", 301));
		expect(response.status).toBe(301);
		expect(response.headers.get("location")).toBe("/home");
	});

	it("redirect is mounted on the http module", () => {
		expect(http.redirect).toBe(redirect);
		expect(http.Redirect).toBe(Redirect);
	});
});
