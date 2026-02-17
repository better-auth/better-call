import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createEndpoint } from "./endpoint";
import { APIError, BetterCallError } from "./error";
import { createMiddleware } from "./middleware";

describe("validation", (it) => {
	it("should validate body and throw validation error", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				body: v.object({
					name: v.string(),
				}),
			},
			async (ctx) => {
				ctx.body;
				ctx.headers;
				return ctx.body;
			},
		);

		await expect(
			endpoint({
				//@ts-expect-error
				body: { name: 1 },
			}),
		).rejects.toThrowError(
			"[body.name] Invalid type: Expected string but received 1",
		);
	});

	it("should validate query and throw validation error", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "GET",
				query: v.object({
					name: v.string(),
				}),
			},
			async (ctx) => {
				return ctx.query;
			},
		);

		await expect(
			endpoint({
				//@ts-expect-error
				query: { name: 1 },
			}),
		).rejects.toThrowError(
			`[query.name] Invalid type: Expected string but received 1`,
		);
	});

	it("should validate the body and return the body", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				body: z.object({
					name: z.string().transform((val) => `${val}-validated`),
				}),
			},
			async (ctx) => {
				return ctx.body;
			},
		);
		const response = await endpoint({
			body: {
				name: "test",
			},
		});

		expect(response.name).toBe("test-validated");
	});

	it("should validate the body and return the query", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "GET",
				query: z.object({
					name: z.string().transform((val) => `${val}-validated`),
				}),
			},
			async (ctx) => {
				return ctx.query;
			},
		);
		const response = await endpoint({
			query: {
				name: "test",
			},
		});
		expect(response.name).toBe("test-validated");
	});

	it("should throw BetterCallError if body is not allowed with GET or HEAD", async () => {
		expect(() =>
			createEndpoint(
				"/test",
				{
					method: "GET",
					//@ts-expect-error - body should not be allowed with GET or HEAD
					body: z.object({
						name: z.string(),
					}),
				},
				async (ctx: any) => {
					return ctx.body;
				},
			),
		).toThrowError(BetterCallError);
	});

	it("should throw BetterCallError if path contains consecutive slashes", async () => {
		expect(() =>
			createEndpoint(
				"/test//path",
				{
					method: "GET",
				},
				async () => {
					return "hello";
				},
			),
		).toThrowError(BetterCallError);

		expect(() =>
			createEndpoint(
				"//test",
				{
					method: "GET",
				},
				async () => {
					return "hello";
				},
			),
		).toThrowError(BetterCallError);

		expect(() =>
			createEndpoint(
				"/test///nested",
				{
					method: "GET",
				},
				async () => {
					return "hello";
				},
			),
		).toThrowError(BetterCallError);
	});
});

