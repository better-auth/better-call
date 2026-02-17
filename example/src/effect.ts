import { createEndpoint, createMiddleware, createRouter } from "better-call";
import { createClient } from "better-call/client";
import { Schema } from "effect";

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
		body: Schema.standardSchemaV1(
			Schema.Struct({
				name: Schema.String,
			}),
		),
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
