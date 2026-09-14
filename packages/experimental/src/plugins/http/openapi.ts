import { asType, type TypeDefination } from "../../schema";
import { statusOf } from "./error";
import {
	collectRoutes,
	type CollectedRoute,
	type Router,
} from "./router";

export type OpenAPISchemaObject = {
	type?: string | string[];
	format?: string;
	properties?: Record<string, OpenAPISchemaObject>;
	items?: OpenAPISchemaObject;
	required?: string[];
	enum?: unknown[];
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
	pattern?: string;
	nullable?: boolean;
	anyOf?: OpenAPISchemaObject[];
	additionalProperties?: boolean | OpenAPISchemaObject;
	description?: string;
};

export type OpenAPIParameter = {
	name: string;
	in: "path" | "query" | "header" | "cookie";
	required?: boolean;
	description?: string;
	schema?: OpenAPISchemaObject;
};

export type OpenAPIRequestBody = {
	required?: boolean;
	content: Record<string, { schema?: OpenAPISchemaObject }>;
};

export type OpenAPIResponse = {
	description: string;
	content?: Record<string, { schema?: OpenAPISchemaObject }>;
};

export type OpenAPIOperation = {
	operationId?: string;
	summary?: string;
	description?: string;
	tags?: string[];
	deprecated?: boolean;
	parameters?: OpenAPIParameter[];
	requestBody?: OpenAPIRequestBody;
	responses: Record<string, OpenAPIResponse>;
};

export type OpenAPIPathItem = Partial<
	Record<
		"get" | "post" | "put" | "patch" | "delete" | "head" | "options",
		OpenAPIOperation
	>
>;

export type OpenAPIDocument = {
	openapi: "3.1.0";
	info: {
		title: string;
		version: string;
		description?: string;
	};
	servers?: { url: string; description?: string }[];
	tags?: { name: string; description?: string }[];
	paths: Record<string, OpenAPIPathItem>;
};

export type ToOpenAPIOptions = {
	info?: {
		title?: string;
		version?: string;
		description?: string;
	};
	servers?: { url: string; description?: string }[];
	/** Prepended to every path (e.g. router `basePath`). */
	basePath?: string;
};

const PATH_PARAM = /:([A-Za-z0-9_]+)/g;

/** Express `:id` → OpenAPI `{id}`. */
export const toOpenAPIPath = (path: string): string =>
	path.replace(PATH_PARAM, "{$1}");

export const pathParamNames = (path: string): string[] =>
	[...path.matchAll(PATH_PARAM)].map((m) => m[1]!).filter(Boolean);

