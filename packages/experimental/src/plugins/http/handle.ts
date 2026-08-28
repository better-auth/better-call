import { v } from "../../index";
import { cookieOptions, deleteCookie, getCookie, setCookie } from "./cookie";
import { applyRedirect, Redirect, redirect } from "./redirect";
import { fromRequest, req } from "./request";
import { res, toResponse } from "./response";

const scope = {
	req,
	res,
	fromRequest,
	redirect,
	getCookie,
	setCookie,
	deleteCookie,
	cookieOptions,
};

const isBodyInit = (value: unknown): value is BodyInit =>
	typeof value === "string" ||
	value instanceof Blob ||
	value instanceof ArrayBuffer ||
	ArrayBuffer.isView(value) ||
	value instanceof ReadableStream ||
	value instanceof FormData ||
	value instanceof URLSearchParams;

export type CreateHandlerOptions = {
	/** Extra modules mounted into the handler scope (alongside HTTP). */
	use?: unknown[];
};

/**
 * Web entry: seed `req`/`res` from a fetch Request, run `run` in that
 * scope, and turn {@link Redirect} into a 3xx Response (preserving any
 * headers already on `res`). A returned {@link Response} passes through;
 * other returns become the body of `toResponse(res)`.
 */
export function createHandler(
	run: (c: any) => unknown | Promise<unknown>,
	options?: CreateHandlerOptions,
): (request: Request) => Promise<Response> {
	const entry = v
		.fn({ use: [scope, ...(options?.use ?? [])] })
		.fn("http.handler", { input: { request: v.any<Request>() } }, async (c) => {
			await c.fromRequest({ request: c.input.request });
			try {
				const out = await run(c);
				if (out instanceof Response) return out;
				const response = c.res ?? { headers: new Headers() };
				if (out === undefined || out === null) {
					return toResponse(response, null);
				}
				if (isBodyInit(out)) return toResponse(response, out);
				if (!response.headers.has("content-type")) {
					response.headers.set("content-type", "application/json");
				}
				return toResponse(response, JSON.stringify(out));
			} catch (thrown) {
				if (thrown instanceof Redirect) {
					const response = c.res ?? { headers: new Headers() };
					applyRedirect(response, thrown);
					return toResponse(response, null);
				}
				throw thrown;
			}
		});

	return (request) => entry({ request }) as Promise<Response>;
}
