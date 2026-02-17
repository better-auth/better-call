import { type } from "arktype";
import { createEndpoint, createMiddleware, createRouter } from "better-call";
import { createClient } from "better-call/client";

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
		body: type({
			name: "string",
		}),
		use: [contextMiddleware],
	},
	(ctx) => {
		ctx.context.test;
		return ctx.json({});
	},
);

export const router = createRouter({
	getUserEndpoint,
});

export const client = createClient<typeof router>();
