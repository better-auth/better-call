import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "../../index";
import { createClient } from "./client";
import { err } from "./error";
import {
	getScalarHTML,
	openapi,
	scalarHTML,
	schemaToOpenAPI,
	toOpenAPI,
	toOpenAPIPath,
} from "./openapi";
import { route } from "./route";
import { createRouter } from "./router";

describe("toOpenAPIPath", () => {
	it("converts :param segments to {param}", () => {
		expect(toOpenAPIPath("/users/:id/posts/:postId")).toBe(
			"/users/{id}/posts/{postId}",
		);
	});
});

describe("schemaToOpenAPI", () => {
	it("walks objects, optionals, and nested arrays", () => {
		expect(
			schemaToOpenAPI({
				email: v.string({ format: "email" }),
				age: v.number({ optional: true, int: true }),
				tags: v.array(v.string()),
			}),
		).toEqual({
			type: "object",
			properties: {
				email: { type: "string", format: "email" },
				age: { type: "integer" },
				tags: { type: "array", items: { type: "string" } },
			},
			required: ["email", "tags"],
		});
	});

	it("emits validator metadata into the schema object", () => {
		expect(
			schemaToOpenAPI({
				email: v.string({
					format: "email",
					description: "Login email",
					title: "Email",
					example: "a@b.c",
					examples: ["a@b.c", "x@y.z"],
				}),
				role: v.string({
					enum: ["admin", "user"],
					deprecated: true,
					default: "user",
				}),
				id: v.string({ format: "uuid", description: "Stable id" }),
				secret: v.noOutput(v.string({ description: "Never returned" })),
				createdAt: v.noInput(v.date({ description: "Set by server" })),
			}),
		).toEqual({
			type: "object",
			properties: {
				email: {
					type: "string",
					format: "email",
					description: "Login email",
					title: "Email",
					example: "a@b.c",
					examples: ["a@b.c", "x@y.z"],
				},
				role: {
					type: "string",
					enum: ["admin", "user"],
					deprecated: true,
					default: "user",
				},
				id: {
					type: "string",
					format: "uuid",
					description: "Stable id",
				},
				secret: {
					type: "string",
					description: "Never returned",
					writeOnly: true,
				},
				createdAt: {
					type: "string",
					format: "date-time",
					description: "Set by server",
					readOnly: true,
				},
			},
			required: ["email", "id", "secret", "createdAt"],
		});
	});

	it('emits format: "url" as-is', () => {
		expect(schemaToOpenAPI(v.string({ format: "url" }))).toEqual({
			type: "string",
			format: "url",
		});
	});
});

const getUser = v.fn(
	"users.get",
	{
		summary: "Get user",
		description: "Load a user by id",
		tags: ["users"],
		input: {
			id: v.string(),
			includePosts: v.boolean({ optional: true }),
		},
		output: {
			id: v.string(),
			email: v.string(),
		},
		errors: {
			not_found: err(404, "User not found"),
		},
		use: [route({ path: "/users/:id", method: "GET" })],
	},
	(c) => ({ id: c.input.id, email: "a@b.c" }),
);

const createUser = v.fn(
	"users.create",
	{
		summary: "Create user",
		tags: ["users"],
		deprecated: true,
		input: {
			email: v.string({ format: "email" }),
			password: v.string({ min: 8 }),
		},
		output: { id: v.string() },
		errors: {
			email_taken: err(409, "Email taken", {
				email: v.string(),
			}),
		},
		use: [route({ path: "/users", method: "POST", status: 201 })],
	},
	() => ({ id: "u1" }),
);

const routes = { getUser, createUser };

