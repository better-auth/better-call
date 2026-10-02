import { describe, expect, it } from "vitest";
import { ValidationError } from "./error";
import {
	checkEmail,
	emailFormat,
	type FormatCheck,
	memoryAdapter,
	parseFields,
	urlFormat,
	v,
} from "./index";

const emailInput = { input: { email: v.string({ format: "email" }) } };

const corpOnly: FormatCheck = (value) =>
	value.endsWith("@corp.com") || "corp addresses only";
const labsOnly: FormatCheck = (value) => value.endsWith("@labs.corp.com");
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

const asyncIssueOf = async (run: () => unknown) => {
	try {
		await run();
	} catch (thrown) {
		if (thrown instanceof ValidationError) return thrown.issues[0]?.message;
		throw thrown;
	}
	return undefined;
};

describe("format vars: defaults", () => {
	it("unset, email keeps the built-in check and normalization", () => {
		const f = v.fn("fmt.plain", emailInput, (c) => c.input.email);
		expect(f({ email: "  Ada@Example.com " })).toBe("ada@example.com");
		expect(issueOf(() => f({ email: "nope" }))).toMatch(
			/expected an email address/,
		);
	});

	it("unset, url keeps the built-in check; uuid stays docs-only", () => {
		const f = v.fn(
			"fmt.plainUrl",
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

	it("the vars are ordinary vars defaulting to the built-ins", () => {
		expect(emailFormat.name).toBe("format.email");
		expect(emailFormat.default).toBe(checkEmail);
		expect(urlFormat.name).toBe("format.url");
		const f = v.fn({ use: [{ emailFormat }] }, (c) => c["format.email"]);
		expect(f()).toBe(checkEmail);
	});
});

describe("format vars: scoping", () => {
	const signUp = v.fn("fmt.signUp", emailInput, (c) => c.input.email);
	const invite = v.fn("fmt.invite", emailInput, (c) => c.input.email);

	it("set at the root, applies to everything the call tree reaches", () => {
		const root = v.fn(
			"fmt.root",
			{ input: { email: v.string() }, use: [{ signUp, invite }] },
			(c) => [c.signUp({ email: c.input.email }), c.invite(c.input)],
		);
		const scoped = root.with({ "format.email": corpOnly });
		expect(scoped({ email: "ada@corp.com" })).toEqual([
			"ada@corp.com",
			"ada@corp.com",
		]);
		expect(issueOf(() => scoped({ email: "ada@example.com" }))).toBe(
			"corp addresses only",
		);
		// The unbound fn is untouched.
		expect(root({ email: "ada@example.com" })).toEqual([
			"ada@example.com",
			"ada@example.com",
		]);
	});

	it("an instance seeds it under its use key, type-checked", () => {
		const app = v.fn("fmt.app.", { use: [{ emailFormat }] });
		const join = app.fn("join", emailInput, (c) => c.input.email);
		const scoped = app.with(join, { emailFormat: corpOnly });
		expect(scoped({ email: "Ada@Corp.com" })).toBe("ada@corp.com");
		expect(issueOf(() => scoped({ email: "ada@example.com" }))).toBe(
			"corp addresses only",
		);
		expect(join({ email: "ada@example.com" })).toBe("ada@example.com");
		// @ts-expect-error - a format check, not a string
		app.with(join, { emailFormat: "nope" });
	});

	it("set via .with on an inner call, it leaves the parent and siblings alone", () => {
		const parent = v.fn(
			"fmt.parent",
			{
				output: v.object({
					inner: v.string(),
					sibling: v.string(),
					own: v.string({ format: "email" }),
				}),
			},
			(c) => ({
				inner: signUp.with({ "format.email": corpOnly })(
					{ email: "ada@corp.com" },
					c,
				),
				// After the scoped call, a sibling and the parent's own output
				// still see the default.
				sibling: invite({ email: "eve@example.com" }, c),
				own: "own@example.com",
			}),
		);
		expect(parent()).toEqual({
			inner: "ada@corp.com",
			sibling: "eve@example.com",
			own: "own@example.com",
		});
		const rejected = v.fn("fmt.parentBad", (c) =>
			signUp.with({ "format.email": corpOnly })(
				{ email: "ada@example.com" },
				c,
			),
		);
		expect(issueOf(() => rejected())).toBe("corp addresses only");
	});

	it("an inner setting shadows an outer one for its call tree only", () => {
		const outer = v.fn("fmt.outer", { use: [{ signUp }] }, (c) => [
			c.signUp({ email: "ada@corp.com" }),
			signUp.with({ "format.email": labsOnly })(
				{ email: "ada@labs.corp.com" },
				c,
			),
			issueOf(() =>
				signUp.with({ "format.email": labsOnly })({ email: "ada@corp.com" }, c),
			),
			// Back in the outer scope, the outer setting holds again.
			issueOf(() => c.signUp({ email: "ada@labs.example.com" })),
		]);
		const [outerOk, innerOk, innerIssue, outerIssue] = outer.with({
			"format.email": corpOnly,
		})();
		expect(outerOk).toBe("ada@corp.com");
		expect(innerOk).toBe("ada@labs.corp.com");
		expect(innerIssue).toBe(`${labsFailure}"ada@corp.com"`);
		expect(outerIssue).toBe("corp addresses only");
	});

	it("an assignment applies to what the fn calls after it", () => {
		const f = v.fn("fmt.assign", { use: [{ signUp, emailFormat }] }, (c) => {
			const before = c.signUp({ email: "ada@example.com" });
			c["format.email"] = corpOnly;
			return [before, issueOf(() => c.signUp({ email: "ada@example.com" }))];
		});
		expect(f()).toEqual(["ada@example.com", "corp addresses only"]);
	});

	it("any format name works - seeding format.<name> adds a check", () => {
		const f = v.fn(
			"fmt.slug",
			{ input: { slug: v.string({ format: "slug" }) } },
			(c) => c.input.slug,
		);
		expect(f({ slug: "Not A Slug" })).toBe("Not A Slug");
		const strict = f.with({
			"format.slug": (value: string) => /^[a-z-]+$/.test(value),
		});
		expect(strict({ slug: "a-slug" })).toBe("a-slug");
		expect(issueOf(() => strict({ slug: "Not A Slug" }))).toBe(
			'expected format "slug", received "Not A Slug"',
		);
	});
});

describe("format vars: checks", () => {
	it("a string is the message, false the generic one, a throw its message", () => {
		const f = v.fn("fmt.messages", emailInput, (c) => c.input.email);
		expect(
			issueOf(() =>
				f.with({ "format.email": () => "no thanks" })({ email: "a@b.co" }),
			),
		).toBe("no thanks");
		expect(
			issueOf(() =>
				f.with({ "format.email": () => false })({ email: "a@b.co" }),
			),
		).toBe(`${labsFailure}"a@b.co"`);
		expect(
			issueOf(() =>
				f.with({
					"format.email": () => {
						throw new Error("domain is blocked");
					},
				})({ email: "a@b.co" }),
			),
		).toBe("domain is blocked");
	});

	it("checks may be async - resolved verdicts and rejections both count", async () => {
		const f = v.fn("fmt.async", emailInput, (c) => c.input.email);
		const slowCorp = async (value: string) => {
			await new Promise((resolve) => setTimeout(resolve, 1));
			return value.endsWith("@corp.com") || "corp addresses only";
		};
		const scoped = f.with({ "format.email": slowCorp });
		await expect(scoped({ email: " Ada@Corp.com" })).resolves.toBe(
			"ada@corp.com",
		);
		expect(await asyncIssueOf(() => scoped({ email: "ada@example.com" }))).toBe(
			"corp addresses only",
		);
		const rejecting = f.with({
			"format.email": async () => {
				throw new Error("lookup failed");
			},
		});
		expect(await asyncIssueOf(() => rejecting({ email: "a@b.co" }))).toBe(
			"lookup failed",
		);
	});

	it("a check reads the scope's vars and calls fns with it as the parent", async () => {
		const blocked = v.var("fmt_blocked", { default: [] as string[] });
		const isDisposable = v.fn(
			"fmt.isDisposable",
			{ input: { domain: v.string() }, use: [{ blocked }] },
			(c) => c.fmt_blocked.includes(c.input.domain),
		);
		const notDisposable: FormatCheck = (value, c) =>
			!isDisposable({ domain: value.split("@")[1] ?? "" }, c) ||
			`disposable domain (${c.fmt_blocked.length} blocked)`;
		const f = v.fn("fmt.context", emailInput, (c) => c.input.email);
		const scoped = f.with({
			"format.email": notDisposable,
			fmt_blocked: ["throwaway.com"],
		});
		expect(scoped({ email: "ada@corp.com" })).toBe("ada@corp.com");
		expect(issueOf(() => scoped({ email: "ada@throwaway.com" }))).toBe(
			"disposable domain (1 blocked)",
		);
	});

	it("an override calls the default without looping back into itself", () => {
		let calls = 0;
		const stricter: FormatCheck = (value) => {
			calls++;
			const base = checkEmail(value);
			if (base !== true) return base;
			return !value.startsWith("admin@") || "reserved address";
		};
		const f = v.fn("fmt.default", emailInput, (c) => c.input.email);
		const scoped = f.with({ "format.email": stricter });
		expect(scoped({ email: "ada@corp.com" })).toBe("ada@corp.com");
		expect(issueOf(() => scoped({ email: "admin@corp.com" }))).toBe(
			"reserved address",
		);
		expect(issueOf(() => scoped({ email: "nope" }))).toMatch(
			/expected an email address/,
		);
		expect(calls).toBe(3);
	});

	it("a fn the check calls sees the default for that format, not the check", () => {
		const normalize = v.fn("fmt.normalize", emailInput, (c) => c.input.email);
		let depth = 0;
		const viaFn: FormatCheck = (value, c) => {
			depth++;
			return normalize({ email: value }, c).endsWith("@corp.com");
		};
		const f = v.fn("fmt.viaFn", emailInput, (c) => c.input.email);
		expect(f.with({ "format.email": viaFn })({ email: "ada@corp.com" })).toBe(
			"ada@corp.com",
		);
		expect(depth).toBe(1);
	});
});

describe("format vars: storage and events", () => {
	const account = v.var("fmt_account", {
		default: null,
		schema: v.object({ id: v.string(), email: v.string({ format: "email" }) }),
	});

	it("a storage write inside the call checks against the scope's var", async () => {
		const db = v.storage(memoryAdapter(), { account });
		const create = v.fn(
			"fmt.storage",
			{ input: { email: v.string() }, use: [{ db }] },
			(c) => c.db.account.create({ id: c.input.email, email: c.input.email }),
		);
		await expect(create({ email: "Ada@Example.com" })).resolves.toMatchObject({
			email: "ada@example.com",
		});
		const scoped = create.with({ "format.email": corpOnly });
		expect(await asyncIssueOf(() => scoped({ email: "eve@example.com" }))).toBe(
			"corp addresses only",
		);
		await expect(scoped({ email: "eve@corp.com" })).resolves.toMatchObject({
			email: "eve@corp.com",
		});
		// The storage itself, outside any fn, keeps the built-in.
		await expect(
			db.account.create({ id: "x", email: "x@example.com" }),
		).resolves.toMatchObject({ email: "x@example.com" });
	});

	it("an event payload published inside the call checks against it too", async () => {
		const joined = v.event("fmt_joined", {
			member: v.object({ email: v.string({ format: "email" }) }),
		});
		const announce = v.fn(
			"fmt.event",
			{ input: { email: v.string() }, use: [{ joined }] },
			async (c) => {
				const [payload] = await c.joined.publish("member", {
					email: c.input.email,
				});
				return payload;
			},
		);
		await expect(announce({ email: "eve@example.com" })).resolves.toEqual({
			email: "eve@example.com",
		});
		const scoped = announce.with({ "format.email": corpOnly });
		expect(await asyncIssueOf(() => scoped({ email: "eve@example.com" }))).toBe(
			"corp addresses only",
		);
		await expect(scoped({ email: "eve@corp.com" })).resolves.toEqual({
			email: "eve@corp.com",
		});
	});
});

describe("format checks outside a fn", () => {
	const schema = v.object({ email: v.string({ format: "email" }) });

	it("parseFields uses the built-ins unless given a lookup", () => {
		expect(parseFields(schema, { email: " A@B.co " })).toEqual({
			email: "a@b.co",
		});
		expect(
			issueOf(() =>
				parseFields(
					schema,
					{ email: "a@b.co" },
					{
						formats: (format) => (format === "email" ? corpOnly : undefined),
					},
				),
			),
		).toBe("corp addresses only");
	});
});
