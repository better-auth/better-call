import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createClient } from "./client";
import { createEndpoint } from "./endpoint";
import { createMiddleware } from "./middleware";
import { createRouter, type Router } from "./router";

describe("client", () => {
	const getEndpoint = createEndpoint(
		"/test2",
		{
			method: "GET",
			query: z.object({
				hello: z.string(),
			}),
		},
		async (ctx) => {
			return {
				status: 200,
				body: {
					hello: "world",
				},
			};
		},
	);
	const endpoint = createEndpoint(
		"/test",
		{
			method: "POST",
			body: z.object({
				hello: z.string(),
			}),
		},
		async (ctx) => {
			return {
				status: 200,
				body: {
					hello: "world",
				},
			};
		},
	);

	const endpoint2 = createEndpoint(
		"/test3",
		{
			method: "GET",
			query: z.object({
				hello: z.string().optional(),
			}),
		},
		async (ctx) => {
			return {
				status: 200,
				body: {
					hello: "world",
				},
			};
		},
	);
	it("should send request and get response", async () => {
		const router = createRouter({
			endpoint,
			endpoint2,
			getEndpoint,
		});

		const client = createClient<typeof router>({
			baseURL: "http://localhost:3000",
			customFetchImpl: async (url, init) => {
				return router.handler(new Request(url, init));
			},
		});

		expectTypeOf<Parameters<typeof client>[0]>().toExtend<
			"@post/test" | "/test2" | "/test3"
		>();

		const response = await client("@post/test", {
			body: {
				hello: "world",
			},
		});
		expect(response.data).toMatchObject({
			status: 200,
			body: { hello: "world" },
		});
	});

	it("should infer types", async () => {
		const router = createRouter({
			endpoint,
			endpoint2,
			getEndpoint,
		});

		const client = createClient<typeof router>({
			baseURL: "http://localhost:3000",
			customFetchImpl: async (url, init) => {
				return new Response(null);
			},
		});

		const res = await client("@post/test", {
			body: {
				hello: "world",
			},
		});

		expectTypeOf<Parameters<typeof client>[0]>().toExtend<
			"@post/test" | "/test2" | "/test3"
		>();

		client("@post/test", {
			body: {
				//@ts-expect-error
				hello: 1,
			},
		});

		client("/test2", {
			query: {
				//@ts-expect-error
				hello: 2,
			},
		});
		client("/test3", {
			query: {},
		});
	});

	it("should call endpoint n", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				body: z.object({
					hello: z.string(),
				}),
			},
			async (ctx) => {
				return {
					status: 200,
					body: {
						hello: "world",
					},
				};
			},
		);
		const endpoint2 = createEndpoint(
			"/test2",
			{
				method: "GET",
			},
			async (ctx) => {
				return {
					status: 200,
					body: {
						hello: "world",
					},
				};
			},
		);

		const router = createRouter({
			endpoint,
			endpoint2,
		});

		const client = createClient<typeof router>({
			baseURL: "http://localhost:3000",
		});
		await client("@post/test", {
			body: {
				hello: "world",
			},
			customFetchImpl: async (url, init) => {
				expect(url.toString()).toBe("http://localhost:3000/test");
				expect(init?.method).toBe("POST");
				expect(init?.body).toBe('{"hello":"world"}');
				return new Response(null);
			},
		});
		await client("/test2", {
			customFetchImpl: async (url, init) => {
				expect(url.toString()).toBe("http://localhost:3000/test2");
				expect(init?.method).toBe("GET");
				return new Response(null);
			},
		});
	});

	it("should infer from custom creator", () => {
		const cr2 = createEndpoint.create({
			use: [
				createMiddleware(async (ctx) => {
					return {
						something: "",
					};
				}),
			],
		});

		const endpoint = cr2(
			"/test",
			{
				method: "POST",
			},
			async (ctx) => {
				return {
					status: 200,
					body: {
						hello: "world",
					},
				};
			},
		);
		const endpoints = {
			endpoint,
		};
		const client = createClient<typeof endpoints>({
			baseURL: "http://localhost:3000",
		});
		expectTypeOf<Parameters<typeof client>[0]>().toMatchTypeOf<"@post/test">();
	});

	it("should not infer client types for virtual and non-rpc scoped endpoints", async () => {
		const endpointVirtual = createEndpoint(
			{
				method: "GET",
			},
			async () => "",
		);

		const endpointNonAction = createEndpoint(
			"/test-non-action",
			{
				method: "GET",
				metadata: {
					isAction: false,
				},
			},
			async () => "",
		);

		const endpointServerOnly = createEndpoint(
			"/test-server-only",
			{
				method: "GET",
				metadata: {
					SERVER_ONLY: true,
				},
			},
			async () => "",
		);

		const endpointServerScoped = createEndpoint(
			"/test-server-scoped",
			{
				method: "GET",
				metadata: {
					scope: "server",
				},
			},
			async () => "",
		);

		const endpointHTTPScoped = createEndpoint(
			"/test-http-scoped",
			{
				method: "GET",
				metadata: {
					scope: "http",
				},
			},
			async () => "",
		);

		const router = createRouter({
			endpoint,
			endpointVirtual,
			endpointServerOnly,
			endpointHTTPScoped,
			endpointServerScoped,
			endpointNonAction,
		});

		const client = createClient<typeof router>({
			baseURL: "http://localhost:3000",
			customFetchImpl: async (url, init) => {
				return new Response(null);
			},
		});

		expectTypeOf<Parameters<typeof client>[0]>().toExtend<"@post/test">();
	});

	it("should not require an empty object", async () => {
		const router = createRouter({
			endpoint: createEndpoint(
				"/test",
				{
					method: "POST",
				},
				async (ctx) => {
					return { status: 200, body: { hello: "world" } };
				},
			),
			getEndpoint: createEndpoint(
				"/test2",
				{
					method: "GET",
				},
				async (ctx) => {
					return { status: 200, body: { hello: "world" } };
				},
			),
		});
		const client = createClient<typeof router>({
			baseURL: "http://localhost:3000",
			customFetchImpl: async (url, init) => {
				return new Response(null);
			},
		});
		expectTypeOf<Parameters<typeof client>[0]>().toExtend<
			"@post/test" | "/test2"
		>();
		client("@post/test", { body: undefined, query: undefined, params: undefined });
		client("/test2", { body: undefined, query: undefined, params: undefined });
	});
});
