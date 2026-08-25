/**
 * Auth-sized `use` graph (session + account + user + storage + extends).
 * Declaration emit of these exports must stay under TS7056 - see
 * `declaration-emit.test.ts`.
 */
import { memoryAdapter, v } from "../../src";

const user = v.var("user", {
	default: null,
	schema: v.object({
		id: v.string(),
		name: v.string(),
		email: v.string(),
		emailVerified: v.boolean(),
		image: v.string({ optional: true }),
		createdAt: v.date(),
		updatedAt: v.date(),
	}),
});

const session = v.var("session", {
	default: null,
	schema: v.object({
		id: v.string(),
		userId: v.string(),
		token: v.string(),
		expiresAt: v.date(),
		ipAddress: v.string({ optional: true }),
		userAgent: v.string({ optional: true }),
		createdAt: v.date(),
		updatedAt: v.date(),
	}),
});

const account = v.var("account", {
	default: null,
	schema: v.object({
		id: v.string(),
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
	}),
});

const verification = v.var("verification", {
	default: null,
	schema: v.object({
		id: v.string(),
		identifier: v.string(),
		value: v.string(),
		expiresAt: v.date(),
		createdAt: v.date({ optional: true }),
		updatedAt: v.date({ optional: true }),
	}),
});

const userWithEmail = v.extend(user, { email: v.string() });
const accountWithPassword = v.extend(account, { password: v.string() });

const db = v.storage(memoryAdapter(), {
	user: {
		schema: user,
		fields: { email: { unique: true } },
	},
	session: { schema: session },
	account: { schema: account },
	verification: { schema: verification },
});

const coreUser = {
	user,
	createUser: v.fn(
		"user.create",
		{ use: [{ user }, db], input: user, provides: ["user"] as const },
		async (c) => c.user,
	),
};

const coreSession = {
	session,
	user,
	createSession: v.fn(
		"session.create",
		{
			use: [{ session, user }, db],
			input: session,
			provides: ["session"] as const,
		},
		async (c) => c.session,
	),
};

const coreAccount = {
	account,
	createAccount: v.fn(
		"account.create",
		{
			use: [{ account }, db],
			input: account,
			provides: ["account"] as const,
		},
		async (c) => c.account,
	),
};

const e = v.fn("auth.", {
	use: [
		coreSession,
		coreAccount,
		coreUser,
		{ accountWithPassword, userWithEmail, db },
	],
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

export const signInEmail = e.fn(
	"sign_in.email",
	{
		input: { email: v.string(), password: v.string() },
		errors: { invalid_credentials: {} },
		provides: ["user", "session"] as const,
	},
	async (c) => {
		const u = await db.user.findOne({ email: c.input.email } as {
			email: string;
		});
		if (!u) throw c.error("invalid_credentials");
		return { user: u };
	},
);

// Call-site typing still works on the compact export surface.
signUpEmail({ email: "a@b.c", password: "x" });
signUpEmail.try({ email: "a@b.c", password: "x" });
signUpEmail.with({ user: null });
signInEmail.key satisfies "auth.sign_in.email";
signUpEmail.provides satisfies readonly ["user", "session"];

v.on(signUpEmail, async (_c, next) => next());
