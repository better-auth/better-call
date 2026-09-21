/**
 * tsc-backed BasePL regressions (vitest expectTypeOf does not catch
 * excess-property failures on `.fn` options). Included by
 * `declaration-emit.test.ts` via `basepl-chain.tsconfig.json`.
 *
 * Parent `use` must remain `BasePL` on nested `.fn` for:
 * - http `path` / `method` (FnOptsExt)
 * - `v.extend` model fields on `c.db.*` (VarExtension / ScopeOf ExtPL)
 */
import { memoryAdapter, v } from "../../src";
import { http } from "../../src/plugins/http";

const app = v.fn("a.", { use: [http] });

export const routed = app.fn("x", { path: "/x", method: "GET" }, async () => ({
	ok: true as const,
}));

routed.$route!.path satisfies "/x";
routed.$route!.method satisfies "GET";

const user = v.var("user", {
	default: null,
	schema: v.object({ id: v.string() }),
});
const userWithEmail = v.extend(user, { email: v.string() });
const db = v.storage(memoryAdapter(), { user: { schema: user } });

const auth = v.fn("auth.", { use: [http, { db }] });
const emailPassword = auth.fn("emailPassword.", {
	use: [{ userWithEmail }],
});

export const signInEmail = emailPassword.fn(
	"sign_in.email",
	{ path: "/sign-in/email", method: "POST" },
	async (c) => {
		const row = await c.db.user.findOne({ email: "a@b.c" });
		row satisfies { id: string; email: string } | null;
		return row;
	},
);

signInEmail.$route!.path satisfies "/sign-in/email";
signInEmail.$route!.method satisfies "POST";