describe("toOpenAPI", () => {

	it("stamps docs from v.fn and status from route()", () => {
		expect(getUser.$schema?.summary).toBe("Get user");
		expect(getUser.$schema?.tags).toEqual(["users"]);
		expect(createUser.$schema?.deprecated).toBe(true);
		expect(createUser.$route?.status).toBe(201);
		expectTypeOf(createUser.$route!.status).toEqualTypeOf<201 | undefined>();
	});

	it("derives paths, params, body, and error responses", () => {
		const doc = toOpenAPI(routes, {
			info: { title: "Users", version: "1.0.0" },
		});

		expect(doc.openapi).toBe("3.1.0");
		expect(doc.info.title).toBe("Users");
		expect(doc.tags).toEqual([{ name: "users" }]);

		const getOp = doc.paths["/users/{id}"]?.get;
		expect(getOp?.operationId).toBe("users.get");
		expect(getOp?.summary).toBe("Get user");
		expect(getOp?.description).toBe("Load a user by id");
		expect(getOp?.tags).toEqual(["users"]);
		expect(getOp?.parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "id",
					in: "path",
					required: true,
				}),
				expect.objectContaining({
					name: "includePosts",
					in: "query",
					required: false,
				}),
			]),
		);
		expect(getOp?.responses["200"]).toBeDefined();
		expect(getOp?.responses["404"]?.description).toBe("not_found");

		const postOp = doc.paths["/users"]?.post;
		expect(postOp?.operationId).toBe("users.create");
		expect(postOp?.deprecated).toBe(true);
		expect(postOp?.requestBody?.content["application/json"]?.schema).toEqual(
			expect.objectContaining({
				type: "object",
				required: ["email", "password"],
			}),
		);
		expect(postOp?.responses["201"]).toBeDefined();
		expect(postOp?.responses["409"]?.description).toBe("email_taken");
	});

	it("reads routes from a createRouter instance and basePath", () => {
		const router = createRouter(routes, { basePath: "/api" });
		const doc = toOpenAPI(router, { basePath: "/api" });
		expect(doc.paths["/api/users/{id}"]?.get?.operationId).toBe("users.get");
		expect(router.routes.some((r) => r.key === "users.get")).toBe(true);
		expect(router.routes.find((r) => r.key === "users.get")?.schema?.summary).toBe(
			"Get user",
		);
	});
});

describe("Scalar", () => {
	it("getScalarHTML embeds the document and Scalar bootstrap", () => {
		const doc = toOpenAPI(routes, { info: { title: "Users", version: "1.0.0" } });
		const html = getScalarHTML(doc, { theme: "purple", title: "Users API" });
		expect(html).toContain("<!doctype html>");
		expect(html).toContain("Users API");
		expect(html).toContain("@scalar/api-reference");
		expect(html).toContain("Scalar.createApiReference");
		expect(html).toContain('"theme":"purple"');
		expect(html).toContain("users.get");
	});

	it("getScalarHTML can point at a URL instead of inlining", () => {
		const html = getScalarHTML(
			{ openapi: "3.1.0", info: { title: "X", version: "1" }, paths: {} },
			{ url: "/api/reference/openapi.json" },
		);
		expect(html).toContain('"/api/reference/openapi.json"');
		expect(html).not.toContain('"paths"');
	});

	it("scalarHTML builds the doc then renders Scalar", () => {
		const html = scalarHTML(routes, {
			info: { title: "Users", version: "1" },
			scalar: { theme: "saturn" },
		});
		expect(html).toContain("users.create");
		expect(html).toContain("saturn");
	});

	it("openapi() module mounts Scalar HTML and OpenAPI JSON via use", async () => {
		const router = createRouter(routes, {
			use: [
				openapi({
					path: "/docs",
					info: { title: "Demo", version: "1.2.3" },
					scalar: { theme: "kepler" },
				}),
			],
		});

		const jsonRes = await router(
			new Request("http://localhost/docs/openapi.json"),
		);
		expect(jsonRes.status).toBe(200);
		expect(jsonRes.headers.get("content-type")).toContain("application/json");
		const doc = await jsonRes.json();
		expect(doc.info.title).toBe("Demo");
		expect(doc.info.version).toBe("1.2.3");
		expect(doc.paths["/users/{id}"]?.get?.operationId).toBe("users.get");

		const htmlRes = await router(new Request("http://localhost/docs"));
		expect(htmlRes.status).toBe(200);
		expect(htmlRes.headers.get("content-type")).toContain("text/html");
		const html = await htmlRes.text();
		expect(html).toContain("Scalar.createApiReference");
		expect(html).toContain("/docs/openapi.json");
		expect(html).toContain("kepler");

		const built = router.openapi({ info: { title: "FromHelper", version: "9" } });
		expect(built.info.title).toBe("FromHelper");
	});

	it("createRouter leaves Scalar unmounted without openapi() in use", async () => {
		const router = createRouter(routes);
		const res = await router(new Request("http://localhost/api/reference"));
		expect(res.status).toBe(404);
	});

	it("openapi() can sit beside other dispatch hooks in use", async () => {
		const seen: string[] = [];
		const gate = v.on("http.router.dispatch", async (c, next) => {
			seen.push(c.req?.path ?? "");
			return next();
		});
		const router = createRouter(routes, {
			use: [
				gate,
				openapi({
					path: "/docs",
					info: { title: "Demo", version: "1" },
				}),
			],
		});
		const res = await router(new Request("http://localhost/docs"));
		expect(res.status).toBe(200);
		expect(seen).toEqual(["/docs"]);
		const page = await res.text();
		expect(page).toContain("Scalar.createApiReference");
	});
});
