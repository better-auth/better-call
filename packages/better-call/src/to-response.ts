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

export function toResponse(data?: any, init?: ResponseInit): Response {
	if (data instanceof Response) {
		if (init?.headers instanceof Headers) {
			init.headers.forEach((value, key) => {
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
			for (const [key, value] of new Headers(init.headers).entries()) {
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
	let headers = new Headers(init?.headers);
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
