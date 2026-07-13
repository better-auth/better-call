import type { Endpoint, EndpointRuntimeOptions } from "./endpoint";
import type { StandardSchemaV1 } from "./standard-schema";

export type OpenAPISchemaType =
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "array"
	| "object";

export interface OpenAPIParameter {
	in: "query" | "path" | "header" | "cookie";
	name?: string;
	description?: string;
	required?: boolean;
	schema?: {
		type?: OpenAPISchemaType;
		format?: string | undefined;
		items?: {
			type: OpenAPISchemaType;
		};
		enum?: string[];
		minLength?: number;
		description?: string | undefined;
		default?: string | undefined;
		example?: string | undefined;
		[key: string]: any;
	};
}

/**
 * An OpenAPI Security Requirement Object. Maps a declared security scheme name
 * to the list of scopes required (empty for non-oauth schemes).
 */
export type OpenAPISecurityRequirement = Record<string, string[]>;

/**
 * An OpenAPI Security Scheme Object. `type` is one of the spec's canonical
 * values; the remaining fields depend on the type (`scheme`, `bearerFormat`,
 * `in`, `name`, `flows`, `openIdConnectUrl`, ...).
 */
export interface OpenAPISecurityScheme {
	type: "apiKey" | "http" | "oauth2" | "openIdConnect" | "mutualTLS";
	description?: string;
	[key: string]: any;
}

/**
 * Configuration for {@link generator}. Everything here is author-supplied — the
 * generator infers paths/operations from the endpoints but never fabricates
 * document-level metadata such as auth or server URLs.
 */
export interface OpenAPIGeneratorConfig {
	/**
	 * Convenience shortcut for a single server URL. Ignored when `servers` is set.
	 */
	url?: string;
	/**
	 * OpenAPI Info Object. Merged over the defaults
	 * (`{ title: "API Reference", version: "1.0.0" }`).
	 */
	info?: {
		title?: string;
		description?: string;
		version?: string;
		[key: string]: any;
	};
	/**
	 * OpenAPI Server Objects.
	 */
	servers?: { url: string; description?: string; [key: string]: any }[];
	/**
	 * Document-level security requirements. Applied to every operation unless a
	 * per-endpoint `metadata.openapi.security` overrides it. Omitted by default —
	 * better-call is auth-agnostic and asserts no scheme on its own.
	 */
	security?: OpenAPISecurityRequirement[];
	/**
	 * Named security schemes exposed under `components.securitySchemes`.
	 */
	securitySchemes?: Record<string, OpenAPISecurityScheme>;
}

interface Operation {
	tags?: string[];
	summary?: string;
	operationId?: string;
	description?: string;
	security?: OpenAPISecurityRequirement[];
	parameters?: OpenAPIParameter[];
	requestBody?: {
		required?: boolean;
		content: {
			"application/json": {
				schema: Record<string, any>;
			};
		};
	};
	responses?: Record<string, any>;
}

type Path = Partial<Record<Lowercase<HTTPVerb>, Operation>>;

type HTTPVerb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// HTTP methods that render as OpenAPI operations. HEAD/OPTIONS and the "*"
// wildcard are intentionally skipped — see the README limitations note.
const DOCUMENTED_METHODS = new Set<string>([
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
]);

// Methods that may carry a request body (mirrors the endpoint runtime guard,
// which only forbids bodies on GET/HEAD).
const BODY_METHODS = new Set<string>(["POST", "PUT", "PATCH", "DELETE"]);

const PATH_PARAM_REGEX = /:([A-Za-z0-9_]+)/g;

/**
 * Convert a Standard Schema to a JSON Schema object using the library-agnostic
 * StandardJSONSchemaV1 interface (`schema["~standard"].jsonSchema`), natively
 * implemented by Zod (>= 4.2), ArkType (>= 2.1.28), and others.
 *
 * Returns `undefined` when the schema doesn't implement the interface (e.g.
 * Valibot without its adapter, or an older Zod) so callers can fall back.
 */
function toJsonSchema(
	schema: StandardSchemaV1 | undefined,
	io: "input" | "output",
): Record<string, any> | undefined {
	const converter = schema?.["~standard"]?.jsonSchema;
	if (!converter) return undefined;
	try {
		const fn = io === "input" ? converter.input : converter.output;
		const produce = fn ?? converter.output ?? converter.input;
		const result = produce?.({ target: "draft-2020-12" });
		if (!result || typeof result !== "object") return undefined;
		// `$schema` is a JSON-Schema document keyword; strip it so the fragment
		// embeds cleanly inside an OpenAPI Schema Object.
		const { $schema, ...rest } = result as Record<string, any>;
		return rest;
	} catch {
		return undefined;
	}
}

function getParameters(
	options: EndpointRuntimeOptions,
	path: string,
): OpenAPIParameter[] {
	const parameters: OpenAPIParameter[] = [];

	// Path parameters, derived from the route pattern (`/x/:id` -> `id`).
	for (const match of path.matchAll(PATH_PARAM_REGEX)) {
		parameters.push({
			name: match[1],
			in: "path",
			required: true,
			schema: { type: "string" },
		});
	}

	// Query parameters, one per top-level field of the query schema.
	const query = toJsonSchema(options.query, "input");
	if (query?.properties && typeof query.properties === "object") {
		const required = new Set<string>(
			Array.isArray(query.required) ? query.required : [],
		);
		for (const [name, prop] of Object.entries(
			query.properties as Record<string, any>,
		)) {
			parameters.push({
				name,
				in: "query",
				required: required.has(name),
				description: prop?.description,
				schema: prop,
			});
		}
	}

	// Author-supplied parameters are appended, never replaced.
	if (options.metadata?.openapi?.parameters) {
		parameters.push(...options.metadata.openapi.parameters);
	}

	return parameters;
}

