import { describe, expectTypeOf, it } from "vitest";
import { v } from ".";
import { http } from "./plugins/http";

describe("builder.on(fn) context inference", () => {
	it("types c from the builder's use plus the target fn", () => {
		const app = v.fn({ use: [http()] });

		const session = app.fn(
			"session",
			{
				path: "/session",
				method: "GET",
				requires: ["req"],
				use: [
					{
						test: v.var("test", {
							default: null as { name: string } | null,
						}),
					},
				],
			},
			async (c) => {
				expectTypeOf(c.req).not.toEqualTypeOf<null>();
				expectTypeOf(c.test).toEqualTypeOf<{ name: string } | null>();
				return { path: c.req.path };
			},
		);

		expectTypeOf(session.$route.path).toEqualTypeOf<"/session">();
		expectTypeOf(session.$route.method).toEqualTypeOf<"GET">();

		app.on(session, (c, next) => {
			expectTypeOf(c.req).not.toEqualTypeOf<null>();
			expectTypeOf(c.test).toEqualTypeOf<{ name: string } | null>();
			expectTypeOf(c.route).toMatchTypeOf<{
				path: string;
				method: string;
				invalidate: string[];
			} | null>();
			return next();
		});
	});
});
