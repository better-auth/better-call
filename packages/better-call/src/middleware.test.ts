import { describe, expect, expectTypeOf, it } from "vitest";
import { createMiddleware } from "./v2/middleware";
import { createEndpoint } from "./v2/endpoint";
import { APIError, kAPIErrorHeaderSymbol } from "./error";

describe("type", () => {
	it("should infer middleware returned type", async () => {
		const middleware = createMiddleware(async (c) => {
			return {
				test: 1,
			};
		});
		const middleware2 = createMiddleware(async (c) => {
			return {
				hello: "world",
			};
		});
		createEndpoint(
			"/",
			{
				method: "POST",
				use: [middleware, middleware2],
			},
			async (c) => {
				expectTypeOf(c.context).toMatchTypeOf<{
					hello: string;
					test: number;
				}>();
			},
		);
	});
});

describe("runtime", () => {
	it("should run middleware", async () => {
		const middleware = createMiddleware(async () => {
			return {
				hello: "world",
			};
		});
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				use: [middleware],
			},
			async (ctx) => {
				return ctx.context;
			},
		);
		const response = await endpoint();
		expect(response).toMatchObject({
			hello: "world",
		});
	});

	it("should run multiple middleware", async () => {
		const middleware = createMiddleware(async () => {
			return {
				hello: "world",
			};
		});
		const middleware2 = createMiddleware(async () => {
			return {
				test: 2,
			};
		});
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				use: [middleware, middleware2],
			},
			async (ctx) => {
				return ctx.context;
			},
		);
		const response = await endpoint();
		expect(response).toMatchObject({
			hello: "world",
			test: 2,
		});
	});
});

describe("creator", () => {
	it("should use creator middlewares", async () => {
		const creator = createMiddleware.create({
			use: [
				createMiddleware(async (c) => {
					return {
						hello: "world",
					};
				}),
			],
		});

		const middleware = creator(async (c) => {
			expectTypeOf(c.context).toMatchTypeOf<{
				hello: string;
			}>();

			return c.context;
		});

		const endpoint = createEndpoint(
			"/",
			{
				use: [middleware],
				method: "GET",
			},
			async (c) => {
				return c.context;
			},
		);
		const response = await endpoint();
		expect(response).toMatchObject({
			hello: "world",
		});
	});

	it("should be able to combine with local middleware", async () => {
		const creator = createMiddleware.create({
			use: [
				createMiddleware(async () => {
					return {
						hello: "world",
					};
				}),
			],
		});
		const middleware = creator(
			{
				use: [
					createMiddleware(async () => {
						return {
							test: "payload",
						};
					}),
				],
			},
			async (c) => {
				return c.context;
			},
		);

		const endpoint = createEndpoint(
			"/path",
			{
				use: [middleware],
				method: "POST",
			},
			async (c) => {
				return c.context;
			},
		);
		const response = await endpoint();
		expect(response).toMatchObject({
			hello: "world",
			test: "payload",
		});
	});

	it("should get header set in middleware when error is thrown", async () => {
		const middleware = createMiddleware(async (ctx) => {
			ctx.setHeader("X-Test", "test");
			throw new APIError("BAD_REQUEST");
		});

		await expect(middleware({})).rejects.toThrowError(APIError);
		await expect(
			middleware({}).catch((e: any) => {
				const headers = e[kAPIErrorHeaderSymbol] as Headers;
				expect(headers.get("X-Test")).toBe("test");
			}),
		).resolves.toBeUndefined();
	});
});
