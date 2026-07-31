import { describe, expectTypeOf, it } from "vitest";
import type { InferBody, InferParam, InferQuery } from "./context";
import type { EndpointContext, EndpointOptions } from "./endpoint";

describe("route param inference", () => {
	it("uses optional params for an empty path", () => {
		expectTypeOf<InferParam<"/">>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
		>();
	});

	it("uses optional params for a never path", () => {
		expectTypeOf<InferParam<never>>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
		>();
	});

	it("uses optional params for a dynamic path", () => {
		expectTypeOf<InferParam<string>>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
		>();
	});

	it("uses optional params for a static path", () => {
		expectTypeOf<InferParam<"/static/path">>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
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

	// TODO: Include undefined after https://github.com/h3js/rou3/pull/198 is released.
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

describe("endpoint input inference", () => {
	it("uses unknown for a body without a schema", () => {
		expectTypeOf<InferBody<EndpointOptions>>().toEqualTypeOf<unknown>();
	});

	it("uses parsed query values for a query without a schema", () => {
		expectTypeOf<InferQuery<EndpointOptions>>().toEqualTypeOf<
			Record<string, string | string[]> | undefined
		>();
	});
});

describe("endpoint context compatibility", () => {
	it("widens route-specific paths without losing their inferred params", () => {
		const toRouteAgnosticContext = <
			Path extends string,
			Options extends EndpointOptions,
			Context extends object,
		>(
			context: EndpointContext<Path, Options, Context>,
		): EndpointContext<string, Options, Context, InferParam<string>> => context;

		expectTypeOf(toRouteAgnosticContext).toBeFunction();
	});
});
