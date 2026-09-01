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
		expect(validate(email, "a@b.co", "email")).toBe("a@b.co");
		expect(() => validate(email, "nope", "email")).toThrow(ValidationError);
	});

	it("withAttrs on a var keeps $var identity", () => {
		const user = v.var("attr_user", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const marked = withAttrs(user, "http", { serverOnly: true });
		expect(marked.$var).toBe(true);
		expect(marked.name).toBe("attr_user");
		expect(typeof marked.customize).toBe("function");
		expect(attrsOf(marked, "http")).toEqual({ serverOnly: true });
		// Field schema on the var is untouched.
		expect(attrsOf(marked.schema)).toBeUndefined();
	});

	it("customize after withAttrs keeps whole-var attrs", () => {
		const user = v.var("attr_user_customize", {
			default: null,
			schema: v.object({ id: v.string() }),
		});
		const marked = withAttrs(user, "http", { serverOnly: true });
		const widened = marked.customize({
			schema: (c) => c.add({ role: c.string() }),
		});
		expect(widened.$var).toBe(true);
		expect(attrsOf(widened, "http")).toEqual({ serverOnly: true });
		expect(
			(widened.schema as { shape: Record<string, unknown> }).shape.role,
		).toBeDefined();
	});
});
