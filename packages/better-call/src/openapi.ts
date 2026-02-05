import { ZodObject, ZodOptional, ZodType } from "zod";
import type { Endpoint, EndpointOptions } from "./endpoint";

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
		type: OpenAPISchemaType;
		format?: string;
		items?: {
			type: OpenAPISchemaType;
		};
		enum?: string[];
		minLength?: number;
		description?: string;
		default?: string;
		example?: string;
	};
}

export interface Path {
	get?: {
		tags?: string[];
		operationId?: string;
		description?: string;
		security?: [{ bearerAuth: string[] }];
		parameters?: OpenAPIParameter[];
		responses?: {
			[key in string]: {
				description?: string;
				content: {
					"application/json": {
						schema: {
							type?: OpenAPISchemaType;
							properties?: Record<string, any>;
							required?: string[];
							$ref?: string;
						};
					};
				};
			};
		};
	};
	post?: {
		tags?: string[];
		operationId?: string;
		description?: string;
		security?: [{ bearerAuth: string[] }];
		parameters?: OpenAPIParameter[];
		requestBody?: {
			content: {
				"application/json": {
					schema: {
						type?: OpenAPISchemaType;
						properties?: Record<string, any>;
						required?: string[];
						$ref?: string;
					};
				};
			};
		};
		responses?: {
			[key in string]: {
				description?: string;
				content: {
					"application/json": {
						schema: {
							type?: OpenAPISchemaType;
							properties?: Record<string, any>;
							required?: string[];
							$ref?: string;
						};
					};
				};
			};
		};
	};
}
const paths: Record<string, Path> = {};

function getTypeFromZodType(zodType: ZodType<any>) {
	switch (zodType.constructor.name) {
		case "ZodString":
			return "string";
		case "ZodNumber":
			return "number";
		case "ZodBoolean":
			return "boolean";
		case "ZodObject":
			return "object";
		case "ZodArray":
			return "array";
		default:
			return "string";
	}
}

function getParameters(options: EndpointOptions) {
	const parameters: OpenAPIParameter[] = [];
	if (options.metadata?.openapi?.parameters) {
		parameters.push(...options.metadata.openapi.parameters);
		return parameters;
	}
	if (options.query instanceof ZodObject) {
		Object.entries(options.query.shape).forEach(([key, value]) => {
			if (value instanceof ZodObject) {
				parameters.push({
					name: key,
					in: "query",
					schema: {
						type: getTypeFromZodType(value),
						...("minLength" in value && value.minLength
							? {
									minLength: value.minLength as number,
								}
							: {}),
						description: value.description,
					},
				});
			}
		});
	}
	return parameters;
}

function getRequestBody(options: EndpointOptions): any {
	if (options.metadata?.openapi?.requestBody) {
		return options.metadata.openapi.requestBody;
	}
	if (!options.body) return undefined;
	if (
		options.body instanceof ZodObject ||
		options.body instanceof ZodOptional
	) {
		// @ts-ignore
		const shape = options.body.shape;
		if (!shape) return undefined;
		const properties: Record<string, any> = {};
		const required: string[] = [];
		Object.entries(shape).forEach(([key, value]) => {
			if (value instanceof ZodObject) {
				properties[key] = {
					type: getTypeFromZodType(value),
					description: value.description,
				};
				if (!(value instanceof ZodOptional)) {
					required.push(key);
				}
			}
		});
		return {
			required:
				options.body instanceof ZodOptional
					? false
					: options.body
						? true
						: false,
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties,
						required,
					},
				},
			},
		};
	}
	return undefined;
}

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
	} as any;
}

export async function generator(
	endpoints: Record<string, Endpoint>,
	config?: {
		url: string;
	},
) {
	const components = {
		schemas: {},
	};

	Object.entries(endpoints).forEach(([_, value]) => {
		const options = value.options as EndpointOptions;
		if (!value.path || options.metadata?.SERVER_ONLY) return;
		if (options.method === "GET") {
			paths[value.path] = {
				get: {
					tags: ["Default", ...(options.metadata?.openapi?.tags || [])],
					description: options.metadata?.openapi?.description,
					operationId: options.metadata?.openapi?.operationId,
					security: [
						{
							bearerAuth: [],
						},
					],
					parameters: getParameters(options),
					responses: getResponse(options.metadata?.openapi?.responses),
				},
			};
		}

		if (options.method === "POST") {
			const body = getRequestBody(options);
			paths[value.path] = {
				post: {
					tags: ["Default", ...(options.metadata?.openapi?.tags || [])],
					description: options.metadata?.openapi?.description,
					operationId: options.metadata?.openapi?.operationId,
					security: [
						{
							bearerAuth: [],
						},
					],
					parameters: getParameters(options),
					...(body
						? { requestBody: body }
						: {
								requestBody: {
									//set body none
									content: {
										"application/json": {
											schema: {
												type: "object",
												properties: {},
											},
										},
									},
								},
							}),
					responses: getResponse(options.metadata?.openapi?.responses),
				},
			};
		}
	});

	const res = {
		openapi: "3.1.1",
		info: {
			title: "Better Auth",
			description: "API Reference for your Better Auth Instance",
			version: "1.1.0",
		},
		components,
		security: [
			{
				apiKeyCookie: [],
			},
		],
		servers: [
			{
				url: config?.url,
			},
		],
		tags: [
			{
				name: "Default",
				description:
					"Default endpoints that are included with Better Auth by default. These endpoints are not part of any plugin.",
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
) => `<!doctype html>
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
      var configuration = {
	  	favicon: ${config?.logo ? `data:image/svg+xml;utf8,${encodeURIComponent(config.logo)}` : undefined} ,
	   	theme: ${config?.theme || "saturn"},
        metaData: {
			title: ${config?.title || "Open API Reference"},
			description: ${config?.description || "Better Call Open API"},
		}
      }
      document.getElementById('api-reference').dataset.configuration =
        JSON.stringify(configuration)
    </script>
	  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
