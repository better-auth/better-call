import { describe, expectTypeOf, it } from "vitest";
import type { InferParam } from "./context";
import type { EndpointContext, EndpointOptions } from "./endpoint";
import type { InferParamPath, InferParamWildCard } from "./helper";
import type { RouterConfig } from "./router";

describe("infer param", () => {
	it("empty path", () => {
		expectTypeOf<InferParamPath<"/">>().toEqualTypeOf<{}>();
		expectTypeOf<InferParamWildCard<"/">>().toEqualTypeOf<{}>();
		expectTypeOf<InferParam<"/">>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
		>();
		expectTypeOf<InferParam<never>>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
		>();
		expectTypeOf<InferParam<string>>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
		>();
	});
	it("static path", () => {
		expectTypeOf<InferParamPath<"/static/path">>().toEqualTypeOf<{}>();
		expectTypeOf<InferParamWildCard<"/static/path">>().toEqualTypeOf<{}>();
		expectTypeOf<InferParam<"/static/path">>().toEqualTypeOf<
			Record<string, string | undefined> | undefined
		>();
	});
	it("single param", () => {
		expectTypeOf<InferParamPath<"/user/:id">>().toEqualTypeOf<{ id: string }>();
		expectTypeOf<InferParamWildCard<"/user/:id">>().toEqualTypeOf<{}>();
		expectTypeOf<InferParam<"/user/:id">>().toEqualTypeOf<{ id: string }>();
	});
	it("multiple params", () => {
		expectTypeOf<InferParamPath<"/user/:userId/post/:postId">>().toEqualTypeOf<{
			userId: string;
			postId: string;
		}>();
		expectTypeOf<
			InferParamWildCard<"/user/:userId/post/:postId">
		>().toEqualTypeOf<{}>();
		expectTypeOf<InferParam<"/user/:userId/post/:postId">>().toEqualTypeOf<{
			userId: string;
			postId: string;
		}>();
	});
	it("wildcard param", () => {
		expectTypeOf<InferParamPath<"/files/*">>().toEqualTypeOf<{}>();
		expectTypeOf<InferParamWildCard<"/files/*">>().toEqualTypeOf<{
			_: string;
		}>();
		expectTypeOf<InferParam<"/files/*">>().toEqualTypeOf<{
			"0": string | undefined;
		}>();
		expectTypeOf<InferParam<"/files/*/">>().toEqualTypeOf<{
			"0": string | undefined;
		}>();
		expectTypeOf<InferParam<"/file-*-*.png">>().toEqualTypeOf<{
			"0": string;
			"1": string;
		}>();
		expectTypeOf<InferParam<"/files/**">>().toEqualTypeOf<{ _: string }>();
		expectTypeOf<InferParam<"/files/**:path">>().toEqualTypeOf<{
			path: string;
		}>();
	});
	it("mixed params", () => {
		expectTypeOf<InferParamPath<"/user/:userId/files/*">>().toEqualTypeOf<{
			userId: string;
		}>();
		expectTypeOf<InferParamWildCard<"/user/:userId/files/*">>().toEqualTypeOf<{
			_: string;
		}>();
		expectTypeOf<InferParam<"/user/:userId/files/*">>().toEqualTypeOf<{
			userId: string;
			"0": string | undefined;
		}>();
	});
});

describe("endpoint context", () => {
	it("preserves explicit context with generic endpoint options", () => {
		type Context = EndpointContext<
			string,
			EndpointOptions,
			{ adapter: object }
		>["context"];

		expectTypeOf<Context>().not.toBeAny();
		expectTypeOf<Context>().toMatchTypeOf<{ adapter: object }>();
	});

	it("widens route-specific paths without losing inferred params", () => {
		const widenContext = <
			Path extends string,
			Options extends EndpointOptions,
			Context extends object,
		>(
			context: EndpointContext<Path, Options, Context>,
		): EndpointContext<string, Options, Context, InferParam<string>> => context;

		expectTypeOf(widenContext).toBeFunction();
	});
});

describe("router hook return types", () => {
	it("accepts synchronous and asynchronous hook results", () => {
		const hooks = {
			onRequest: (request: Request) => request,
			onResponse: async (response: Response) => response,
			onError: async () => (Math.random() > 0.5 ? new Response() : undefined),
		} satisfies RouterConfig;

		expectTypeOf(hooks.onRequest).toBeFunction();
	});

	it("rejects return values ignored by the router", () => {
		const hooks = {
			// @ts-expect-error onRequest accepts a Request, Response, or void
			onRequest: () => ({ response: new Response() }),
			// @ts-expect-error onResponse accepts a Response or void
			onResponse: () => "ignored",
		} satisfies RouterConfig;

		void hooks;
	});
});
