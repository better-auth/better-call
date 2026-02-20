import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { getRequest, setResponse } from "./request";

describe("getRequest", () => {
	it("should handle Express pre-parsed body", async () => {
		// Mock an Express request with pre-parsed body
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		// Set up the request properties
		req.url = "/api/test";
		req.method = "POST";
		req.headers = {
			host: "localhost:3000",
			"content-type": "application/json",
		};

		// Simulate Express body-parser already parsed the body
		req.body = { message: "Hello World", id: 123 };

		// Call getRequest
		const request = getRequest({
			request: req,
			base: "http://localhost:3000",
		});

		// Verify the request was created successfully
		expect(request).toBeInstanceOf(Request);
		expect(request.url).toBe("http://localhost:3000/api/test");
		expect(request.method).toBe("POST");

		// Verify the body can be read
		const bodyText = await request.text();
		expect(bodyText).toBe(JSON.stringify({ message: "Hello World", id: 123 }));
	});

	it("should handle Express pre-parsed string body", async () => {
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		req.url = "/api/test";
		req.method = "POST";
		req.headers = {
			host: "localhost:3000",
			"content-type": "text/plain",
		};

		// Simulate Express body-parser parsed a string body
		req.body = "Plain text body";

		const request = getRequest({
			request: req,
			base: "http://localhost:3000",
		});

		expect(request).toBeInstanceOf(Request);
		const bodyText = await request.text();
		expect(bodyText).toBe("Plain text body");
	});

	it("should handle Express sub-router with baseUrl", async () => {
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		// Simulate Express sub-router where baseUrl is the mount path
		req.baseUrl = "/api/v1";
		req.url = "/users/123";
		req.method = "GET";
		req.headers = {
			host: "localhost:3000",
		};

		const request = getRequest({
			request: req,
			base: "http://localhost:3000",
		});

		// Should combine baseUrl + url
		expect(request.url).toBe("http://localhost:3000/api/v1/users/123");
	});

	it("should handle raw body stream when no Express body parser", async () => {
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		req.url = "/api/test";
		req.method = "POST";
		req.headers = {
			host: "localhost:3000",
			"content-type": "application/json",
			"content-length": "20",
		};
		req.httpVersionMajor = 1;

		// No req.body property - raw stream should be used
		expect(req.body).toBeUndefined();

		// Mock the stream events
		req.on = vi.fn();
		req.pause = vi.fn();
		req.resume = vi.fn();
		req.destroy = vi.fn();
		req.destroyed = false;

		const request = getRequest({
			request: req,
			base: "http://localhost:3000",
		});

		expect(request).toBeInstanceOf(Request);
		expect(request.url).toBe("http://localhost:3000/api/test");

		// Verify stream handlers were set up
		expect(req.on).toHaveBeenCalledWith("error", expect.any(Function));
		expect(req.on).toHaveBeenCalledWith("end", expect.any(Function));
		expect(req.on).toHaveBeenCalledWith("data", expect.any(Function));
	});

	it("should handle both baseUrl and pre-parsed body together", async () => {
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		// Express sub-router with body parser
		req.baseUrl = "/api";
		req.url = "/webhook";
		req.method = "POST";
		req.headers = {
			host: "example.com",
			"content-type": "application/json",
		};
		req.body = { event: "user.created", data: { id: 1, name: "Test" } };

		const request = getRequest({
			request: req,
			base: "https://example.com",
		});

		expect(request.url).toBe("https://example.com/api/webhook");

		const bodyText = await request.text();
		expect(bodyText).toBe(
			JSON.stringify({ event: "user.created", data: { id: 1, name: "Test" } }),
		);
	});

	it("should not include body for GET requests", async () => {
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		req.url = "/api/users";
		req.method = "GET";
		req.headers = {
			host: "localhost:3000",
			"content-type": "application/json",
			"content-length": "20",
		};
		req.httpVersionMajor = 1;

		// Mock the stream events
		req.on = vi.fn();
		req.pause = vi.fn();
		req.resume = vi.fn();
		req.destroy = vi.fn();
		req.destroyed = false;

		const request = getRequest({
			request: req,
			base: "http://localhost:3000",
		});

		expect(request).toBeInstanceOf(Request);
		expect(request.url).toBe("http://localhost:3000/api/users");
		expect(request.method).toBe("GET");

		// Body should be null for GET requests
		expect(request.body).toBeNull();

		// Stream handlers should not be set up for GET requests
		expect(req.on).not.toHaveBeenCalled();
	});

	it("should not include body for HEAD requests", async () => {
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		req.url = "/api/health";
		req.method = "HEAD";
		req.headers = {
			host: "localhost:3000",
			"content-type": "application/json",
			"content-length": "50",
		};
		req.httpVersionMajor = 1;

		// Mock the stream events
		req.on = vi.fn();
		req.pause = vi.fn();
		req.resume = vi.fn();
		req.destroy = vi.fn();
		req.destroyed = false;

		const request = getRequest({
			request: req,
			base: "http://localhost:3000",
		});

		expect(request).toBeInstanceOf(Request);
		expect(request.url).toBe("http://localhost:3000/api/health");
		expect(request.method).toBe("HEAD");

		// Body should be null for HEAD requests
		expect(request.body).toBeNull();

		// Stream handlers should not be set up for HEAD requests
		expect(req.on).not.toHaveBeenCalled();
	});

	it("should ignore pre-parsed body for GET requests", async () => {
		const socket = new Socket();
		const req = new IncomingMessage(socket) as any;

		req.url = "/api/search";
		req.method = "GET";
		req.headers = {
			host: "localhost:3000",
			"content-type": "application/json",
		};

		// Even if Express somehow attached a body to a GET request, it should be ignored
		req.body = { query: "test", limit: 10 };

		const request = getRequest({
			request: req,
			base: "http://localhost:3000",
		});

		expect(request).toBeInstanceOf(Request);
		expect(request.url).toBe("http://localhost:3000/api/search");
		expect(request.method).toBe("GET");

		// Body should be null for GET requests even if req.body exists
		expect(request.body).toBeNull();
	});
});

describe("setResponse", () => {
	it("should set res.statusCode before writeHead for middleware compatibility", async () => {
		// Regression test for https://github.com/better-auth/better-auth/issues/7035
		// Some frameworks/middleware read res.statusCode before writeHead is called.
		// We need to ensure statusCode is set early so loggers see the correct status.
		const socket = new Socket();
		const req = new IncomingMessage(socket);
		const res = new ServerResponse(req);

		let statusCodeBeforeWriteHead: number | undefined;

		// Intercept writeHead to capture statusCode at that moment
		const originalWriteHead = res.writeHead.bind(res);
		res.writeHead = vi.fn().mockImplementation((status: number) => {
			statusCodeBeforeWriteHead = res.statusCode;
			return originalWriteHead(status);
		});

		res.write = vi.fn().mockReturnValue(true);
		res.end = vi.fn().mockReturnValue(res);

		const webResponse = new Response(JSON.stringify({ error: "Bad Request" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});

		await setResponse(res, webResponse);

		// statusCode should already be 400 BEFORE writeHead is called
		expect(statusCodeBeforeWriteHead).toBe(400);
		expect(res.statusCode).toBe(400);
	});
});
