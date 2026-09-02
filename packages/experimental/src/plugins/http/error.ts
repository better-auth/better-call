import { FnError, UnexpectedError, ValidationError } from "../../error";
import type { HttpResponse } from "./response";

/** Static HTTP metadata on an error declaration from `http.err`. Non-
 * enumerable so `asType` / object validation never treat it as a field. */
export const kHttpErr = Symbol.for("better-call:http.err");

export type HttpErrMeta = {
	status: number;
};

/**
 * Declare an HTTP status on a fn error tag. Returns a normal payload
 * schema (so `c.error(tag, data)` validates as today) with status stashed
 * on {@link kHttpErr}. Core never sees HTTP; the edge reads it back with
 * {@link errorStatus} / {@link applyError}, or from {@link FnError.status}
 * stamped at mint time.
 *
 * @example
 * ```ts
 * errors: {
 *   invalid_credentials: http.err(401, { attempts: v.number() }),
 *   gone: http.err(410),
 * }
 * ```
 */
export function err(status: number): Record<string, never>;
export function err<const S extends Record<string, unknown>>(
	status: number,
	data: S,
): S;
export function err(
	status: number,
	data: Record<string, unknown> = {},
): Record<string, unknown> {
	if (!Number.isInteger(status) || status < 200 || status > 599) {
		throw new ValidationError(
			"http.err.status",
			`expected HTTP status 200-599, received ${status}`,
		);
	}
	// Copy so two tags can share a data shape without sharing metadata.
	const schema = { ...data };
	Object.defineProperty(schema, kHttpErr, {
		value: { status } satisfies HttpErrMeta,
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

/**
 * Map a contract / domain / defect error to an HTTP status + JSON body.
 * Returns `null` for throws the edge should not claim (rethrow).
 */
export const encodeError = (thrown: unknown): EncodedError | null => {
	if (thrown instanceof ValidationError) {
		return { status: 400, body: thrown.toJSON() };
	}
	if (thrown instanceof FnError) {
		return {
			status: thrown.status ?? 422,
			body: thrown.toJSON(),
		};
	}
	if (thrown instanceof UnexpectedError) {
		return { status: 500, body: thrown.toJSON() };
	}
	return null;
};
