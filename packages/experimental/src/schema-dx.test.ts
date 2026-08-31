import { describe, expectTypeOf, it } from "vitest";
import { v } from "./index";
import type { InferOutput, InferType } from "./schema";

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
