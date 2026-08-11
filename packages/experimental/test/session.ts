import { v } from "../src";
import { cookieOptions, setCookie } from "../src/plugins/http";
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

export const sessionCookie = v.derive(
	"sessionCookie",
	cookieOptions,
	(base) => ({
		name: "session_id",
		options: {
			...base,
			httpOnly: true,
			sameSite: "lax" as const,
			maxAge: 60 * 60 * 24 * 7,
		},
	}),
);

const s = v.fn({
	use: [{ session, user, sessionCookie, cookieOptions }, { setCookie }],
});

export const createUser = s.fn("create_user", { input: user }, async (c) => {
	const value = c.user;
	if (value) db.insert({ table: "user", row: value });
	return c.session;
});

export const createSession = s.fn(
	"create_session",
	{ input: session, provides: ["session"] },
	async (c) => {
		const u = c.user;
		const s = c.session;
		if (u) db.insert({ table: "user", row: u });
		if (s) {
			db.insert({ table: "session", row: s });
			const cookie = c.sessionCookie;
			c.setCookie({
				name: cookie.name,
				value: s.id,
				options: cookie.options,
			});
		}
		return { created: true };
	},
);

export const coreSession = {
	createUser,
	createSession,
	session,
	user,
	sessionCookie,
};
