import { describe, expect, expectTypeOf, it } from "vitest";
import { FnError, v } from "../../index";
import {
	applyError,
	err,
	errorStatus,
	type HttpResponse,
	http,
	kHttpErr,
	statusOf,
} from "./index";

const app = v.fn({ use: [http] });

describe("http.err - status on declared errors", () => {
	it("stashes status without polluting enumerable fields", () => {
		const decl = err(401, { attempts: v.number() });
		expect(statusOf(decl)).toBe(401);
		expect(Object.keys(decl)).toEqual(["attempts"]);
		expect((decl as Record<symbol, unknown>)[kHttpErr]).toEqual({
			status: 401,
		});
	});

	it("status-only declarations stay empty payloads", () => {
		const decl = err(410);
		expect(statusOf(decl)).toBe(410);
		expect(Object.keys(decl)).toEqual([]);
	});

	it("refuses non-HTTP status numbers", () => {
		expect(() => err(99)).toThrow(/http\.err\.status/);
		expect(() => err(600)).toThrow(/http\.err\.status/);
		expect(() => err(401.5)).toThrow(/http\.err\.status/);
	});

	it("copies the data shape so shared schemas do not share meta", () => {
		const shared = { attempts: v.number() };
		const a = err(401, shared);
		const b = err(403, shared);
		expect(statusOf(a)).toBe(401);
		expect(statusOf(b)).toBe(403);
		expect(statusOf(shared)).toBeUndefined();
	});

	it("c.error still validates payload; status never enters data", () => {
		const signIn = app.fn(
			"httpt.err.sign_in",
			{
				input: { kind: v.string() },
				errors: {
					invalid_credentials: err(401, { attempts: v.number() }),
					gone: err(410),
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
		}

		expect(() =>
			app.fn(
				"httpt.err.liar",
				{ errors: { oops: err(400, { code: v.number() }) } },
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
					denied: err(403),
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
					unauthorized: err(401, { attempts: v.number() }),
					conflict: err(409),
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

	it("applyError leaves res.status alone for plain error tags", () => {
		const response = { headers: new Headers(), status: 200 };
		applyError(response, { plain: { reason: v.string() } }, { tag: "plain" });
		expect(response.status).toBe(200);
	});

	it("http.err is re-exported on the http module", () => {
		expect(http.err(418)).toBeDefined();
		expect(http.statusOf(http.err(418))).toBe(418);
	});
});
