import { describe, expect, expectTypeOf, it } from "vitest";
import { FnError, UnexpectedError, ValidationError, v } from "../../index";
import {
	applyError,
	encodeError,
	err,
	errorStatus,
	type HttpResponse,
	http,
	kHttpErr,
	statusOf,
} from "./index";

const app = v.fn({ use: [http] });

describe("http.err - status + message on declared errors", () => {
	it("stashes status and message without polluting enumerable fields", () => {
		const decl = err(401, "Invalid credentials", { attempts: v.number() });
		expect(statusOf(decl)).toBe(401);
		expect(Object.keys(decl)).toEqual(["attempts"]);
		expect((decl as Record<symbol, unknown>)[kHttpErr]).toEqual({
			status: 401,
			message: "Invalid credentials",
		});
	});

	it("message-only declarations stay empty payloads", () => {
		const decl = err(410, "Gone");
		expect(statusOf(decl)).toBe(410);
		expect(Object.keys(decl)).toEqual([]);
		expect((decl as Record<symbol, unknown>)[kHttpErr]).toEqual({
			status: 410,
			message: "Gone",
		});
	});

	it("refuses non-HTTP status numbers", () => {
		expect(() => err(99, "nope")).toThrow(/http\.err\.status/);
		expect(() => err(600, "nope")).toThrow(/http\.err\.status/);
		expect(() => err(401.5, "nope")).toThrow(/http\.err\.status/);
	});

	it("copies the data shape so shared schemas do not share meta", () => {
		const shared = { attempts: v.number() };
		const a = err(401, "a", shared);
		const b = err(403, "b", shared);
		expect(statusOf(a)).toBe(401);
		expect(statusOf(b)).toBe(403);
		expect(statusOf(shared)).toBeUndefined();
	});

	it("c.error still validates payload; status and message never enter data", () => {
		const signIn = app.fn(
			"httpt.err.sign_in",
			{
				input: { kind: v.string() },
				errors: {
					invalid_credentials: err(401, "Invalid credentials", {
						attempts: v.number(),
					}),
					gone: err(410, "Gone"),
				},
			},
			(c) => {
				if (c.input.kind === "gone") throw c.error("gone");
				throw c.error("invalid_credentials", { attempts: 3 });
			},
		);

		const bad = signIn.try({ kind: "bad" });
		expect(bad.ok).toBe(false);
		if (!bad.ok) {
			expect(bad.error).toBeInstanceOf(FnError);
			expect(bad.error.tag).toBe("invalid_credentials");
			expect(bad.error.data).toEqual({ attempts: 3 });
			expect(bad.error.status).toBe(401);
			expect(bad.error.message).toBe("Invalid credentials");
			if (bad.error.tag === "invalid_credentials") {
				expectTypeOf(bad.error.data).toEqualTypeOf<{
					readonly attempts: number;
				}>();
			}
		}

		const gone = signIn.try({ kind: "gone" });
		expect(gone.ok).toBe(false);
		if (!gone.ok) {
			expect(gone.error.tag).toBe("gone");
			expect(gone.error.data).toEqual({});
			expect(gone.error.status).toBe(410);
			expect(gone.error.message).toBe("Gone");
		}

		expect(() =>
			app.fn(
				"httpt.err.liar",
				{
					errors: {
						oops: err(400, "Oops", { code: v.number() }),
					},
				},
				(c) => {
					throw c.error("oops", { code: "nope" } as never);
				},
			)(),
		).toThrow(/httpt\.err\.liar\.errors\.oops\.code/);
	});

	it("errorStatus reads from the fn's declared errors map", () => {
		const guard = app.fn(
			"httpt.err.guard",
			{
				errors: {
					denied: err(403, "Denied"),
					plain: { reason: v.string() },
				},
			},
			(c) => {
				throw c.error("denied");
			},
		);
		const errors = guard.$schema?.errors;
		expect(errorStatus(errors, "denied")).toBe(403);
		expect(errorStatus(errors, "plain")).toBeUndefined();
		expect(errorStatus(errors, "missing")).toBeUndefined();
		expect(errorStatus(undefined, "denied")).toBeUndefined();
	});

	it("applyError writes status onto res from http.err metadata", () => {
		const endpoint = app.fn(
			"httpt.err.endpoint",
			{
				errors: {
					unauthorized: err(401, "Unauthorized", { attempts: v.number() }),
					conflict: err(409, "Conflict"),
				},
			},
			(c) => {
				throw c.error("unauthorized", { attempts: 1 });
			},
		);

		const result = endpoint.try();
		expect(result.ok).toBe(false);
		if (result.ok) return;

		const response: HttpResponse = { headers: new Headers() };
		applyError(response, endpoint.$schema?.errors, result.error);
		expect(response.status).toBe(401);
	});

	it("applyError uses FnError.status when the map is absent", () => {
		const response: HttpResponse = { headers: new Headers() };
		applyError(response, undefined, { tag: "denied", status: 403 });
		expect(response.status).toBe(403);
	});

	it("applyError leaves res.status alone for plain error tags", () => {
		const response = { headers: new Headers(), status: 200 };
		applyError(response, { plain: { reason: v.string() } }, { tag: "plain" });
		expect(response.status).toBe(200);
	});

	it("http.err is re-exported on the http module", () => {
		expect(http.err(418, "I'm a teapot")).toBeDefined();
		expect(http.statusOf(http.err(418, "I'm a teapot"))).toBe(418);
	});
});

