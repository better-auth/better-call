import { describe, expect, expectTypeOf, it } from "vitest";
import { ValidationError, v } from "./index";
import type { InferArgs, InferInput } from "./schema";
import { validate } from "./schema";

describe("v.enum", () => {
	const role = v.enum(["admin", "user"]);

	it("narrows to the literal union", () => {
		expectTypeOf<InferInput<typeof role>>().toEqualTypeOf<"admin" | "user">();
		expectTypeOf<InferArgs<typeof role>>().toEqualTypeOf<"admin" | "user">();
	});

	it("accepts listed values", () => {
		expect(validate(role, "admin", "role")).toBe("admin");
		expect(validate(role, "user", "role")).toBe("user");
	});

	it("rejects values outside the set", () => {
		expect(() => validate(role, "guest", "role")).toThrow(ValidationError);
		expect(() => validate(role, "guest", "role")).toThrow(/one of/);
	});

	it("works as a fn input field", () => {
		const f = v.fn({ input: { role } }, (c) => c.input.role);
		expect(f({ role: "admin" })).toBe("admin");
		expect(() => f({ role: "guest" } as never)).toThrow(ValidationError);
		expectTypeOf(f).returns.toEqualTypeOf<"admin" | "user">();
	});

	it("supports number and boolean literals", () => {
		const status = v.enum([200, 404] as const);
		const flag = v.enum([true, false] as const);
		expect(validate(status, 200, "s")).toBe(200);
		expect(() => validate(status, 500, "s")).toThrow(ValidationError);
		expect(validate(flag, false, "f")).toBe(false);
	});
});

describe("v.array", () => {
	const tags = v.array(v.string({ min: 1 }));

	it("infers an array of the item type", () => {
		expectTypeOf<InferInput<typeof tags>>().toEqualTypeOf<string[]>();
		expectTypeOf<InferArgs<typeof tags>>().toEqualTypeOf<string[]>();
	});

	it("validates every element", () => {
		expect(validate(tags, ["a", "b"], "tags")).toEqual(["a", "b"]);
		expect(() => validate(tags, ["a", ""], "tags")).toThrow(ValidationError);
		expect(() => validate(tags, ["a", ""], "tags")).toThrow(/tags\[1\]/);
	});

	it("rejects non-arrays", () => {
		expect(() => validate(tags, "nope", "tags")).toThrow(/expected array/);
	});

	it("enforces length rules", () => {
		const pair = v.array(v.number(), { length: 2 });
		expect(validate(pair, [1, 2], "p")).toEqual([1, 2]);
		expect(() => validate(pair, [1], "p")).toThrow(/expected length 2/);

		const few = v.array(v.number(), { min: 1, max: 2 });
		expect(() => validate(few, [], "f")).toThrow(/at least 1/);
		expect(() => validate(few, [1, 2, 3], "f")).toThrow(/at most 2/);
	});

	it("collects every bad element", () => {
		try {
			validate(tags, ["", ""], "tags");
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ValidationError);
			expect((e as ValidationError).issues).toHaveLength(2);
		}
	});

	it("with no item schema, any array passes", () => {
		const anyArr = v.array();
		expect(validate(anyArr, [1, "x", null], "a")).toEqual([1, "x", null]);
	});

	it("nests objects and keeps optional/default args", () => {
		const rows = v.array(
			v.object({
				id: v.string(),
				n: v.number({ default: 0 }),
			}),
		);
		expectTypeOf<InferArgs<typeof rows>>().toEqualTypeOf<
			{ id: string; n?: number }[]
		>();
		expectTypeOf<InferInput<typeof rows>>().toEqualTypeOf<
			{ id: string; n: number }[]
		>();
		expect(validate(rows, [{ id: "1" }], "rows")).toEqual([{ id: "1", n: 0 }]);
	});

	it("works as a fn input field", () => {
		const f = v.fn({ input: { ids: v.array(v.string()) } }, (c) => c.input.ids);
		expect(f({ ids: ["a", "b"] })).toEqual(["a", "b"]);
		expect(() => f({ ids: [1] } as never)).toThrow(ValidationError);
	});
});

describe("v.record", () => {
	const scores = v.record(v.number({ min: 0 }));

	it("infers Record<string, value>", () => {
		expectTypeOf<InferInput<typeof scores>>().toEqualTypeOf<
			Record<string, number>
		>();
		expectTypeOf<InferArgs<typeof scores>>().toEqualTypeOf<
			Record<string, number>
		>();
	});

	it("validates every value", () => {
		expect(validate(scores, { a: 1, b: 2 }, "scores")).toEqual({
			a: 1,
			b: 2,
		});
		expect(() => validate(scores, { a: -1 }, "scores")).toThrow(
			ValidationError,
		);
		expect(() => validate(scores, { a: -1 }, "scores")).toThrow(/scores\.a/);
	});

	it("rejects non-objects", () => {
		expect(() => validate(scores, "nope", "scores")).toThrow(/expected object/);
	});

	it("collects every bad entry", () => {
		try {
			validate(scores, { a: -1, b: -2 }, "scores");
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(ValidationError);
			expect((e as ValidationError).issues).toHaveLength(2);
		}
	});

	it("applies defaults inside each value", () => {
		const fields = v.record(
			v.object({
				type: v.string({ default: "string" }),
				unique: v.boolean({ optional: true, default: false }),
			}),
		);
		expectTypeOf<InferArgs<typeof fields>>().toEqualTypeOf<
			Record<string, { type?: string; unique?: boolean }>
		>();
		expectTypeOf<InferInput<typeof fields>>().toEqualTypeOf<
			Record<string, { type: string; unique: boolean }>
		>();
		expect(validate(fields, { id: {} }, "fields")).toEqual({
			id: { type: "string", unique: false },
		});
	});

	it("with no value schema, any object passes", () => {
		const anyRec = v.record();
		expect(validate(anyRec, { a: 1, b: "x" }, "r")).toEqual({ a: 1, b: "x" });
	});

	it("works as a fn input field", () => {
		const f = v.fn(
			{ input: { tags: v.record(v.string()) } },
			(c) => c.input.tags,
		);
		expect(f({ tags: { a: "x" } })).toEqual({ a: "x" });
		expect(() => f({ tags: { a: 1 } } as never)).toThrow(ValidationError);
	});
});
