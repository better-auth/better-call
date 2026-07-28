import { v } from "../index";

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

export const request = v.var("request", { default: null as Request | null });

export const method = v.derive("method", request, (req) =>
	req.method.toUpperCase(),
);
export const path = v.derive(
	"path",
	request,
	(req) => new URL(req.url).pathname,
);
export const headers = v.derive("headers", request, (req) => req.headers);
export const query = v.derive("query", request, (req) =>
	parseQuery(new URL(req.url)),
);
export const cookies = v.derive("cookies", request, (req) =>
	parseCookies(req.headers.get("cookie")),
);

/** Body needs awaiting, so the adapter fills it rather than a getter. */
export const body = v.var("body", { default: undefined as unknown });
export const responseHeaders = v.var("responseHeaders", {
	default: null as Headers | null,
});

const httpVars = {
	request,
	method,
	path,
	headers,
	query,
	cookies,
	body,
	responseHeaders,
};

const h = v.fn({ use: [httpVars] });

export const fromRequest = h.fn(
	"http.from_request",
	{ input: { request: v.any<Request>() }, provides: ["request"] },
	async (c) => {
		const raw = c.input.request;
		c.var.request = raw;
		c.var.responseHeaders = new Headers();
		if (raw.method !== "GET" && raw.method !== "HEAD") {
			const contentType = raw.headers.get("content-type") ?? "";
			if (contentType.includes("json")) {
				c.var.body = await raw
					.clone()
					.json()
					.catch(() => undefined);
			} else if (contentType.includes("text")) {
				c.var.body = await raw
					.clone()
					.text()
					.catch(() => undefined);
			}
		}
		return { method: c.var.method, path: c.var.path };
	},
);

export const http = { ...httpVars, handler: fromRequest };
