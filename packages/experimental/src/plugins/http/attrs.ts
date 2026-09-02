import { ValidationError } from "../../error";
import {
	asType,
	attrsOf,
	isVar,
	typeOf,
	validate,
	withAttrs,
} from "../../schema";

/** Mark a field as unusable over the wire - HTTP / capability edges
 * reject it if present; in-process callers may still pass it. */
export const serverOnly = <S>(schema: S): S =>
	withAttrs(schema, "http", { serverOnly: true });

const isServerOnly = (schema: unknown) =>
	attrsOf(schema, "http")?.serverOnly === true;

/**
 * Drop fields (and nested object keys) marked {@link serverOnly}. Used
 * for OpenAPI / client contracts; {@link InferArgs} on the original
 * schema stays the full shape.
 */
export const clientSchema = <S>(schema: S): S => {
	if (isVar(schema)) {
		const v = schema as { schema?: unknown };
		return {
			...(schema as object),
			schema: v.schema === undefined ? undefined : clientSchema(v.schema as S),
		} as S;
	}
	const def = asType(schema);
	if (def.name === "object" && def.shape !== undefined) {
		const shape: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(
			def.shape as Record<string, unknown>,
		)) {
			if (isServerOnly(child)) continue;
			shape[key] = clientSchema(child);
		}
		return { ...def, shape } as S;
	}
	if (def.name === "array" && def.shape !== undefined) {
		return { ...def, shape: clientSchema(def.shape) } as S;
	}
	if (def.name === "union" && Array.isArray(def.shape)) {
		return {
			...def,
			shape: (def.shape as unknown[]).map((option) => clientSchema(option)),
		} as S;
	}
	return schema;
};

/**
 * Throw if any {@link serverOnly} field is present on `value` (own key).
 * Object validation otherwise strips unknown keys, so this is what stops
 * wire callers from smuggling server-only values.
 */
export const rejectServerOnly = (
	schema: unknown,
	value: unknown,
	path = "input",
): void => {
	if (value === null || value === undefined) return;
	const root = isVar(schema)
		? ((schema as { schema?: unknown }).schema ?? {})
		: schema;
	const def = asType(root);
	if (def.name === "object" && def.shape !== undefined) {
		if (typeOf(value) !== "object") return;
		const record = value as Record<string, unknown>;
		for (const [key, child] of Object.entries(
			def.shape as Record<string, unknown>,
		)) {
			if (isServerOnly(child) && Object.hasOwn(record, key)) {
				throw new ValidationError(
					`${path}.${key}`,
					"server-only field is not allowed over the wire",
				);
			}
			if (Object.hasOwn(record, key)) {
				rejectServerOnly(child, record[key], `${path}.${key}`);
			}
		}
		return;
	}
	if (def.name === "array" && def.shape !== undefined && Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			rejectServerOnly(def.shape, value[i], `${path}[${i}]`);
		}
		return;
	}
	if (def.name === "union" && Array.isArray(def.shape)) {
		for (const option of def.shape as unknown[]) {
			rejectServerOnly(option, value, path);
		}
	}
};

/**
 * Wire-side input gate: reject smuggled server-only keys, then validate
 * against {@link clientSchema}.
 */
export const wireInput = <S>(
	schema: S,
	value: unknown,
	path = "input",
): unknown => {
	rejectServerOnly(schema, value, path);
	return validate(asType(clientSchema(schema)), value, path);
};

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
