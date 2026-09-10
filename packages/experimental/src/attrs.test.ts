import { describe, expect, expectTypeOf, it } from "vitest";
import { ValidationError } from "./error";
import { v } from "./index";
import {
	asType,
	attrsOf,
	isNoInput,
	isNoOutput,
	omitFields,
	parseFields,
	rejectFields,
	type SchemaInputOf,
	type SchemaOutputOf,
	validate,
	withAttrs,
} from "./schema";

describe("schema $attrs", () => {
	it("withAttrs merges within a namespace and isolates namespaces", () => {
		const base = v.string();
		const once = withAttrs(base, "db", { unique: true });
		const twice = withAttrs(once, "db", { index: true });
		const both = withAttrs(twice, "http", { tag: true });

		expect(attrsOf(twice, "db")).toEqual({ unique: true, index: true });
		expect(attrsOf(both, "http")).toEqual({ tag: true });
		expect(attrsOf(both)?.db).toEqual({ unique: true, index: true });
		// Original untouched.
		expect(attrsOf(base)).toBeUndefined();
	});

	it("asType preserves $attrs on a type def", () => {
		const marked = withAttrs(v.number({ min: 1 }), "db", { unique: true });
		expect(attrsOf(marked, "db")).toEqual({ unique: true });
		expect(validate(marked, 2, "n")).toBe(2);
	});

	it("validate ignores $attrs", () => {
		const email = withAttrs(v.string({ email: true }), "db", {
			unique: true,
		});
		expect(validate(email, "a@b.co", "email")).toBe("a@b.co");
		expect(() => validate(email, "nope", "email")).toThrow(ValidationError);
	});

	it("withAttrs on a var keeps $var identity", () => {
		const user = v.var("attr_user", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const marked = withAttrs(user, "http", { tag: true });
		expect(marked.$var).toBe(true);
		expect(marked.name).toBe("attr_user");
		expect(typeof marked.customize).toBe("function");
		expect(attrsOf(marked, "http")).toEqual({ tag: true });
		// Field schema on the var is untouched.
		expect(attrsOf(marked.schema)).toBeUndefined();
	});

	it("customize after withAttrs keeps whole-var attrs", () => {
		const user = v.var("attr_user_customize", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const marked = withAttrs(user, "http", { tag: true });
		const widened = marked.customize({
			schema: (c) => c.add({ role: c.string() }),
		});
		expect(widened.$var).toBe(true);
		expect(attrsOf(widened, "http")).toEqual({ tag: true });
		expect(
			(widened.schema as { shape: Record<string, unknown> }).shape.role,
		).toBeDefined();
	});
});

describe("v.noInput / v.noOutput and schema views", () => {
	const user = v.var("attr_views_user", {
		schema: v.object({
			id: v.noInput(v.string()),
			email: v.string(),
			passwordHash: v.noOutput(v.string()),
		}),
	});

	it("marks $attrs.v", () => {
		expect(attrsOf(v.noInput(v.string()), "v")).toEqual({ noInput: true });
		expect(attrsOf(v.noOutput(v.string()), "v")).toEqual({ noOutput: true });
		expect(isNoInput(v.noInput(v.string()))).toBe(true);
		expect(isNoOutput(v.noOutput(v.string()))).toBe(true);
	});

	it("var.input and var.output project nested fields", () => {
		const inputShape = asType(user.input.schema).shape as Record<
			string,
			unknown
		>;
		const outputShape = asType(user.output.schema).shape as Record<
			string,
			unknown
		>;
		expect(Object.keys(inputShape).sort()).toEqual(["email", "passwordHash"]);
		expect(Object.keys(outputShape).sort()).toEqual(["email", "id"]);
	});

	it("type .input / .output match omitFields", () => {
		const schema = v.object({
			id: v.noInput(v.string()),
			email: v.string(),
			secret: v.noOutput(v.string()),
		});
		expect(Object.keys(asType(schema.input).shape as object).sort()).toEqual([
			"email",
			"secret",
		]);
		expect(Object.keys(asType(schema.output).shape as object).sort()).toEqual([
			"email",
			"id",
		]);
	});

	it("SchemaInputOf / SchemaOutputOf drop gated keys", () => {
		type Row = {
			id: ReturnType<typeof v.noInput<ReturnType<typeof v.string>>>;
			email: ReturnType<typeof v.string>;
			passwordHash: ReturnType<typeof v.noOutput<ReturnType<typeof v.string>>>;
		};
		expectTypeOf<keyof SchemaInputOf<Row>>().toEqualTypeOf<
			"email" | "passwordHash"
		>();
		expectTypeOf<keyof SchemaOutputOf<Row>>().toEqualTypeOf<"id" | "email">();
	});
});

describe("omitFields / rejectFields / parseFields", () => {
	const dropMarked = (schema: unknown) =>
		attrsOf(schema, "v")?.noInput === true;
	const shape = v.object({
		id: v.string(),
		role: v.noInput(v.string()),
		meta: v.object({
			note: v.string(),
			secret: v.noInput(v.string()),
		}),
	});

	it("omitFields projects nested objects", () => {
		const projected = asType(omitFields(shape, dropMarked));
		expect(Object.keys(projected.shape as object).sort()).toEqual([
			"id",
			"meta",
		]);
		const meta = asType((projected.shape as Record<string, unknown>).meta);
		expect(Object.keys(meta.shape as object)).toEqual(["note"]);
	});

	it("rejectFields throws on smuggled keys", () => {
		expect(() =>
			rejectFields(shape, { id: "1", role: "admin" }, dropMarked),
		).toThrow(ValidationError);
		expect(() =>
			rejectFields(
				shape,
				{ id: "1", meta: { note: "n", secret: "s" } },
				dropMarked,
			),
		).toThrow(/field is not allowed/);
	});

	it("parseFields rejects then validates the projection", () => {
		expect(
			parseFields(
				shape,
				{ id: "1", meta: { note: "hi" } },
				{ reject: dropMarked, omit: dropMarked },
			),
		).toEqual({ id: "1", meta: { note: "hi" } });
		expect(() =>
			parseFields(
				shape,
				{ id: "1", role: "admin" },
				{ reject: dropMarked, omit: dropMarked },
			),
		).toThrow(ValidationError);
	});

	it("omitFields projects through a var schema", () => {
		const user = v.var("parse_user", {
			schema: shape,
		});
		const projected = omitFields(user, dropMarked);
		expect(projected.$var).toBe(true);
		expect(
			Object.keys(
				asType((projected as { schema: unknown }).schema).shape as object,
			).sort(),
		).toEqual(["id", "meta"]);
	});
});
