import {
	addRoute,
	createRouter as createRou3Router,
	findAllRoutes,
	findRoute,
} from "rou3";
import type { Endpoint } from "./endpoint";
import { createEndpoint } from "./endpoint";
import type { MiddlewareHandler } from "./middleware";
import { generator, getHTML } from "./openapi";
import { toResponse } from "./to-response";
import { getBody, isAPIError, isRequest } from "./utils";

export interface RouterConfig {
	throwError?: boolean;
	basePath?: string;
	routerMiddleware?: Array<{
		path: string;
		middleware: MiddlewareHandler;
	}>;
	/**
	 * additional Context that needs to passed to endpoints
	 *
	 * this will be available on `ctx.context` on endpoints
	 */
	routerContext?: Record<string, any>;
	/**
	 * Runs before every HTTP response is returned, including responses from onRequest
	 * and onError. A returned Response replaces the response.
	 */
	onResponse?: (response: Response, request: Request) => any | Promise<any>;
	/**
	 * Runs before routing. A returned Request replaces the request, while a returned
	 * Response skips the endpoint and continues to onResponse.
	 */
	onRequest?: (request: Request) => any | Promise<any>;
	/**
	 * Runs when onRequest, router middleware, or an endpoint throws.
	 *
	 * @param error - the error that was thrown in the router or middleware.
	 * @returns An optional Response that replaces the default error response.
	 */
	onError?: (
		error: unknown,
		request: Request,
	) => void | Promise<void> | Response | Promise<Response>;
	/**
	 * List of allowed media types (MIME types) for the router
	 *
	 * if provided, only the media types in the list will be allowed to be passed in the body.
	 *
	 * If an endpoint has allowed media types, it will override the router's allowed media types.
	 *
	 * @example
	 * ```ts
	 * const router = createRouter({
	 * 		allowedMediaTypes: ["application/json", "application/x-www-form-urlencoded"],
	 * 	})
	 */
	allowedMediaTypes?: string[];
	/**
	 * Skip trailing slashes
	 *
	 * @default false
	 */
	skipTrailingSlashes?: boolean;
	/**
	 * Open API route configuration
	 */
	openapi?: {
		/**
		 * Disable openapi route
		 *
		 * @default false
		 */
		disabled?: boolean;
		/**
		 * A path to display open api using scalar
		 *
		 * @default "/api/reference"
		 */
		path?: string;
		/**
		 * Scalar Configuration
		 */
		scalar?: {
			/**
			 * Title
			 * @default "Open API Reference"
			 */
			title?: string;
			/**
			 * Description
			 *
			 * @default "Better Call Open API Reference"
			 */
			description?: string;
			/**
			 * Logo URL
			 */
			logo?: string;
			/**
			 * Scalar theme
			 * @default "saturn"
			 */
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
				const schema = await generator(endpoints);
				return new Response(getHTML(schema, openapi.scalar), {
					headers: {
						"Content-Type": "text/html",
					},
				});
			},
		);
	}
	const router = createRou3Router<Endpoint>();
	const middlewareRouter = createRou3Router<MiddlewareHandler>();

	for (const endpoint of Object.values(endpoints)) {
		if (!endpoint.options || !endpoint.path) {
			continue;
		}
		if (endpoint.options?.metadata?.SERVER_ONLY) continue;

		const methods = Array.isArray(endpoint.options?.method)
			? endpoint.options.method
			: [endpoint.options?.method];

		for (const method of methods) {
			addRoute(router, method, endpoint.path, endpoint);
		}
	}

	if (config?.routerMiddleware?.length) {
		for (const { path, middleware } of config.routerMiddleware) {
			addRoute(middlewareRouter, "*", path, middleware);
		}
	}

	// Normalize the configured base path once. `basePath` is configuration, not
	// per-request input, so trailing-slash normalization belongs here rather than
	// in the request hot path. An empty result (unset, "/", or all slashes) means
	// "no base path": route on the full pathname.
	const basePath =
		config?.basePath && config.basePath !== "/"
			? config.basePath.replace(/\/+$/, "")
			: "";

	const handleError = async (
		error: unknown,
		request: Request,
	): Promise<Response> => {
		if (config?.onError) {
			try {
				const errorResponse = await config.onError(error, request);
				if (errorResponse instanceof Response) {
					return toResponse(errorResponse);
				}
			} catch (callbackError) {
				if (isAPIError(callbackError)) {
					return toResponse(callbackError);
				}
				throw callbackError;
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
	};

	const processRequest = async (request: Request) => {
		const url = new URL(request.url);
		const pathname = url.pathname;
		// Strip `basePath` only when it is a leading, "/"-boundary prefix of the
		// request pathname. A pathname that does not start with the configured
		// basePath is outside this router and resolves to a 404, so a path like
		// "/x/api/test" never reaches "/test". The "/" boundary also rejects a
		// path where basePath is only a leading substring, not a full segment.
		// The previous implementation stripped basePath wherever it occurred
		// (`pathname.split(basePath)`).
		let path: string;
		if (basePath) {
			if (!pathname.startsWith(`${basePath}/`)) {
				return new Response(null, { status: 404, statusText: "Not Found" });
			}
			path = pathname.slice(basePath.length);
		} else {
			path = pathname;
		}

		// Reject empty paths and paths with consecutive slashes.
		if (path.length === 0 || /\/{2,}/.test(path)) {
			return new Response(null, { status: 404, statusText: "Not Found" });
		}

		const route = findRoute(router, request.method, path);
		const hasTrailingSlash = path.endsWith("/");
		const routeHasTrailingSlash = route?.data?.path?.endsWith("/");

		// If the path has a trailing slash and the route doesn't have a trailing slash and skipTrailingSlashes is not set, return 404
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

		const handler = route.data;

		// Determine which allowedMediaTypes to use: endpoint-level overrides router-level
		const allowedMediaTypes =
			handler.options.metadata?.allowedMediaTypes || config?.allowedMediaTypes;
		const context = {
			path,
			method: request.method as "GET",
			headers: request.headers,
			params: route.params ? { ...route.params } : {},
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
				const middlewareResponse = await (middleware as Endpoint)({
					...context,
					params: params ? { ...params } : {},
					asResponse: false,
				});

				if (middlewareResponse instanceof Response) return middlewareResponse;
			}
		}

		const response = (await handler(context)) as Response;
		return response;
	};

	return {
		handler: async (request: Request) => {
			let activeRequest = request;
			let response: Response;
			try {
				const onRequestResult = await config?.onRequest?.(request);
				if (onRequestResult instanceof Response) {
					response = onRequestResult;
				} else {
					activeRequest = isRequest(onRequestResult)
						? onRequestResult
						: request;
					response = await processRequest(activeRequest);
				}
			} catch (error) {
				response = await handleError(error, activeRequest);
			}
			const onResponseResult = await config?.onResponse?.(
				response,
				activeRequest,
			);
			if (onResponseResult instanceof Response) {
				return onResponseResult;
			}
			return response;
		},
		endpoints,
	};
};

export type Router = ReturnType<typeof createRouter>;
