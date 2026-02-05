import { describe, expect, it, beforeAll, afterAll } from "vitest";
import express from "express";
import bodyParser from "body-parser";
import request from "supertest";
import { createRouter, createEndpoint } from "../../index";
import { toNodeHandler } from "./index";
import type { Server } from "node:http";

describe("Express Integration with body-parser", () => {
	let app: express.Application;
	let server: Server;

	beforeAll(() => {
		app = express();
		server = app.listen(0, () => {});
	});

	afterAll(() => {
		server.close();
	});

	it("should handle Express with JSON body-parser middleware", async () => {
		// Create a better-call endpoint
		const testEndpoint = createEndpoint(
			"/test",
			{
				method: "POST",
			},
			async ({ body }) => {
				// Echo back the body
				return {
					received: body,
					message: "Body processed successfully",
				};
			},
		);

		const router = createRouter({
			testEndpoint,
		});

		// Set up Express app with body-parser BEFORE better-call
		const testApp = express();
		testApp.use(bodyParser.json());
		testApp.use(toNodeHandler(router.handler));

		// Send a POST request with JSON body
		const response = await request(testApp)
			.post("/test")
			.send({ name: "John", age: 30 })
			.set("Content-Type", "application/json")
			.expect(200);

		// Verify the response
		expect(response.body).toEqual({
			received: { name: "John", age: 30 },
			message: "Body processed successfully",
		});
	});

	it("should handle Express with text body-parser middleware", async () => {
		const echoEndpoint = createEndpoint(
			"/echo",
			{
				method: "POST",
			},
			async ({ body }) => {
				return `Received: ${body}`;
			},
		);

		const router = createRouter({
			echoEndpoint,
		});

		const testApp = express();
		testApp.use(bodyParser.text());
		testApp.use(toNodeHandler(router.handler));

		const response = await request(testApp)
			.post("/echo")
			.send("Hello from Express")
			.set("Content-Type", "text/plain")
			.expect(200);

		expect(response.text).toBe("Received: Hello from Express");
	});

	it("should handle Express sub-router with body-parser", async () => {
		// The endpoint should use the full path including the mount point
		const apiEndpoint = createEndpoint(
			"/api/v1/users",
			{
				method: "POST",
			},
			async ({ body }) => {
				return {
					created: true,
					user: body,
				};
			},
		);

		const router = createRouter({
			apiEndpoint,
		});

		const mainApp = express();
		const apiRouter = express.Router();

		// Apply body-parser to the sub-router
		apiRouter.use(bodyParser.json());
		apiRouter.use(toNodeHandler(router.handler));

		// Mount the sub-router at /api/v1
		mainApp.use("/api/v1", apiRouter);

		const response = await request(mainApp)
			.post("/api/v1/users")
			.send({ username: "test-user", email: "test@example.com" })
			.set("Content-Type", "application/json")
			.expect(200);

		expect(response.body).toEqual({
			created: true,
			user: { username: "test-user", email: "test@example.com" },
		});
	});

	it("should handle multiple middleware including body-parser", async () => {
		const webhookEndpoint = createEndpoint(
			"/webhook",
			{
				method: "POST",
			},
			async ({ body, headers }) => {
				return {
					signature: headers?.get("x-signature") || null,
					payload: body,
					processed: true,
				};
			},
		);

		const router = createRouter({
			webhookEndpoint,
		});

		const testApp = express();

		// Multiple middleware before better-call
		testApp.use((req, res, next) => {
			req.headers["x-signature"] = "test-signature";
			next();
		});
		testApp.use(bodyParser.json());
		testApp.use(toNodeHandler(router.handler));

		const response = await request(testApp)
			.post("/webhook")
			.send({ event: "payment.completed", amount: 100 })
			.set("Content-Type", "application/json")
			.expect(200);

		expect(response.body).toEqual({
			signature: "test-signature",
			payload: { event: "payment.completed", amount: 100 },
			processed: true,
		});
	});

	it("should handle large JSON bodies with body-parser", async () => {
		const dataEndpoint = createEndpoint(
			"/data",
			{
				method: "POST",
			},
			async ({ body }) => {
				const data = body as any;
				return {
					itemCount: data.items?.length || 0,
					firstItem: data.items?.[0],
					lastItem: data.items?.[data.items.length - 1],
				};
			},
		);

		const router = createRouter({
			dataEndpoint,
		});

		const testApp = express();
		testApp.use(bodyParser.json({ limit: "10mb" }));
		testApp.use(toNodeHandler(router.handler));

		const largeData = {
			items: Array.from({ length: 1000 }, (_, i) => ({
				id: i,
				name: `Item ${i}`,
				value: Math.random(),
			})),
		};

		const response = await request(testApp)
			.post("/data")
			.send(largeData)
			.set("Content-Type", "application/json")
			.expect(200);

		expect(response.body.itemCount).toBe(1000);
		expect(response.body.firstItem.id).toBe(0);
		expect(response.body.lastItem.id).toBe(999);
	});

	it("should work without body-parser (raw body stream)", async () => {
		const rawEndpoint = createEndpoint(
			"/raw",
			{
				method: "POST",
			},
			async ({ body }) => {
				return {
					bodyReceived: body !== null && body !== undefined,
					bodyContent: body,
				};
			},
		);

		const router = createRouter({
			rawEndpoint,
		});

		const testApp = express();
		// No body-parser middleware - should use raw stream
		testApp.use(toNodeHandler(router.handler));

		const response = await request(testApp)
			.post("/raw")
			.send(JSON.stringify({ test: "data" }))
			.set("Content-Type", "application/json")
			.expect(200);

		expect(response.body.bodyReceived).toBe(true);
		expect(response.body.bodyContent).toEqual({ test: "data" });
	});
});

describe("Express Integration routing", () => {
	it("routes correctly when mounted at a sub-router root path", async () => {
		// The endpoint will use the root of the sub-router mount point
		const middlewareEndpoint = createEndpoint(
			"/api/test",
			{
				method: "POST",
			},
			async ({ body }) => {
				return {
					bodyReceived: body !== null && body !== undefined,
					bodyContent: body,
				};
			},
		);

		const router = createRouter({
			middlewareEndpoint,
		});

		const testApp = express();
		const testRouter = express.Router();

		testRouter.use(toNodeHandler(router.handler));

		// Mount the sub-router at /api/test
		testApp.use("/api/test", testRouter);

		const response = await request(testApp)
			.post("/api/test")
			.send(JSON.stringify({ test: "data" }))
			.set("Content-Type", "application/json")
			.expect(200);

		expect(response.body.bodyReceived).toBe(true);
		expect(response.body.bodyContent).toEqual({ test: "data" });
	});

	it("routes correctly when mounted via a wildcard middleware", async () => {
		const middlewareEndpoint = createEndpoint(
			"/api/auth/sign-in/social",
			{
				method: "POST",
			},
			async ({ body }) => {
				return {
					bodyReceived: body !== null && body !== undefined,
					bodyContent: body,
				};
			},
		);

		const router = createRouter({
			middlewareEndpoint,
		});

		const testApp = express();
		testApp.use("/api/auth/*path", toNodeHandler(router.handler));

		const response = await request(testApp)
			.post("/api/auth/sign-in/social")
			.send(JSON.stringify({ test: "data" }))
			.set("Content-Type", "application/json")
			.expect(200);

		expect(response.body.bodyReceived).toBe(true);
		expect(response.body.bodyContent).toEqual({ test: "data" });
	});
});
