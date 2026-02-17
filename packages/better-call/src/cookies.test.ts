import { describe, expect, it } from "vitest";
import { createEndpoint } from "./v2/endpoint";
import { z } from "zod";
import { signCookieValue } from "./crypto";
import { parseCookies } from "./cookies";

describe("parseCookies", () => {
	it("should parse cookies", () => {
		const cookies = parseCookies("test=test; test2=test 2");
		expect(cookies.get("test")).toBe("test");
		expect(cookies.get("test2")).toBe("test 2");
	});

	it("should parse cookies with encoded values", () => {
		const cookies = parseCookies("test=test; test2=test%202");
		expect(cookies.get("test")).toBe("test");
		expect(cookies.get("test2")).toBe("test 2");
	});
});

describe("get-cookies", () => {
	it("should get cookies", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
				body: z.object({
					cookieName: z.string(),
				}),
				requireHeaders: true,
			},
			async (c) => {
				return c.getCookie(c.body.cookieName);
			},
		);
		const response = await endpoint({
			body: {
				cookieName: "test",
			},
			headers: {
				cookie: "test=test",
			},
		});
		expect(response).toBe("test");
	});

	it("should get signed cookies", async () => {
		const secret = "test";
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
				body: z.object({
					cookieName: z.string(),
				}),
				requireHeaders: true,
			},
			async (c) => {
				return c.getSignedCookie(c.body.cookieName, secret);
			},
		);
		const response = await endpoint({
			body: {
				cookieName: "test",
			},
			headers: {
				cookie: `test=${await signCookieValue("test", secret)}`,
			},
		});
		expect(response).toBe("test");
	});

	it("should return null if signature is invalid", async () => {
		const secret = "test";
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
				body: z.object({
					cookieName: z.string(),
				}),
				requireHeaders: true,
			},
			async (c) => {
				return c.getSignedCookie(c.body.cookieName, secret);
			},
		);
		const response = await endpoint({
			body: {
				cookieName: "test",
			},
			headers: {
				cookie: `test=invalid_signature`,
			},
		});
		expect(response).toBe(null);
	});

	it("should return false if secret is invalid", async () => {
		const secret = "test";
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
				body: z.object({
					cookieName: z.string(),
				}),
				requireHeaders: true,
			},
			async (c) => {
				return c.getSignedCookie(c.body.cookieName, "invalid_secret");
			},
		);
		const response = await endpoint({
			body: {
				cookieName: "test",
			},
			headers: {
				cookie: `test=${await signCookieValue("test", secret)}`,
			},
		});
		expect(response).toBe(false);
	});
});

describe("set-cookies", () => {
	it("should set cookie", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
			},
			async (c) => {
				c.setCookie("test", "test");
			},
		);
		const response = await endpoint({
			returnHeaders: true,
		});
		expect(response.headers.get("set-cookie")).toBe("test=test");
	});

	it("should set multiple cookies", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
			},
			async (c) => {
				c.setCookie("test", "test");
				c.setCookie("test2", "test2");
				c.setCookie("test3", "test3");
			},
		);
		const response = await endpoint({
			returnHeaders: true,
		});
		expect(response.headers.get("set-cookie")).toBe(
			"test=test, test2=test2, test3=test3",
		);
	});

	it("should apply options", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
			},
			async (c) => {
				c.setCookie("test", "test", {
					secure: true,
					httpOnly: true,
					path: "/",
				});
			},
		);
		const response = await endpoint({
			returnHeaders: true,
		});

		expect(response.headers.get("Set-Cookie")).toBe(
			"test=test; Path=/; HttpOnly; Secure",
		);
	});

	it("should apply multiple cookies with options", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
			},
			async (c) => {
				c.setCookie("test", "test", {
					secure: true,
					httpOnly: true,
					path: "/",
				});
				c.setCookie("test2", "test2", {
					secure: true,
					httpOnly: true,
					path: "/",
				});
			},
		);
		const response = await endpoint({
			returnHeaders: true,
		});
		expect(response.headers.get("Set-Cookie")).toBe(
			"test=test; Path=/; HttpOnly; Secure, test2=test2; Path=/; HttpOnly; Secure",
		);
	});

	it("should set signed cookie", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
			},
			async (c) => {
				await c.setSignedCookie("test", "test", "test");
			},
		);
		const response = await endpoint({
			returnHeaders: true,
		});
		const setCookie = response.headers.get("set-cookie");
		const signature = setCookie?.split(".")[1];
		expect(setCookie).toContain("test=test.");
		expect(signature?.length).toBeGreaterThan(10);
	});

	it("should properly sign cookies", async () => {
		const endpoint = createEndpoint(
			"/",
			{
				method: "POST",
			},
			async (c) => {
				await c.setSignedCookie("test", "test", "test");
			},
		);
		const response = await endpoint({
			returnHeaders: true,
		});
		const setCookie = response.headers.get("set-cookie");
		const endpoint2 = createEndpoint(
			"/",
			{
				method: "POST",
				requireHeaders: true,
			},
			async (c) => {
				return await c.getSignedCookie("test", "test");
			},
		);
		const response2 = await endpoint2({
			headers: {
				cookie: setCookie!,
			},
		});
		expect(response2).toBe("test");
	});
});
