import { describe, expect, it } from "vitest";
import { ValidationError } from "./error";
import { v } from "./index";
import { attrsOf, validate, withAttrs } from "./schema";

describe("schema $attrs", () => {
	it("withAttrs merges within a namespace and isolates namespaces", () => {
		const base = v.string();
		const once = withAttrs(base, "db", { unique: true });
		const twice = withAttrs(once, "db", { index: true });
		const both = withAttrs(twice, "http", { serverOnly: true });

		expect(attrsOf(twice, "db")).toEqual({ unique: true, index: true });
		expect(attrsOf(both, "http")).toEqual({ serverOnly: true });
		expect(attrsOf(both)?.db).toEqual({ unique: true, index: true });
		// Original untouched.
		expect(attrsOf(base)).toBeUndefined();
	});

	it("asType preserves $attrs on a type def", () => {
		const marked = withAttrs(v.number({ min: 1 }), "db", { unique: true });
		expect(attrsOf(marked, "db")).toEqual({ unique: true });
		expect(validate(marked, 2, "n")).toBe(2);
	});

	it("validate ignores $attrs", () => {
		const email = withAttrs(v.string({ email: true }), "db", {
			unique: true,
		});
		expect(validate(email, "a@b.c", "email")).toBe("a@b.c");
		expect(() => validate(email, "nope", "email")).toThrow(ValidationError);
	});
});
