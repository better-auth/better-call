import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { APIError } from "./error";

describe("APIError", () => {
	it("should throw correct stack", () => {
		const error = new APIError("INTERNAL_SERVER_ERROR", {
			message: "Test error",
		});
		expect(error.stack).toMatchInlineSnapshot(`"APIError: Test error"`);

		function testError() {
			throw new APIError("INTERNAL_SERVER_ERROR", {
				message: "Test error in function",
			});
		}

		function deepTestError() {
			testError();
		}

		expect(() => deepTestError()).toThrowErrorMatchingInlineSnapshot(
			`[APIError: Test error in function]`,
		);

		try {
			deepTestError();
		} catch (e: unknown) {
			const loggedString = inspect(e, {
				depth: Number.MAX_SAFE_INTEGER,
			});
			expect(loggedString).toMatchInlineSnapshot(`
				"[InternalAPIError: Test error in function] {
				  status: 'INTERNAL_SERVER_ERROR',
				  body: { message: 'Test error in function' },
				  headers: {},
				  statusCode: 500
				}"
			`);
			const stack = (e as InstanceType<typeof APIError>).errorStack;
			expect(stack).toMatch(
				new RegExp(
					"APIError:\\s*\\n" +
						"\\s+at testError \\(.*/error\\.test\\.ts:\\d+:\\d+\\)\\n" +
						"\\s+at deepTestError \\(.*/error\\.test\\.ts:\\d+:\\d+\\)",
					"s",
				),
			);
		}
	});

	it("should keep the cause readable but not serializable", () => {
		const cause = new Error("Connection timeout");
		const error = new APIError("INTERNAL_SERVER_ERROR", {
			message: "Failed to get session",
			code: "FAILED_TO_GET_SESSION",
			cause,
		});
		expect(error.cause).toBe(cause);
		expect(error.body?.cause).toBe(cause);
		expect(JSON.parse(JSON.stringify(error.body))).toEqual({
			message: "Failed to get session",
			code: "FAILED_TO_GET_SESSION",
		});
	});
});
