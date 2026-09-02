/**
 * Dependent-package fixture: import through the published "better-call"
 * entry (package exports), export an e.fn that declares errors and uses
 * another error-declaring fn. Under moduleResolution node16, declaration
 * emit must name types only via the package entry - see
 * `declaration-emit.test.ts` (TS2883 / formerly TS2742).
 */
import { v } from "better-call";

const loadUser = v.fn(
	"loadUser",
	{
		errors: {
			not_found: { id: v.string() },
			denied: { reason: v.string() },
		},
	},
	(c): { id: string } => {
		if (Math.random() > 0.5) throw c.error("not_found", { id: "x" });
		return { id: "1" };
	},
);

const e = v.fn("auth.", { use: [{ loadUser }] });

export const signInEmail = e.fn(
	"sign_in.email",
	{
		input: { email: v.string(), password: v.string() },
		errors: {
			invalid_credentials: {},
			locked: { until: v.date() },
		},
	},
	async (c) => {
		const r = c.loadUser();
		if (!r.ok) throw c.error("invalid_credentials");
		return { user: r.value };
	},
);

export const bound = signInEmail.with({});