describe("types", async () => {
	it("body", async () => {
		createEndpoint(
			"/test",
			{
				method: "POST",
				body: z.object({
					name: z.string(),
				}),
			},
			async (ctx) => {
				expectTypeOf(ctx.body).toEqualTypeOf<{ name: string }>();
			},
		);

		createEndpoint(
			"/test",
			{
				method: "POST",
				body: z.object({
					name: z.string().optional(),
				}),
			},
			async (ctx) => {
				expectTypeOf(ctx.body).toEqualTypeOf<{ name?: string }>();
			},
		);

		createEndpoint(
			"/test",
			{
				method: "POST",
				body: z
					.object({
						name: z.string(),
					})
					.optional(),
			},
			async (ctx) => {
				expectTypeOf(ctx.body).toEqualTypeOf<{ name: string } | undefined>();
			},
		);

		createEndpoint(
			"/path",
			{
				method: "POST",
				body: z.record(z.string(), z.string()),
				metadata: {
					$Infer: {
						body: {} as {
							hello: "world";
						},
					},
				},
			},
			async (c) => {
				expectTypeOf(c.body).toMatchTypeOf<{
					hello: "world";
				}>();
			},
		);
	});

	it("query", async () => {
		createEndpoint(
			"/test",
			{
				method: "GET",
				query: z.object({
					name: z.string(),
				}),
			},
			async (ctx) => {
				expectTypeOf(ctx.query).toEqualTypeOf<{ name: string }>();
			},
		);

		createEndpoint(
			"/test",
			{
				method: "GET",
				query: z.object({
					name: z.string().optional(),
				}),
			},
			async (ctx) => {
				expectTypeOf(ctx.query).toEqualTypeOf<{ name?: string }>();
			},
		);

		createEndpoint(
			"/test",
			{
				method: "GET",
				query: z.optional(
					z.object({
						name: z.string(),
					}),
				),
			},
			async (ctx) => {
				expectTypeOf(ctx.query).toEqualTypeOf<{ name: string } | undefined>();
			},
		);

		createEndpoint(
			"/path",
			{
				method: "POST",
				body: z.record(z.string(), z.string()),
				metadata: {
					$Infer: {
						query: {} as {
							hello: "world";
						},
					},
				},
			},
			async (c) => {
				expectTypeOf(c.query).toMatchTypeOf<{
					hello: "world";
				}>();
			},
		);
	});

	it("params", async () => {
		createEndpoint(
			"/:id",
			{
				method: "GET",
			},
			async (ctx) => {
				expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
			},
		);

		createEndpoint(
			"/leading-path/:id",
			{
				method: "GET",
			},
			async (ctx) => {
				expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
			},
		);

		createEndpoint(
			"/leading-path/:id/:name",
			{
				method: "GET",
			},
			async (ctx) => {
				ctx.params;
				expectTypeOf(ctx.params).toEqualTypeOf<{ id: string; name: string }>();
			},
		);
	});

	it("wildcard params", async () => {
		createEndpoint(
			"/api/*",
			{
				method: "GET",
			},
			async (ctx) => {
				expectTypeOf(ctx.params).toEqualTypeOf<{ _: string }>();
			},
		);

		createEndpoint(
			"/api/:id/*",
			{
				method: "GET",
			},
			async (ctx) => {
				expectTypeOf(ctx.params).toEqualTypeOf<{ _: string; id: string }>();
			},
		);
	});

	it("method", async () => {
		createEndpoint(
			"/test",
			{
				method: "GET",
			},
			async (ctx) => {
				expectTypeOf(ctx.method).toEqualTypeOf<"GET">();
			},
		);

		const endpoint = createEndpoint(
			"/test",
			{
				method: ["POST", "GET"],
			},
			async (ctx) => {
				expectTypeOf(ctx.method).toEqualTypeOf<"POST" | "GET">();
			},
		);
		// method should be optional for array methods (defaults to first method)
		endpoint({});
		// but you can still explicitly specify a method
		endpoint({ method: "POST" });
		endpoint({ method: "GET" });
		const wildCardMethodEndpoint = createEndpoint(
			"/test",
			{
				method: "*",
			},
			async (ctx) => {
				expectTypeOf(ctx.method).toEqualTypeOf<
					"POST" | "GET" | "DELETE" | "PUT" | "PATCH" | "HEAD"
				>();
			},
		);
		//@ts-expect-error - wildcard method should still require explicit method
		wildCardMethodEndpoint({});
	});
	it("response", async () => {
		const endpoint1 = createEndpoint(
			"/test",
			{
				method: "GET",
			},
			async (ctx) => {
				return { name: "test" };
			},
		);
		const jsonResponse1 = await endpoint1();
		expectTypeOf(jsonResponse1).toEqualTypeOf<{ name: string }>();
		const objResponse1 = await endpoint1({ asResponse: true });
		expectTypeOf(objResponse1).toEqualTypeOf<Response>();
	});

	it("shouldn't allow GET or HEAD with body", async () => {
		try {
			createEndpoint(
				"/path",
				{
					method: "GET",
					//@ts-expect-error - body should not be allowed with GET or HEAD
					body: z.object({
						name: z.string(),
					}),
				},
				async (ctx: any) => {
					return ctx.body;
				},
			);

			createEndpoint(
				"/path",
				{
					method: "HEAD",
					//@ts-expect-error - body should not be allowed with HEAD
					body: z.object({
						name: z.string(),
					}),
				},
				async (ctx: any) => {
					throw ctx.error("BAD_REQUEST", {
						message: "Body is not allowed with HEAD",
					});
				},
			);
		} catch (e) {
			//should throw BetterCallError
		}
	});
});

