import { createMiddleware } from "better-call/v2/middleware";
import { createEndpoint } from "better-call/v2/endpoint";
import { createRouter } from "better-call/v2/router";
import { createClient } from "better-call/v2/client";
import { type } from "arktype";

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
