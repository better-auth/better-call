/**
 * Consumer failure mode: export the builder itself
 * (`export const app = v.fn("x.", { use: [...] })`), not only terminating
 * `app.fn(...)` results. Under declaration + composite, emit must name
 * Instance / InstanceOn via the package entry (TS2883) and stay under
 * the serialize limit (TS7056).
 */
import { memoryAdapter, v } from "better-call";

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
		password: v.string({ optional: true }),
		createdAt: v.date(),
		updatedAt: v.date(),
	}),
});

const cache = v.var("cache", {
	default: {} as Record<string, string>,
});

const db = v.storage(memoryAdapter(), {
	user: { schema: user, fields: { email: { unique: true } } },
	session: { schema: session },
	account: { schema: account },
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

const coreCache = {
	cache,
	cacheGet: v.fn(
		"cache.get",
		{ use: [{ cache }], input: { key: v.string() } },
		(c) => c.cache[c.input.key],
	),
};

export const app = v.fn("auth.", {
	use: [coreSession, coreAccount, coreUser, coreCache, { db }],
});

// Call-site typing on the exported builder still works.
export const signIn = app.fn(
	"sign_in",
	{ input: { email: v.string() }, provides: ["user"] as const },
	async (c) => {
		c.user = {
			id: "1",
			name: "x",
			email: c.input.email,
			emailVerified: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		return { user: c.user };
	},
);

app.with(signIn, { user: null });
signIn.key satisfies "auth.sign_in";
