import { v } from "../src";
import { db } from "./my-db";

export const user = v.var("user", {
	default: null,
	schema: v.object({
		id: v.string(),
	}),
});

export const session = v.var("session", {
	default: null,
	schema: v.object({ id: v.string(), userId: v.string() }),
});

const auth = v.fn({ use: [{ session, user }] });

/** Reading is the app's own concern: one round-trip answers both vars,
 * and the scope's vars CACHE the rows for everything below - a second
 * call in the same scope never touches the db. */
export const loadSession = auth.fn("load_session", async (c) => {
	const cached = c.var.session.get();
	if (cached) return cached;
	const [u, s] = db.selectMany(["user", "session"]);
	if (u) c.var.user.set(u as never);
	if (s) c.var.session.set(s as never);
	return c.var.session.get();
});

export const createUser = auth.fn("create_user", { input: user }, async (c) => {
	const value = c.var.user.get();
	if (value) db.insert({ table: "user", row: value });
	return c.var.session.get();
});

export const createSession = auth.fn(
	"create_session",
	{ input: session, provides: ["session"] },
	async (c) => {
		const u = c.var.user.get();
		const s = c.var.session.get();
		if (u) db.insert({ table: "user", row: u });
		if (s) db.insert({ table: "session", row: s });
		return { created: true };
	},
);

export const coreSession = {
	createUser,
	createSession,
	loadSession,
	session,
	user,
};
