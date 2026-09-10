/**
 * Consumer failure mode: export terminating fns from builders that `use`
 * a model var + `db` storage, plus sibling core bags and a larger
 * `signUpEmail`-style builder. Must emit under TS7056 without annotating
 * each export as `FnDefination<...>`.
 */
import { memoryAdapter, v } from "../../src";
import { id, schema, unique } from "../../src/plugins/db";

const user = schema("user", {
	id: id(v.string()),
	name: v.string(),
	email: unique(v.string()),
	emailVerified: v.boolean(),
	image: v.string({ optional: true }),
	createdAt: v.date(),
	updatedAt: v.date(),
});

const account = schema("account", {
	id: id(v.string()),
	userId: v.string(),
	accountId: v.string(),
	providerId: v.string(),
	accessToken: v.string({ optional: true }),
	refreshToken: v.string({ optional: true }),
	accessTokenExpiresAt: v.date({ optional: true }),
	refreshTokenExpiresAt: v.date({ optional: true }),
	scope: v.string({ optional: true }),
	idToken: v.string({ optional: true }),
	password: v.string({ optional: true }),
	createdAt: v.date(),
	updatedAt: v.date(),
});

const session = schema("session", {
	id: id(v.string()),
	userId: v.string(),
	token: v.string(),
	expiresAt: v.date(),
	ipAddress: v.string({ optional: true }),
	userAgent: v.string({ optional: true }),
	createdAt: v.date(),
	updatedAt: v.date(),
});

const db = v.storage(memoryAdapter(), {
	user: { schema: user },
	session: { schema: session },
	account: { schema: account },
});

const a = v.fn("auth.", { use: [{ account, db }] });

export const createAccount = a.fn(
	"create_account",
	{ input: account, provides: ["account"] as const },
	async (c) => {
		const row = await c.db.account.create(c.input);
		c.account = row;
		return row;
	},
);

const u = v.fn("user.", { use: [{ user, db }] });

export const createUser = u.fn(
	"create_user",
	{ input: user, provides: ["user"] as const },
	async (c) => {
		const row = await c.db.user.create(c.input);
		c.user = row;
		return row;
	},
);

export const findUser = u.fn(
	"find_user",
	{ input: { email: v.string() } },
	async (c) => c.db.user.findOne({ email: c.input.email }),
);

const s = v.fn("session.", { use: [{ session, user, db }] });

export const createSession = s.fn(
	"create_session",
	{ input: session, provides: ["session"] as const },
	async (c) => {
		const row = await c.db.session.create(c.input);
		c.session = row;
		return row;
	},
);

export const coreUser = { user, createUser, findUser };
export const coreAccount = { account, createAccount };
export const coreSession = { session, user, createSession };

const e = v.fn("auth.", {
	use: [coreSession, coreAccount, coreUser, { db }],
});

export const signUpEmail = e.fn(
	"sign_up.email",
	{
		input: {
			email: v.string(),
			password: v.string(),
			name: v.string({ optional: true }),
		},
		errors: { user_already_exists: {} },
		provides: ["user", "session"] as const,
	},
	async (c) => {
		c.user = {
			id: "1",
			name: c.input.name ?? "x",
			email: c.input.email,
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		c.session = {
			id: "s1",
			userId: "1",
			token: "t",
			expiresAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		return { user: c.user, session: c.session };
	},
);

export const emailPassword = { signUpEmail };

// Call-site typing still works on the compact export surface.
createAccount.with({ account: null });
a.with(createAccount, { account: null });
createUser.try({
	name: "Ada",
	email: "a@b.c",
	emailVerified: false,
	createdAt: new Date(),
	updatedAt: new Date(),
});
signUpEmail({ email: "a@b.c", password: "x" });
signUpEmail.try({ email: "a@b.c", password: "x" });
signUpEmail.key satisfies "auth.sign_up.email";
signUpEmail.provides satisfies readonly ["user", "session"];
createAccount.provides satisfies readonly ["account"];
