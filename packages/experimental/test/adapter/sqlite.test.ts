import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src";
import {
	ddl,
	generateColumn,
	generateTable,
	runMap,
	sqliteTypes,
} from "./index";

describe("sqlite type generation", () => {
	describe("runMap", () => {
		it("maps string → varchar(255)", () => {
			expect(runMap({ type: "string" })).toBe("varchar(255)");
		});

		it("appends UNIQUE when unique is set", () => {
			expect(runMap({ type: "string", unique: true })).toBe(
				"varchar(255) UNIQUE",
			);
		});

		it("maps number → int(16)", () => {
			expect(runMap({ type: "number" })).toBe("int(16)");
		});

		it("maps number + bigint → bigint", () => {
			expect(runMap({ type: "number", bigint: true })).toBe("bigint");
		});

		it("maps number + bigint + unique", () => {
			expect(runMap({ type: "number", bigint: true, unique: true })).toBe(
				"bigint UNIQUE",
			);
		});

		it("maps boolean → integer", () => {
			expect(runMap({ type: "boolean" })).toBe("integer");
		});

		it("maps json → text", () => {
			expect(runMap({ type: "json" })).toBe("text");
		});

		it("defaults type to string when omitted", () => {
			expect(runMap({})).toBe("varchar(255)");
		});

		it("returns null for unmapped types", () => {
			expect(runMap({ type: "uuid" })).toBeNull();
		});

		it("rejects invalid input", () => {
			expect(() => runMap({ type: 1 } as never)).toThrow(ValidationError);
		});
	});

	describe("sqlite mappers", () => {
		it("string mapper ignores non-strings", () => {
			expect(sqliteTypes.mapSqliteString({ type: "number" })).toBeNull();
		});

		it("number mapper ignores non-numbers", () => {
			expect(sqliteTypes.mapSqliteNumber({ type: "string" })).toBeNull();
		});
	});

	describe("generateColumn", () => {
		it("names a mapped field", () => {
			expect(
				generateColumn({
					name: "email",
					field: { type: "string", unique: true },
				}),
			).toBe("email varchar(255) UNIQUE");
		});

		it("returns null when no mapper matches", () => {
			expect(
				generateColumn({ name: "meta", field: { type: "uuid" } }),
			).toBeNull();
		});
	});

	describe("generateTable", () => {
		it("builds CREATE TABLE from many fields", () => {
			expect(
				generateTable({
					name: "user",
					fields: {
						id: { type: "string", unique: true },
						age: { type: "number" },
						balance: { type: "number", bigint: true },
					},
				}),
			).toBe(
				"CREATE TABLE user (id varchar(255) UNIQUE, age int(16), balance bigint)",
			);
		});

		it("throws when a field has no mapper", () => {
			expect(() =>
				generateTable({
					name: "doc",
					fields: {
						id: { type: "string" },
						payload: { type: "uuid" },
					},
				}),
			).toThrow(/no type mapper for field "payload"/);
		});

		it("is available through ddl", () => {
			const migrate = ddl.fn("test.migrate", (c) =>
				c.use.generateTable({
					name: "session",
					fields: {
						id: { type: "string", unique: true },
						userId: { type: "string" },
					},
				}),
			);
			expect(migrate()).toBe(
				"CREATE TABLE session (id varchar(255) UNIQUE, userId varchar(255))",
			);
		});
	});
});
