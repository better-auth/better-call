import { v } from "../src";

export const session = v.var("session", {
	default: null,
	schema: v.object({ userId: v.string() }),
});

export const user = v.var("user", {
	default: null,
	schema: v.object({
		id: v.string(),
	}),
});

const sessionStore = v.persist(session, {
	async save(_value, _prev, _c, _info) {
		//...save session to storage
	},
	load: (_c) => {
		return { userId: "user-id" };
	},
});

const auth = v.fn({ use: [{ session, user }] });

export const createUser = auth.fn("create_user", { input: user }, async (c) => {
	//...create user
	await sessionStore.save({ userId: "user-id" }, null, c, { fields: null });
	return c.var.user;
});

export const createSession = auth.fn(
	"create_session",
	{ input: { userId: v.string() }, provides: ["session"] },
	async (c) => {
		///...create session
		c.var.session.set({ userId: c.input.userId });
		console.log("user var:", c.var.user);
		return { created: true };
	},
);

export const coreSession = {
	createUser,
	createSession,
	session,
	user,
};
