import { describe, expectTypeOf, it } from "vitest";
import type { InferParam } from "./context";

describe("route param inference", () => {
	it("uses optional params for an empty path", () => {
		expectTypeOf<InferParam<"/">>().toEqualTypeOf<
			Record<string, any> | undefined
		>();
	});

	it("uses optional params for a never path", () => {
		expectTypeOf<InferParam<never>>().toEqualTypeOf<
			Record<string, any> | undefined
		>();
	});

	it("uses optional params for a dynamic path", () => {
		expectTypeOf<InferParam<string>>().toEqualTypeOf<
			Record<string, any> | undefined
		>();
	});

	it("uses optional params for a static path", () => {
		expectTypeOf<InferParam<"/static/path">>().toEqualTypeOf<
			Record<string, any> | undefined
		>();
	});

	it("infers a named param", () => {
		expectTypeOf<InferParam<"/user/:id">>().toEqualTypeOf<{ id: string }>();
	});

	it("infers multiple named params", () => {
		expectTypeOf<InferParam<"/user/:userId/post/:postId">>().toEqualTypeOf<{
			userId: string;
			postId: string;
		}>();
	});

	it("infers a numeric key for an unnamed segment wildcard", () => {
		expectTypeOf<InferParam<"/files/*">>().toEqualTypeOf<{ "0": string }>();
	});

	it("infers _ for an unnamed catch-all wildcard", () => {
		expectTypeOf<InferParam<"/files/**">>().toEqualTypeOf<{ _: string }>();
	});

	it("infers the name of a named catch-all wildcard", () => {
		expectTypeOf<InferParam<"/files/**:path">>().toEqualTypeOf<{
			path: string;
		}>();
	});

	it("infers indexed keys for multiple unnamed wildcards", () => {
		expectTypeOf<InferParam<"/file-*-*.png">>().toEqualTypeOf<{
			"0": string;
			"1": string;
		}>();
	});

	it("combines named and unnamed params", () => {
		expectTypeOf<InferParam<"/user/:userId/files/*">>().toEqualTypeOf<{
			userId: string;
			"0": string;
		}>();
	});
});
