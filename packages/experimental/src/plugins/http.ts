import { v } from "../index";
import type { InferArgs } from "../schema";

const parseQuery = (url: URL) => {
	const q: Record<string, string | string[]> = {};
	for (const [key, value] of url.searchParams) {
		const current = q[key];
		q[key] =
			current === undefined
				? value
				: Array.isArray(current)
					? [...current, value]
					: [current, value];
	}
	return q;
};

const parseCookies = (header: string | null) => {
	const jar: Record<string, string> = {};
	for (const part of (header ?? "").split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name) jar[name] = decodeURIComponent(rest.join("="));
	}
	return jar;
};

/** The whole request-side state, as ONE value: `c.req` and
 * everything is there - no per-piece vars to require one by one. */
export type HttpRequest = {
	/** The fetch Request itself, untouched. */
	raw: Request;
	method: string;
	path: string;
	headers: Headers;
	query: Record<string, string | string[]>;
	cookies: Record<string, string>;
	/** Parsed by `fromRequest` when the content type says json/text -
	 * anything else stays on `raw`. */
	body: unknown;
};

/** Build the `req` value from a fetch Request. The body cannot be read
 * synchronously, so it comes in from whoever already awaited it -
 * `fromRequest` does that for you. */
export const toHttpRequest = (raw: Request, body?: unknown): HttpRequest => {
	const url = new URL(raw.url);
	return {
		raw,
		method: raw.method.toUpperCase(),
		path: url.pathname,
		headers: raw.headers,
		query: parseQuery(url),
		cookies: parseCookies(raw.headers.get("cookie")),
		body,
	};
};

export const req = v.var("req", { default: null as HttpRequest | null });

/** The response side, as ONE value. `headers` and `status` are meant to
 * be MUTATED in place (`res.headers.set(...)`, `res.status = 201`) - the
 * object is shared with whoever builds the final Response, so in-place
 * writes are exactly what travels back. */
export type HttpResponse = {
	headers: Headers;
	/** Steers the answering Response's status - assign it in place. */
	status?: number;
	statusText?: string;
};

export const res = v.var("res", { default: null as HttpResponse | null });

const httpVars = { req, res };

const h = v.fn({ use: [httpVars] });

export const fromRequest = h.fn(
	"http.from_request",
	{ input: { request: v.any<Request>() }, provides: ["req"] },
	async (c) => {
		const raw = c.input.request;
		let body: unknown;
		if (raw.method !== "GET" && raw.method !== "HEAD") {
			const contentType = raw.headers.get("content-type") ?? "";
			if (contentType.includes("json")) {
				body = await raw
					.clone()
					.json()
					.catch(() => undefined);
			} else if (contentType.includes("text")) {
				body = await raw
					.clone()
					.text()
					.catch(() => undefined);
			}
		}
		const value = toHttpRequest(raw, body);
		c.req = value;
		c.res = { headers: new Headers() };
		return { method: value.method, path: value.path };
	},
);

/* --------------------------------- cookies --------------------------------- */

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

export const http = {
	...httpVars,
	cookieOptions,
	handler: fromRequest,
	getCookie,
	setCookie,
	deleteCookie,
};
