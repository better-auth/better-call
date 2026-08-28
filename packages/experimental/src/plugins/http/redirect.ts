import { ControlFlow } from "../../error";
import { v } from "../../index";
import type { HttpResponse } from "./response";
import { res, toResponse } from "./response";

export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

const REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const;

/** HTTP navigation control - not a domain refusal and not a defect.
 * Thrown by {@link redirect} after writing Location + status onto `res`. */
export class Redirect extends ControlFlow {
	constructor(
		public url: string,
		public status: RedirectStatus = 302,
	) {
		super(`redirect ${status} ${url}`);
		this.name = "Redirect";
	}
}

const h = v.fn({ use: [{ res }] });

/**
 * Write a redirect onto the scope's `res`, then throw {@link Redirect}
 * so the call stack unwinds. Catch it at the web edge with
 * {@link createHandler} (or {@link asResponse} in a manual try/catch).
 * `.try` does not catch it.
 *
 * @example
 * ```ts
 * const handler = createHandler((c) => {
 *   c.redirect({ url: "/dashboard" });
 * });
 * ```
 */
export const redirect = h.fn(
	"http.redirect",
	{
		input: {
			url: v.string(),
			status: v.number({
				enum: REDIRECT_STATUSES,
				default: 302,
			}),
		},
	},
	(c): never => {
		const { url, status } = c.input;
		let response = c.res;
		if (!response) {
			response = { headers: new Headers() };
			c.res = response;
		}
		response.status = status;
		response.headers.set("location", url);
		throw new Redirect(url, status as RedirectStatus);
	},
);

/**
 * Write a thrown {@link Redirect} onto `res`: status + Location.
 * Returns the same `res` for chaining.
 */
export const applyRedirect = (
	response: HttpResponse,
	redirected: Redirect,
): HttpResponse => {
	response.status = redirected.status;
	response.headers.set("location", redirected.url);
	return response;
};

/**
 * Turn a thrown {@link Redirect} into a fetch Response, preserving
 * headers already on `response`. Any other value is rethrown.
 */
export const asResponse = (
	thrown: unknown,
	response?: HttpResponse | null,
): Response => {
	if (!(thrown instanceof Redirect)) throw thrown;
	const current = response ?? { headers: new Headers() };
	applyRedirect(current, thrown);
	return toResponse(current, null);
};
