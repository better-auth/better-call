/** The Standard Schema interface. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	/** The Standard Schema properties. */
	readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
	/** The Standard Schema properties interface. */
	export interface Props<Input = unknown, Output = Input> {
		/** The version number of the standard. */
		readonly version: 1;
		/** The vendor name of the schema library. */
		readonly vendor: string;
		/** Validates unknown input values. */
		readonly validate: (
			value: unknown,
		) => Result<Output> | Promise<Result<Output>>;
		/** Inferred types associated with the schema. */
		readonly types?: Types<Input, Output> | undefined;
		/**
		 * Optional JSON Schema conversion, per the StandardJSONSchemaV1 proposal
		 * (https://standardschema.dev/json-schema). Natively implemented by Zod
		 * (>= 4.2), ArkType (>= 2.1.28), and others. Consumed by the OpenAPI
		 * generator to describe request bodies and query parameters in a
		 * library-agnostic way.
		 */
		readonly jsonSchema?: JSONSchemaConverter | undefined;
	}

	/** Options accepted by the JSON Schema conversion methods. */
	export interface JSONSchemaOptions {
		/**
		 * Target JSON Schema dialect. OpenAPI 3.1 aligns with `"draft-2020-12"`.
		 */
		readonly target?:
			| "draft-2020-12"
			| "draft-07"
			| "openapi-3.0"
			| (string & {});
		readonly [key: string]: unknown;
	}

	/** The JSON Schema conversion interface exposed on `~standard.jsonSchema`. */
	export interface JSONSchemaConverter {
		/** JSON Schema describing accepted input values. */
		readonly input?: (options?: JSONSchemaOptions) => Record<string, unknown>;
		/** JSON Schema describing produced output values. */
		readonly output?: (options?: JSONSchemaOptions) => Record<string, unknown>;
	}

	/** The result interface of the validate function. */
	export type Result<Output> = SuccessResult<Output> | FailureResult;

	/** The result interface if validation succeeds. */
	export interface SuccessResult<Output> {
		/** The typed output value. */
		readonly value: Output;
		/** The non-existent issues. */
		readonly issues?: undefined;
	}

	/** The result interface if validation fails. */
	export interface FailureResult {
		/** The issues of failed validation. */
		readonly issues: ReadonlyArray<Issue>;
	}

	/** The issue interface of the failure output. */
	export interface Issue {
		/** The error message of the issue. */
		readonly message: string;
		/** The path of the issue, if any. */
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	/** The path segment interface of the issue. */
	export interface PathSegment {
		/** The key representing a path segment. */
		readonly key: PropertyKey;
	}

	/** The Standard Schema types interface. */
	export interface Types<Input = unknown, Output = Input> {
		/** The input type of the schema. */
		readonly input: Input;
		/** The output type of the schema. */
		readonly output: Output;
	}

	/** Infers the input type of a Standard Schema. */
	export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
		Schema["~standard"]["types"]
	>["input"];

	/** Infers the output type of a Standard Schema. */
	export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
		Schema["~standard"]["types"]
	>["output"];
}
