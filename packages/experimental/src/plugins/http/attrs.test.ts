import { describe, expect, it } from "vitest";
import { ValidationError } from "../../error";
import { v } from "../../index";
import { asType, attrsOf, validate } from "../../schema";
import {
	clientSchema,
	fromJsonBody,
	rejectServerOnly,
	serverOnly,
	wireInput,
} from "./attrs";

describe("http field attrs", () => {
	const shape = {
		id: v.string(),
		role: serverOnly(v.string()),
		meta: v.object({
			note: v.string(),
			secret: serverOnly(v.string()),
		}),
	};

	it("serverOnly writes $attrs.http", () => {
		expect(attrsOf(serverOnly(v.string()), "http")).toEqual({
			serverOnly: true,
		});
	});

	it("clientSchema drops server-only fields nested", () => {
		const projected = asType(clientSchema(v.object(shape)));
		expect(Object.keys(projected.shape as object).sort()).toEqual([
			"id",
			"meta",
		]);
		const meta = asType((projected.shape as Record<string, unknown>).meta);
		expect(Object.keys(meta.shape as object)).toEqual(["note"]);
	});

	it("rejectServerOnly fails when a server-only key is present", () => {
		expect(() =>
			rejectServerOnly(v.object(shape), {
				id: "1",
				role: "admin",
			}),
		).toThrow(ValidationError);
		expect(() =>
			rejectServerOnly(v.object(shape), {
				id: "1",
				meta: { note: "hi", secret: "x" },
			}),
		).toThrow(/server-only/);
	});

	it("wireInput accepts client fields and rejects smuggled server-only", () => {
		expect(
			wireInput(v.object(shape), {
				id: "1",
				meta: { note: "hi" },
			}),
		).toEqual({ id: "1", meta: { note: "hi" } });
		expect(() =>
			wireInput(v.object(shape), { id: "1", role: "admin" }),
		).toThrow(ValidationError);
	});

	it("in-process validate still accepts server-only fields", () => {
		expect(
			validate(
				asType(v.object(shape)),
				{
					id: "1",
					role: "admin",
					meta: { note: "n", secret: "s" },
				},
				"user",
			),
		).toEqual({
			id: "1",
			role: "admin",
			meta: { note: "n", secret: "s" },
		});
	});

	it("fromJsonBody runs wireInput on the request body", async () => {
		const request = new Request("https://example.com", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "1", meta: { note: "ok" } }),
		});
		await expect(fromJsonBody(request, v.object(shape))).resolves.toEqual({
			id: "1",
			meta: { note: "ok" },
		});

		const smuggle = new Request("https://example.com", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "1", role: "admin" }),
		});
		await expect(fromJsonBody(smuggle, v.object(shape))).rejects.toThrow(
			ValidationError,
		);

		const badJson = new Request("https://example.com", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		});
		await expect(fromJsonBody(badJson, v.object(shape))).rejects.toThrow(
			/expected a JSON body \(/,
		);
	});

	it("clientSchema and rejectServerOnly recurse into union arms", () => {
		const schema = v.union([
			v.object({
				kind: v.string({ enum: ["user"] }),
				id: v.string(),
				role: serverOnly(v.string()),
			}),
			v.object({
				kind: v.string({ enum: ["anon"] }),
				token: v.string(),
			}),
		]);
		const projected = asType(clientSchema(schema));
		const arms = projected.shape as unknown[];
		expect(arms).toHaveLength(2);
		expect(Object.keys(asType(arms[0]).shape as object).sort()).toEqual([
			"id",
			"kind",
		]);
		expect(Object.keys(asType(arms[1]).shape as object).sort()).toEqual([
			"kind",
			"token",
		]);

		expect(() =>
			rejectServerOnly(schema, { kind: "user", id: "1", role: "admin" }),
		).toThrow(/server-only/);
		expect(wireInput(schema, { kind: "anon", token: "t" })).toEqual({
			kind: "anon",
			token: "t",
		});
		expect(wireInput(schema, { kind: "user", id: "1" })).toEqual({
			kind: "user",
			id: "1",
		});
	});
});
