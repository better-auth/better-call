import { v } from "../../index";
import type { InferArgs } from "../../schema";
import { req } from "./request";
import { res } from "./response";

/** Cookie attributes as a SCHEMA - the source of truth. The TS type
 * falls out of it, and everything crossing a fn door validates against
 * it (enum-checked sameSite, `instanceof`-checked expires). */
export const cookieShape = {
	maxAge: v.number({ optional: true }),
	expires: v.date({ optional: true }),
	path: v.string({ optional: true }),
	domain: v.string({ optional: true }),
	secure: v.boolean({ optional: true }),
	httpOnly: v.boolean({ optional: true }),
	sameSite: v.string({ enum: ["strict", "lax", "none"], optional: true }),
};

export type CookieOptions = InferArgs<typeof cookieShape>;

/**
 * Scope-level cookie DEFAULTS, as a var: whatever sets it - app setup, a
 * module, an interceptor - every `setCookie` below merges its per-call
 * options ON TOP. Config that travels down the call tree is exactly what
 * a var is, so "change the global cookie config" is just a `.set()` at
 * any point in the scope.
 */
export const cookieOptions = v.var("cookieOptions", {
	default: {},
	schema: v.object(cookieShape),
});

/** The per-call options field: the same shape, optional to send. */
const cookieOptionsField = v.object(cookieShape, { optional: true });

const serialize = (
	name: string,
	value: string,
	options: CookieOptions = {},
) => {
	const parts = [`${name}=${encodeURIComponent(value)}`];
	if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
	if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
	if (options.path) parts.push(`Path=${options.path}`);
	if (options.domain) parts.push(`Domain=${options.domain}`);
	if (options.secure) parts.push("Secure");
	if (options.httpOnly) parts.push("HttpOnly");
	if (options.sameSite) {
		parts.push(
			`SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`,
		);
	}
	return parts.join("; ");
};

const ck = v.fn("cookie.", {
	use: [{ req, res, cookieOptions }],
});

/** Read one cookie from the REQUEST jar. Positional: `getCookie("theme")`.
 * Readonly - reading a cookie can never write the scope. */
export const getCookie = ck.fn(
	"get",
	{ input: [v.string()], readonly: true },
	(c): string | null => {
		const [name] = c.input;
		return c.req?.cookies[name] ?? null;
	},
);

/** Queue a Set-Cookie on the scope's response headers: the scope's
 * `cookieOptions` defaults, with per-call options merged on top. The
 * written cookie also lands in the request jar, so a later `getCookie`
 * in the same scope reads what was set. */
export const setCookie = ck.fn(
	"set",
	{
		input: {
			name: v.string(),
			value: v.string(),
			options: cookieOptionsField,
		},
	},
	(c) => {
		const { name, value, options } = c.input;
		let response = c.res;
		if (!response) {
			response = { headers: new Headers() };
			c.res = response;
		}
		response.headers.append(
			"set-cookie",
			serialize(name, value, { ...c.cookieOptions, ...options }),
		);
		const current = c.req;
		if (current) {
			c.req = {
				...current,
				cookies: { ...current.cookies, [name]: value },
			};
		}
		return { set: true };
	},
);

/** Expire a cookie: a Set-Cookie with Max-Age=0 - the attributes (path,
 * domain) must match the ones it was set with. */
export const deleteCookie = ck.fn(
	"delete",
	{
		input: {
			name: v.string(),
			options: cookieOptionsField,
		},
		use: [{ setCookie }],
	},
	(c) => {
		const { name, options } = c.input;
		return c.setCookie({
			name,
			value: "",
			options: { ...options, maxAge: 0 },
		});
	},
);
