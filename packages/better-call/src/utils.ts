import { APIError } from "./error";

const jsonContentTypeRegex = /^application\/([a-z0-9.+-]*\+)?json/i;

export async function getBody(request: Request, allowedMediaTypes?: string[]) {
	const contentType = request.headers.get("content-type") || "";
	const normalizedContentType = contentType.toLowerCase();

	if (!request.body) {
		return undefined;
	}

	// Validate content-type if allowedMediaTypes is provided
	if (allowedMediaTypes && allowedMediaTypes.length > 0) {
		const isAllowed = allowedMediaTypes.some((allowed) => {
			// Normalize both content types for comparison
			const normalizedContentTypeBase = normalizedContentType
				.split(";")[0]!
				.trim();
			const normalizedAllowed = allowed.toLowerCase().trim();
			return (
				normalizedContentTypeBase === normalizedAllowed ||
				normalizedContentTypeBase.includes(normalizedAllowed)
			);
		});

		if (!isAllowed) {
			if (!normalizedContentType) {
				throw new APIError(415, {
					message: `Content-Type is required. Allowed types: ${allowedMediaTypes.join(", ")}`,
					code: "UNSUPPORTED_MEDIA_TYPE",
				});
			}
			throw new APIError(415, {
				message: `Content-Type "${contentType}" is not allowed. Allowed types: ${allowedMediaTypes.join(", ")}`,
				code: "UNSUPPORTED_MEDIA_TYPE",
			});
		}
	}

	if (jsonContentTypeRegex.test(normalizedContentType)) {
		return await request.json();
	}

	if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
		const formData = await request.formData();
		const result: Record<string, string> = {};
		formData.forEach((value, key) => {
			result[key] = value.toString();
		});
		return result;
	}

	if (normalizedContentType.includes("multipart/form-data")) {
		const formData = await request.formData();
		const result: Record<string, any> = {};
		formData.forEach((value, key) => {
			result[key] = value;
		});
		return result;
	}

	if (normalizedContentType.includes("text/plain")) {
		return await request.text();
	}

	if (normalizedContentType.includes("application/octet-stream")) {
		return await request.arrayBuffer();
	}

	if (
		normalizedContentType.includes("application/pdf") ||
		normalizedContentType.includes("image/") ||
		normalizedContentType.includes("video/")
	) {
		const blob = await request.blob();
		return blob;
	}

	if (
		normalizedContentType.includes("application/stream") ||
		request.body instanceof ReadableStream
	) {
		return request.body;
	}

	return await request.text();
}

export function isAPIError(error: any): error is APIError {
	return error instanceof APIError || error?.name === "APIError";
}

export function tryDecode(str: string) {
	try {
		return str.includes("%") ? decodeURIComponent(str) : str;
	} catch {
		return str;
	}
}

type Success<T> = {
	data: T;
	error: null;
};

type Failure<E> = {
	data: null;
	error: E;
};

type Result<T, E = Error> = Success<T> | Failure<E>;

export async function tryCatch<T, E = Error>(
	promise: Promise<T>,
): Promise<Result<T, E>> {
	try {
		const data = await promise;
		return { data, error: null };
	} catch (error) {
		return { data: null, error: error as E };
	}
}

/**
 * Check if an object is a `Request`
 * - `instanceof`: works for native Request instances
 * - `toString`: handles where instanceof check fails but the object is still a valid Request
 */
export function isRequest(obj: unknown): obj is Request {
	return (
		obj instanceof Request ||
		Object.prototype.toString.call(obj) === "[object Request]"
	);
}