type RulesLike = {
	min?: number;
	max?: number;
	length?: number;
	regex?: RegExp;
	email?: boolean;
	url?: boolean;
	int?: boolean;
	enum?: readonly unknown[];
	optional?: boolean;
	default?: unknown;
	shape?: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

/** Convert a vida / bare-object schema into a JSON Schema fragment. */
export function schemaToOpenAPI(
	schema: unknown,
): OpenAPISchemaObject | undefined {
	if (schema === undefined || schema === null) return undefined;
	return typeDefToOpenAPI(asType(schema) as TypeDefination<any, any> & RulesLike);
}

function typeDefToOpenAPI(
	def: TypeDefination<any, any> & RulesLike,
): OpenAPISchemaObject {
	const out: OpenAPISchemaObject = {};

	switch (def.name) {
		case "string":
			out.type = "string";
			if (def.email) out.format = "email";
			if (def.url) out.format = "uri";
			if (def.min !== undefined) out.minLength = def.min;
			if (def.max !== undefined) out.maxLength = def.max;
			if (def.length !== undefined) {
				out.minLength = def.length;
				out.maxLength = def.length;
			}
			if (def.regex) out.pattern = def.regex.source;
			break;
		case "number":
			out.type = def.int ? "integer" : "number";
			if (def.min !== undefined) out.minimum = def.min;
			if (def.max !== undefined) out.maximum = def.max;
			break;
		case "boolean":
			out.type = "boolean";
			break;
		case "date":
			out.type = "string";
			out.format = "date-time";
			break;
		case "any":
			break;
		case "null":
			out.type = "null";
			break;
		case "array": {
			out.type = "array";
			if (def.shape !== undefined) {
				const items = schemaToOpenAPI(def.shape);
				if (items) out.items = items;
			}
			if (def.min !== undefined) out.minItems = def.min;
			if (def.max !== undefined) out.maxItems = def.max;
			break;
		}
		case "object": {
			out.type = "object";
			const shape = (def.shape ?? {}) as Record<string, unknown>;
			const properties: Record<string, OpenAPISchemaObject> = {};
			const required: string[] = [];
			for (const [key, field] of Object.entries(shape)) {
				const fieldSchema = schemaToOpenAPI(field);
				if (!fieldSchema) continue;
				properties[key] = fieldSchema;
				const fieldDef = asType(field) as TypeDefination<any, any> & RulesLike;
				if (!fieldDef.optional && fieldDef.default === undefined) {
					required.push(key);
				}
			}
			if (Object.keys(properties).length > 0) out.properties = properties;
			if (required.length > 0) out.required = required;
			break;
		}
		case "union": {
			const members = Array.isArray(def.shape) ? def.shape : [];
			const anyOf = members
				.map((m) => schemaToOpenAPI(m))
				.filter((m): m is OpenAPISchemaObject => !!m);
			if (anyOf.length > 0) out.anyOf = anyOf;
			break;
		}
		default: {
			if (isPlainObject(def.shape)) {
				return typeDefToOpenAPI({
					...def,
					name: "object",
					shape: def.shape,
				} as TypeDefination<any, any> & RulesLike);
			}
		}
	}

	if (def.enum) out.enum = [...def.enum];
	return out;
}

const objectProps = (
	schema: unknown,
): {
	properties: Record<string, OpenAPISchemaObject>;
	required: string[];
} => {
	const converted = schemaToOpenAPI(schema);
	return {
		properties: converted?.properties ?? {},
		required: converted?.required ?? [],
	};
};

const errorResponseSchema = (
	tag: string,
	decl: unknown,
): OpenAPISchemaObject => {
	const dataSchema =
		schemaToOpenAPI(isPlainObject(decl) ? decl : {}) ?? { type: "object" };
	const status = statusOf(decl);
	return {
		type: "object",
		required: ["name", "tag", "data", "trail"],
		properties: {
			name: { type: "string", enum: ["FnError"] },
			tag: { type: "string", enum: [tag] },
			data: dataSchema,
			trail: { type: "array", items: { type: "string" } },
			status:
				status !== undefined
					? { type: "integer", enum: [status] }
					: { type: "integer" },
			message: { type: "string" },
			originalMessage: { type: "string" },
		},
	};
};

const joinBasePath = (basePath: string | undefined, path: string): string => {
	const base = (basePath ?? "").replace(/\/$/, "");
	if (!base) return path.startsWith("/") ? path : `/${path}`;
	const suffix = path.startsWith("/") ? path : `/${path}`;
	return `${base}${suffix}` || "/";
};

type RouteSource = Router | CollectedRoute[] | Record<string, unknown>;

const resolveRoutes = (
	source: RouteSource,
	basePath?: string,
): { routes: CollectedRoute[]; basePath?: string } => {
	if (Array.isArray(source)) return { routes: source, basePath };
	if (typeof source === "function" && "routes" in source) {
		const router = source as Router;
		return {
			routes: router.routes,
			basePath: basePath ?? (router as { basePath?: string }).basePath,
		};
	}
	return {
		routes: collectRoutes(source as Record<string, unknown>),
		basePath,
	};
};

/**
 * Build an OpenAPI 3.1 document from routed fns.
 *
 * - `operationId` ← `fn.key`
 * - `summary` / `description` / `tags` / `deprecated` ← `fn.$schema`
 * - path params ← `:name` segments; remaining input → query (GET/HEAD) or body
 * - success status ← `route({ status })` or 200
 * - error responses ← `errors` + `http.err` status / data schemas
 */
export function toOpenAPI(
	source: RouteSource,
	options?: ToOpenAPIOptions,
): OpenAPIDocument {
	const { routes, basePath } = resolveRoutes(source, options?.basePath);
	const paths: Record<string, OpenAPIPathItem> = {};
	const tagSet = new Set<string>();

	for (const entry of routes) {
		const schema = entry.schema ?? entry.fn.$schema;
		const method = entry.method.toLowerCase() as keyof OpenAPIPathItem;
		const openapiPath = toOpenAPIPath(
			joinBasePath(basePath ?? options?.basePath, entry.path),
		);
		const pathNames = new Set(pathParamNames(entry.path));
		const { properties, required } = objectProps(schema?.input);
		const parameters: OpenAPIParameter[] = [];

		for (const name of pathNames) {
			parameters.push({
				name,
				in: "path",
				required: true,
				schema: properties[name] ?? { type: "string" },
			});
		}

		const bodyProps: Record<string, OpenAPISchemaObject> = {};
		const bodyRequired: string[] = [];
		const isQueryMethod = entry.method === "GET" || entry.method === "HEAD";

		for (const [name, prop] of Object.entries(properties)) {
			if (pathNames.has(name)) continue;
			if (isQueryMethod) {
				parameters.push({
					name,
					in: "query",
					required: required.includes(name),
					schema: prop,
				});
			} else {
				bodyProps[name] = prop;
				if (required.includes(name)) bodyRequired.push(name);
			}
		}

		const successStatus = String(entry.status ?? 200);
		const responses: Record<string, OpenAPIResponse> = {
			[successStatus]: {
				description: "Success",
				...(schema?.output !== undefined
					? {
							content: {
								"application/json": {
									schema: schemaToOpenAPI(schema.output) ?? {},
								},
							},
						}
					: {}),
			},
		};

		const errors = (schema?.errors ?? {}) as Record<string, unknown>;
		for (const [tag, decl] of Object.entries(errors)) {
			const status = String(statusOf(decl) ?? 422);
			responses[status] = {
				description: tag,
				content: {
					"application/json": {
						schema: errorResponseSchema(tag, decl),
					},
				},
			};
		}

		const operation: OpenAPIOperation = {
			operationId: entry.key ?? entry.fn.key,
			responses,
		};
		if (schema?.summary) operation.summary = schema.summary;
		if (schema?.description) operation.description = schema.description;
		if (schema?.tags?.length) {
			operation.tags = [...schema.tags];
			for (const t of schema.tags) tagSet.add(t);
		}
		if (schema?.deprecated) operation.deprecated = true;
		if (parameters.length > 0) operation.parameters = parameters;
		if (!isQueryMethod && Object.keys(bodyProps).length > 0) {
			operation.requestBody = {
				required: bodyRequired.length > 0,
				content: {
					"application/json": {
						schema: {
							type: "object",
							properties: bodyProps,
							...(bodyRequired.length > 0 ? { required: bodyRequired } : {}),
						},
					},
				},
			};
		}

		const item = paths[openapiPath] ?? {};
		item[method] = operation;
		paths[openapiPath] = item;
	}

	return {
		openapi: "3.1.0",
		info: {
			title: options?.info?.title ?? "API",
			version: options?.info?.version ?? "1.0.0",
			...(options?.info?.description
				? { description: options.info.description }
				: {}),
		},
		...(options?.servers ? { servers: options.servers } : {}),
		...(tagSet.size > 0
			? { tags: [...tagSet].map((name) => ({ name })) }
			: {}),
		paths,
	};
}

/* --------------------------------- Scalar --------------------------------- */

export type ScalarOptions = {
	/** Document `<title>` / Scalar page title. */
	title?: string;
	/** Meta description. */
	description?: string;
	/** Scalar theme id (e.g. `"saturn"`, `"purple"`, `"kepler"`). */
	theme?: string;
	/** Favicon URL or data URI. */
	favicon?: string;
	/** CDN script URL for `@scalar/api-reference`. */
	cdn?: string;
	/**
	 * Serve the OpenAPI document from this URL instead of inlining it.
	 * Useful when the JSON is already mounted (see router `openapi.jsonPath`).
	 */
	url?: string;
	/** Extra Scalar `createApiReference` options (merged in). */
	configuration?: Record<string, unknown>;
};

const DEFAULT_SCALAR_CDN =
	"https://cdn.jsdelivr.net/npm/@scalar/api-reference";

/** Escape a JSON payload for safe embedding inside a `<script>` tag. */
const jsonForScript = (value: unknown): string =>
	JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * Render a Scalar API Reference HTML page for an OpenAPI document.
 *
 * Uses the CDN standalone build (`Scalar.createApiReference`) with the
 * document inlined as `content`, unless {@link ScalarOptions.url} is set.
 */
export function getScalarHTML(
	document: OpenAPIDocument | Record<string, unknown>,
	options?: ScalarOptions,
): string {
	const info =
		document && typeof document === "object" && "info" in document
			? (document as OpenAPIDocument).info
			: undefined;
	const title = options?.title ?? info?.title ?? "API Reference";
	const description =
		options?.description ?? info?.description ?? "OpenAPI Reference";
	const theme = options?.theme ?? "saturn";
	const cdn = options?.cdn ?? DEFAULT_SCALAR_CDN;

	const config: Record<string, unknown> = {
		theme,
		...(options?.favicon ? { favicon: options.favicon } : {}),
		...(options?.configuration ?? {}),
	};
	if (options?.url) {
		config.url = options.url;
	} else {
		config.content = document;
	}

	return `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(title)}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(description)}" />
  </head>
  <body>
    <div id="app"></div>
    <script src="${escapeHtml(cdn)}"></script>
    <script>
      Scalar.createApiReference("#app", ${jsonForScript(config)});
    </script>
  </body>
</html>`;
}

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

/**
 * Build an OpenAPI document from routes / a router, then render Scalar HTML.
 */
export function scalarHTML(
	source: Router | CollectedRoute[] | Record<string, unknown>,
	options?: ToOpenAPIOptions & { scalar?: ScalarOptions },
): string {
	const { scalar, ...openAPIOptions } = options ?? {};
	return getScalarHTML(toOpenAPI(source, openAPIOptions), scalar);
}
