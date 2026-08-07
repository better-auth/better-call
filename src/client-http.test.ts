import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { createClient } from "../src/client-http";
import { z } from "zod";
import { createEndpoint } from "./endpoint";
import { createRouter, type Router } from "./router";
import { createMiddleware } from "./middleware";

import { toNodeHandler } from "./adapters/node";
import { createServer } from "http";

let port = 3000;
async function listen(router: Router) {
  let usePort = port++;
  const server = createServer(toNodeHandler(router.handler));
  await server.listen(usePort);
  return {
    baseURL: `http://localhost:${usePort}`,
    close: () => server.close()
  };
}

describe("client-http", () => {
	const getEndpoint = createEndpoint(
		"/test2",
		{
			method: "GET",
			query: z.object({
				hello: z.string(),
			}),
		},
		async (ctx) => {
			return {
        hello: "world",
			};
		},
	);
	const endpoint = createEndpoint(
		"/test",
		{
			method: "POST",
			body: z.object({
				hello: z.string(),
			}),
		},
		async (ctx) => {
			return {
				hello: "world",
			};
		},
	);

	const endpoint2 = createEndpoint(
		"/test3",
		{
			method: "GET",
			query: z.object({
				hello: z.string().optional(),
			}),
		},
		async (ctx) => {
			return {
        hello: "world",
			};
		},
	);

  let router = createRouter({ endpoint, endpoint2, getEndpoint, });;
  let close: any;
  let baseURL: string;

  beforeAll(async () => {
    const { close: _close, baseURL: _baseURL } = await listen(router);;
    close = _close;
    baseURL = _baseURL;
  })
  afterAll(async () => await close());

	it("should send request and get response", async () => {
		const client = createClient<typeof router>({ baseURL });

		expectTypeOf<Parameters<typeof client.post>[0]>().toExtend<"/test">();
		expectTypeOf<Parameters<typeof client.get>[0]>().toExtend<"/test2" | "/test3">();

		const response = await client.post("/test", {
			body: {
				hello: "world",
			},
		});

		if (response.ok) {
			// response.data.hello

			// TODO: these should all be available
			console.log("HEADERS:", response.headers);
			expect(response.data).toMatchObject({ hello: "world" });
		} else {
			console.log("ERROR!?", response.error);
			console.log("ERROR .status", response.status);
			console.log("ERROR .statusText", response.statusText);
			expect(response.data).toBeNull();
		}
	});

	it("should infer types", async () => {
    const client = createClient<typeof router>({ baseURL });

		const res = await client.post("/test", {
			body: {
				hello: "world",
			},
		});

		expectTypeOf<Parameters<typeof client.post>[0]>().toExtend<"/test">();
		expectTypeOf<Parameters<typeof client.get>[0]>().toExtend<"/test2" | "/test3">();

		client.post("/test", {
			body: {
				//@ts-expect-error
				hello: 1,
			},
		});

		client.get("/test2", {
			query: {
				//@ts-expect-error
				hello: 2,
			},
		});
		client.get("/test3", {
			query: {},
		});
	});

	it("should call endpoint n", async () => {
		const endpoint = createEndpoint(
			"/test",
			{
				method: "POST",
				body: z.object({
					hello: z.string(),
				}),
			},
			async (ctx) => {
				return { hello: "world", };
			},
		);
		const endpoint2 = createEndpoint(
			"/test2",
			{
				method: "GET",
			},
			async (ctx) => {
				return { hello: "world", };
			},
		);

    const client = createClient<typeof router>({ baseURL });
		const result = await client.post("/test", {
			body: {
				hello: "world",
			},
		});

    if (result.ok) {
      result.data.hello
    }

		await client.get("/test2", {
      query: { hello: "world" }
    });
	});

	it("should infer from custom creator", () => {
		const cr2 = createEndpoint.create({
			use: [
				createMiddleware(async (ctx) => {
					return {
						something: "",
					};
				}),
			],
		});

		const endpoint = cr2(
			"/test",
			{
				method: "POST",
			},
			async (ctx) => {
				return { hello: "world", };
			},
		);

		const endpoints = { endpoint, };

		const client = createClient<typeof endpoints>({
			baseURL: "http://localhost:3000",
		});
		expectTypeOf<Parameters<typeof client.post>[0]>().toExtend<"/test">();
	});
});
