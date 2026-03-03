import { createEndpoint, createMiddleware, createRouter } from "better-call";
import { createClient } from "better-call/client";
import * as z from "zod";

type Context = {
	readonly test: "demo";
};

const contextMiddleware = createMiddleware(async () => {
	return {} as Context;
});

export const getUserEndpoint = createEndpoint(
	"/user",
	{
		method: "POST",
		body: z.object({
			name: z.string(),
		}),
		use: [contextMiddleware],
	},
	async (ctx) => {
		ctx.context.test;
		return ctx.json({});
	},
);
const schema = z.object({
	name: z.string(),
});
export const getUser2Endpoint = createEndpoint(
	"/user2",
	{
		method: "POST",
		body: z.object({
			name: z.string(),
		}),
		use: [contextMiddleware],
		metadata: {
			$Infer: {
				body: schema,
			},
		},
	},
	async (ctx) => {
		ctx.context.test;
		return ctx.json({});
	},
);

export const router = createRouter({
	getUserEndpoint,
	getUser2Endpoint,
});

export const client = createClient<typeof router>();
