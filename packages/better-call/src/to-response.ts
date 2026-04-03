import { APIError } from "./error";
import { isAPIError } from "./utils";

function isJSONSerializable(value: any) {
	if (value === undefined) {
		return false;
	}
	const t = typeof value;
	if (t === "string" || t === "number" || t === "boolean" || t === null) {
		return true;
	}
	if (t !== "object") {
		return false;
	}
	if (Array.isArray(value)) {
		return true;
	}
	if (value.buffer) {
		return false;
	}
	return (
		(value.constructor && value.constructor.name === "Object") ||
		typeof value.toJSON === "function"
	);
}

function safeStringify(
	obj: any,
	replacer?: (key: string, value: any) => any,
	space?: string | number,
): string {
	let id = 0;
	const seen = new WeakMap<object, number>(); // ref -> counter

	const safeReplacer = (key: string, value: any) => {
		// Handle bigint first
		if (typeof value === "bigint") {
			return value.toString();
		}

		// Then handle circular references
		if (typeof value === "object" && value !== null) {
			if (seen.has(value)) {
				return `[Circular ref-${seen.get(value)}]`;
			}
			seen.set(value, id++);
		}

		// Finally apply any custom replacer
		if (replacer) {
			return replacer(key, value);
		}

		return value;
	};

	return JSON.stringify(obj, safeReplacer, space);
}

export type JSONResponse = {
	body: Record<string, any>;
	routerResponse: ResponseInit | undefined;
	status?: number;
	headers?: Record<string, string> | Headers;
	_flag: "json";
};

function isJSONResponse(value: any): value is JSONResponse {
	if (!value || typeof value !== "object") {
		return false;
	}
	return "_flag" in value && value._flag === "json";
}

/**
 * Headers that MUST be stripped when building an HTTP response from
 * arbitrary header input. These are request-only, hop-by-hop, or
 * transport-managed headers that cause protocol violations when present
 * on responses (e.g. Content-Length mismatch → net::ERR_CONTENT_LENGTH_MISMATCH).
 *
 * Sources:
 *   - RFC 9110 §10.1   (Request Context Fields)
 *   - RFC 9110 §7.6.1  (Connection / hop-by-hop)
 *   - RFC 9110 §11.6-7 (Authentication credentials)
 *   - RFC 9110 §12.5   (Content negotiation)
 *   - RFC 9110 §13.1   (Conditional request headers)
 *   - RFC 9110 §14.2   (Range requests)
 *   - RFC 6265 §5.4    (Cookie)
 *   - RFC 6454         (Origin)
 */
const REQUEST_ONLY_HEADERS = new Set([
	// Request context (RFC 9110 §10.1)
	"host", // §7.2
	"user-agent", // §10.1.5
	"referer", // §10.1.3
	"from", // §10.1.2
	"expect", // §10.1.1

	// Authentication credentials (RFC 9110 §11.6-7)
	"authorization", // §11.6.2
	"proxy-authorization", // §11.7.2
	"cookie", // RFC 6265 §5.4
	"origin", // RFC 6454

	// Content negotiation (RFC 9110 §12.5)
	"accept-charset", // §12.5.2 (deprecated)
	"accept-encoding", // §12.5.3
	"accept-language", // §12.5.4

	// Conditional requests (RFC 9110 §13.1)
	"if-match", // §13.1.1
	"if-none-match", // §13.1.2
	"if-modified-since", // §13.1.3
	"if-unmodified-since", // §13.1.4
	"if-range", // §13.1.5

	// Range requests (RFC 9110 §14.2)
	"range", // §14.2

	// Forwarding control (RFC 9110 §7.6)
	"max-forwards", // §7.6.2

	// Hop-by-hop (RFC 9110 §7.6.1)
	"connection", // §7.6.1
	"keep-alive",
	"transfer-encoding",
	"te", // §10.1.4
	"upgrade",
	"trailer",
	"proxy-connection", // non-standard

	// Valid on responses but WRONG if copied from request (RFC 9110 §8.6)
	"content-length",
]);

function stripRequestOnlyHeaders(headers: Headers): void {
	for (const name of REQUEST_ONLY_HEADERS) {
		headers.delete(name);
	}
}

export function toResponse(data?: any, init?: ResponseInit): Response {
	if (data instanceof Response) {
		if (init?.headers) {
			const safeHeaders = new Headers(init.headers);
			stripRequestOnlyHeaders(safeHeaders);
			safeHeaders.forEach((value, key) => {
				data.headers.set(key, value);
			});
		}
		return data;
	}
	const isJSON = isJSONResponse(data);
	if (isJSON) {
		const body = data.body;
		const routerResponse = data.routerResponse;
		if (routerResponse instanceof Response) {
			return routerResponse;
		}
		const headers = new Headers();
		if (routerResponse?.headers) {
			const headers = new Headers(routerResponse.headers);
			for (const [key, value] of headers.entries()) {
				headers.set(key, value);
			}
		}
		if (data.headers) {
			for (const [key, value] of new Headers(data.headers).entries()) {
				headers.set(key, value);
			}
		}
		if (init?.headers) {
			const safeHeaders = new Headers(init.headers);
			stripRequestOnlyHeaders(safeHeaders);
			for (const [key, value] of safeHeaders.entries()) {
				headers.set(key, value);
			}
		}

		headers.set("Content-Type", "application/json");
		return new Response(JSON.stringify(body), {
			...routerResponse,
			headers,
			status: data.status ?? init?.status ?? routerResponse?.status,
			statusText: init?.statusText ?? routerResponse?.statusText,
		});
	}
	if (isAPIError(data)) {
		return toResponse(data.body, {
			status: init?.status ?? data.statusCode,
			statusText: data.status.toString(),
			headers: init?.headers || data.headers,
		});
	}
	let body = data;
	const headers = new Headers(init?.headers);
	stripRequestOnlyHeaders(headers);
	if (!data) {
		if (data === null) {
			body = JSON.stringify(null);
		}
		headers.set("content-type", "application/json");
	} else if (typeof data === "string") {
		body = data;
		headers.set("Content-Type", "text/plain");
	} else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
		body = data;
		headers.set("Content-Type", "application/octet-stream");
	} else if (data instanceof Blob) {
		body = data;
		headers.set("Content-Type", data.type || "application/octet-stream");
	} else if (data instanceof FormData) {
		body = data;
	} else if (data instanceof URLSearchParams) {
		body = data;
		headers.set("Content-Type", "application/x-www-form-urlencoded");
	} else if (data instanceof ReadableStream) {
		body = data;
		headers.set("Content-Type", "application/octet-stream");
	} else if (isJSONSerializable(data)) {
		body = safeStringify(data);
		headers.set("Content-Type", "application/json");
	}

	return new Response(body, {
		...init,
		headers,
	});
}
