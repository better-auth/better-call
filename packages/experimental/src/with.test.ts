import { describe, expect, it } from "vitest";
import { v } from "./index";

const user = v.var("user", {
	default: null,
	schema: v.object({ id: v.string(), name: v.string({ optional: true }) }),
});

const initials = v.derive("initials", user, (u) => u.id.slice(0, 2));

const s = v.fn("acct.", { use: [{ user, initials }] });

const label = s.fn("label", (c) => {
	const current = c.user;
	return current ? `user:${current.id}` : "anonymous";
});

const rename = s.fn(
	"rename",
	{
		input: { name: v.string() },
		requires: ["user"],
		errors: { name_taken: {} },
	},
	(c) => {
		if (c.input.name === "taken") throw c.error("name_taken");
		const current = c.user;
		c.user = { ...current, name: c.input.name };
		return c.user;
	},
);

const send = s.fn("send", (c) => `real:${c.user?.id ?? "?"}`);
const deliver = s.fn("deliver", { use: [{ send }] }, (c) => c.send());
const flow = s.fn("flow", { use: [{ deliver, send }] }, (c) => c.deliver());

describe("fn.with", () => {
	it("seeds a var the fn only knows through its BUILDER chain", () => {
		// `label` never says `use: [user]` - the builder did.
		expect(label.with({ user: { id: "ada" } })()).toBe("user:ada");
		expect(label()).toBe("anonymous");
	});

	it("a seed satisfies `requires`, and each bound call re-seeds fresh", async () => {
		const bound = rename.with({ user: { id: "ada" } });
		expect(bound({ name: "Ada" })).toMatchObject({ id: "ada", name: "Ada" });
		// Second call starts from the SEED again, not the first call's write.
		expect(bound({ name: "Eve" })).toMatchObject({ id: "ada", name: "Eve" });
		// Without the seed the contract still holds.
		expect(() => rename({ name: "Ada" })).toThrow(/required var "user"/);
	});

	it(".try on a bound call still catches DECLARED errors", () => {
		const result = rename.with({ user: { id: "ada" } }).try({ name: "taken" });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.tag).toBe("name_taken");
	});

	it("derived vars read through a seeded source", () => {
		const seen = s.fn("seen", (c) => c.initials);
		expect(seen.with({ user: { id: "ada" } })()).toBe("ad");
	});

	it("a `use` fn override replaces the binding for the WHOLE subtree", () => {
		expect(flow()).toBe("real:?");
		// `flow` calls `deliver`, which calls `send` - the override is keyed
		// at the top and still lands two frames down.
		expect(flow.with({ send: () => "mock" })()).toBe("mock");
	});

	it("vars and overrides compose in one context", () => {
		expect(flow.with({ user: { id: "ada" } })()).toBe("real:ada");
		expect(
			flow.with({
				user: { id: "ada" },
				send: () => "mock",
			})(),
		).toBe("mock");
	});

	it("only the chain's vars and fns type-check", () => {
		// @ts-expect-error - `nope` is neither a var nor a use fn of `label`
		label.with({ nope: 1 });
		// @ts-expect-error - value must match the var's type
		label.with({ user: { id: 42 } });
	});
});
