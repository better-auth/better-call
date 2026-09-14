import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "../../index";
import { createClient } from "./client";
import { err } from "./error";
import {
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
				email: v.string({ email: true }),
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
});

describe("toOpenAPI", () => {
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
				email: v.string({ email: true }),
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
