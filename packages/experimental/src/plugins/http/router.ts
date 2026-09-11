import type { FnDefination } from "../../fn";
import { isFn, isNamespace, type Module } from "../../module";
import { type CreateHandlerOptions, createHandler } from "./handle";
import { buildServerApi, type InferServerAPI } from "./path-api";
import { getRouteMeta, INVALIDATE_HEADER, type RouteMeta } from "./route";

export type CollectedRoute = RouteMeta & {
	/** Dotted export path, e.g. `signIn.email`. */
	name: string;
	fn: FnDefination<any, any, any, any, any, any>;
};

/** Walk a module (and nested namespaces) for fns stamped with `$route`. */
export function collectRoutes(
	module: Record<string, unknown>,
	prefix = "",
): CollectedRoute[] {
	const out: CollectedRoute[] = [];
	for (const [name, value] of Object.entries(module)) {
		const path = prefix ? `${prefix}.${name}` : name;
		if (isFn(value)) {
			const meta = getRouteMeta(value);
			if (meta) {
				out.push({
					name: path,
					fn: value as FnDefination<any, any, any, any, any, any>,
					...meta,
				});
			}
			continue;
		}
		if (isNamespace(value)) {
			out.push(...collectRoutes(value as Record<string, unknown>, path));
		}
	}
	return out;
}

const matchPath = (
	pattern: string,
	pathname: string,
): Record<string, string> | null => {
	if (pattern === pathname) return {};
	const patternParts = pattern.split("/").filter(Boolean);
	const pathParts = pathname.split("/").filter(Boolean);
	if (patternParts.length !== pathParts.length) return null;
	const params: Record<string, string> = {};
	for (let i = 0; i < patternParts.length; i++) {
		const pp = patternParts[i];
		const vp = pathParts[i];
		if (pp === undefined || vp === undefined) return null;
		if (pp.startsWith(":")) {
			params[pp.slice(1)] = decodeURIComponent(vp);
			continue;
		}
		if (pp !== vp) return null;
	}
	return params;
};

export type CreateRouterOptions<PL extends readonly Module[] = readonly []> =
	CreateHandlerOptions<PL> & {
		/** Base path stripped before matching (e.g. `/api/auth`). */
		basePath?: string;
	};

/** Fetch handler plus in-process server API keyed by export names. */
export type Router<
	R extends Record<string, unknown> = Record<string, unknown>,
> = ((request: Request) => Promise<Response>) & {
	/** Call endpoints in-process by **export name** (`api.signUpEmail`). */
	api: InferServerAPI<R>;
	/** Collected `$route` endpoints (path + method + export name). */
	routes: CollectedRoute[];
};

/**
 * Path+method dispatcher over fns that declare
 * `use: [route({ path, method })]`.
 *
 * Returns a fetch handler with:
 * - `.api` — in-process calls keyed by **variable/export name**
 * - `.routes` — the collected route table
 *
 * On success, writes `x-better-call-invalidate` from the final
 * `c.route.invalidate` (static seed plus any runtime pushes).
 */
export function createRouter<const R extends Record<string, unknown>>(
	routes: R,
	options?: CreateRouterOptions,
): Router<R> {
	const table = collectRoutes(routes);
	const basePath = options?.basePath?.replace(/\/$/, "") ?? "";
	const api = buildServerApi(routes) as InferServerAPI<R>;

	const handle = createHandler(async (c) => {
		const req = c.req;
		if (!req) {
			c.res = c.res ?? { headers: new Headers() };
			c.res.status = 500;
			return { error: "NO_REQUEST" };
		}

		let pathname = req.path;
		if (basePath && pathname.startsWith(basePath)) {
			pathname = pathname.slice(basePath.length) || "/";
		}

		const method = req.method.toUpperCase();
		let matched: CollectedRoute | undefined;
		let params: Record<string, string> = {};
		for (const entry of table) {
			if (entry.method !== method) continue;
			const found = matchPath(entry.path, pathname);
			if (found) {
				matched = entry;
				params = found;
				break;
			}
		}

		if (!matched) {
			c.res = c.res ?? { headers: new Headers() };
			c.res.status = 404;
			return { error: "NOT_FOUND", path: pathname, method };
		}

		const input =
			method === "GET" || method === "HEAD"
				? {
						...(typeof req.query === "object" && req.query ? req.query : {}),
						...params,
					}
				: {
						...(typeof req.body === "object" && req.body !== null
							? (req.body as object)
							: {}),
						...params,
					};

		const needsInput = matched.fn.$schema?.input !== undefined;
		const result = needsInput
			? await matched.fn(input as never, c as never)
			: await matched.fn(undefined as never, c as never);

		const invalidate = (c as { route?: { invalidate?: string[] } }).route
			?.invalidate;
		if (invalidate && invalidate.length > 0) {
			c.res = c.res ?? { headers: new Headers() };
			c.res.headers.set(INVALIDATE_HEADER, [...new Set(invalidate)].join(","));
		}

		return result;
	}, options);

	return Object.assign(handle, { api, routes: table }) as Router<R>;
}