describe("virtual endpoints", () => {
	it("should work for path-less endpoints", async () => {
		for (const value of [1, "hello", true]) {
			const endpoint = createEndpoint(
				{
					method: "POST",
				},
				async (ctx) => {
					expect(ctx.path).toBe("virtual:");
					return value;
				},
			);
			const response = await endpoint();
			expect(response).toBe(value);
		}
	});
});

describe("response", () => {
	describe("flat", () => {
		it("should return primitive values", async () => {
			for (const value of [1, "hello", true]) {
				const endpoint = createEndpoint(
					"/path",
					{
						method: "POST",
					},
					async (ctx) => {
						return value;
					},
				);
				const response = await endpoint();
				expect(response).toBe(value);
			}
		});
	});

	describe("setStatus", () => {
		it("should provide access to the response status on a plain object", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
				},
				async (ctx) => {
					ctx.setStatus(201);
					return { test: "response" };
				},
			);
			const response = await endpoint({
				returnStatus: true,
			});
			expect(response.status).toBe(201);
			expect(response.response).toMatchObject({
				test: "response",
			});
		});

		it("should provide access to the response status and headers on a plain object", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
				},
				async (ctx) => {
					ctx.setStatus(201);
					return { test: "response" };
				},
			);
			const response = await endpoint({
				returnStatus: true,
				returnHeaders: true,
			});
			expect(response.status).toBe(201);
			expect(response.headers).toBeInstanceOf(Headers);
			expect(response.response).toMatchObject({
				test: "response",
			});
		});

		it("should provide access to the response status and headers on ctx.json()", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
				},
				async (ctx) => {
					ctx.setStatus(201);
					return ctx.json({ test: "response" });
				},
			);
			const response = await endpoint({
				returnStatus: true,
			});
			expect(response.status).toBe(201);
			expect(response.response).toMatchObject({
				test: "response",
			});
		});

		it("should provide access to the response status and headers on a plain object (as response)", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
				},
				async (ctx) => {
					ctx.setStatus(201);
					return { test: "response" };
				},
			);
			const response = await endpoint({
				asResponse: true,
			});
			expect(response.status).toBe(201);
			expect(response.headers).toBeInstanceOf(Headers);
			expect(await response.json()).toMatchObject({
				test: "response",
			});
		});

		it("should provide access to the response status and headers on a response object", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
				},
				async (ctx) => {
					ctx.setStatus(201); // ignored
					return Response.json({ test: "response" });
				},
			);
			const response = await endpoint();
			expect(response.status).toBe(200);
			expect(response.headers).toBeInstanceOf(Headers);
			expect(await response.json()).toMatchObject({
				test: "response",
			});
		});
	});

	describe("json", () => {
		it("should return a js object response on direct call", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
				},
				async (ctx) => {
					return ctx.json({ test: "response" });
				},
			);
			const response = await endpoint();
			expect(response).toMatchObject({
				test: "response",
			});
		});

		it("should return a js object response with 201 status", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
					status: 201,
				},
				async (ctx) => {
					return ctx.json(
						{ test: "response" },
						{
							status: 201,
						},
					);
				},
			);
			const response = await endpoint({
				asResponse: true,
			});
			await expect(response.json()).resolves.toMatchObject({
				test: "response",
			});
			expect(response.status).toBe(201);
		});

		it("should return a correct header asResponse", async () => {
			const endpoint = createEndpoint(
				"/path",
				{
					method: "POST",
					status: 201,
				},
				async (ctx) => {
					ctx.setHeader("X-Custom-Header", "hello world");
					return ctx.json({ test: "response" });
				},
			);

			const response = await endpoint({
				asResponse: true,
			});

			const json = await response.json();
			expect(json).toStrictEqual({
				test: "response",
			});
			const headers = response.headers.get("X-Custom-Header");
			expect(headers).toBe("hello world");
		});
	});

	it("should return a js object response (asResponse)", async () => {
		const endpoint = createEndpoint(
			"/path",
			{
				method: "POST",
				status: 200,
			},
			async (ctx) => {
				return ctx.json({ test: "response" });
			},
		);
		const response = await endpoint({
			asResponse: true,
		});
		await expect(response.json()).resolves.toMatchObject({
			test: "response",
		});
		expect(response.status).toBe(200);
	});

	describe("as-response", () => {
		it("should return a response object", async () => {
			const responses = [
				{
					type: "number",
					value: 1,
				},
				{
					type: "string",
					value: "hello world!",
				},
				{
					type: "object",
					value: {
						hello: "world",
					},
				},
				{
					type: "object",
					value: ["1", "2", "3"],
				},
			];
			for (const value of responses) {
				const endpoint = createEndpoint(
					"/path",
					{
						method: "POST",
					},
					async () => {
						return value.value;
					},
				);
				const response = await endpoint({
					asResponse: true,
				});
				const body = await response.text();
				if (value.type !== "object") {
					expect(body).toBe(value.value.toString());
				} else {
					expect(body).toMatch(JSON.stringify(value.value));
				}
			}
		});
	});

	describe("redirect", () => {
		it("should return redirect response", async () => {
			const endpoint = createEndpoint(
				"/endpoint",
				{
					method: "POST",
				},
				async (c) => {
					return c.redirect("/");
				},
			);
			const response = await endpoint();
			expect(response).instanceOf(APIError);
			expect(response.status).toBe("FOUND");
			expect(response.statusCode).toBe(302);
		});
	});

	describe("set-headers", () => {
		it("should set headers", async () => {
			const endpoint = createEndpoint(
				"/endpoint",
				{
					method: "POST",
				},
				async (c) => {
					c.setHeader("hello", "world");
				},
			);
			const response = await endpoint({
				asResponse: true,
			});
			expect(response.headers.get("hello")).toBe("world");

			const response2 = await endpoint({
				returnHeaders: true,
			});
			expect(response2.headers.get("hello")).toBe("world");
		});
	});

	describe("API Error", () => {
		it("should throw API Error", async () => {
			const endpoint = createEndpoint(
				"/endpoint",
				{
					method: "POST",
				},
				async (c) => {
					throw c.error("NOT_FOUND");
				},
			);
			await expect(endpoint()).rejects.toThrowError(APIError);
		});

		it("should return error Response", async () => {
			const endpoint = createEndpoint(
				"/endpoint",
				{
					method: "POST",
				},
				async (c) => {
					throw c.error("NOT_FOUND");
				},
			);
			const response = await endpoint({
				asResponse: true,
			});
			expect(response.status).toBe(404);
		});

		it("should return error Response with it's body", async () => {
			const endpoint = createEndpoint(
				"/endpoint",
				{
					method: "POST",
				},
				async (c) => {
					throw c.error("BAD_REQUEST", {
						message: "error message",
					});
				},
			);
			const response = await endpoint({
				asResponse: true,
			});
			const body = await response.json();
			expect(response.status).toBe(400);
			expect(body).toMatchObject({
				message: "error message",
			});
		});

		it("custom validation errors", async () => {
			const endpoint = createEndpoint(
				"/endpoint",
				{
					method: "POST",
					body: z.string().min(1000),
					onValidationError({ issues, message }) {
						expect(typeof message).toBe("string");
						expect(issues.length).toBeGreaterThan(0);
						throw new APIError("I'M_A_TEAPOT", {
							message: "Such a useful error status.",
						});
					},
				},
				async (c) => {
					return c.json({
						success: false, // Should never receive this.
					});
				},
			);
			try {
				const response = await endpoint({
					body: "I'm less than 1000 characters",
				});
				// This ensures that there is an error thrown.
				expect(response).not.toBeCalled();
			} catch (error) {
				expect(error).toBeInstanceOf(APIError);
				if (!(error instanceof APIError)) return;
				// Ensure it's the validation error we defined.
				expect(error.status).toBe("I'M_A_TEAPOT");
				expect(error.message).toBe("Such a useful error status.");
			}
		});
	});
	describe("json", async () => {
		it("should return the json directly", async () => {
			const endpoint = createEndpoint(
				"/",
				{
					method: "GET",
				},
				async (c) => {
					return c.json(
						{ name: "hello" },
						new Response(
							JSON.stringify({
								client: "hello",
							}),
						),
					);
				},
			);
			const response = await endpoint();
			expect(response).toMatchObject({
				name: "hello",
			});
		});
	});
});

