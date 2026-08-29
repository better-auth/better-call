import type { Context, Fn } from "../../fn";
import { v } from "../../index";
import type { ApplyOns, Module, ModuleFns } from "../../module";
import type { ScopeOf } from "../../scope";
import { cookieOptions, deleteCookie, getCookie, setCookie } from "./cookie";
import { applyRedirect, Redirect, redirect } from "./redirect";
import { fromRequest, req } from "./request";
import type { HttpResponse } from "./response";
import { res, toResponse } from "./response";

const base = {
	req,
	res,
	fromRequest,
	redirect,
	getCookie,
	setCookie,
	deleteCookie,
	cookieOptions,
};

type EdgeModules<PL extends readonly Module[]> = readonly [typeof base, ...PL];

/** Context `run` receives: HTTP base plus anything in `options.use`. */
export type CreateHandlerContext<PL extends readonly Module[] = readonly []> =
	Context<
		{ request: Request },
		ScopeOf<EdgeModules<PL>>,
		never,
		ApplyOns<ModuleFns<EdgeModules<PL>>, EdgeModules<PL>>,
		Fn
	>;

const isBodyInit = (value: unknown): value is BodyInit =>
	typeof value === "string" ||
	value instanceof Blob ||
	value instanceof ArrayBuffer ||
	ArrayBuffer.isView(value) ||
	value instanceof ReadableStream ||
	value instanceof FormData ||
	value instanceof URLSearchParams;

const resultToResponse = (response: HttpResponse, out: unknown): Response => {
	if (out instanceof Response) return out;
	if (out === undefined || out === null) return toResponse(response, null);
	if (isBodyInit(out)) return toResponse(response, out);
	if (!response.headers.has("content-type")) {
		response.headers.set("content-type", "application/json");
	}
	return toResponse(response, JSON.stringify(out));
};

const catchRedirect = (
	thrown: unknown,
	response: HttpResponse | null | undefined,
): Response => {
	if (!(thrown instanceof Redirect)) throw thrown;
	const current = response ?? { headers: new Headers() };
	applyRedirect(current, thrown);
	return toResponse(current, null);
};

/** Seed req/res, run `run` on the same `c`, settle Redirect / body. */
const settle = async (
	c: any,
	request: Request,
	run: (c: any) => unknown | Promise<unknown>,
): Promise<Response> => {
	await c.fromRequest({ request });
	try {
		const out = await run(c);
		return resultToResponse(c.res ?? { headers: new Headers() }, out);
	} catch (thrown) {
		return catchRedirect(thrown, c.res);
	}
};

const h = v.fn({ use: [base] });

/**
 * Mounted web edge: seed `req`/`res` from `request`, run `run` in the
 * same scope, and turn {@link Redirect} into a 3xx Response.
 *
 * @example
 * ```ts
 * return c.handler({
 *   request: c.input.request,
 *   run: (ctx) => {
 *     ctx.redirect({ url: "/dashboard" });
 *   },
 * });
 * ```
 */
export const handler = h.fn(
	"http.handler",
	{
		input: {
			request: v.any<Request>(),
			run: v.any<(c: any) => unknown | Promise<unknown>>(),
		},
	},
	async (c) => settle(c, c.input.request, c.input.run),
);

export type CreateHandlerOptions<PL extends readonly Module[] = readonly []> = {
	/** Extra modules mounted onto the same `c` that `run` receives. */
	use?: PL;
};

/**
 * Fetch adapter: `(request) => Response`. Modules in `options.use` are
 * mounted on the same context as `req` / `res` / `redirect`, so
 * `createHandler((c) => c.whoami(), { use: [{ whoami }] })` works.
 */
export function createHandler<
	const PL extends readonly Module[] = readonly [],
	R = unknown,
>(
	run: (c: CreateHandlerContext<PL>) => R | Promise<R>,
	options?: CreateHandlerOptions<PL>,
): (request: Request) => Promise<Response> {
	const use = [base, ...(options?.use ?? [])] as EdgeModules<PL>;
	const entry = v
		.fn({ use })
		.fn(
			"http.create_handler",
			{ input: { request: v.any<Request>() } },
			async (c) => settle(c, c.input.request, run),
		);

	return (request) => entry({ request }) as Promise<Response>;
}
