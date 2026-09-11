import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "../../index";
import {
	collectRoutes,
	createClient,
	createRouter,
	getRouteMeta,
	INVALIDATE_HEADER,
	route,
} from "./index";

let session: { user: { id: string; email: string } | null } = {
	user: null,
};

const getSession = v.fn(
	"session.get",
	{
		use: [route({ path: "/get-session", method: "GET" })],
		output: v.object({
			user: v.object({ id: v.string(), email: v.string() }, { optional: true }),
		}),
	},
	() => session,
);

const signIn = v.fn(
	"signIn.email",
	{
		use: [
			route({
				path: "/sign-in/email",
				method: "POST",
				invalidate: ["session"],
			}),
		],
		input: {
			email: v.string(),
			password: v.string(),
			revokeOthers: v.boolean({ optional: true }),
		},
		output: v.object({ token: v.string() }),
	},
	(c) => {
		session = {
			user: { id: "u1", email: c.input.email },
		};
		if (c.input.revokeOthers) {
			c.route?.invalidate.push("sessions");
		}
		return { token: "tok_1" };
	},
);

const routes = { getSession, signIn };

describe("route()", () => {
	it("keeps path/method/invalidate as string literals", () => {
		const r = route({
			path: "/sign-in/email",
			method: "POST",
			invalidate: ["session"],
		});
		expectTypeOf(r.path).toEqualTypeOf<"/sign-in/email">();
		expectTypeOf(r.method).toEqualTypeOf<"POST">();
		expectTypeOf(r.invalidate).toEqualTypeOf<readonly ["session"]>();

		const getSessionRoute = getSession.$route;
		const signInRoute = signIn.$route;
		if (!getSessionRoute || !signInRoute) {
			throw new Error("expected $route on stamped fns");
		}
		expectTypeOf(getSessionRoute.path).toEqualTypeOf<"/get-session">();
		expectTypeOf(getSessionRoute.method).toEqualTypeOf<"GET">();
		expectTypeOf(signInRoute.path).toEqualTypeOf<"/sign-in/email">();
		expectTypeOf(signInRoute.method).toEqualTypeOf<"POST">();
		expectTypeOf(signInRoute.invalidate).toEqualTypeOf<readonly ["session"]>();
	});

	it("stamps $route on the fn", () => {
		expect(getRouteMeta(getSession)).toEqual({
			path: "/get-session",
			method: "GET",
			invalidate: [],
		});
		expect(getRouteMeta(signIn)).toEqual({
			path: "/sign-in/email",
			method: "POST",
			invalidate: ["session"],
		});
	});

	it("seeds mutable c.route.invalidate", async () => {
		session = { user: null };
		const result = await signIn({
			email: "a@b.c",
			password: "x",
			revokeOthers: true,
		});
		expect(result).toEqual({ token: "tok_1" });
	});

	it("allows {} when the endpoint has no input", () => {
		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				customFetchImpl: async () => new Response("{}"),
			},
		});
		// No-input GET: omit, undefined, or {}.
		expectTypeOf(client.getSession).toBeCallableWith();
		expectTypeOf(client.getSession).toBeCallableWith({});
		expectTypeOf(client.getSession).toBeCallableWith(undefined);
	});

	it("collectRoutes finds route fns", () => {
		const table = collectRoutes(routes);
		expect(table.map((r) => r.name).sort()).toEqual(["getSession", "signIn"]);
	});

	it("client nests by path; router.api uses export names", async () => {
		session = { user: null };
		const router = createRouter(routes);
		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				customFetchImpl: async (url, init) => router(new Request(url, init)),
			},
		});

		// Path `/sign-in/email` → client.signIn.email (not export name `signIn`)
		expectTypeOf(client.signIn.email).toBeCallableWith({
			email: "a@b.c",
			password: "x",
		});
		expectTypeOf(client.getSession).toBeCallableWith();

		// Server API keeps the export name
		expectTypeOf(router.api.signIn).toEqualTypeOf(signIn);
		expectTypeOf(router.api.getSession).toEqualTypeOf(getSession);

		const fromServer = await router.api.signIn({
			email: "server@x.com",
			password: "pw",
		});
		expect(fromServer).toEqual({ token: "tok_1" });
		expect(session.user?.email).toBe("server@x.com");

		const fromClient = await client.signIn.email(
			{ email: "client@x.com", password: "pw" },
			{ throw: true },
		);
		expect(fromClient).toEqual({ token: "tok_1" });
		expect(session.user?.email).toBe("client@x.com");
	});
});