function getRequestBody(
	options: EndpointRuntimeOptions,
): Operation["requestBody"] | undefined {
	if (options.metadata?.openapi?.requestBody) {
		return options.metadata.openapi.requestBody;
	}
	if (!options.body) return undefined;
	const schema = toJsonSchema(options.body, "input");
	if (!schema) return undefined;
	return {
		required: true,
		content: {
			"application/json": {
				schema,
			},
		},
	};
}

const EMPTY_REQUEST_BODY = {
	content: {
		"application/json": {
			schema: {
				type: "object" as const,
				properties: {},
			},
		},
	},
};

function getResponse(responses?: Record<string, any>) {
	return {
		"400": {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							message: {
								type: "string",
							},
						},
						required: ["message"],
					},
				},
			},
			description:
				"Bad Request. Usually due to missing parameters, or invalid parameters.",
		},
		"401": {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							message: {
								type: "string",
							},
						},
						required: ["message"],
					},
				},
			},
			description: "Unauthorized. Due to missing or invalid authentication.",
		},
		"403": {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							message: {
								type: "string",
							},
						},
					},
				},
			},
			description:
				"Forbidden. You do not have permission to access this resource or to perform this action.",
		},
		"404": {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							message: {
								type: "string",
							},
						},
					},
				},
			},
			description: "Not Found. The requested resource was not found.",
		},
		"429": {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							message: {
								type: "string",
							},
						},
					},
				},
			},
			description:
				"Too Many Requests. You have exceeded the rate limit. Try again later.",
		},
		"500": {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							message: {
								type: "string",
							},
						},
					},
				},
			},
			description:
				"Internal Server Error. This is a problem with the server that you cannot fix.",
		},
		...responses,
	} as Record<string, any>;
}

function buildOperation(
	options: EndpointRuntimeOptions,
	method: string,
	routePath: string,
): Operation {
	const openapi = options.metadata?.openapi;
	const operation: Operation = {
		tags: ["Default", ...(openapi?.tags || [])],
	};

	if (openapi?.summary) operation.summary = openapi.summary;
	if (openapi?.description) operation.description = openapi.description;
	if (openapi?.operationId) operation.operationId = openapi.operationId;
	// Only assert security when the endpoint explicitly declares it. Otherwise
	// the operation inherits the document-level `security` (if any).
	if (openapi?.security) operation.security = openapi.security;

	const parameters = getParameters(options, routePath);
	if (parameters.length) operation.parameters = parameters;

	if (BODY_METHODS.has(method)) {
		operation.requestBody = getRequestBody(options) ?? EMPTY_REQUEST_BODY;
	}

	operation.responses = getResponse(openapi?.responses);
	return operation;
}

export async function generator(
	endpoints: Record<string, Endpoint>,
	config?: OpenAPIGeneratorConfig,
) {
	// `paths` is local: a fresh document is produced per call, with no state
	// leaking across invocations.
	const paths: Record<string, Path> = {};

	Object.entries(endpoints).forEach(([_, value]) => {
		const options = value.options as EndpointRuntimeOptions;
		if (!value.path || options.metadata?.SERVER_ONLY) return;

		const methods = (
			Array.isArray(options.method) ? options.method : [options.method]
		)
			.map((m) => String(m).toUpperCase())
			.filter((m) => DOCUMENTED_METHODS.has(m));
		if (!methods.length) return;

		// Rewrite rou3-style `:param` segments to OpenAPI `{param}` templates.
		const openapiPath = value.path.replace(PATH_PARAM_REGEX, "{$1}");
		const pathItem = (paths[openapiPath] ??= {});

		for (const method of methods) {
			// Merge onto the path item instead of overwriting it, so a path with
			// multiple methods keeps every operation.
			pathItem[method.toLowerCase() as Lowercase<HTTPVerb>] = buildOperation(
				options,
				method,
				value.path,
			);
		}
	});

	const components: {
		schemas: Record<string, any>;
		securitySchemes?: Record<string, OpenAPISecurityScheme>;
	} = {
		schemas: {},
	};
	if (config?.securitySchemes) {
		components.securitySchemes = config.securitySchemes;
	}

	const servers = config?.servers ?? (config?.url ? [{ url: config.url }] : []);

	const res = {
		openapi: "3.1.1",
		info: {
			title: "API Reference",
			version: "1.0.0",
			...config?.info,
		},
		components,
		...(config?.security ? { security: config.security } : {}),
		servers,
		tags: [
			{
				name: "Default",
				description: "Endpoints that are not tagged with a specific tag.",
			},
		],
		paths,
	};
	return res;
}

export const getHTML = (
	apiReference: Record<string, any>,
	config?: {
		logo?: string;
		theme?: string;
		title?: string;
		description?: string;
	},
) => {
	const configuration = {
		...(config?.logo
			? {
					favicon: `data:image/svg+xml;utf8,${encodeURIComponent(config.logo)}`,
				}
			: {}),
		theme: config?.theme || "saturn",
		metaData: {
			title: config?.title || "Open API Reference",
			description: config?.description || "Better Call Open API",
		},
	};

	return `<!doctype html>
<html>
  <head>
    <title>Scalar API Reference</title>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      type="application/json">
    ${JSON.stringify(apiReference)}
    </script>
	 <script>
      var configuration = ${JSON.stringify(configuration)}
      document.getElementById('api-reference').dataset.configuration =
        JSON.stringify(configuration)
    </script>
	  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
};
