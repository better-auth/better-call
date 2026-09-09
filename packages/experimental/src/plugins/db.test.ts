import { describe, expect, expectTypeOf, it } from "vitest";
import { memoryAdapter, v } from "../index";
import { attrsOf, validate } from "../schema";
import type { ValueOfVar } from "../var";
import { db, generateId, id, schema } from "./db";

const ALPHANUMERIC = /^[a-zA-Z0-9]+$/;

describe("generateId", () => {
	it("defaults to a 32-char alphanumeric string", async () => {
		const value = await generateId();
		expect(value).toHaveLength(32);
		expect(value).toMatch(ALPHANUMERIC);
	});

	it("honors size", async () => {
		expect(await generateId({ size: 8 })).toHaveLength(8);
		expect(await generateId({ size: 1 })).toHaveLength(1);
		expect(await generateId({})).toHaveLength(32);
	});

	it("mints a fresh value each call", async () => {
		const seen = new Set(
			await Promise.all(Array.from({ length: 20 }, () => generateId())),
		);
		expect(seen.size).toBe(20);
	});
});

describe("db.id", () => {
	it("marks $attrs.db.id and installs generateId as the default factory", () => {
		const field = id(v.string({}));
		expect(attrsOf(field, "db")).toEqual({ id: true });
		expect(field.default).toBe(generateId);
	});

	it("fills a fresh id when the field is omitted", async () => {
		const field = db.id(v.string({}));
		const a = await validate(field, undefined, "id");
		const b = await validate(field, undefined, "id");
		expect(a).toHaveLength(32);
		expect(a).toMatch(ALPHANUMERIC);
		expect(b).toHaveLength(32);
		expect(a).not.toBe(b);
	});

	it("keeps an explicit id", () => {
		const field = db.id(v.string({}));
		expect(validate(field, "custom-id", "id")).toBe("custom-id");
	});

	it("auto-fills id inside an object when the key is absent", async () => {
		const row = v.object({
			id: db.id(v.string({})),
			tag: v.string(),
		});
		const created = await validate(row, { tag: "a" }, "row");
		expect(created.tag).toBe("a");
		expect(created.id).toHaveLength(32);
		expect(created.id).toMatch(ALPHANUMERIC);

		expect(validate(row, { id: "fixed", tag: "b" }, "row")).toEqual({
			id: "fixed",
			tag: "b",
		});
	});
});

describe("schema", () => {
	it("is a named export and the same helper as db.schema", () => {
		expect(schema).toBe(db.schema);
	});

	it("wraps v.var with default null and an object schema", () => {
		const user = schema("dbt_user", {
			id: db.id(v.string({})),
			email: db.unique(v.string()),
		});
		expect(user.$var).toBe(true);
		expect(user.name).toBe("dbt_user");
		expect(user.default).toBeNull();
		expect(user.schema?.name).toBe("object");
		expect(attrsOf(user.schema?.shape?.email, "db")).toEqual({ unique: true });
	});

	it("types the var as the row or null, and works as a storage model", async () => {
		const item = schema("dbt_item", {
			id: db.id(v.string({})),
			tag: v.string(),
		});
		expectTypeOf<ValueOfVar<typeof item>>().toEqualTypeOf<{
			id: string;
			tag: string;
		} | null>();

		const store = v.storage(memoryAdapter(), { item });
		type CreateArg = Parameters<typeof store.item.create>[0];
		expectTypeOf<CreateArg>().toEqualTypeOf<{ tag: string; id?: string }>();

		const created = await store.item.create({ tag: "a" });
		expect(created.tag).toBe("a");
		expect(created.id).toHaveLength(32);
		expect(await store.item.findOne({ id: created.id })).toEqual(created);

		const read = v.fn({ use: [{ item }] }, (c) => {
			expectTypeOf(c.dbt_item).toEqualTypeOf<{
				id: string;
				tag: string;
			} | null>();
			return c.dbt_item;
		});
		expect(read()).toBeNull();
		expect(read.with({ dbt_item: created })()).toEqual(created);
	});
});
