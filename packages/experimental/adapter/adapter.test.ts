import { describe, expect, it } from "vitest";
import { clauses, eq, fromDb, match, toDb, toDbWhere } from "./index";

const schema = {
	user: {
		table: "users",
		fields: {
			email: { type: "string" as const, column: "email_address" },
			active: { type: "boolean" as const },
			createdAt: { type: "date" as const },
			meta: { type: "json" as const },
		},
	},
};

describe("where", () => {
	const row = { email: "A@x", age: 20, role: "admin" };

	it("record form ANDs fields and unwraps operator maps", () => {
		expect(match(row, { age: { gte: 18 }, role: "admin" })).toBe(true);
		expect(match(row, { age: { lt: 18 } })).toBe(false);
		expect(clauses({ email: { contains: "@" } })).toEqual([
			{
				field: "email",
				value: "@",
				operator: "contains",
				connector: "AND",
				mode: "sensitive",
			},
		]);
	});

	it("AND binds tighter than OR", () => {
		const where = [
			eq("role", "admin"),
			{
				field: "age",
				value: 99,
				operator: "eq" as const,
				connector: "AND" as const,
			},
			{
				field: "email",
				value: "A@x",
				operator: "eq" as const,
				connector: "OR" as const,
			},
		];
		expect(match(row, where)).toBe(true);
	});

	it("string operators and in/not_in", () => {
		expect(
			match(row, [
				{
					field: "email",
					value: "a@x",
					operator: "contains",
					mode: "insensitive",
				},
			]),
		).toBe(true);
		expect(
			match(row, [
				{ field: "role", value: ["admin", "owner"], operator: "in" },
			]),
		).toBe(true);
		expect(
			match(row, [{ field: "role", value: ["x"], operator: "not_in" }]),
		).toBe(true);
	});
});

describe("map", () => {
	const codec = {
		date: "iso" as const,
		bool: "integer" as const,
		json: "stringify" as const,
	};
	const createdAt = new Date("2020-01-01T00:00:00.000Z");

	it("renames columns and encodes values", () => {
		const stored = toDb(
			schema,
			"user",
			{ id: "1", email: "a@x", active: true, createdAt, meta: { n: 1 } },
			codec,
		);
		expect(stored).toEqual({
			id: "1",
			email_address: "a@x",
			active: 1,
			createdAt: "2020-01-01T00:00:00.000Z",
			meta: JSON.stringify({ n: 1 }),
		});
		expect(fromDb(schema, "user", stored, codec)).toEqual({
			id: "1",
			email: "a@x",
			active: true,
			createdAt,
			meta: { n: 1 },
		});
	});

	it("maps where field names", () => {
		expect(toDbWhere(schema, "user", { email: "a@x" }, codec)).toEqual([
			{
				field: "email_address",
				value: "a@x",
				operator: "eq",
				connector: "AND",
				mode: "sensitive",
			},
		]);
	});
});
