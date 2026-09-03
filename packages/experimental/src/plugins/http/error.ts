import { FnError, UnexpectedError, ValidationError } from "../../error";
import type { HttpResponse } from "./response";

/** Static HTTP metadata on an error declaration from `http.err`. Non-
 * enumerable so `asType` / object validation never treat it as a field. */
export const kHttpErr = Symbol.for("better-call:http.err");

export type HttpErrMeta = {
	status: number;
	message: string;
};

/**
 * Declare an HTTP status + default message on a fn error tag. Returns a
 * normal payload schema (so `c.error(tag, data)` validates as today) with
 * status/message stashed on {@link kHttpErr}. Core never sees HTTP; the
 * edge reads it back with {@link errorStatus} / {@link applyError}, or
 * from {@link FnError.status} / {@link FnError} message stamped at mint.
 *
 * @example
 * ```ts
 * errors: {
 *   invalid_credentials: http.err(401, "Invalid credentials", { attempts: v.number() }),
 *   gone: http.err(410, "Gone"),
 * }
 * ```
 */
export function err(status: number, message: string): Record<string, never>;
export function err<const S extends Record<string, unknown>>(
	status: number,
	message: string,
	data: S,
): S;
export function err(
	status: number,
	message: string,
	data: Record<string, unknown> = {},
): Record<string, unknown> {
	if (!Number.isInteger(status) || status < 200 || status > 599) {
		throw new ValidationError(
			"http.err.status",
			`expected HTTP status 200-599, received ${status}`,
		);
	}
	if (typeof message !== "string" || message.length === 0) {
		throw new ValidationError(
			"http.err.message",
			"expected a non-empty error message",
		);
	}
	// Copy so two tags can share a data shape without sharing metadata.
	const schema = { ...data };
	Object.defineProperty(schema, kHttpErr, {
		value: { status, message } satisfies HttpErrMeta,
		enumerable: false,
		configurable: true,
	});
	return schema;
}

/** Status declared via `http.err` on a single error-schema value, if any. */
export const statusOf = (decl: unknown): number | undefined => {
	if (decl === null || typeof decl !== "object") return undefined;
	const meta = (decl as Record<symbol, HttpErrMeta | undefined>)[kHttpErr];
	return meta?.status;
};

/** Status for a thrown tag, looked up on the fn's `errors` map. */
export const errorStatus = (
	errors: Record<string, unknown> | undefined | null,
	tag: string,
): number | undefined => statusOf(errors?.[tag]);

/**
 * Write a declared error onto `res`: set `status` from `http.err`
 * metadata when present. Returns the same `res` for chaining.
 */
export const applyError = (
	response: HttpResponse,
	errors: Record<string, unknown> | undefined | null,
	error: { tag: string; status?: number },
): HttpResponse => {
	const status = error.status ?? errorStatus(errors, error.tag);
	if (status !== undefined) response.status = status;
	return response;
};

export type EncodedError = {
	status: number;
	body: Record<string, unknown>;
};

/** Tag-keyed string, or a fn of the error for interpolation / full control. */
export type ErrorMessageOverride =
	| string
	| ((error: FnError) => string | undefined | null);

export type EncodeErrorOptions = {
	/**
	 * Rewrite `FnError` messages by tag (i18n dictionaries). A string
	 * replaces the declared message; a fn may return a new message or
	 * `null`/`undefined` to keep the declared one. A top-level fn receives
	 * the request (when provided) so locale can be detected per call.
	 * When rewritten, the body also gets `originalMessage`.
	 */
	messages?:
		| Record<string, ErrorMessageOverride>
		| ((
				request: Request | undefined,
		  ) => Record<string, ErrorMessageOverride> | undefined);
	/**
	 * Full-control rewrite. Runs after `messages` lookup; return
	 * `null`/`undefined` to keep whatever message is current.
	 */
	message?: (
		error: FnError,
		request: Request | undefined,
	) => string | undefined | null;
	/** Current request - used by `messages`/`message` fns for locale detection. */
	request?: Request;
};

const resolveOverride = (
	override: ErrorMessageOverride | undefined,
	error: FnError,
): string | undefined => {
	if (override === undefined) return undefined;
	if (typeof override === "function") {
		const next = override(error);
		return typeof next === "string" ? next : undefined;
	}
	return override;
};

/**
 * Map a contract / domain / defect error to an HTTP status + JSON body.
 * Returns `null` for throws the edge should not claim (rethrow).
 * Pass {@link EncodeErrorOptions} to rewrite `FnError` messages (i18n).
 */
export const encodeError = (
	thrown: unknown,
	options?: EncodeErrorOptions,
): EncodedError | null => {
	if (thrown instanceof ValidationError) {
		return { status: 400, body: thrown.toJSON() };
	}
	if (thrown instanceof FnError) {
		const body = thrown.toJSON() as Record<string, unknown>;
		const map =
			typeof options?.messages === "function"
				? options.messages(options.request)
				: options?.messages;
		const fromMap = resolveOverride(map?.[thrown.tag], thrown);
		const fromFn = options?.message?.(thrown, options.request);
		const next = (typeof fromFn === "string" ? fromFn : undefined) ?? fromMap;
		if (typeof next === "string" && next !== body.message) {
			if (typeof body.message === "string") {
				body.originalMessage = body.message;
			}
			body.message = next;
		}
		return {
			status: thrown.status ?? 422,
			body,
		};
	}
	if (thrown instanceof UnexpectedError) {
		return { status: 500, body: thrown.toJSON() };
	}
	return null;
};
