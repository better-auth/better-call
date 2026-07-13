import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEndpoint, type Endpoint } from "./endpoint";
import { generator, getHTML } from "./openapi";

/**
 * Regression suite for the OpenAPI generator. The scenarios mirror the bug
 * report that motivated the rewrite: a POST endpoint registered before a GET
 * endpoint on the same path used to be clobbered, PATCH/DELETE were dropped,
 * scalar bodies rendered empty, and `:id` was never templated.
 */

const asEndpoints = (record: Record<string, Endpoint>) => record;

describe("openapi generator", () => {
	it("keeps every method of a shared path (no overwrite)", async () => {
		// POST is defined *before* GET, mirroring the reported failure where the
		// later GET clobbered the earlier POST.
		const createTicket = createEndpoint(
			"/tickets",
			{
				method: "POST",
				body: z.object({
					subject: z.string(),
					description: z.string(),
				}),
			},
			async () => ({}),
		);
		const listTickets = createEndpoint(
			"/tickets",
			{ method: "GET" },
			async () => [],
		);

		const doc = await generator(asEndpoints({ createTicket, listTickets }));

		expect(doc.paths["/tickets"]).toBeDefined();
		expect(doc.paths["/tickets"]?.post).toBeDefined();
		expect(doc.paths["/tickets"]?.get).toBeDefined();
	});

	it("renders scalar request-body properties instead of an empty object", async () => {
		const createTicket = createEndpoint(
			"/tickets",
			{
				method: "POST",
				body: z.object({
					subject: z.string(),
					description: z.string().optional(),
				}),
			},
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ createTicket }));
		const schema =
			doc.paths["/tickets"]?.post?.requestBody?.content["application/json"]
				.schema;

		expect(schema?.properties).toHaveProperty("subject");
		expect(schema?.properties).toHaveProperty("description");
		expect(schema?.required).toContain("subject");
		expect(schema?.required).not.toContain("description");
	});

	it("does not advertise a request body for a bodyless route", async () => {
		const deleteTicket = createEndpoint(
			"/tickets/:id",
			{ method: "DELETE" },
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ deleteTicket }));
		expect(doc.paths["/tickets/{id}"]?.delete).toBeDefined();
		expect(doc.paths["/tickets/{id}"]?.delete?.requestBody).toBeUndefined();
	});

	it("marks the request body required for a non-optional body schema", async () => {
		const createTicket = createEndpoint(
			"/tickets",
			{ method: "POST", body: z.object({ subject: z.string() }) },
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ createTicket }));
		expect(doc.paths["/tickets"]?.post?.requestBody?.required).toBe(true);
	});

	it("marks the request body optional for a top-level optional body schema", async () => {
		const createTicket = createEndpoint(
			"/tickets",
			{ method: "POST", body: z.object({ subject: z.string() }).optional() },
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ createTicket }));
		const requestBody = doc.paths["/tickets"]?.post?.requestBody;
		expect(requestBody?.required).toBe(false);
		expect(
			requestBody?.content["application/json"].schema?.properties,
		).toHaveProperty("subject");
	});

	it("emits PATCH and DELETE operations", async () => {
		const updateTicket = createEndpoint(
			"/tickets/:id",
			{
				method: "PATCH",
				body: z.object({ subject: z.string() }),
			},
			async () => ({}),
		);
		const deleteTicket = createEndpoint(
			"/tickets/:id",
			{ method: "DELETE" },
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ updateTicket, deleteTicket }));

		expect(doc.paths["/tickets/{id}"]?.patch).toBeDefined();
		expect(doc.paths["/tickets/{id}"]?.delete).toBeDefined();
	});

	it("expands array-valued methods into separate operations", async () => {
		const handler = createEndpoint(
			"/items",
			{ method: ["GET", "POST"] },
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ handler }));

		expect(doc.paths["/items"]?.get).toBeDefined();
		expect(doc.paths["/items"]?.post).toBeDefined();
	});

	it("templates :param path segments and emits path parameters", async () => {
		const getTicket = createEndpoint(
			"/tickets/:id",
			{ method: "GET" },
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ getTicket }));

		expect(doc.paths["/tickets/{id}"]).toBeDefined();
		expect(doc.paths["/tickets/:id"]).toBeUndefined();
		const params = doc.paths["/tickets/{id}"]?.get?.parameters ?? [];
		expect(params).toContainEqual(
			expect.objectContaining({ name: "id", in: "path", required: true }),
		);
	});

	it("emits query fields as query parameters", async () => {
		const listTickets = createEndpoint(
			"/tickets",
			{
				method: "GET",
				query: z.object({
					status: z.string(),
					page: z.string().optional(),
				}),
			},
			async () => [],
		);

		const doc = await generator(asEndpoints({ listTickets }));
		const params = doc.paths["/tickets"]?.get?.parameters ?? [];

		expect(params).toContainEqual(
			expect.objectContaining({ name: "status", in: "query", required: true }),
		);
		expect(params).toContainEqual(
			expect.objectContaining({ name: "page", in: "query", required: false }),
		);
	});

	it("asserts no security by default", async () => {
		const listTickets = createEndpoint(
			"/tickets",
			{ method: "GET" },
			async () => [],
		);

		const doc = await generator(asEndpoints({ listTickets }));

		expect(doc).not.toHaveProperty("security");
		expect(doc.paths["/tickets"]?.get).not.toHaveProperty("security");
		expect(doc.components).not.toHaveProperty("securitySchemes");
	});

	it("honors document-level security and securitySchemes config", async () => {
		const listTickets = createEndpoint(
			"/tickets",
			{ method: "GET" },
			async () => [],
		);

		const doc = await generator(asEndpoints({ listTickets }), {
			security: [{ sessionCookie: [] }],
			securitySchemes: {
				sessionCookie: {
					type: "apiKey",
					in: "cookie",
					name: "better-auth.session_token",
				},
			},
		});

		expect(doc.security).toEqual([{ sessionCookie: [] }]);
		expect(doc.components.securitySchemes).toHaveProperty("sessionCookie");
	});

	it("honors per-endpoint security metadata", async () => {
		const listTickets = createEndpoint(
			"/tickets",
			{
				method: "GET",
				metadata: {
					openapi: {
						security: [{ bearerAuth: [] }],
					},
				},
			},
			async () => [],
		);

		const doc = await generator(asEndpoints({ listTickets }));

		expect(doc.paths["/tickets"]?.get?.security).toEqual([{ bearerAuth: [] }]);
	});

	it("honors document info and servers config", async () => {
		const endpoint = createEndpoint("/", { method: "GET" }, async () => ({}));

		const doc = await generator(asEndpoints({ endpoint }), {
			info: { title: "Service Desk", version: "2.0.0" },
			servers: [{ url: "https://example.com/api" }],
		});

		expect(doc.info.title).toBe("Service Desk");
		expect(doc.info.version).toBe("2.0.0");
		expect(doc.servers).toEqual([{ url: "https://example.com/api" }]);
	});

	it("defaults to a neutral title (not 'Better Auth')", async () => {
		const endpoint = createEndpoint("/", { method: "GET" }, async () => ({}));
		const doc = await generator(asEndpoints({ endpoint }));
		expect(doc.info.title).toBe("API Reference");
	});

	it("does not leak paths across generator calls", async () => {
		const first = createEndpoint("/first", { method: "GET" }, async () => ({}));
		const second = createEndpoint(
			"/second",
			{ method: "GET" },
			async () => ({}),
		);

		const docA = await generator(asEndpoints({ first }));
		const docB = await generator(asEndpoints({ second }));

		expect(Object.keys(docA.paths)).toEqual(["/first"]);
		expect(Object.keys(docB.paths)).toEqual(["/second"]);
	});

	it("skips SERVER_ONLY endpoints", async () => {
		const hidden = createEndpoint(
			"/hidden",
			{ method: "GET", metadata: { SERVER_ONLY: true } },
			async () => ({}),
		);

		const doc = await generator(asEndpoints({ hidden }));
		expect(doc.paths["/hidden"]).toBeUndefined();
	});

	it("produces valid, quoted scalar configuration in the HTML", async () => {
		const doc = await generator(
			asEndpoints({
				endpoint: createEndpoint("/", { method: "GET" }, async () => ({})),
			}),
		);
		const html = getHTML(doc, { theme: "saturn", title: "My API" });

		// The configuration object must be valid JSON (the old template emitted
		// bare identifiers like `theme: saturn`).
		const match = html.match(/var configuration = (\{.*?\})\n/s);
		expect(match).not.toBeNull();
		const parsed = JSON.parse(match?.[1] ?? "{}");
		expect(parsed.theme).toBe("saturn");
		expect(parsed.metaData.title).toBe("My API");
	});
});
