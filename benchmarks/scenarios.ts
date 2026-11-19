import type { RequestListener } from "node:http";
import type { Endpoint } from "better-call";
import { createEndpoint, createMiddleware, createRouter } from "better-call";
import { z } from "zod";

export type BenchRequest = {
	method: "GET" | "POST";
	path: string;
	headers?: Record<string, string>;
	body?: string;
};

type FetchHandler = (request: Request) => Promise<Response>;

export type Scenario = {
	name: string;
	description: string;
	request: BenchRequest;
	handler?: FetchHandler;
	nodeListener?: RequestListener;
};

const disabledOpenApi = {
	openapi: {
		disabled: true,
	},
} as const;

const jsonHeaders = {
	"content-type": "application/json",
} as const;

function scenario(
	name: string,
	description: string,
	router: { handler: FetchHandler },
	request: BenchRequest,
): Scenario {
	return {
		name,
		description,
		handler: router.handler,
		request,
	};
}

function createManyRoutes(count: number) {
	const endpoints: Record<string, Endpoint> = {};
	for (let index = 0; index < count; index++) {
		endpoints[`route${index}`] = createEndpoint(
			`/r/${index}`,
			{
				method: "GET",
			},
			async () => ({ index }),
		);
	}
	return endpoints;
}

export function getScenarios(): Scenario[] {
	const hello = createEndpoint(
		"/",
		{
			method: "GET",
		},
		async () => ({ ok: true }),
	);

	const getUser = createEndpoint(
		"/users/:id",
		{
			method: "GET",
		},
		async (ctx) => ({ id: ctx.params.id }),
	);

	const search = createEndpoint(
		"/search",
		{
			method: "GET",
			query: z.object({
				q: z.string().min(1),
				page: z.string().optional(),
			}),
		},
		async (ctx) => ({
			q: ctx.query.q,
			page: ctx.query.page ?? "1",
		}),
	);

	const createItem = createEndpoint(
		"/items",
		{
			method: "POST",
			body: z.object({
				title: z.string().min(1),
				count: z.number().int().positive(),
			}),
		},
		async (ctx) =>
			ctx.json({
				id: "item_1",
				title: ctx.body.title,
				count: ctx.body.count,
			}),
	);

	const withRequestId = createMiddleware(async () => ({
		requestId: "req_1",
	}));
	const withSession = createMiddleware(async (ctx) => ({
		session: {
			userId: ctx.getHeader("x-user-id") ?? "anonymous",
		},
	}));
	const me = createEndpoint(
		"/me",
		{
			method: "GET",
			use: [withRequestId, withSession],
		},
		async (ctx) => ({
			requestId: ctx.context.requestId,
			userId: ctx.context.session.userId,
		}),
	);

	const ping = createEndpoint(
		"/ping",
		{
			method: "GET",
		},
		async () => ({ pong: true }),
	);
	const routerGate = createMiddleware(async (ctx) => {
		if (ctx.getHeader("x-deny") === "1") {
			return new Response(null, { status: 401 });
		}
	});

	const sessionCookie = createEndpoint(
		"/session",
		{
			method: "GET",
		},
		async (ctx) => {
			const session = ctx.getCookie("session");
			ctx.setCookie("session", session ?? "anon", {
				path: "/",
				httpOnly: true,
			});
			return { session: session ?? null };
		},
	);

	const sessionMiddleware = createMiddleware(async (ctx) => {
		const token = ctx.getCookie("better-auth.session_token");
		return {
			session: token ? { token } : null,
		};
	});
	const createAuthedEndpoint = createEndpoint.create({
		use: [sessionMiddleware],
	});
	const getSession = createAuthedEndpoint(
		"/get-session",
		{
			method: "GET",
		},
		async (ctx) => ({ session: ctx.context.session }),
	);
	const originGate = createMiddleware(async (ctx) => {
		if (ctx.getHeader("origin") === "http://evil.example") {
			return new Response(null, { status: 403 });
		}
	});

	return [
		{
			name: "raw-node",
			description:
				"Node http.Server JSON GET with no framework (stringify each request)",
			nodeListener: (_request, response) => {
				const body = JSON.stringify({ ok: true });
				response.writeHead(200, {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(body),
				});
				response.end(body);
			},
			request: {
				method: "GET",
				path: "/",
			},
		},
		{
			name: "raw-fetch",
			description:
				"Node HTTP + toNodeHandler around a trivial fetch Response (no router)",
			handler: async () =>
				new Response(JSON.stringify({ ok: true }), {
					headers: {
						"content-type": "application/json",
					},
				}),
			request: {
				method: "GET",
				path: "/",
			},
		},
		scenario(
			"get-hello",
			"Baseline GET with a JSON body and no validation",
			createRouter({ hello }, disabledOpenApi),
			{
				method: "GET",
				path: "/",
			},
		),
		scenario(
			"get-params",
			"GET with a dynamic route parameter",
			createRouter({ getUser }, disabledOpenApi),
			{
				method: "GET",
				path: "/users/42",
			},
		),
		scenario(
			"get-query",
			"GET with Zod query-string validation",
			createRouter({ search }, disabledOpenApi),
			{
				method: "GET",
				path: "/search?q=better-call&page=2",
			},
		),
		scenario(
			"post-json",
			"POST JSON with Zod body validation and ctx.json()",
			createRouter({ createItem }, disabledOpenApi),
			{
				method: "POST",
				path: "/items",
				headers: jsonHeaders,
				body: JSON.stringify({ title: "notebook", count: 3 }),
			},
		),
		scenario(
			"endpoint-middleware",
			"GET through two endpoint `use` middlewares",
			createRouter({ me }, disabledOpenApi),
			{
				method: "GET",
				path: "/me",
				headers: {
					"x-user-id": "user_1",
				},
			},
		),
		scenario(
			"router-middleware",
			"GET through a catch-all router middleware gate",
			createRouter(
				{ ping },
				{
					...disabledOpenApi,
					routerMiddleware: [
						{
							path: "/**",
							middleware: routerGate,
						},
					],
				},
			),
			{
				method: "GET",
				path: "/ping",
			},
		),
		scenario(
			"cookies",
			"GET that reads and sets a session cookie",
			createRouter({ sessionCookie }, disabledOpenApi),
			{
				method: "GET",
				path: "/session",
				headers: {
					cookie: "session=abc123",
				},
			},
		),
		scenario(
			"many-routes",
			"GET against a router with 100 registered routes",
			createRouter(createManyRoutes(100), disabledOpenApi),
			{
				method: "GET",
				path: "/r/50",
			},
		),
		scenario(
			"auth-like",
			"Session-style GET: basePath, router gate, cookie middleware, createEndpoint.create",
			createRouter(
				{ getSession },
				{
					...disabledOpenApi,
					basePath: "/api/auth",
					routerContext: {
						appName: "bench",
					},
					routerMiddleware: [
						{
							path: "/**",
							middleware: originGate,
						},
					],
				},
			),
			{
				method: "GET",
				path: "/api/auth/get-session",
				headers: {
					origin: "http://localhost",
					cookie: "better-auth.session_token=tok_1",
				},
			},
		),
	];
}
