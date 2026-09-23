import { describe, expect, it } from "vitest";
import { createEndpoint } from "./endpoint";
import { generator } from "./openapi";

describe("openapi generator", () => {
	it("should include parameter examples in generated openapi spec", async () => {
		const endpoint = createEndpoint(
			"/search",
			{
				method: "GET",
				metadata: {
					openapi: {
						description: "Search endpoint",
						parameters: [
							{
								name: "searchOperator",
								in: "query",
								description: "The operator to use for the search",
								schema: {
									type: "string",
									enum: ["contains", "starts_with", "ends_with"],
								},
								examples: {
									contains: { value: "contains" },
									starts_with: { value: "starts_with" },
									ends_with: { value: "ends_with" },
								},
							},
						],
					},
				},
			},
			async (ctx) => {
				return { ok: true };
			},
		);

		const spec = await generator({
			search: endpoint,
		});

		expect(spec.paths["/search"]).toBeDefined();
		expect(spec.paths["/search"].get?.parameters).toEqual([
			{
				name: "searchOperator",
				in: "query",
				description: "The operator to use for the search",
				schema: {
					type: "string",
					enum: ["contains", "starts_with", "ends_with"],
				},
				examples: {
					contains: { value: "contains" },
					starts_with: { value: "starts_with" },
					ends_with: { value: "ends_with" },
				},
			},
		]);
	});
});
