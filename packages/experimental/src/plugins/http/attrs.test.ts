import { describe, expect, it } from "vitest";
import { ValidationError } from "../../error";
import { v } from "../../index";
import { asType, attrsOf, validate } from "../../schema";
import {
	clientSchema,
	fromJsonBody,
	readonly,
	rejectReadonly,
	responseSchema,
	returned,
	serverOnly,
	wireInput,
} from "./attrs";

describe("http field attrs", () => {
	const shape = {
		id: v.string(),
		role: readonly(v.string()),
		password: returned(v.string()),
		meta: v.object({
			note: v.string(),
			secret: readonly(v.string()),
			hash: returned(v.string()),
		}),
	};

	it("readonly and returned write $attrs.http", () => {
		expect(attrsOf(readonly(v.string()), "http")).toEqual({
			readonly: true,
		});
		expect(attrsOf(returned(v.string()), "http")).toEqual({
			returned: true,
		});
		expect(attrsOf(serverOnly(v.string()), "http")).toEqual({
			serverOnly: true,
		});
	});

	it("clientSchema drops readonly fields nested", () => {
		const projected = asType(clientSchema(v.object(shape)));
		expect(Object.keys(projected.shape as object).sort()).toEqual([
			"id",
			"meta",
			"password",
		]);
		const meta = asType((projected.shape as Record<string, unknown>).meta);
		expect(Object.keys(meta.shape as object).sort()).toEqual(["hash", "note"]);
	});

	it("responseSchema drops returned fields nested", () => {
		const projected = asType(responseSchema(v.object(shape)));
		expect(Object.keys(projected.shape as object).sort()).toEqual([
			"id",
			"meta",
			"role",
		]);
		const meta = asType((projected.shape as Record<string, unknown>).meta);
		expect(Object.keys(meta.shape as object).sort()).toEqual([
			"note",
			"secret",
		]);
	});

	it("rejectReadonly fails when a readonly key is present", () => {
		expect(() =>
			rejectReadonly(v.object(shape), {
				id: "1",
				role: "admin",
			}),
		).toThrow(ValidationError);
		expect(() =>
			rejectReadonly(v.object(shape), {
				id: "1",
				meta: { note: "hi", secret: "x" },
			}),
		).toThrow(/readonly field/);
	});

	it("wireInput accepts client fields and rejects smuggled readonly", () => {
		expect(
			wireInput(v.object(shape), {
				id: "1",
				password: "secret",
				meta: { note: "hi", hash: "h" },
			}),
		).toEqual({
			id: "1",
			password: "secret",
			meta: { note: "hi", hash: "h" },
		});
		expect(() =>
			wireInput(v.object(shape), { id: "1", role: "admin" }),
		).toThrow(ValidationError);
	});

	it("serverOnly still gates the wire like readonly", () => {
		const schema = v.object({
			id: v.string(),
			role: serverOnly(v.string()),
		});
		expect(() => wireInput(schema, { id: "1", role: "admin" })).toThrow(
			/readonly field/,
		);
		expect(wireInput(schema, { id: "1" })).toEqual({ id: "1" });
	});

	it("in-process validate still accepts readonly fields", () => {
		expect(
			validate(
				asType(v.object(shape)),
				{
					id: "1",
					role: "admin",
					password: "p",
					meta: { note: "n", secret: "s", hash: "h" },
				},
				"user",
			),
		).toEqual({
			id: "1",
			role: "admin",
			password: "p",
			meta: { note: "n", secret: "s", hash: "h" },
		});
	});

	it("fromJsonBody runs wireInput on the request body", async () => {
		const request = new Request("https://example.com", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "1",
				password: "p",
				meta: { note: "ok", hash: "h" },
			}),
		});
		await expect(fromJsonBody(request, v.object(shape))).resolves.toEqual({
			id: "1",
			password: "p",
			meta: { note: "ok", hash: "h" },
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

	it("clientSchema and rejectReadonly recurse into union arms", () => {
		const schema = v.union([
			v.object({
				kind: v.string({ enum: ["user"] }),
				id: v.string(),
				role: readonly(v.string()),
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
			rejectReadonly(schema, { kind: "user", id: "1", role: "admin" }),
		).toThrow(/readonly field/);
		expect(wireInput(schema, { kind: "anon", token: "t" })).toEqual({
			kind: "anon",
			token: "t",
		});
		expect(wireInput(schema, { kind: "user", id: "1" })).toEqual({
			kind: "user",
			id: "1",
		});
	});

	it("rejectReadonly only gates the matching union arm", () => {
		const schema = v.union([
			v.object({
				kind: v.string({ enum: ["user"] }),
				id: v.string(),
				role: readonly(v.string()),
			}),
			v.object({
				kind: v.string({ enum: ["anon"] }),
				token: v.string(),
				role: v.string({ optional: true }),
			}),
		]);
		// `role` is readonly on the user arm only; anon may still send it.
		expect(
			wireInput(schema, { kind: "anon", token: "t", role: "guest" }),
		).toEqual({ kind: "anon", token: "t", role: "guest" });
		expect(() =>
			wireInput(schema, { kind: "user", id: "1", role: "admin" }),
		).toThrow(/readonly field/);
	});

	it("union arm selection uses the full schema, not the projection", () => {
		// Earlier arm gates `role` but only accepts numbers; later arm
		// accepts the string the client sent. Projecting `role` out would
		// wrongly pick the first arm and reject.
		const schema = v.union([
			v.object({
				kind: v.string({ enum: ["a"] }),
				role: readonly(v.number()),
			}),
			v.object({
				kind: v.string({ enum: ["a"] }),
				role: v.string(),
			}),
		]);
		expect(wireInput(schema, { kind: "a", role: "admin" })).toEqual({
			kind: "a",
			role: "admin",
		});
	});

	it("wrong-typed readonly keys still reject on projected fallback", () => {
		const schema = v.union([
			v.object({
				kind: v.string({ enum: ["user"] }),
				id: v.string(),
				role: readonly(v.string()),
			}),
		]);
		expect(() =>
			wireInput(schema, { kind: "user", id: "1", role: 123 as never }),
		).toThrow(/readonly field/);
	});
});
