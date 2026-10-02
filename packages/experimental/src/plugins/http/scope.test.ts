import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "../../index";
import {
	buildPathTree,
	collectRoutes,
	createClient,
	createRouter,
	flattenRouteLeaves,
	getRouteMeta,
	http,
	NOT_FOUND,
	route,
} from "./index";

const e = v.fn({ use: [http()] });

const getSession = e.fn("getSession", { path: "/get-session" }, () => ({
	user: "u1",
}));
const getSessionRpc = e.fn(
	"getSessionRpc",
	{ path: "/get-session-rpc", scope: "rpc" },
	() => ({ user: "u1" }),
);
const verifyPassword = e.fn(
	"verifyPassword",
	{
		path: "/verify-password",
		input: { password: v.string() },
		scope: "server",
	},
	(c) => ({ ok: c.input.password === "secret" }),
);
const callback = e.fn(
	"callback",
	{ path: "/callback/:id", scope: "http" },
	() => ({ handled: true }),
);
const setPassword = e.fn(
	"setPassword",
	{
		path: "/set-password",
		input: { password: v.string() },
		scope: "internal",
	},
	() => ({ status: true }),
);

const routes = {
	getSession,
	getSessionRpc,
	verifyPassword,
	callback,
	setPassword,
};

const call = (router: (r: Request) => Promise<Response>, path: string) =>
	router(
		new Request(`http://localhost${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ password: "secret" }),
		}),
	);

describe("scope option", () => {
	it("stamps scope on $route only when set", () => {
		expect(getRouteMeta(getSession)).toEqual({
			path: "/get-session",
			method: "GET",
			invalidate: [],
		});
		expect(getRouteMeta(getSessionRpc)?.scope).toBe("rpc");
		expect(getRouteMeta(verifyPassword)?.scope).toBe("server");
		expect(getRouteMeta(callback)?.scope).toBe("http");
		expect(getRouteMeta(setPassword)?.scope).toBe("internal");

		expectTypeOf(verifyPassword.$route.scope).toEqualTypeOf<
			"server" | undefined
		>();
		expectTypeOf(setPassword.$route.scope).toEqualTypeOf<
			"internal" | undefined
		>();
		expectTypeOf(getSession.$route.scope).toEqualTypeOf<"rpc" | undefined>();
	});

	it("route() accepts scope", () => {
		const legacy = v.fn(
			"legacy",
			{ use: [route({ path: "/legacy", method: "POST", scope: "server" })] },
			() => null,
		);
		expect(getRouteMeta(legacy)?.scope).toBe("server");
		expectTypeOf(legacy.$route.scope).toEqualTypeOf<"server" | undefined>();
	});

	it("rejects unknown scopes (type)", () => {
		// @ts-expect-error not a RouteScope
		e.fn("bad", { path: "/bad", scope: "client" }, () => null);
		// @ts-expect-error not a RouteScope
		route({ path: "/bad", method: "GET", scope: "client" });
	});

	it("collectRoutes skips internal", () => {
		expect(collectRoutes(routes).map((r) => r.name)).toEqual([
			"getSession",
			"getSessionRpc",
			"verifyPassword",
			"callback",
		]);
	});

	it("router serves rpc / server / http, 404s internal", async () => {
		const router = createRouter(routes);

		const rpc = await router(new Request("http://localhost/get-session"));
		expect(rpc.status).toBe(200);
		expect(await rpc.json()).toEqual({ user: "u1" });

		const server = await call(router, "/verify-password");
		expect(server.status).toBe(200);
		expect(await server.json()).toEqual({ ok: true });

		const httpOnly = await router(new Request("http://localhost/callback/1"));
		expect(httpOnly.status).toBe(200);
		expect(await httpOnly.json()).toEqual({ handled: true });

		const internal = await call(router, "/set-password");
		expect(internal.status).toBe(404);
		expect(await internal.json()).toEqual(NOT_FOUND);
	});

	it("router.api keeps rpc / server / internal, drops http", async () => {
		const router = createRouter(routes);
		expect(Object.keys(router.api).sort()).toEqual([
			"getSession",
			"getSessionRpc",
			"setPassword",
			"verifyPassword",
		]);
		expect(await router.api.setPassword({ password: "x" })).toEqual({
			status: true,
		});
		expect(await router.api.verifyPassword({ password: "secret" })).toEqual({
			ok: true,
		});

		expectTypeOf(router.api).toHaveProperty("getSession");
		expectTypeOf(router.api).toHaveProperty("verifyPassword");
		expectTypeOf(router.api).toHaveProperty("setPassword");
		// @ts-expect-error http-scoped endpoints are router-only
		router.api.callback;
	});

	it("openapi leaves out internal", () => {
		const doc = createRouter(routes).openapi();
		expect(Object.keys(doc.paths).sort()).toEqual([
			"/callback/{id}",
			"/get-session",
			"/get-session-rpc",
			"/verify-password",
		]);
	});

	it("buildPathTree keeps rpc leaves only", () => {
		const leaves = flattenRouteLeaves(routes);
		expect(leaves.map((l) => l.scope)).toEqual([
			undefined,
			"rpc",
			"server",
			"http",
			"internal",
		]);
		expect(Object.keys(buildPathTree(leaves)).sort()).toEqual([
			"getSession",
			"getSessionRpc",
		]);
	});

	it("client exposes rpc only and never fetches hidden endpoints", async () => {
		const router = createRouter(routes);
		const requested: string[] = [];
		const client = createClient({
			baseURL: "http://localhost",
			routes,
			fetchOptions: {
				customFetchImpl: async (url, init) => {
					requested.push(new URL(String(url)).pathname);
					return router(new Request(url, init));
				},
			},
		});

		expect(await client.getSession()).toEqual({
			data: { user: "u1" },
			error: null,
		});
		expect(await client.getSessionRpc()).toMatchObject({ error: null });
		expect(client).not.toHaveProperty("verifyPassword");
		expect(client).not.toHaveProperty("callback");
		expect(client).not.toHaveProperty("setPassword");
		expect(requested).toEqual(["/get-session", "/get-session-rpc"]);

		expectTypeOf(client.getSession).toBeFunction();
		expectTypeOf(client.getSessionRpc).toBeFunction();
		// @ts-expect-error scope: "server" is not on the client
		client.verifyPassword;
		// @ts-expect-error scope: "http" is not on the client
		client.callback;
		// @ts-expect-error scope: "internal" is not on the client
		client.setPassword;
	});

	it("client with only hidden routes is empty", () => {
		const client = createClient({
			baseURL: "http://localhost",
			routes: { verifyPassword, setPassword },
		});
		expect(client).not.toHaveProperty("verifyPassword");
		expect(client).not.toHaveProperty("setPassword");
		// @ts-expect-error not on the client
		client.verifyPassword;
	});
});
