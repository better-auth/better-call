import { describe, expect, it } from "vitest";
import { createEndpoint, type Endpoint } from "./v2/endpoint";
import { createRouter } from "./v2/router";
import { z } from "zod";
import { APIError } from "./error";
import { getRequest } from "./adapters/node/request";
import { toResponse } from "./to-response";

describe("router", () => {
	it("should be able to return simple response", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({
			endpoint,
		});
		const request = new Request("http://localhost:3000");
		const response = await router.handler(request);
		const text = await response.text();
		expect(text).toBe("hello world");
	});
	it("should be able to route server or http scoped endpoints", async () => {
		const endpointServerScoped = createEndpoint(
			"/test-server-scoped",
			{
				method: "GET",
				metadata: {
					scope: "server",
				},
			},
			async () => {
				return "hello world";
			},
		);
		const endpointHTTPScoped = createEndpoint(
			"/test-http-scoped",
			{
				method: "GET",
				metadata: {
					scope: "http",
				},
			},
			async () => {
				return "hello world";
			},
		);
		const endpointNonAction = createEndpoint(
			"/test-non-action",
			{
				method: "GET",
				metadata: {
					isAction: false,
				},
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({
			endpointServerScoped,
			endpointHTTPScoped,
			endpointNonAction,
		});

		const endpointServerScopedResponse = await router.handler(
			new Request("http://localhost:3000/test-server-scoped"),
		);
		expect(endpointServerScopedResponse.status).toBe(200);

		const endpointHTTPScopedResponse = await router.handler(
			new Request("http://localhost:3000/test-http-scoped"),
		);
		expect(endpointHTTPScopedResponse.status).toBe(200);

		const endpointNonActionResponse = await router.handler(
			new Request("http://localhost:3000/test-non-action"),
		);
		expect(endpointNonActionResponse.status).toBe(200);
	});
	it("should not route virtual endpoints", async () => {
		const endpointVirtual = createEndpoint(
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const endpointServerOnly = createEndpoint(
			"/test-server-only",
			{
				method: "GET",
				metadata: {
					SERVER_ONLY: true,
				},
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({
			endpointVirtual,
			endpointServerOnly,
		});

		const endpointVirtualResponse = await router.handler(
			new Request("http://localhost:3000"),
		);
		expect(endpointVirtualResponse.status).toBe(404);

		const endpointServerOnlyResponse = await router.handler(
			new Request("http://localhost:3000/test-server-only"),
		);
		expect(endpointServerOnlyResponse.status).toBe(404);
	});
	it("should be able to router properly", async () => {
		const routes: {
			path: string;
			method: string;
			body?: any;
		}[] = [
			{
				path: "/",
				method: "GET",
			},
			{
				path: "/post",
				method: "POST",
			},
			{
				path: "/patch",
				method: "PATCH",
			},
			{
				path: "/delete",
				method: "DELETE",
			},
			{
				path: "/put",
				method: "PUT",
			},
		];
		const endpoints: Record<string, Endpoint> = {};
		for (const route of routes) {
			const endpoint = createEndpoint(
				route.path,
				{
					method: route.method as "GET",
				},
				async () => {
					return route.path;
				},
			);
			endpoints[route.path] = endpoint;
		}

		const router = createRouter(endpoints);
		for (const route of routes) {
			const request = new Request(`http://localhost:3000${route.path}`, {
				method: route.method,
			});
			const response = await router.handler(request).then((res) => res.text());
			expect(response).toBe(route.path);
		}
	});

	it("should not work with trailing slashes", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const endpoint2 = createEndpoint("/test2/", { method: "GET" }, async () => {
			return "hello world";
		});
		const router = createRouter({ endpoint, endpoint2 });
		const request = new Request("http://localhost/test/", {
			method: "GET",
		});
		const response = await router.handler(request);
		expect(response.status).toBe(404);
		const response2 = await router.handler(
			new Request("http://localhost/test2", { method: "GET" }),
		);
		expect(response2.status).toBe(404);
	});

	it("should work with trailing slashes if skipTrailingSlashes is set to true", async () => {
		const endpoint = createEndpoint("/test", { method: "GET" }, async () => {
			return "hello world";
		});
		const endpoint2 = createEndpoint("/test2/", { method: "GET" }, async () => {
			return "hello world";
		});
		const router = createRouter(
			{ endpoint, endpoint2 },
			{ skipTrailingSlashes: true },
		);
		const request = new Request("http://localhost/test/", {
			method: "GET",
		});
		const response = await router.handler(request);
		expect(response.status).toBe(200);
		const response2 = await router.handler(
			new Request("http://localhost/test2", { method: "GET" }),
		);
		expect(response2.status).toBe(200);
	});

	it("should not work with double slashes", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({ endpoint });
		const request = new Request("http://localhost/test//", {
			method: "GET",
		});
		const response = await router.handler(request);
		expect(response.status).toBe(404);
	});

	it("shouldn't work with double slashes in the middle of the path", async () => {
		const endpoint = createEndpoint(
			"/test/test",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({ endpoint });
		const request = new Request("http://localhost//test/test", {
			method: "GET",
		});
		const response = await router.handler(request);
		expect(response.status).toBe(404);
	});

	it("should return 404 for multiple consecutive slashes anywhere in path", async () => {
		const endpoint = createEndpoint(
			"/test/nested/path",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({ endpoint });

		// Test triple slashes
		const request1 = new Request("http://localhost/test///nested/path", {
			method: "GET",
		});
		const response1 = await router.handler(request1);
		expect(response1.status).toBe(404);

		// Test double slashes at start
		const request2 = new Request("http://localhost//test/nested/path", {
			method: "GET",
		});
		const response2 = await router.handler(request2);
		expect(response2.status).toBe(404);

		// Test double slashes at end
		const request3 = new Request("http://localhost/test/nested/path//", {
			method: "GET",
		});
		const response3 = await router.handler(request3);
		expect(response3.status).toBe(404);
	});

	it("requests with a body", async () => {
		const endpoint = createEndpoint(
			"/post",
			{
				method: "POST",
				body: z.object({
					name: z.string(),
				}),
			},
			async (c) => {
				return c.body;
			},
		);
		const router = createRouter({
			endpoint,
		});
		const request = new Request("http://localhost/post", {
			body: JSON.stringify({
				name: "hello",
			}),
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
		});
		const response = await router.handler(request).then((res) => res.json());
		expect(response).toMatchObject({ name: "hello" });
	});

	it("should work with request with a query param", async () => {
		const endpoint = createEndpoint(
			"/post",
			{
				method: "POST",
				query: z.object({
					name: z.string(),
				}),
			},
			async (c) => {
				return c.query;
			},
		);
		const router = createRouter({
			endpoint,
		});
		const request = new Request("http://localhost/post?name=hello", {
			method: "POST",
		});
		const response = await router.handler(request).then((res) => res.json());
		expect(response).toMatchObject({ name: "hello" });
	});

	it("should work with request with a query param with multiple values", async () => {
		const endpoint = createEndpoint(
			"/post",
			{
				method: "POST",
				query: z.object({
					name: z.array(z.string()),
				}),
			},
			async (c) => {
				return c.query;
			},
		);
		const router = createRouter({
			endpoint,
		});
		const request = new Request("http://localhost/post?name=hello&name=world", {
			method: "POST",
		});
		const response = await router.handler(request).then((res) => res.json());
		expect(response).toMatchObject({ name: ["hello", "world"] });
	});

	it("should work with request with dynamic param", async () => {
		const endpoint = createEndpoint(
			"/post/:id",
			{
				method: "POST",
			},
			async (c) => {
				return c.params;
			},
		);
		const router = createRouter({
			endpoint,
		});
		const request = new Request("http://localhost/post/1", {
			method: "POST",
		});
		const response = await router.handler(request).then((res) => res.json());
		expect(response).toMatchObject({ id: "1" });
	});

	it("should handle API Errors", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw new APIError("FORBIDDEN");
			},
		);
		const router = createRouter({ endpoint });
		const response = await router.handler(new Request("http://localhost"));
		expect(response.status).toBe(403);
	});

	it("should work with duplicate base path", async () => {
		const endpoint = createEndpoint(
			"/test/api/v1/test",
			{
				method: "GET",
			},
			async (c) => {
				return c.path;
			},
		);
		const router = createRouter({ endpoint }, { basePath: "/api/v1" });
		const response = await router.handler(
			new Request("http://localhost/api/v1/test/api/v1/test"),
		);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toBe("/test/api/v1/test");
	});

	it("node adapter getRequest should include Express baseUrl when present", async () => {
		const base = "http://localhost:3000";
		const fakeReq: any = {
			headers: { host: "localhost:3000" },
			method: "GET",
			url: "/auth/callback",
			baseUrl: "/api",
			httpVersionMajor: 1,
			destroyed: false,
		};
		const req = getRequest({ base, request: fakeReq });
		expect(new URL(req.url).href).toBe(
			"http://localhost:3000/api/auth/callback",
		);
	});

	it("node adapter getRequest should fall back to url when baseUrl is missing", async () => {
		const base = "http://localhost:3000";
		const fakeReq: any = {
			headers: { host: "localhost:3000" },
			method: "GET",
			url: "/auth/callback",
			httpVersionMajor: 1,
			destroyed: false,
		};
		const req = getRequest({ base, request: fakeReq });
		expect(new URL(req.url).href).toBe("http://localhost:3000/auth/callback");
	});
});

describe("route middleware", () => {
	it("should apply middleware as context", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async (c) => {
				const cx = c.json({ name: "hello" });
				return cx;
			},
		);
		const router = createRouter({ endpoint });
		const response = await router.handler(new Request("http://localhost"));
		const json = await response.json();
		expect(json).toMatchObject({ name: "hello" });
	});
});

