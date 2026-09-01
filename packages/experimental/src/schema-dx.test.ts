import { describe, expect, expectTypeOf, it } from "vitest";
import { v } from "./index";
import type { InferArgs, InferOutput, InferType } from "./schema";
import { validate } from "./schema";

describe("v.string type-arg + optional DX", () => {
	it("narrowed type param works with optional: true", () => {
		const field = v.string<"a" | "b">({ optional: true });
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<"a" | "b">();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			"a" | "b" | undefined | null
		>();
	});

	it("enum form with optional: true matches type-param form", () => {
		const viaEnum = v.string({ enum: ["a", "b"], optional: true });
		const viaParam = v.string<"a" | "b">({ optional: true });
		expectTypeOf<InferOutput<typeof viaEnum>>().toEqualTypeOf<
			InferOutput<typeof viaParam>
		>();
		expectTypeOf<InferType<typeof viaEnum>>().toEqualTypeOf<
			InferType<typeof viaParam>
		>();
	});

	it("narrowed type param works with default", () => {
		const field = v.string<"a" | "b">({ default: "a" });
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<"a" | "b">();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<"a" | "b">();
	});

	it("narrowed type param works with optional + default", () => {
		const field = v.string<"a" | "b">({ optional: true, default: "a" });
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<"a" | "b">();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<"a" | "b">();
	});
});