describe("createRouter", () => {
	it("dispatches by method+path and emits invalidate header", async () => {
		session = { user: null };
		const handler = createRouter(routes);

		const signInRes = await handler(
			new Request("http://localhost/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "ada@lovelace.dev",
					password: "pw",
					revokeOthers: true,
				}),
			}),
		);
		expect(signInRes.status).toBe(200);
		expect(signInRes.headers.get(INVALIDATE_HEADER)).toBe("session,sessions");
		await expect(signInRes.json()).resolves.toEqual({ token: "tok_1" });

		const sessionRes = await handler(
			new Request("http://localhost/get-session", { method: "GET" }),
		);
		expect(sessionRes.status).toBe(200);
		await expect(sessionRes.json()).resolves.toEqual({
			user: { id: "u1", email: "ada@lovelace.dev" },
		});
	});

	it("returns 404 for unknown routes", async () => {
		const handler = createRouter(routes);
		const res = await handler(
			new Request("http://localhost/missing", { method: "GET" }),
		);
		expect(res.status).toBe(404);
	});
});

describe("createClient", () => {
	it("proxies calls and refreshes resources on invalidate", async () => {
		session = { user: null };
		const handler = createRouter(routes);

		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				customFetchImpl: async (url, init) => handler(new Request(url, init)),
			},
			plugins: [
				{
					id: "session",
					getResources: ({ client: c }) => ({
						session: {
							query: async (): Promise<typeof session | null> => {
								const result = await (
									c as {
										getSession: () => Promise<{
											data: typeof session | null;
										}>;
									}
								).getSession();
								return result.data;
							},
							prefetch: false,
						},
					}),
				},
			],
		});

		const sessionStore = client.$store.resources.session;
		expect(sessionStore).toBeDefined();
		await sessionStore?.refetch();
		expect(sessionStore?.get().data).toEqual({
			user: null,
		});

		const { data, error } = await client.signIn.email({
			email: "ada@lovelace.dev",
			password: "pw",
		});
		expect(error).toBeNull();
		expect(data).toEqual({ token: "tok_1" });

		expect(sessionStore?.get().data).toEqual({
			user: { id: "u1", email: "ada@lovelace.dev" },
		});
	});

	it("disableInvalidate skips resource refresh", async () => {
		session = { user: { id: "u1", email: "old@x.com" } };
		const handler = createRouter(routes);
		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				customFetchImpl: async (url, init) => handler(new Request(url, init)),
			},
			plugins: [
				{
					id: "session",
					getResources: ({ client: c }) => ({
						session: {
							query: async (): Promise<typeof session | null> => {
								const result = await (
									c as {
										getSession: () => Promise<{
											data: typeof session | null;
										}>;
									}
								).getSession();
								return result.data;
							},
							prefetch: false,
						},
					}),
				},
			],
		});

		const sessionStore = client.$store.resources.session;
		expect(sessionStore).toBeDefined();
		await sessionStore?.refetch();
		expect(sessionStore?.get().data?.user?.email).toBe("old@x.com");

		await client.signIn.email(
			{ email: "new@x.com", password: "pw" },
			{ disableInvalidate: true },
		);
		expect(sessionStore?.get().data?.user?.email).toBe("old@x.com");
	});

	it("create-time throw: true returns data only", async () => {
		session = { user: null };
		const handler = createRouter(routes);
		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				throw: true,
				customFetchImpl: async (url, init) => handler(new Request(url, init)),
			},
		});

		const data = await client.signIn.email({
			email: "ada@lovelace.dev",
			password: "pw",
		});
		expect(data).toEqual({ token: "tok_1" });
		expectTypeOf(data).toEqualTypeOf<{ token: string }>();
		// @ts-expect-error result is data, not { data, error }
		expect(data.error).toBeUndefined();
	});

	it("per-call throw: true returns data only", async () => {
		session = { user: null };
		const handler = createRouter(routes);
		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				customFetchImpl: async (url, init) => handler(new Request(url, init)),
			},
		});

		const data = await client.signIn.email(
			{ email: "ada@lovelace.dev", password: "pw" },
			{ throw: true },
		);
		expect(data).toEqual({ token: "tok_1" });
		expectTypeOf(data).toEqualTypeOf<{ token: string }>();
	});

	it("create-time throw: true can be overridden per-call", async () => {
		session = { user: null };
		const handler = createRouter(routes);
		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				throw: true,
				customFetchImpl: async (url, init) => handler(new Request(url, init)),
			},
		});

		const result = await client.signIn.email(
			{ email: "ada@lovelace.dev", password: "pw" },
			{ throw: false },
		);
		expect(result.error).toBeNull();
		expect(result.data).toEqual({ token: "tok_1" });
		expectTypeOf(result).toEqualTypeOf<{
			data: { token: string } | null;
			error: {
				message: string;
				status: number;
				statusText: string;
			} | null;
		}>();
	});
});
