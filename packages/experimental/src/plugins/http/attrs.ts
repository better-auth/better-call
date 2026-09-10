import { ValidationError } from "../../error";
import {
	isNoInput,
	isNoOutput,
	noInput,
	omitFields,
	parseFields,
	rejectFields,
} from "../../schema";

/** HTTP-facing alias of {@link noInput} - same `$attrs.v.noInput` gate. */
export const serverOnly = noInput;

/**
 * Drop fields marked `v.noInput`. Used for OpenAPI / client input
 * contracts; Prefer `schema.input` when the schema already has views.
 */
export const clientSchema = <S>(schema: S): S => omitFields(schema, isNoInput);

/**
 * Drop fields marked `v.noOutput`. Prefer `schema.output` when the schema
 * already has views.
 */
export const responseSchema = <S>(schema: S): S =>
	omitFields(schema, isNoOutput);

/**
 * Throw if any `v.noInput` field is present on `value` (own key).
 */
export const rejectReadonly = (
	schema: unknown,
	value: unknown,
	path = "input",
): void | Promise<void> =>
	rejectFields(
		schema,
		value,
		isNoInput,
		path,
		"noInput field is not allowed over the wire",
	);

/**
 * Wire-side input gate: reject smuggled noInput keys, then validate
 * against {@link clientSchema}. Built on core {@link parseFields}.
 */
export const wireInput = <S>(
	schema: S,
	value: unknown,
	path = "input",
): unknown =>
	parseFields(schema, value, {
		path,
		reject: isNoInput,
		omit: isNoInput,
		rejectMessage: "noInput field is not allowed over the wire",
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

/** True when a field carries `v.noOutput`. */
export const isReturnedField = isNoOutput;

/** Project output schemas the same way `v.fn` does on exit. */
export const stripReturned = <S>(schema: S): S => responseSchema(schema);
