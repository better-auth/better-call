import type { IncomingMessage, ServerResponse } from "node:http";
import * as set_cookie_parser from "set-cookie-parser";

function get_raw_body(req: IncomingMessage, body_size_limit?: number) {
	const h = req.headers;

	if (!h["content-type"]) return null;

	const content_length = Number(h["content-length"]);

	// check if no request body
	if (
		(req.httpVersionMajor === 1 && isNaN(content_length) && h["transfer-encoding"] == null) ||
		content_length === 0
	) {
		return null;
	}

	let length = content_length;

	if (body_size_limit) {
		if (!length) {
			length = body_size_limit;
		} else if (length > body_size_limit) {
			throw Error(
				`Received content-length of ${length}, but only accept up to ${body_size_limit} bytes.`,
			);
		}
	}

	if (req.destroyed) {
		const readable = new ReadableStream();
		readable.cancel();
		return readable;
	}

	let size = 0;
	let cancelled = false;

	return new ReadableStream({
		start(controller) {
			req.on("error", (error) => {
				cancelled = true;
				controller.error(error);
			});

			req.on("end", () => {
				if (cancelled) return;
				controller.close();
			});

			req.on("data", (chunk) => {
				if (cancelled) return;

				size += chunk.length;

				if (size > length) {
					cancelled = true;

					controller.error(
						new Error(
							`request body size exceeded ${
								content_length ? "'content-length'" : "BODY_SIZE_LIMIT"
							} of ${length}`,
						),
					);
					return;
				}

				controller.enqueue(chunk);

				if (controller.desiredSize === null || controller.desiredSize <= 0) {
					req.pause();
				}
			});
		},

		pull() {
			req.resume();
		},

		cancel(reason) {
			cancelled = true;
			req.destroy(reason);
		},
	});
}

function constructRelativeUrl(req: IncomingMessage & { baseUrl?: string; originalUrl?: string }) {
	const baseUrl = req.baseUrl;
	const originalUrl = req.originalUrl;

	if (!baseUrl || !originalUrl) {
		// In express.js sub-routers `req.url` is relative to the mount
		// path (e.g., '/auth/xxx'), and `req.baseUrl` will hold the mount
		// path (e.g., '/api'). Build the full path as baseUrl + url when
		// available to preserve the full route. For application level routes
		// baseUrl will be an empty string
		return baseUrl ? baseUrl + req.url : req.url;
	}

	if (baseUrl + req.url === originalUrl) {
		return baseUrl + req.url;
	}

	// For certain subroutes or when mounting wildcard middlewares in express
	// it is possible `baseUrl + req.url` will result in a url constructed
	// which has a trailing forward slash the original url did not have.
	// Checking the `req.originalUrl` path ending can prevent this issue.

	const originalPathEnding = originalUrl.split("?")[0].at(-1);
	return originalPathEnding === "/" ? baseUrl + req.url : baseUrl;
}

export function getRequest({
	request,
	base,
	bodySizeLimit,
}: {
	base: string;
	bodySizeLimit?: number;
	request: IncomingMessage;
}) {
	// Check if body has already been parsed by Express middleware
	const maybeConsumedReq = request as any;
	let body = undefined;

	const method = request.method;
	// Request with GET/HEAD method cannot have body.
	if (method !== "GET" && method !== "HEAD") {
		// If body was already parsed by Express body-parser middleware
		if (maybeConsumedReq.body !== undefined) {
			// Convert parsed body back to a ReadableStream
			const bodyContent =
				typeof maybeConsumedReq.body === "string"
					? maybeConsumedReq.body
					: JSON.stringify(maybeConsumedReq.body);

			body = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(bodyContent));
					controller.close();
				},
			});
		} else {
			// Otherwise, get the raw body stream
			body = get_raw_body(request, bodySizeLimit);
		}
	}

	return new Request(base + constructRelativeUrl(request), {
		// @ts-expect-error
		duplex: "half",
		method: request.method,
		body,
		headers: request.headers as Record<string, string>,
	});
}

export async function setResponse(res: ServerResponse, response: Response) {
	for (const [key, value] of response.headers as any) {
		try {
			res.setHeader(
				key,
				key === "set-cookie"
					? set_cookie_parser.splitCookiesString(response.headers.get(key) as string)
					: value,
			);
		} catch (error) {
			res.getHeaderNames().forEach((name) => res.removeHeader(name));
			res.writeHead(500).end(String(error));
			return;
		}
	}

	res.statusCode = response.status;
	res.writeHead(response.status);

	if (!response.body) {
		res.end();
		return;
	}

	if (response.body.locked) {
		res.end(
			"Fatal error: Response body is locked. " +
				"This can happen when the response was already read (for example through 'response.json()' or 'response.text()').",
		);
		return;
	}

	const reader = response.body.getReader();

	if (res.destroyed) {
		reader.cancel();
		return;
	}

	const cancel = (error?: Error) => {
		res.off("close", cancel);
		res.off("error", cancel);

		// If the reader has already been interrupted with an error earlier,
		// then it will appear here, it is useless, but it needs to be catch.
		reader.cancel(error).catch(() => {});
		if (error) res.destroy(error);
	};

	res.on("close", cancel);
	res.on("error", cancel);

	next();
	async function next() {
		try {
			for (;;) {
				const { done, value } = await reader.read();

				if (done) break;

				const writeResult = res.write(value);
				if (!writeResult) {
					// In AWS Lambda/serverless environments, drain events may not work properly
					// Check if we're in a Lambda-like environment and handle differently
					if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT) {
						// In Lambda, continue without waiting for drain
						continue;
					} else {
						// Standard Node.js behavior
						res.once("drain", next);
						return;
					}
				}
				res.end();
			}
		} catch (error) {
			cancel(error instanceof Error ? error : new Error(String(error)));
		}
	}
}
