import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "./index";
import type { InferArgs, InferOutput, InferType } from "./schema";
import { validate } from "./schema";

describe("v.string type-arg + optional DX", () => {
	it("narrowed type param works with optional: true", () => {
		const field = v.string<"a" | "b">({ optional: true });
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<"a" | "b">();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			"a" | "b" | undefined
		>();
	});

	it("enum form with optional: true matches type-param form", () => {
		const viaEnum = v.string({ enum: ["a", "b"], optional: true });
		const viaParam = v.string<"a" | "b">({ optional: true });
		expectTypeOf<InferOutput<typeof viaEnum>>().toEqualTypeOf<
			InferOutput<typeof viaParam>
		>();
		expectTypeOf<InferType<typeof viaEnum>>().toEqualTypeOf<
			InferType<typeof viaParam>
		>();
	});

	it("narrowed type param works with default", () => {
		const field = v.string<"a" | "b">({ default: "a" });
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<"a" | "b">();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<"a" | "b">();
	});

	it("narrowed type param works with optional + default", () => {
		const field = v.string<"a" | "b">({ optional: true, default: "a" });
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<"a" | "b">();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<"a" | "b">();
	});
});

describe("other vTypes type-arg + optional DX", () => {
	it("v.any with type param accepts optional: true", () => {
		const field = v.any<{ id: string }>({ optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			{ id: string } | undefined
		>();
	});

	it("v.number with output type param accepts optional: true", () => {
		const field = v.number<number>({ optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			number | undefined
		>();
	});

	it("v.array with element accepts optional: true", () => {
		const field = v.array(v.string<"a" | "b">(), { optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			("a" | "b")[] | undefined
		>();
	});

	it("v.object with shape accepts optional: true", () => {
		const field = v.object({ kind: v.string<"a" | "b">() }, { optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			{ kind: "a" | "b" } | undefined
		>();
	});

	it("object and array defaults are typed as inputs", () => {
		const obj = v.object(
			{ n: v.string({ transform: (s) => Number(s) }) },
			{ default: { n: "5" } },
		);
		expectTypeOf<InferOutput<typeof obj>>().toEqualTypeOf<{ n: number }>();

		const arr = v.array(v.string({ transform: (s) => Number(s) }), {
			default: ["5"],
		});
		expectTypeOf<InferOutput<typeof arr>>().toEqualTypeOf<number[]>();
	});
});

describe("factory defaults", () => {
	it("v.date({ default: () => new Date() }) is omittable and fresh each time", () => {
		const schema = v.object({
			id: v.string({}),
			createdAt: v.date({ default: () => new Date(1000) }),
			updatedAt: v.date({ default: () => new Date(2000) }),
		});
		expectTypeOf<InferArgs<typeof schema>>().toEqualTypeOf<{
			id: string;
			createdAt?: Date;
			updatedAt?: Date;
		}>();
		expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<{
			id: string;
			createdAt: Date;
			updatedAt: Date;
		}>();

		const a = validate(schema, { id: "1" }, "row");
		const b = validate(schema, { id: "2" }, "row");
		expect(a.createdAt).toEqual(new Date(1000));
		expect(a.updatedAt).toEqual(new Date(2000));
		// Distinct instances - not one shared Date reused across validates.
		expect(a.createdAt).not.toBe(b.createdAt);
	});

	it("literal defaults still work; an explicit value wins", () => {
		const field = v.date({ default: new Date(0) });
		expect(validate(field, undefined, "at")).toEqual(new Date(0));
		expect(validate(field, new Date(9), "at")).toEqual(new Date(9));
	});

	it("object/array factory defaults mint a fresh value", () => {
		const obj = v.object({ n: v.number() }, { default: () => ({ n: 1 }) });
		const a = validate(obj, undefined, "o");
		const b = validate(obj, undefined, "o");
		expect(a).toEqual({ n: 1 });
		expect(a).not.toBe(b);

		const arr = v.array(v.string(), { default: () => ["x"] });
		const xs = validate(arr, undefined, "a");
		const ys = validate(arr, undefined, "a");
		expect(xs).toEqual(["x"]);
		expect(xs).not.toBe(ys);
	});
});

describe("email normalization", () => {
	it("trims and lowercases before validating", () => {
		const field = v.string({ email: true });
		expect(validate(field, "  Foo@Bar.COM  ", "email")).toBe("foo@bar.com");
	});

	it("still rejects malformed addresses after normalize", () => {
		const field = v.string({ email: true });
		expect(() => validate(field, "  not-an-email  ", "email")).toThrow(
			/expected an email address/,
		);
	});

	it("user transform receives the normalized value", () => {
		const field = v.string({
			email: true,
			transform: (s) => `user:${s}`,
		});
		expect(validate(field, " A@B.CO ", "email")).toBe("user:a@b.co");
	});
});

describe("v.union", () => {
	it("parses string | number; rejects neither", () => {
		const field = v.union([v.string(), v.number()]);
		expect(validate(field, "hi", "x")).toBe("hi");
		expect(validate(field, 3, "x")).toBe(3);
		expect(() => validate(field, true, "x")).toThrow(/expected/);
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<string | number>();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<string | number>();
		expectTypeOf<InferArgs<typeof field>>().toEqualTypeOf<string | number>();
	});

	it("first matching object arm wins, including its transform", () => {
		const field = v.union([
			v.object({
				kind: v.string({ enum: ["a"] }),
				n: v.string({ transform: (s) => Number(s) }),
			}),
			v.object({
				kind: v.string({ enum: ["b"] }),
				ok: v.boolean(),
			}),
		]);
		expect(validate(field, { kind: "a", n: "9" }, "x")).toEqual({
			kind: "a",
			n: 9,
		});
		expect(validate(field, { kind: "b", ok: true }, "x")).toEqual({
			kind: "b",
			ok: true,
		});
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			{ kind: "a"; n: number } | { kind: "b"; ok: boolean }
		>();
	});

	it("optional and default behave like other types", () => {
		const optional = v.union([v.string(), v.number()], { optional: true });
		expect(validate(optional, undefined, "x")).toBeUndefined();
		expectTypeOf<InferOutput<typeof optional>>().toEqualTypeOf<
			string | number | undefined
		>();

		const withDefault = v.union([v.string(), v.number()], { default: 0 });
		expect(validate(withDefault, undefined, "x")).toBe(0);
		expectTypeOf<InferOutput<typeof withDefault>>().toEqualTypeOf<
			string | number
		>();
	});

	it("aggregates issues from every failing branch", () => {
		const field = v.union([v.string({ min: 2 }), v.number({ min: 10 })]);
		try {
			validate(field, "x", "u");
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Error);
			const err = thrown as { issues: { message: string }[] };
			expect(err.issues.length).toBeGreaterThanOrEqual(2);
		}
	});
});