describe("error handling", () => {
	it("should use onError callback when provided", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw new Error("Test error");
			},
		);

		let errorCaught = false;
		let receivedRequest: Request | undefined;
		const customResponse = new Response("Custom error response", {
			status: 418,
		});

		const router = createRouter(
			{ endpoint },
			{
				onError: (error, request) => {
					errorCaught = true;
					receivedRequest = request;
					return customResponse;
				},
			},
		);

		const request = new Request("http://localhost");
		const response = await router.handler(request);
		expect(errorCaught).toBe(true);
		expect(receivedRequest).toBe(request);
		expect(response).toBe(customResponse);
		expect(response.status).toBe(418);
	});

	it("should handle APIError converted to Response from onError callback", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw new Error("Test error");
			},
		);

		let errorCaught = false;
		const apiError = new APIError("BAD_REQUEST", {
			message: "Custom API error",
		});

		const router = createRouter(
			{ endpoint },
			{
				onError: (error, request) => {
					errorCaught = true;
					// Convert APIError to Response
					return toResponse(apiError);
				},
			},
		);

		const response = await router.handler(new Request("http://localhost"));
		expect(errorCaught).toBe(true);
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.message).toBe("Custom API error");
	});

	it("should throw custom error from onError callback", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw new Error("Original error");
			},
		);

		const newError = new Error("New error from onError");

		const router = createRouter(
			{ endpoint },
			{
				onError: (error, request) => {
					// Throw the error in the callback
					throw newError;
				},
			},
		);

		await expect(async () => {
			await router.handler(new Request("http://localhost"));
		}).rejects.toThrow(newError);
	});

	it("should re-throw error when throwError is true", async () => {
		const testError = new Error("Test error");
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw testError;
			},
		);

		const router = createRouter({ endpoint }, { throwError: true });

		await expect(async () => {
			await router.handler(new Request("http://localhost"));
		}).rejects.toThrow(testError);
	});

	it("should return 500 response when no error handling is provided", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw new Error("Test error");
			},
		);

		const router = createRouter({ endpoint });
		const response = await router.handler(new Request("http://localhost"));
		expect(response.status).toBe(500);
	});

	it("should handle APIError directly when no onError is provided", async () => {
		const apiError = new APIError("NOT_FOUND", {
			message: "Resource not found",
		});
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw apiError;
			},
		);

		const router = createRouter({ endpoint });
		const response = await router.handler(new Request("http://localhost"));
		expect(response.status).toBe(404);
		const body = await response.json();
		expect(body.message).toBe("Resource not found");
	});

	describe("allowedMediaTypes", () => {
		it("should allow requests with allowed media type at router level", async () => {
			const endpoint = createEndpoint(
				"/post",
				{
					method: "POST",
					body: z.object({
						name: z.string(),
					}),
				},
				async (c) => {
					return c.body;
				},
			);

			const router = createRouter(
				{ endpoint },
				{
					allowedMediaTypes: ["application/json"],
				},
			);

			const request = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "test" }),
			});

			const response = await router.handler(request);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.name).toBe("test");
		});

		it("should reject requests with disallowed media type at router level", async () => {
			const endpoint = createEndpoint(
				"/post",
				{
					method: "POST",
					body: z.object({
						name: z.string(),
					}),
				},
				async (c) => {
					return c.body;
				},
			);

			const router = createRouter(
				{ endpoint },
				{
					allowedMediaTypes: ["application/json"],
				},
			);

			const request = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
				},
				body: "plain text",
			});

			const response = await router.handler(request);
			expect(response.status).toBe(415);
			const body = await response.json();
			expect(body.code).toBe("UNSUPPORTED_MEDIA_TYPE");
			expect(body.message).toContain("text/plain");
			expect(body.message).toContain("application/json");
		});

		it("should allow endpoint-level allowedMediaTypes to override router-level", async () => {
			const endpoint = createEndpoint(
				"/post",
				{
					method: "POST",
					body: z.object({
						name: z.string(),
					}),
					metadata: {
						allowedMediaTypes: ["application/x-www-form-urlencoded"],
					},
				},
				async (c) => {
					return c.body;
				},
			);

			const router = createRouter(
				{ endpoint },
				{
					allowedMediaTypes: ["application/json"],
				},
			);

			// Should reject JSON (router-level) and accept form-urlencoded (endpoint-level)
			const jsonRequest = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "test" }),
			});

			const jsonResponse = await router.handler(jsonRequest);
			expect(jsonResponse.status).toBe(415);

			// Should accept form-urlencoded
			const formData = new URLSearchParams();
			formData.append("name", "test");
			const formRequest = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: formData.toString(),
			});

			const formResponse = await router.handler(formRequest);
			expect(formResponse.status).toBe(200);
		});

		it("should handle multiple allowed media types", async () => {
			const endpoint = createEndpoint(
				"/post",
				{
					method: "POST",
					body: z.object({
						name: z.string(),
					}),
				},
				async (c) => {
					return c.body;
				},
			);

			const router = createRouter(
				{ endpoint },
				{
					allowedMediaTypes: [
						"application/json",
						"application/x-www-form-urlencoded",
					],
				},
			);

			// Test JSON
			const jsonRequest = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "test" }),
			});

			const jsonResponse = await router.handler(jsonRequest);
			expect(jsonResponse.status).toBe(200);

			// Test form-urlencoded
			const formData = new URLSearchParams();
			formData.append("name", "test");
			const formRequest = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: formData.toString(),
			});

			const formResponse = await router.handler(formRequest);
			expect(formResponse.status).toBe(200);

			// Test disallowed type
			const textRequest = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
				},
				body: "plain text",
			});

			const textResponse = await router.handler(textRequest);
			expect(textResponse.status).toBe(415);
		});

		it("should handle content-type with charset parameter", async () => {
			const endpoint = createEndpoint(
				"/post",
				{
					method: "POST",
					body: z.object({
						name: z.string(),
					}),
				},
				async (c) => {
					return c.body;
				},
			);

			const router = createRouter(
				{ endpoint },
				{
					allowedMediaTypes: ["application/json"],
				},
			);

			const request = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/json; charset=utf-8",
				},
				body: JSON.stringify({ name: "test" }),
			});

			const response = await router.handler(request);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.name).toBe("test");
		});

		it("should not validate content-type when no body is present", async () => {
			const endpoint = createEndpoint(
				"/get",
				{
					method: "GET",
				},
				async () => {
					return { message: "success" };
				},
			);

			const router = createRouter(
				{ endpoint },
				{
					allowedMediaTypes: ["application/json"],
				},
			);

			const request = new Request("http://localhost/get", {
				method: "GET",
			});

			const response = await router.handler(request);
			expect(response.status).toBe(200);
		});

		it("should work without allowedMediaTypes configured", async () => {
			const endpoint = createEndpoint(
				"/post",
				{
					method: "POST",
					body: z.object({
						name: z.string(),
					}),
				},
				async (c) => {
					return c.body;
				},
			);

			const router = createRouter({ endpoint });

			// Should accept any content type
			const request = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "test" }),
			});

			const response = await router.handler(request);
			expect(response.status).toBe(200);
		});

		it("should work with JSON structured suffixes", async () => {
			// See https://datatracker.ietf.org/doc/html/rfc6839#section-3.1

			const endpoint = createEndpoint(
				"/post",
				{
					method: "POST",
					body: z.object({
						name: z.string(),
					}),
				},
				async (c) => {
					return c.body;
				},
			);

			const router = createRouter(
				{ endpoint },
				{
					allowedMediaTypes: ["application/scim+json"],
				},
			);

			const request = new Request("http://localhost/post", {
				method: "POST",
				headers: {
					"Content-Type": "application/scim+json",
				},
				body: JSON.stringify({ name: "test" }),
			});

			const response = await router.handler(request);
			expect(response.status).toBe(200);
		});
	});
});

