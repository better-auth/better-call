import { describe, expect, it } from "vitest";
import { ValidationError } from "./error";
import { v } from "./index";

const emailInput = { input: { email: v.string({ format: "email" }) } };

const corpEmail = v.fn(
	"better-call.validator.email",
	{
		input: v.string(),
		output: v.boolean(),
		errors: { invalid: { message: v.string() } },
	},
	(c) => {
		if (!c.input.endsWith("@corp.com")) {
			throw c.error("invalid", { message: "corp addresses only" });
		}
		return true;
	},
);
const labsEmail = v.fn(
	"better-call.validator.email",
	{ input: v.string(), output: v.boolean() },
	(c) => c.input.endsWith("@labs.corp.com"),
);
const labsFailure = 'expected format "email", received ';

const issueOf = (run: () => unknown): string | undefined => {
	try {
		run();
	} catch (thrown) {
		if (thrown instanceof ValidationError) return thrown.issues[0]?.message;
		throw thrown;
	}
	return undefined;
};

describe("validators: defaults", () => {
	it("no validator keeps the built-in email check and normalization", () => {
		const f = v.fn("val.plain", emailInput, (c) => c.input.email);
		expect(f({ email: "  Ada@Example.com " })).toBe("ada@example.com");
		expect(issueOf(() => f({ email: "nope" }))).toMatch(
			/expected an email address/,
		);
	});

	it("no validator keeps the built-in url check; uuid stays docs-only", () => {
		const f = v.fn(
			"val.plainUrl",
			{
				input: {
					url: v.string({ format: "url" }),
					id: v.string({ format: "uuid" }),
				},
			},
			(c) => c.input,
		);
		expect(f({ url: "https://a.dev", id: "anything" }).id).toBe("anything");
		expect(issueOf(() => f({ url: "nope", id: "x" }))).toMatch(
			/expected a URL/,
		);
	});
});

describe("validators: scoping", () => {
	const app = v.fn("app.", { use: [corpEmail] });
	const inner = app.fn("inner.", { use: [labsEmail] });
	const sibling = app.fn("sibling.");

	const rootSignup = app.fn("signup", emailInput, (c) => c.input.email);
	const innerSignup = inner.fn("signup", emailInput, (c) => c.input.email);
	const siblingSignup = sibling.fn("signup", emailInput, (c) => c.input.email);
	const outside = v.fn("outside.signup", emailInput, (c) => c.input.email);

	it("a validator at the root scope applies to every fn below it", () => {
		expect(rootSignup({ email: "ada@corp.com" })).toBe("ada@corp.com");
		expect(issueOf(() => rootSignup({ email: "ada@example.com" }))).toBe(
			"corp addresses only",
		);
		expect(siblingSignup({ email: "ada@corp.com" })).toBe("ada@corp.com");
		expect(issueOf(() => siblingSignup({ email: "ada@example.com" }))).toBe(
			"corp addresses only",
		);
	});

	it("fns outside the validating scope keep the default", () => {
		expect(outside({ email: "ada@example.com" })).toBe("ada@example.com");
	});

	it("a nested validator applies inside its scope, not its parent or siblings", () => {
		expect(innerSignup({ email: "ada@labs.corp.com" })).toBe(
			"ada@labs.corp.com",
		);
		expect(issueOf(() => innerSignup({ email: "ada@corp.com" }))).toBe(
			`${labsFailure}"ada@corp.com"`,
		);
		// Parent and sibling still run the outer validator.
		expect(rootSignup({ email: "ada@corp.com" })).toBe("ada@corp.com");
		expect(siblingSignup({ email: "ada@corp.com" })).toBe("ada@corp.com");
	});

	it("a deeper validator shadows an outer one", () => {
		const anyEmail = v.fn(
			"better-call.validator.email",
			{ input: v.string(), output: v.boolean() },
			() => true,
		);
		const deep = inner.fn("deep.", { use: [anyEmail] });
		const deepSignup = deep.fn("signup", emailInput, (c) => c.input.email);
		expect(deepSignup({ email: "not-an-email" })).toBe("not-an-email");
		expect(issueOf(() => innerSignup({ email: "not-an-email" }))).toBe(
			`${labsFailure}"not-an-email"`,
		);
	});

	it("a fn's own use overrides its builder scope", () => {
		const own = app.fn(
			"own",
			{ ...emailInput, use: [labsEmail] },
			(c) => c.input.email,
		);
		expect(issueOf(() => own({ email: "ada@corp.com" }))).toBe(
			`${labsFailure}"ada@corp.com"`,
		);
	});

	it("is lexical: a fn keeps its own scope when called from another", () => {
		const callsOutside = inner.fn(
			"callsOutside",
			{ use: [{ outside, rootSignup }] },
			(c) => [
				c.outside({ email: "ada@example.com" }),
				c.rootSignup({ email: "ada@corp.com" }),
			],
		);
		expect(callsOutside()).toEqual(["ada@example.com", "ada@corp.com"]);
	});

	it("a validator can also be mounted inside a module record", () => {
		const f = v.fn(
			"val.grouped",
			{ ...emailInput, use: [{ formats: { corpEmail } }] },
			(c) => c.input.email,
		);
		expect(issueOf(() => f({ email: "ada@example.com" }))).toBe(
			"corp addresses only",
		);
	});
});

