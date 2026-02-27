import {
	addRoute,
	createRouter as createRou3Router,
	findAllRoutes,
	findRoute,
} from "rou3";
import { createEndpoint, type Endpoint } from "./endpoint";
import type { Middleware } from "./middleware";
import { generator, getHTML } from "./openapi";
import { toResponse } from "./to-response";
import { getBody, isAPIError, isRequest } from "./utils";

export interface RouterConfig {
	throwError?: boolean;
	basePath?: string;
	routerMiddleware?: Array<{
		path: string;
		middleware: Middleware;
	}>;
	routerContext?: Record<string, any>;
	onResponse?: (response: Response, request: Request) => any | Promise<any>;
	onRequest?: (request: Request) => any | Promise<any>;
	onError?: (
		error: unknown,
		request: Request,
	) => void | Promise<void> | Response | Promise<Response>;
	allowedMediaTypes?: string[];
	skipTrailingSlashes?: boolean;
	openapi?: {
		disabled?: boolean;
		path?: string;
		scalar?: {
			title?: string;
			description?: string;
			logo?: string;
			theme?: string;
		};
	};
}

export const createRouter = <
	E extends Record<string, Endpoint>,
	Config extends RouterConfig,
>(
	endpoints: E,
	config?: Config,
) => {
	if (!config?.openapi?.disabled) {
		const openapi = {
			path: "/api/reference",
			...config?.openapi,
		};
		//@ts-expect-error
		endpoints["openapi"] = createEndpoint(
			openapi.path,
			{
				method: "GET",
			},
			async (c) => {
				const schema = await generator(endpoints as any);
				return new Response(getHTML(schema, openapi.scalar), {
					headers: {
						"Content-Type": "text/html",
					},
				});
			},
		);
	}
	const router = createRou3Router();
	const middlewareRouter = createRou3Router();

	for (const endpoint of Object.values(endpoints)) {
		if (!endpoint.options || !endpoint.path) {
			continue;
		}
		if (endpoint.options?.metadata?.SERVER_ONLY) continue;

		const methods = Array.isArray(endpoint.options?.method)
			? endpoint.options.method
			: [endpoint.options?.method];

		for (const method of methods) {
			addRoute(router, method as string, endpoint.path, endpoint);
		}
	}

	if (config?.routerMiddleware?.length) {
		for (const { path, middleware } of config.routerMiddleware) {
			addRoute(middlewareRouter, "*", path, middleware);
		}
	}

	const processRequest = async (request: Request) => {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const path =
			config?.basePath && config.basePath !== "/"
				? pathname
						.split(config.basePath)
						.reduce((acc, curr, index) => {
							if (index !== 0) {
								if (index > 1) {
									acc.push(`${config.basePath}${curr}`);
								} else {
									acc.push(curr);
								}
							}
							return acc;
						}, [] as string[])
						.join("")
				: url.pathname;
		if (!path?.length) {
			return new Response(null, { status: 404, statusText: "Not Found" });
		}

		if (/\/{2,}/.test(path)) {
			return new Response(null, { status: 404, statusText: "Not Found" });
		}

		const route = findRoute(router, request.method, path) as {
			data: Endpoint & { path: string };
			params: Record<string, string>;
		};
		const hasTrailingSlash = path.endsWith("/");
		const routeHasTrailingSlash = route?.data?.path?.endsWith("/");

		if (
			hasTrailingSlash !== routeHasTrailingSlash &&
			!config?.skipTrailingSlashes
		) {
			return new Response(null, { status: 404, statusText: "Not Found" });
		}
		if (!route?.data)
			return new Response(null, { status: 404, statusText: "Not Found" });

		const query: Record<string, string | string[]> = {};
		url.searchParams.forEach((value, key) => {
			if (key in query) {
				if (Array.isArray(query[key])) {
					(query[key] as string[]).push(value);
				} else {
					query[key] = [query[key] as string, value];
				}
			} else {
				query[key] = value;
			}
		});

		const handler = route.data as Endpoint;

		try {
			const allowedMediaTypes =
				handler.options.metadata?.allowedMediaTypes ||
				config?.allowedMediaTypes;
			const context = {
				path,
				method: request.method as "GET",
				headers: request.headers,
				params: route.params
					? (JSON.parse(JSON.stringify(route.params)) as any)
					: {},
				request: request,
				body: handler.options.disableBody
					? undefined
					: await getBody(
							handler.options.cloneRequest ? request.clone() : request,
							allowedMediaTypes,
						),
				query,
				_flag: "router" as const,
				asResponse: true,
				context: config?.routerContext,
			};
			const middlewareRoutes = findAllRoutes(middlewareRouter, "*", path);
			if (middlewareRoutes?.length) {
				for (const { data: middleware, params } of middlewareRoutes) {
					const res = await (middleware as Endpoint)({
						...context,
						params,
						asResponse: false,
					});

					if (res instanceof Response) return res;
				}
			}

			const response = (await handler(context)) as Response;
			return response;
		} catch (error) {
			if (config?.onError) {
				try {
					const errorResponse = await config.onError(error, request);

					if (errorResponse instanceof Response) {
						return toResponse(errorResponse);
					}
				} catch (error) {
					if (isAPIError(error)) {
						return toResponse(error);
					}

					throw error;
				}
			}

			if (config?.throwError) {
				throw error;
			}

			if (isAPIError(error)) {
				return toResponse(error);
			}

			console.error(`# SERVER_ERROR: `, error);
			return new Response(null, {
				status: 500,
				statusText: "Internal Server Error",
			});
		}
	};

	return {
		handler: async (request: Request) => {
			const onReq = await config?.onRequest?.(request);
			if (onReq instanceof Response) {
				return onReq;
			}
			const req = isRequest(onReq) ? onReq : request;
			const res = await processRequest(req);
			const onRes = await config?.onResponse?.(res, req);
			if (onRes instanceof Response) {
				return onRes;
			}
			return res;
		},
		endpoints,
	};
};

export type Router = ReturnType<typeof createRouter>;
