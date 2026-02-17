import type { StandardSchemaV1 } from "./standard-schema";

type ValidationResponse =
	| {
			data: {
				body: any;
				query: any;
			};
			error: null;
	  }
	| {
			data: null;
			error: {
				message: string;
				issues: readonly StandardSchemaV1.Issue[];
			};
	  };

/**
 * Runs validation on body and query
 * @returns error and data object
 */
export async function runValidation(
	options: {
		body?: StandardSchemaV1;
		query?: StandardSchemaV1;
		requireHeaders?: boolean;
		requireRequest?: boolean;
	},
	context: Record<string, any> = {},
): Promise<ValidationResponse> {
	const request = {
		body: context.body,
		query: context.query,
	} as {
		body: any;
		query: any;
	};
	if (options.body) {
		const result = await options.body["~standard"].validate(context.body);
		if (result.issues) {
			return {
				data: null,
				error: fromError(result.issues, "body"),
			};
		}
		request.body = result.value;
	}

	if (options.query) {
		const result = await options.query["~standard"].validate(context.query);
		if (result.issues) {
			return {
				data: null,
				error: fromError(result.issues, "query"),
			};
		}
		request.query = result.value;
	}
	if (options.requireHeaders && !context.headers) {
		return {
			data: null,
			error: { message: "Headers is required", issues: [] },
		};
	}
	if (options.requireRequest && !context.request) {
		return {
			data: null,
			error: { message: "Request is required", issues: [] },
		};
	}
	return {
		data: request,
		error: null,
	};
}

function fromError(
	error: readonly StandardSchemaV1.Issue[],
	validating: string,
) {
	const message = error
		.map((e) => {
			return `[${e.path?.length ? `${validating}.` + e.path.map((x) => (typeof x === "object" ? x.key : x)).join(".") : validating}] ${e.message}`;
		})
		.join("; ");

	return {
		message,
		issues: error,
	};
}