describe("creator", () => {
	it("should use creator context", async () => {
		const creator = createEndpoint.create({
			use: [
				createMiddleware(async () => {
					return {
						hello: "world",
					};
				}),
			],
		});
		const endpoint = creator(
			"/path",
			{
				method: "POST",
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

	it("should be able to combine with endpoint middleware", async () => {
		const creator = createEndpoint.create({
			use: [
				createMiddleware(async () => {
					return {
						hello: "world",
					};
				}),
			],
		});
		const endpoint = creator(
			"/path",
			{
				method: "POST",
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
		const response = await endpoint();
		expect(response).toMatchObject({
			hello: "world",
			test: "payload",
		});
	});
});

describe("context parameter", () => {
	it("should pass context from input parameter to endpoint", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				body: z.object({
					name: z.string(),
				}),
			},
			async (ctx) => {
				// Context should be accessible in the endpoint handler
				return {
					body: ctx.body,
					context: ctx.context,
				};
			},
		);

		const response = await endpoint({
			body: { name: "test" },
			context: {
				userId: "123",
				requestId: "req-456",
			},
		});

		expect(response.body.name).toBe("test");
		expect(response.context).toMatchObject({
			userId: "123",
			requestId: "req-456",
		});
	});

	it("should merge context with middleware context", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				use: [
					createMiddleware(async () => {
						return {
							fromMiddleware: "middleware-value",
						};
					}),
				],
			},
			async (ctx) => {
				return ctx.context;
			},
		);

		const response = await endpoint({
			context: {
				fromInput: "input-value",
			},
		});

		// Both middleware context and input context should be available
		expect(response).toMatchObject({
			fromMiddleware: "middleware-value",
			fromInput: "input-value",
		});
	});

	it("should handle empty context parameter", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "GET",
			},
			async (ctx) => {
				return ctx.context;
			},
		);

		const response = await endpoint();

		// Should have empty context object
		expect(response).toEqual({});
	});

	it("should allow context with complex nested objects", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
			},
			async (ctx) => {
				return ctx.context;
			},
		);

		const complexContext = {
			user: {
				id: "123",
				profile: {
					name: "Test User",
					email: "test@example.com",
				},
			},
			metadata: {
				traceId: "trace-123",
				tags: ["tag1", "tag2"],
			},
		};

		const response = await endpoint({
			context: complexContext,
		});

		expect(response).toEqual(complexContext);
	});
});

describe("onAPIError", () => {
	it("should call onAPIError", async () => {
		let error: APIError | undefined;
		const endpoint = createEndpoint(
			"/path",
			{
				method: "POST",
				onAPIError: async (e) => {
					console.log("onAPIError", e);
					error = e;
				},
			},
			async (c) => {
				throw c.error("UNAUTHORIZED");
			},
		);
		await endpoint().catch(() => {});
		expect(error).toBeDefined();
		expect(error?.status).toBe("UNAUTHORIZED");
	});
});
