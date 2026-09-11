import { describe, expect, expectTypeOf, it } from "vitest";
import { ValidationError } from "../../error";
import { v } from "../../index";
import {
	asType,
	attrsOf,
	type InferInput,
	type SchemaInputOf,
	validate,
} from "../../schema";
import {
	clientSchema,
	fromJsonBody,
	rejectReadonly,
	responseSchema,
	serverOnly,
	wireInput,
} from "./attrs";

describe("http field attrs", () => {
	const shape = {
		id: v.string(),
		role: v.noInput(v.string()),
		password: v.noOutput(v.string()),
		meta: v.object({
			note: v.string(),
			secret: v.noInput(v.string()),
			hash: v.noOutput(v.string()),
		}),
	};

	it("serverOnly aliases v.noInput; noOutput writes $attrs.v", () => {
		expect(attrsOf(serverOnly(v.string()), "v")).toEqual({
			noInput: true,
		});
		expect(attrsOf(v.noOutput(v.string()), "v")).toEqual({
			noOutput: true,
		});
		expect(serverOnly).toBe(v.noInput);
	});

	it("clientSchema drops noInput fields nested", () => {
		const projected = asType(clientSchema(v.object(shape)));
		expect(Object.keys(projected.shape as object).sort()).toEqual([
			"id",
			"meta",
			"password",
		]);
		const meta = asType((projected.shape as Record<string, unknown>).meta);
		expect(Object.keys(meta.shape as object).sort()).toEqual(["hash", "note"]);
	});

	it("responseSchema drops noOutput fields nested", () => {
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

	it("rejectReadonly fails when a noInput key is present", () => {
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
		).toThrow(/noInput field/);
	});

	it("wireInput accepts client fields and rejects smuggled noInput", () => {
		const schema = v.object(shape);
		const parsed = wireInput(schema, {
			id: "1",
			password: "secret",
			meta: { note: "hi", hash: "h" },
		});
		expect(parsed).toEqual({
			id: "1",
			password: "secret",
			meta: { note: "hi", hash: "h" },
		});
		expectTypeOf(parsed).toEqualTypeOf<
			InferInput<SchemaInputOf<typeof schema>>
		>();
		expect(() => wireInput(schema, { id: "1", role: "admin" })).toThrow(
			ValidationError,
		);
	});

	it("in-process validate still accepts noInput fields on the full schema", () => {
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
				role: v.noInput(v.string()),
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
		).toThrow(/noInput field/);
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
				role: v.noInput(v.string()),
			}),
			v.object({
				kind: v.string({ enum: ["anon"] }),
				token: v.string(),
				role: v.string({ optional: true }),
			}),
		]);
		// `role` is noInput on the user arm only; anon may still send it.
		expect(
			wireInput(schema, { kind: "anon", token: "t", role: "guest" }),
		).toEqual({ kind: "anon", token: "t", role: "guest" });
		expect(() =>
			wireInput(schema, { kind: "user", id: "1", role: "admin" }),
		).toThrow(/noInput field/);
	});

	it("union arm selection uses the full schema, not the projection", () => {
		const schema = v.union([
			v.object({
				kind: v.string({ enum: ["a"] }),
				role: v.noInput(v.number()),
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

	it("wrong-typed noInput keys still reject on projected fallback", () => {
		const schema = v.union([
			v.object({
				kind: v.string({ enum: ["user"] }),
				id: v.string(),
				role: v.noInput(v.string()),
			}),
		]);
		expect(() =>
			wireInput(schema, { kind: "user", id: "1", role: 123 as never }),
		).toThrow(/noInput field/);
	});

	it("nested unions reject wrong-typed noInput keys too", () => {
		const schema = v.object({
			profile: v.union([
				v.object({
					kind: v.string({ enum: ["user"] }),
					role: v.noInput(v.string()),
				}),
			]),
		});
		expect(() =>
			wireInput(schema, {
				profile: { kind: "user", role: 123 as never },
			}),
		).toThrow(/noInput field/);
	});
});