describe("onRequest and onResponse callbacks", () => {
	it("should pass request to onRequest callback", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);

		let receivedRequest: Request | undefined;
		const router = createRouter(
			{ endpoint },
			{
				onRequest: (request) => {
					receivedRequest = request;
				},
			},
		);

		const request = new Request("http://localhost");
		await router.handler(request);
		expect(receivedRequest).toBe(request);
	});

	it("should pass response and request to onResponse callback", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);

		let receivedResponse: Response | undefined;
		let receivedRequest: Request | undefined;
		const router = createRouter(
			{ endpoint },
			{
				onResponse: (response, request) => {
					receivedResponse = response;
					receivedRequest = request;
				},
			},
		);

		const request = new Request("http://localhost");
		await router.handler(request);
		expect(receivedRequest).toBe(request);
		expect(receivedResponse).toBeInstanceOf(Response);
	});

	it("should pass request to onError callback", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "GET",
			},
			async () => {
				throw new Error("Test error");
			},
		);

		let receivedError: unknown;
		let receivedRequest: Request | undefined;
		const router = createRouter(
			{ endpoint },
			{
				onError: (error, request) => {
					receivedError = error;
					receivedRequest = request;
				},
			},
		);

		const request = new Request("http://localhost");
		await router.handler(request);
		expect(receivedRequest).toBe(request);
		expect(receivedError).toBeInstanceOf(Error);
		expect((receivedError as Error).message).toBe("Test error");
	});
});

describe("base path", () => {
	it("should work with base path", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({ endpoint }, { basePath: "/api" });
		const response = await router.handler(
			new Request("http://localhost/api/test"),
		);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toBe("hello world");
	});

	it("should work with base path with '/'", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "GET",
			},
			async () => {
				return "hello world";
			},
		);
		const router = createRouter({ endpoint }, { basePath: "/" });
		const response = await router.handler(new Request("http://localhost/test"));
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toBe("hello world");
	});
});