describe("encodeError + createHandler JSON bodies", () => {
	it("encodeError maps ValidationError to 400", () => {
		const error = new ValidationError(
			"body.n",
			'expected number, received string ("x")',
			[
				{
					path: "body.n",
					message: 'expected number, received string ("x")',
					received: '"x"',
				},
			],
		);
		expect(encodeError(error)).toEqual({
			status: 400,
			body: error.toJSON(),
		});
	});

	it("encodeError maps FnError status or defaults to 422", () => {
		const stamped = new FnError("denied", {}, "f", 403);
		expect(encodeError(stamped)?.status).toBe(403);
		const plain = new FnError("denied", {}, "f");
		expect(encodeError(plain)?.status).toBe(422);
	});

	it("encodeError maps UnexpectedError to 500 without a cause stack", () => {
		const unexpected = new UnexpectedError(new Error("boom"), "f");
		expect(encodeError(unexpected)).toEqual({
			status: 500,
			body: {
				name: "UnexpectedError",
				message: "f: unexpected - boom",
				trail: ["f"],
				cause: { name: "Error", message: "boom" },
			},
		});
	});

	it("createHandler returns 400 JSON for ValidationError", async () => {
		const fetch = http.createHandler(() => {
			throw new ValidationError(
				"body.email",
				'expected an email address, received "x"',
				[
					{
						path: "body.email",
						message: 'expected an email address, received "x"',
						received: '"x"',
					},
				],
			);
		});
		const response = await fetch(new Request("http://x.test/"));
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			name: "ValidationError",
			path: "body.email",
			issues: [{ path: "body.email", received: '"x"' }],
		});
	});

	it("createHandler returns declared status + message JSON for FnError", async () => {
		const deny = app.fn(
			"httpt.err.deny",
			{ errors: { denied: err(403, "Denied") } },
			(c) => {
				throw c.error("denied");
			},
		);
		const fetch = http.createHandler(() => {
			throw deny();
		});
		const response = await fetch(new Request("http://x.test/"));
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			name: "FnError",
			tag: "denied",
			data: {},
			trail: ["httpt.err.deny"],
			status: 403,
			message: "Denied",
		});
	});

	it("encodeError rewrites FnError message by tag and keeps originalMessage", () => {
		const stamped = new FnError("denied", {}, "f", 403, "Denied");
		expect(
			encodeError(stamped, {
				messages: { denied: "Refusé" },
			}),
		).toEqual({
			status: 403,
			body: {
				name: "FnError",
				tag: "denied",
				data: {},
				trail: ["f"],
				status: 403,
				message: "Refusé",
				originalMessage: "Denied",
			},
		});
	});

	it("encodeError message fn can interpolate data", () => {
		const stamped = new FnError(
			"rate_limited",
			{ retryAfter: 30 },
			"f",
			429,
			"Too many attempts",
		);
		expect(
			encodeError(stamped, {
				message: (error) =>
					error.tag === "rate_limited"
						? `Réessayez dans ${(error.data as { retryAfter: number }).retryAfter}s`
						: error.message,
			})?.body,
		).toMatchObject({
			message: "Réessayez dans 30s",
			originalMessage: "Too many attempts",
		});
	});

	it("encodeError messages fn can pick a locale from the request", () => {
		const stamped = new FnError("denied", {}, "f", 403, "Denied");
		const request = new Request("http://x.test/", {
			headers: { "Accept-Language": "fr" },
		});
		expect(
			encodeError(stamped, {
				request,
				messages: (req) => {
					const locale = req?.headers.get("Accept-Language") ?? "en";
					return {
						en: { denied: "Denied" },
						fr: { denied: "Refusé" },
					}[locale];
				},
			})?.body,
		).toMatchObject({
			message: "Refusé",
			originalMessage: "Denied",
		});
	});

	it("createHandler message fn receives the request", async () => {
		const deny = app.fn(
			"httpt.err.deny_req",
			{ errors: { denied: err(403, "Denied") } },
			(c) => {
				throw c.error("denied");
			},
		);
		const fetch = http.createHandler(
			() => {
				throw deny();
			},
			{
				message: (error, request) => {
					if (request?.headers.get("Accept-Language") === "fr") {
						return "Refusé";
					}
					return error.message;
				},
			},
		);
		const response = await fetch(
			new Request("http://x.test/", {
				headers: { "Accept-Language": "fr" },
			}),
		);
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			message: "Refusé",
			originalMessage: "Denied",
		});
	});

	it("encodeError leaves message alone when no override matches", () => {
		const stamped = new FnError("denied", {}, "f", 403, "Denied");
		expect(encodeError(stamped, { messages: { other: "x" } })?.body).toEqual({
			name: "FnError",
			tag: "denied",
			data: {},
			trail: ["f"],
			status: 403,
			message: "Denied",
		});
	});

	it("createHandler applies messages overrides from options", async () => {
		const deny = app.fn(
			"httpt.err.deny_i18n",
			{ errors: { denied: err(403, "Denied") } },
			(c) => {
				throw c.error("denied");
			},
		);
		const fetch = http.createHandler(
			() => {
				throw deny();
			},
			{
				messages: { denied: "Refusé" },
			},
		);
		const response = await fetch(new Request("http://x.test/"));
		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			tag: "denied",
			message: "Refusé",
			originalMessage: "Denied",
		});
	});
});
