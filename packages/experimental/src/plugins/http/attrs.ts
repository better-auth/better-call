import { ValidationError } from "../../error";
import {
	attrsOf,
	omitFields,
	parseFields,
	rejectFields,
	withAttrs,
} from "../../schema";

/** Client may not set this field. Wire / capability edges reject it if
 * present; in-process callers may still pass it. */
export const readonly = <S>(schema: S): S =>
	withAttrs(schema, "http", { readonly: true });

/**
 * Exclude this field from responses. When an fn's `output` schema (often
 * a var) carries it, output validation drops the key.
 */
export const returned = <S>(schema: S): S =>
	withAttrs(schema, "http", { returned: true });

/** @deprecated Prefer {@link readonly}. Same wire gate. */
export const serverOnly = <S>(schema: S): S =>
	withAttrs(schema, "http", { serverOnly: true });

const httpAttrs = (schema: unknown) => attrsOf(schema, "http");

const isReadonly = (schema: unknown) => {
	const http = httpAttrs(schema);
	return http?.readonly === true || http?.serverOnly === true;
};

const isReturned = (schema: unknown) => httpAttrs(schema)?.returned === true;

/**
 * Drop fields marked {@link readonly} / {@link serverOnly}. Used for
 * OpenAPI / client input contracts; {@link InferArgs} on the original
 * schema stays the full shape.
 */
export const clientSchema = <S>(schema: S): S => omitFields(schema, isReadonly);

/**
 * Drop fields marked {@link returned}. Pair with {@link clientSchema} when
 * projecting an output / response contract.
 */
export const responseSchema = <S>(schema: S): S =>
	omitFields(schema, isReturned);

/**
 * Throw if any {@link readonly} / {@link serverOnly} field is present on
 * `value` (own key).
 */
export const rejectReadonly = (
	schema: unknown,
	value: unknown,
	path = "input",
): void =>
	rejectFields(
		schema,
		value,
		isReadonly,
		path,
		"readonly field is not allowed over the wire",
	);

/** @deprecated Prefer {@link rejectReadonly}. */
export const rejectServerOnly = (
	schema: unknown,
	value: unknown,
	path = "input",
): void => rejectReadonly(schema, value, path);

/**
 * Wire-side input gate: reject smuggled readonly keys, then validate
 * against {@link clientSchema}. Built on core {@link parseFields}.
 */
export const wireInput = <S>(
	schema: S,
	value: unknown,
	path = "input",
): unknown =>
	parseFields(schema, value, {
		path,
		reject: isReadonly,
		omit: isReadonly,
		rejectMessage: "readonly field is not allowed over the wire",
	});

/** Parse a JSON request body and run it through {@link wireInput}. */
export const fromJsonBody = async <S>(
	request: Request,
	schema: S,
	path = "body",
): Promise<unknown> => {
	let body: unknown;
	try {
		body = await request.json();
	} catch (cause) {
		throw new ValidationError(
			path,
			`expected a JSON body (${cause instanceof Error ? cause.message : String(cause)})`,
			undefined,
			{ cause },
		);
	}
	return await wireInput(schema, body, path);
};

/** True when a field carries {@link returned}. Used by `v.fn` output exit. */
export const isReturnedField = isReturned;

/** Project output schemas the same way `v.fn` does on exit. */
export const stripReturned = <S>(schema: S): S => responseSchema(schema);
