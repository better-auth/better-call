import { describe, expect, it } from "vitest";
import { v } from "../index";
import * as http from "./http";

const app = v.fn({ use: [http] });

const whoami = app.fn("httpt.whoami", { requires: ["request"] }, (c) => ({
	method: c.var.method,
	path: c.var.path,
	ua: c.var.headers.get("user-agent"),
	q: c.var.query,
	cookie: c.var.cookies.theme ?? null,
	body: c.var.body ?? null,
}));

describe("fromRequest (web adapter)", () => {
	it("derives everything from one request var", async () => {
		const entry = v.fn({ use: [http, { whoami }] }).fn(async (c) => {
			await c.use.fromRequest({
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
			return c.use.whoami();
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
		expect(() => whoami()).toThrow(/required var "request" is not set/);
	});
});
