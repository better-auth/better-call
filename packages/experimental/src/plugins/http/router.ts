import type { FnDefination } from "../../fn";
import { v } from "../../index";
import { isFn, isNamespace, type Module } from "../../module";
import { applyError } from "./error";
import { type CreateHandlerOptions, createHandler } from "./handle";
import { buildServerApi, type InferServerAPI } from "./path-api";
import { req } from "./request";
import { res } from "./response";
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

/** Stable 404 body — same shape as declared-error HTTP responses. */
export const NOT_FOUND = { error: "not_found" } as const;

const resHeaders = (c: { res?: { headers?: Headers } | null }) =>
	c.res?.headers ?? new Headers();

/** JSON Response that always forwards `c.res.headers` (cookies, etc.). */
const jsonResponse = (
	c: { res?: { headers?: Headers; status?: number } | null },
	body: unknown,
	status?: number,
): Response => {
	const headers = resHeaders(c);
	const code = status ?? c.res?.status ?? 200;
	return Response.json(body, { status: code, headers });
};

export type CreateRouterOptions<PL extends readonly Module[] = readonly []> =
	CreateHandlerOptions<PL> & {
		/** Base path routes must live under (e.g. `/api/auth`). Strict: paths
		 * outside the prefix are `not_found`, same as Better Auth v2. */
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
	/**
	 * The dispatch fn mounted on the handler scope. Hook with
	 * `v.on(router.dispatch, …)` for origin checks, sessions, etc.
	 */
	dispatch: FnDefination<any, any, any, any, any, any>;
};

/**
 * Path+method dispatcher over fns that declare
 * `use: [route({ path, method })]`.
 *
 * Returns a fetch handler with:
 * - `.api` — in-process calls keyed by **variable/export name**
 * - `.routes` — the collected route table
 * - `.dispatch` — dispatch fn (for v.on hooks) (`v.on(router.dispatch, …)`)
 *
 * Declared endpoint errors use `.try` + {@link applyError} and return
 * `{ error: tag }` while preserving `c.res.headers`. Unknown paths /
 * methods return `{ error: "not_found" }` (404).
 *
 * On success, writes `x-better-call-invalidate` from the final
 * `c.route.invalidate` (static seed plus any runtime pushes).
 */
/** Wrap bare `v.on(...)` entries so `use: [hook]` works (modules must be objects). */
const normalizeUse = (mods: readonly unknown[]): Module[] =>
	mods.map((mod, i) => {
		if (
			mod &&
			typeof mod === "object" &&
			(mod as { $on?: unknown }).$on === true
		) {
			return { [`on_${i}`]: mod } as Module;
		}
		return mod as Module;
	});

export function createRouter<const R extends Record<string, unknown>>(
	routes: R,
	options?: CreateRouterOptions,
): Router<R> {
	const table = collectRoutes(routes);
	const basePath = options?.basePath?.replace(/\/$/, "") ?? "";
	const api = buildServerApi(routes) as InferServerAPI<R>;

	const dispatch = v
		.fn({ use: [{ req, res }] })
		.fn("http.router.dispatch", async (c) => {
			const request = c.req;
			if (!request) {
				c.res = c.res ?? { headers: new Headers() };
				c.res.status = 500;
				return jsonResponse(c, { error: "no_request" }, 500);
			}

			const rawPath = request.path;
			// Strict basePath: outside the mount prefix is not_found.
			if (basePath && !rawPath.startsWith(basePath)) {
				c.res = c.res ?? { headers: new Headers() };
				c.res.status = 404;
				return jsonResponse(c, NOT_FOUND, 404);
			}
			const pathname = basePath
				? rawPath.slice(basePath.length) || "/"
				: rawPath;

			const method = request.method.toUpperCase();
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
				return jsonResponse(c, NOT_FOUND, 404);
			}

			const input =
				method === "GET" || method === "HEAD"
					? {
							...(typeof request.query === "object" && request.query
								? request.query
								: {}),
							...params,
						}
					: {
							...(typeof request.body === "object" && request.body !== null
								? (request.body as object)
								: {}),
							...params,
						};

			const needsInput = matched.fn.$schema?.input !== undefined;
			const tried = needsInput
				? await matched.fn.try(input as never, c as never)
				: await matched.fn.try(undefined as never, c as never);

			if (!tried.ok) {
				c.res = c.res ?? { headers: new Headers() };
				applyError(c.res, matched.fn.$schema?.errors, tried.error);
				c.res.status ??= 400;
				return jsonResponse(c, { error: tried.error.tag }, c.res.status);
			}

			const invalidate = (c as { route?: { invalidate?: string[] } }).route
				?.invalidate;
			if (invalidate && invalidate.length > 0) {
				c.res = c.res ?? { headers: new Headers() };
				c.res.headers.set(
					INVALIDATE_HEADER,
					[...new Set(invalidate)].join(","),
				);
			}

			// Endpoint may return a Response directly (redirects, custom bodies).
			if (tried.value instanceof Response) return tried.value;

			return jsonResponse(c, tried.value ?? null);
		});

	const use = normalizeUse([...(options?.use ?? []), { dispatch }]);
	const handle = createHandler(
		async (c) => (c as unknown as { dispatch: () => unknown }).dispatch(),
		{
			...options,
			use: use as never,
		},
	);

	return Object.assign(handle, {
		api,
		routes: table,
		dispatch,
	}) as Router<R>;
}