describe("validators: behavior", () => {
	it("validates url and docs-only formats like uuid", () => {
		const httpsOnly = v.fn(
			"better-call.validator.url",
			{ input: v.string(), output: v.boolean() },
			(c) => c.input.startsWith("https://"),
		);
		const uuid = v.fn(
			"better-call.validator.uuid",
			{ input: v.string(), output: v.boolean() },
			(c) =>
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					c.input,
				),
		);
		const f = v.fn(
			"val.urls",
			{
				input: {
					url: v.string({ format: "url" }),
					id: v.string({ format: "uuid" }),
				},
				use: [httpsOnly, uuid],
			},
			(c) => c.input,
		);
		const id = "123e4567-e89b-12d3-a456-426614174000";
		expect(f({ url: "https://a.dev", id }).url).toBe("https://a.dev");
		expect(issueOf(() => f({ url: "http://a.dev", id }))).toBe(
			'expected format "url", received "http://a.dev"',
		);
		expect(issueOf(() => f({ url: "https://a.dev", id: "nope" }))).toBe(
			'expected format "uuid", received "nope"',
		);
	});

	it("a declared error without a message fails with its tag", () => {
		const tagged = v.fn(
			"better-call.validator.email",
			{ input: v.string(), output: v.boolean(), errors: { blocked: {} } },
			(c) => {
				throw c.error("blocked");
			},
		);
		const f = v.fn(
			"val.tagged",
			{ ...emailInput, use: [tagged] },
			(c) => c.input.email,
		);
		expect(issueOf(() => f({ email: "a@b.co" }))).toBe(
			'expected format "email" (blocked), received "a@b.co"',
		);
	});

	it("an undeclared throw is a defect, not a validation failure", () => {
		const broken = v.fn(
			"better-call.validator.email",
			{ input: v.string(), output: v.boolean() },
			() => {
				throw new Error("dns down");
			},
		);
		const f = v.fn(
			"val.broken",
			{ ...emailInput, use: [broken] },
			(c) => c.input.email,
		);
		expect(() => f({ email: "a@b.co" })).toThrow("dns down");
	});

	it("still normalizes email before the validator runs", () => {
		const seen: string[] = [];
		const spy = v.fn(
			"better-call.validator.email",
			{ input: v.string(), output: v.boolean() },
			(c) => {
				seen.push(c.input);
				return true;
			},
		);
		const f = v.fn(
			"val.normalized",
			{ ...emailInput, use: [spy] },
			(c) => c.input.email,
		);
		expect(f({ email: " Ada@Corp.com" })).toBe("ada@corp.com");
		expect(seen).toEqual(["ada@corp.com"]);
	});

	it("applies to output too", () => {
		const f = v.fn(
			"val.output",
			{ output: { email: v.string({ format: "email" }) }, use: [corpEmail] },
			() => ({ email: "ada@example.com" }),
		);
		expect(issueOf(() => f())).toBe("corp addresses only");
	});

	it("supports async validators", async () => {
		const slow = v.fn(
			"better-call.validator.email",
			{
				input: v.string({ description: "email" }),
				output: v.boolean(),
			},
			async (c) => c.input.endsWith("@corp.com"),
		);
		const f = v.fn(
			"val.async",
			{ ...emailInput, use: [slow] },
			(c) => c.input.email,
		);
		await expect(f({ email: "ada@corp.com" })).resolves.toBe("ada@corp.com");
		await expect(f({ email: "ada@example.com" })).rejects.toThrow(
			'expected format "email"',
		);
	});

	it("a sync rule failing after an async validator still throws sync", () => {
		const slow = v.fn(
			"better-call.validator.email",
			{ input: v.string(), output: v.boolean() },
			async () => true,
		);
		const f = v.fn(
			"val.asyncThenSync",
			{
				input: {
					email: v.string({ format: "email", endsWith: "@corp.com" }),
				},
				use: [slow],
			},
			(c) => c.input.email,
		);
		expect(issueOf(() => f({ email: "ada@example.com" }))).toMatch(
			/expected to end with "@corp.com"/,
		);
	});

	it("the validator runs in the caller's var scope", () => {
		const domain = v.var("val_domain", { default: "corp.com" });
		const byDomain = v.fn(
			"better-call.validator.email",
			{ input: v.string(), output: v.boolean() },
			(c) => c.input.endsWith(`@${c.val_domain}`),
		);
		const f = v.fn(
			"val.vars",
			{ ...emailInput, use: [{ domain }, byDomain] },
			(c) => c.input.email,
		);
		expect(f.with({ val_domain: "labs.dev" })({ email: "a@labs.dev" })).toBe(
			"a@labs.dev",
		);
		expect(issueOf(() => f({ email: "a@labs.dev" }))).toBe(
			'expected format "email", received "a@labs.dev"',
		);
	});

	it("a validator's own email input never runs an email override", () => {
		const calls: string[] = [];
		const outer = v.fn(
			"better-call.validator.email",
			{ input: v.string(), output: v.boolean() },
			(c) => {
				calls.push(`outer:${c.input}`);
				return true;
			},
		);
		// Its input is email-formatted and its scope mounts another email
		// validator: neither that one nor itself checks its own input.
		const selfChecking = v.fn(
			"better-call.validator.email",
			{
				input: v.string({ format: "email" }),
				output: v.boolean(),
				use: [outer],
			},
			(c) => {
				calls.push(`self:${c.input}`);
				return c.input.endsWith("@corp.com");
			},
		);
		const f = v.fn(
			"val.selfChecking",
			{ ...emailInput, use: [selfChecking] },
			(c) => c.input.email,
		);
		expect(f({ email: "ada@corp.com" })).toBe("ada@corp.com");
		expect(calls).toEqual(["self:ada@corp.com"]);
	});

	it("v.on targets a validator by its key, also from a builder", () => {
		const log: string[] = [];
		const app = v.fn("val.app.", { use: [labsEmail] });
		const audit = app.on("better-call.validator.email", (c, next) => {
			log.push(c.fnKey);
			return next();
		});
		const f = app.fn(
			"signup",
			{ ...emailInput, use: [{ audit }] },
			(c) => c.input.email,
		);
		expect(f({ email: "a@labs.corp.com" })).toBe("a@labs.corp.com");
		expect(log).toEqual(["better-call.validator.email"]);
	});

	it("a validator under a prefixed builder fails at definition", () => {
		const app = v.fn("val.app.");
		expect(() =>
			app.fn(
				"better-call.validator.email",
				{ input: v.string(), output: v.boolean() },
				() => true,
			),
		).toThrow(/validator keys are global/);
	});
});

describe("validators: types", () => {
	it("use takes a bare validator fn but no other bare fn", () => {
		const plain = v.fn("val.plainFn", () => 1);
		expect(() =>
			// @ts-expect-error - only validator fns mount bare
			v.fn("val.bareFn", { use: [plain] }, () => 1),
		).toThrow(/modules are objects/);
		const stringy = v.fn(
			"better-call.validator.email",
			{ input: v.string() },
			() => "yes",
		);
		// @ts-expect-error - a validator returns a boolean
		v.fn("val.stringy", { use: [stringy] }, () => 1);
		v.fn("val.ok", { use: [corpEmail, { plain }] }, (c) => c.plain());
	});
});
