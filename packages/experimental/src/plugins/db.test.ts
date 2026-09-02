import { describe, expect, it } from "vitest";
import { v } from "../index";
import { attrsOf, validate } from "../schema";
import { db, generateId, id } from "./db";

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
