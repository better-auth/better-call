import { v } from "../../index";
import { res } from "./response";

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

const h = v.fn({ use: [{ req, res }] });

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
