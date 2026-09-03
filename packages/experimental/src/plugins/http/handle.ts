import type { Context, Fn } from "../../fn";
import { v } from "../../index";
import type { ApplyOns, Module, ModuleFns } from "../../module";
import type { ScopeOf } from "../../scope";
import { cookieOptions, deleteCookie, getCookie, setCookie } from "./cookie";
import { type EncodeErrorOptions, encodeError } from "./error";
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

const catchEdgeError = (
	thrown: unknown,
	response: HttpResponse | null | undefined,
	encodeOptions?: EncodeErrorOptions,
	request?: Request,
): Response => {
	if (thrown instanceof Redirect) {
		const current = response ?? { headers: new Headers() };
		applyRedirect(current, thrown);
		return toResponse(current, null);
	}
	const encoded = encodeError(thrown, {
		...encodeOptions,
		request: encodeOptions?.request ?? request,
	});
	if (!encoded) throw thrown;
	const current = response ?? { headers: new Headers() };
	current.status = encoded.status;
	if (!current.headers.has("content-type")) {
		current.headers.set("content-type", "application/json");
	}
	return toResponse(current, JSON.stringify(encoded.body));
};

/** Seed req/res, run `run` on the same `c`, settle Redirect / encoded errors / body. */
const settle = async (
	c: any,
	request: Request,
	run: (c: any) => unknown | Promise<unknown>,
	encodeOptions?: EncodeErrorOptions,
): Promise<Response> => {
	await c.fromRequest({ request });
	try {
		const out = await run(c);
		return resultToResponse(c.res ?? { headers: new Headers() }, out);
	} catch (thrown) {
		return catchEdgeError(thrown, c.res, encodeOptions, request);
	}
};

const h = v.fn({ use: [base] });

/**
 * Mounted web edge: seed `req`/`res` from `request`, run `run` in the
 * same scope, and turn {@link Redirect} into a 3xx Response. Contract
 * violations and declared/unexpected errors become JSON error bodies.
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
} & Omit<EncodeErrorOptions, "request">;

/**
 * Fetch adapter: `(request) => Response`. Modules in `options.use` are
 * mounted on the same context as `req` / `res` / `redirect`, so
 * `createHandler((c) => c.whoami(), { use: [{ whoami }] })` works.
 * Pass `messages` / `message` to rewrite declared `FnError` copy for i18n.
 */
export function createHandler<
	const PL extends readonly Module[] = readonly [],
	R = unknown,
>(
	run: (c: CreateHandlerContext<PL>) => R | Promise<R>,
	options?: CreateHandlerOptions<PL>,
): (request: Request) => Promise<Response> {
	const use = [base, ...(options?.use ?? [])] as EdgeModules<PL>;
	const encodeOptions: EncodeErrorOptions | undefined =
		options?.messages !== undefined || options?.message !== undefined
			? { messages: options.messages, message: options.message }
			: undefined;
	const entry = v
		.fn({ use })
		.fn(
			"http.create_handler",
			{ input: { request: v.any<Request>() } },
			async (c) => settle(c, c.input.request, run, encodeOptions),
		);

	return (request) => entry({ request }) as Promise<Response>;
}
