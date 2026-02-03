import { createEndpoint, createRouter, createMiddleware } from "better-call";
import { z } from "zod";

const middleware = createMiddleware(async (ctx) => {
	return {
		test: "hello",
	};
});

const middleware2 = createMiddleware(async (ctx) => {
	return {
		test2: "world",
	};
});

const hello = createEndpoint(
	"/hello",
	{
		method: "POST",
		body: z.object({
			name: z.string(),
		}),
		use: [middleware, middleware2],
		metadata: {
			openapi: {
				responses: {
					"200": {
						description: "Welcome Page",
						content: {
							"text/plain": {
								schema: {
									type: "string",
								},
							},
						},
					},
				},
			},
		},
	},
	async (c) => {
		c.context;
		c.setCookie("hello", "world");
		c.setCookie("test", "value");
		return "hello from better-call!";
	},
);

const router = createRouter({ hello });

Bun.serve({
	fetch: router.handler,
});