describe("other vTypes type-arg + optional DX", () => {
	it("v.any with type param accepts optional: true", () => {
		const field = v.any<{ id: string }>({ optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			{ id: string } | undefined | null
		>();
	});

	it("v.number accepts optional: true without a type param", () => {
		const field = v.number({ optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			number | undefined | null
		>();
	});

	it("v.number with output type param accepts optional: true", () => {
		const field = v.number<number>({ optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			number | undefined | null
		>();
	});

	it("v.boolean/date accept optional: true", () => {
		const b = v.boolean({ optional: true });
		const d = v.date({ optional: true });
		expectTypeOf<InferOutput<typeof b>>().toEqualTypeOf<
			boolean | undefined | null
		>();
		expectTypeOf<InferOutput<typeof d>>().toEqualTypeOf<
			Date | undefined | null
		>();
	});

	it("v.array with element accepts optional: true", () => {
		const field = v.array(v.string<"a" | "b">(), { optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			("a" | "b")[] | undefined | null
		>();
	});

	it("v.object with shape accepts optional: true", () => {
		const field = v.object({ kind: v.string<"a" | "b">() }, { optional: true });
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			{ kind: "a" | "b" } | undefined | null
		>();
	});

	it("object and array defaults are typed as inputs", () => {
		const obj = v.object(
			{ n: v.string({ transform: (s) => Number(s) }) },
			{ default: { n: "5" } },
		);
		expectTypeOf<InferOutput<typeof obj>>().toEqualTypeOf<{ n: number }>();

		const arr = v.array(v.string({ transform: (s) => Number(s) }), {
			default: ["5"],
		});
		expectTypeOf<InferOutput<typeof arr>>().toEqualTypeOf<number[]>();
	});

	it("object optional + empty default allows required children", () => {
		const field = v.object(
			{
				password: v.object(
					{
						hash: v.string({ optional: true }),
						verify: v.string({ optional: true }),
					},
					{ optional: true, default: {} },
				),
				minPasswordLength: v.number(),
				maxPasswordLength: v.number({ optional: true }),
			},
			{ optional: true, default: {} },
		);
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<{
			password: { hash?: string | null; verify?: string | null };
			minPasswordLength: number;
			maxPasswordLength?: number | null;
		}>();
	});

	it("password-options style extend with required number fields", () => {
		const options = v.var("options", { schema: v.object({}), default: {} });
		const passwordOptions = v.extend(options, {
			emailAndPassword: v.object(
				{
					password: v.object(
						{
							hash: v.fn.type({
								input: { password: v.string() },
								output: v.string(),
								optional: true,
							}),
							verify: v.fn.type({
								input: { password: v.string(), hash: v.string() },
								output: v.boolean(),
								optional: true,
							}),
						},
						{ optional: true, default: {} },
					),
					minPasswordLength: v.number(),
					maxPasswordLength: v.number(),
				},
				{ optional: true, default: {} },
			),
		});
		expectTypeOf(passwordOptions).not.toBeNever();
	});
});

describe("factory defaults", () => {
	it("v.date({ default: () => new Date() }) is omittable and fresh each time", () => {
		const schema = v.object({
			id: v.string({}),
			createdAt: v.date({ default: () => new Date(1000) }),
			updatedAt: v.date({ default: () => new Date(2000) }),
		});
		expectTypeOf<InferArgs<typeof schema>>().toEqualTypeOf<{
			id: string;
			createdAt?: Date;
			updatedAt?: Date;
		}>();
		expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<{
			id: string;
			createdAt: Date;
			updatedAt: Date;
		}>();

		const a = validate(schema, { id: "1" }, "row");
		const b = validate(schema, { id: "2" }, "row");
		expect(a.createdAt).toEqual(new Date(1000));
		expect(a.updatedAt).toEqual(new Date(2000));
		// Distinct instances - not one shared Date reused across validates.
		expect(a.createdAt).not.toBe(b.createdAt);
	});

	it("literal defaults still work; an explicit value wins", () => {
		const field = v.date({ default: new Date(0) });
		expect(validate(field, undefined, "at")).toEqual(new Date(0));
		expect(validate(field, new Date(9), "at")).toEqual(new Date(9));
	});

	it("object/array factory defaults mint a fresh value", () => {
		const obj = v.object({ n: v.number() }, { default: () => ({ n: 1 }) });
		const a = validate(obj, undefined, "o");
		const b = validate(obj, undefined, "o");
		expect(a).toEqual({ n: 1 });
		expect(a).not.toBe(b);

		const arr = v.array(v.string(), { default: () => ["x"] });
		const xs = validate(arr, undefined, "a");
		const ys = validate(arr, undefined, "a");
		expect(xs).toEqual(["x"]);
		expect(xs).not.toBe(ys);
	});
});

describe("email normalization", () => {
	it("trims and lowercases before validating", () => {
		const field = v.string({ email: true });
		expect(validate(field, "  Foo@Bar.COM  ", "email")).toBe("foo@bar.com");
	});

	it("still rejects malformed addresses after normalize", () => {
		const field = v.string({ email: true });
		expect(() => validate(field, "  not-an-email  ", "email")).toThrow(
			/expected an email address/,
		);
	});

	it("user transform receives the normalized value", () => {
		const field = v.string({
			email: true,
			transform: (s) => `user:${s}`,
		});
		expect(validate(field, " A@B.CO ", "email")).toBe("user:a@b.co");
	});
});

describe("v.union", () => {
	it("parses string | number; rejects neither", () => {
		const field = v.union([v.string(), v.number()]);
		expect(validate(field, "hi", "x")).toBe("hi");
		expect(validate(field, 3, "x")).toBe(3);
		expect(() => validate(field, true, "x")).toThrow(/expected/);
		expectTypeOf<InferType<typeof field>>().toEqualTypeOf<string | number>();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<string | number>();
		expectTypeOf<InferArgs<typeof field>>().toEqualTypeOf<string | number>();
	});

	it("first matching object arm wins, including its transform", () => {
		const field = v.union([
			v.object({
				kind: v.string({ enum: ["a"] }),
				n: v.string({ transform: (s) => Number(s) }),
			}),
			v.object({
				kind: v.string({ enum: ["b"] }),
				ok: v.boolean(),
			}),
		]);
		expect(validate(field, { kind: "a", n: "9" }, "x")).toEqual({
			kind: "a",
			n: 9,
		});
		expect(validate(field, { kind: "b", ok: true }, "x")).toEqual({
			kind: "b",
			ok: true,
		});
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			{ kind: "a"; n: number } | { kind: "b"; ok: boolean }
		>();
	});

	it("optional and default behave like other types", () => {
		const optional = v.union([v.string(), v.number()], { optional: true });
		expect(validate(optional, undefined, "x")).toBeUndefined();
		expect(validate(optional, null, "x")).toBeNull();
		expectTypeOf<InferOutput<typeof optional>>().toEqualTypeOf<
			string | number | undefined | null
		>();

		const withDefault = v.union([v.string(), v.number()], { default: 0 });
		expect(validate(withDefault, undefined, "x")).toBe(0);
		expectTypeOf<InferOutput<typeof withDefault>>().toEqualTypeOf<
			string | number
		>();
	});

	it("optional accepts null the same way as undefined", () => {
		const field = v.string({ optional: true });
		expect(validate(field, null, "x")).toBeNull();
		expect(validate(field, undefined, "x")).toBeUndefined();
		expectTypeOf<InferArgs<typeof field>>().toEqualTypeOf<string | null>();
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<
			string | undefined | null
		>();

		const withDefault = v.string({ optional: true, default: "hi" });
		expect(validate(withDefault, null, "x")).toBe("hi");
		expect(validate(withDefault, undefined, "x")).toBe("hi");

		const shaped = v.object({
			name: v.string({ optional: true }),
		});
		expect(validate(shaped, { name: null }, "x")).toEqual({ name: null });
		expect(validate(shaped, {}, "x")).toEqual({});
		expect(() => validate(v.string(), null, "x")).toThrow(/expected string/);
	});

	it("default: null is optional to send and produces null", () => {
		const callbackUrl = v.string({ optional: true, default: null });
		expect(validate(callbackUrl, undefined, "x")).toBeNull();
		expect(validate(callbackUrl, null, "x")).toBeNull();
		expect(validate(callbackUrl, "https://ok", "x")).toBe("https://ok");
		expectTypeOf<InferOutput<typeof callbackUrl>>().toEqualTypeOf<
			string | null
		>();
		expectTypeOf<InferArgs<typeof callbackUrl>>().toEqualTypeOf<
			string | null
		>();

		const bare = v.string({ default: null });
		expect(validate(bare, undefined, "x")).toBeNull();
		expectTypeOf<InferOutput<typeof bare>>().toEqualTypeOf<string | null>();

		const shaped = v.object({
			callbackUrl: v.string({ optional: true, default: null }),
			n: v.number({ default: null }),
		});
		expect(validate(shaped, {}, "x")).toEqual({
			callbackUrl: null,
			n: null,
		});
		expectTypeOf<InferOutput<typeof shaped>>().toEqualTypeOf<{
			callbackUrl: string | null;
			n: number | null;
		}>();
		expectTypeOf<InferArgs<typeof shaped>>().toEqualTypeOf<{
			callbackUrl?: string | null;
			n?: number | null;
		}>();

		expect(
			validate(v.number({ optional: true, default: null }), undefined, "n"),
		).toBeNull();
		expect(validate(v.boolean({ default: null }), undefined, "b")).toBeNull();
		expect(
			validate(v.any({ optional: true, default: null }), undefined, "a"),
		).toBeNull();
		expect(
			validate(
				v.object({ x: v.string() }, { optional: true, default: null }),
				undefined,
				"o",
			),
		).toBeNull();
		expect(
			validate(
				v.array(v.string(), { optional: true, default: null }),
				undefined,
				"arr",
			),
		).toBeNull();
		expect(
			validate(
				v.union([v.string(), v.number()], { optional: true, default: null }),
				undefined,
				"u",
			),
		).toBeNull();
		expect(
			validate(v.date({ optional: true, default: null }), undefined, "d"),
		).toBeNull();
	});

	it("aggregates issues from every failing branch", () => {
		const field = v.union([v.string({ min: 2 }), v.number({ min: 10 })]);
		try {
			validate(field, "x", "u");
			expect.unreachable();
		} catch (thrown) {
			expect(thrown).toBeInstanceOf(Error);
			const err = thrown as { issues: { message: string }[] };
			expect(err.issues.length).toBeGreaterThanOrEqual(2);
		}
	});

	it("preserves bare null (and other literals) in the inferred union", () => {
		const user = v.var("union_user", {
			schema: v.object({ id: v.string(), name: v.string() }),
		});
		const field = v.union([user, null]);
		expectTypeOf<InferOutput<typeof field>>().toEqualTypeOf<{
			id: string;
			name: string;
		} | null>();
		expectTypeOf<InferArgs<typeof field>>().toEqualTypeOf<{
			id: string;
			name: string;
		} | null>();
		expect(validate(field, null, "x")).toBeNull();
		expect(validate(field, { id: "1", name: "a" }, "x")).toEqual({
			id: "1",
			name: "a",
		});

		const literals = v.union([null, "idle", 0] as const);
		expectTypeOf<InferOutput<typeof literals>>().toEqualTypeOf<
			null | "idle" | 0
		>();
		expect(validate(literals, null, "x")).toBeNull();
		expect(validate(literals, "idle", "x")).toBe("idle");
		expect(validate(literals, 0, "x")).toBe(0);
		expect(() => validate(literals, "busy", "x")).toThrow(/expected/);
	});

	it("fn output: v.union([var, null]) accepts a handler that returns null", () => {
		const user = v.var("union_out_user", {
			schema: v.object({ id: v.string() }),
		});
		const find = v.fn(
			"union.find",
			{ output: v.union([user, null]) },
			(_c): { id: string } | null => null,
		);
		expectTypeOf(find).returns.toEqualTypeOf<{ id: string } | null>();
		expect(find()).toBeNull();
	});
});
