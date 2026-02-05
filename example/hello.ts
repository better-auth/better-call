import { createEndpoint } from 'better-call';
import { createRouter } from 'better-call';
import { z } from "zod";

const hello = createEndpoint(
	"/hello",
	{
		method: "POST",
		body: z.object({
			name: z.string(),
		}),
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
		c.setCookie("hello", "world");
		c.setCookie("test", "value");
		return "hello from better-call!";
	},
);

const router = createRouter({ hello });

Bun.serve({
	fetch: router.handler,
});
