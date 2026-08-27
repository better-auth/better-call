/**
 * Larger capability example: endpoint-shaped fns + a fuller Authority.
 *
 * Run: npx tsx test/capability-api-demo.ts
 *
 * Models a small multi-tenant API. Caps are fn keys (optionally pinned).
 * `serve` never invents policy — the Authority object below does.
 */
import { v } from "../src";
import {
	type Attestation,
	type Cap,
	capability,
	createAgent,
	fmtCap,
	fnOf,
	serve,
} from "../src/capability";

/* --------------------------------- data --------------------------------- */

type Role = "member" | "owner" | "admin";

const users: Record<
	string,
	{ email: string; password: string; name: string; role: Role; orgId: string }
> = {
	"user:alice": {
		email: "alice@acme.com",
		password: "alice-pw",
		name: "Alice",
		role: "owner",
		orgId: "org:acme",
	},
	"user:bob": {
		email: "bob@acme.com",
		password: "bob-pw",
		name: "Bob",
		role: "member",
		orgId: "org:acme",
	},
	"user:root": {
		email: "root@acme.com",
		password: "root-pw",
		name: "Root",
		role: "admin",
		orgId: "org:acme",
	},
};

const posts: Record<
	string,
	{ id: string; orgId: string; authorId: string; title: string; body: string }
> = {
	"post:1": {
		id: "post:1",
		orgId: "org:acme",
		authorId: "user:alice",
		title: "Hello",
		body: "first post",
	},
};

const auditTrail: string[] = [];

const findUserByEmail = (email: string) =>
	Object.entries(users).find(([, u]) => u.email === email);

/* ------------------------------ endpoint fns ------------------------------ */

/** Internal only — never in defaults, always denied if requested on the wire. */
const audit = v.fn("audit.log", { input: { event: v.string() } }, async (c) => {
	auditTrail.push(c.input.event);
	return { ok: true };
});

const signUp = v.fn(
	"auth.sign_up",
	{
		input: {
			email: v.string(),
			password: v.string(),
			name: v.string(),
		},
	},
	async (c) => {
		if (findUserByEmail(c.input.email)) throw new Error("email taken");
		const id = `user:${c.input.email.split("@")[0]}`;
		users[id] = {
			email: c.input.email,
			password: c.input.password,
			name: c.input.name,
			role: "member",
			orgId: "org:acme",
		};
		return { user: { id, email: c.input.email, role: "member" as Role } };
	},
);

const signIn = v.fn(
	"auth.sign_in",
	{ input: { email: v.string(), password: v.string() } },
	async (c) => {
		const found = findUserByEmail(c.input.email);
		if (!found || found[1].password !== c.input.password) {
			throw new Error("bad credentials");
		}
		const [id, user] = found;
		return { user: { id, email: user.email, role: user.role } };
	},
);

const me = v.fn("auth.me", { use: [{ capability }] }, async (c) => {
	const id = c.capability?.subject ?? "";
	const user = users[id];
	if (!user) return null;
	return { id, email: user.email, name: user.name, role: user.role };
});

const readProfile = v.fn(
	"profile.read",
	{ use: [{ capability }] },
	async (c) => {
		const id = c.capability?.subject ?? "";
		const user = users[id];
		return user ? { id, name: user.name, email: user.email } : null;
	},
);

const updateProfile = v.fn(
	"profile.update",
	{
		input: { name: v.string() },
		use: [{ capability, audit }],
	},
	async (c) => {
		const id = c.capability?.subject ?? "";
		const user = users[id];
		if (!user) throw new Error("no profile");
		user.name = c.input.name;
		await c.audit({ event: `${id} renamed to "${c.input.name}"` });
		return { id, name: user.name, email: user.email };
	},
);

const listPosts = v.fn("posts.list", { use: [{ capability }] }, async (c) => {
	const id = c.capability?.subject ?? "";
	const user = users[id];
	if (!user) return [];
	return Object.values(posts).filter((p) => p.orgId === user.orgId);
});

const createPost = v.fn(
	"posts.create",
	{
		input: { title: v.string(), body: v.string() },
		use: [{ capability, audit }],
	},
	async (c) => {
		const id = c.capability?.subject ?? "";
		const user = users[id];
		if (!user) throw new Error("no user");
		const postId = `post:${Object.keys(posts).length + 1}`;
		const post = {
			id: postId,
			orgId: user.orgId,
			authorId: id,
			title: c.input.title,
			body: c.input.body,
		};
		posts[postId] = post;
		await c.audit({ event: `${id} created ${postId}` });
		return post;
	},
);

const updatePost = v.fn(
	"posts.update",
	{
		input: { id: v.string(), title: v.string() },
		use: [{ capability }],
	},
	async (c) => {
		const subject = c.capability?.subject ?? "";
		const post = posts[c.input.id];
		if (!post) throw new Error("not found");
		const user = users[subject];
		if (!user || post.orgId !== user.orgId) throw new Error("forbidden");
		post.title = c.input.title;
		return post;
	},
);

const deletePost = v.fn(
	"posts.delete",
	{ input: { id: v.string() }, use: [{ capability, audit }] },
	async (c) => {
		const subject = c.capability?.subject ?? "";
		const post = posts[c.input.id];
		if (!post) throw new Error("not found");
		const user = users[subject];
		if (!user || post.orgId !== user.orgId) throw new Error("forbidden");
		delete posts[c.input.id];
		await c.audit({ event: `${subject} deleted ${c.input.id}` });
		return { ok: true };
	},
);

const inviteMember = v.fn(
	"org.invite",
	{
		input: { email: v.string(), role: v.string() },
		use: [{ capability, audit }],
	},
	async (c) => {
		const subject = c.capability?.subject ?? "";
		await c.audit({
			event: `${subject} invited ${c.input.email} as ${c.input.role}`,
		});
		return { invited: c.input.email, role: c.input.role };
	},
);

const readBilling = v.fn(
	"billing.read",
	{ use: [{ capability }] },
	async (c) => {
		const id = c.capability?.subject ?? "";
		const user = users[id];
		return {
			orgId: user?.orgId ?? null,
			plan: "pro",
			seats: 5,
		};
	},
);

const updateBilling = v.fn(
	"billing.update",
	{
		input: { plan: v.string() },
		use: [{ capability, audit }],
	},
	async (c) => {
		const id = c.capability?.subject ?? "";
		await c.audit({ event: `${id} set plan to ${c.input.plan}` });
		return { plan: c.input.plan };
	},
);

const listUsers = v.fn(
	"admin.users.list",
	{ use: [{ capability }] },
	async () =>
		Object.entries(users).map(([id, u]) => ({
			id,
			email: u.email,
			role: u.role,
		})),
);

const setRole = v.fn(
	"admin.users.set_role",
	{
		input: { userId: v.string(), role: v.string() },
		use: [{ capability, audit }],
	},
	async (c) => {
		const user = users[c.input.userId];
		if (!user) throw new Error("not found");
		user.role = c.input.role as Role;
		await c.audit({
			event: `${c.capability?.subject} set ${c.input.userId} → ${c.input.role}`,
		});
		return { id: c.input.userId, role: user.role };
	},
);

const deleteAccount = v.fn(
	"account.delete",
	{ use: [{ capability, audit }] },
	async (c) => {
		const id = c.capability?.subject ?? "";
		await c.audit({ event: `${id} deleted account` });
		delete users[id];
		return { ok: true };
	},
);

/* -------------------------------- authority -------------------------------- */

/** Caps that must never be granted on the wire (inner helpers only). */
const NEVER_GRANT = new Set(["audit.log"]);

/** Caps that destroy data / money — always human challenge or deny. */
const SENSITIVE = new Set([
	"posts.delete",
	"billing.update",
	"account.delete",
	"admin.users.set_role",
]);

/** Caps auto-approved for a given role when requested. */
const AUTO_APPROVE: Record<Role, Cap[]> = {
	member: ["profile.update", "posts.create", "posts.update"],
	owner: [
		"profile.update",
		"posts.create",
		"posts.update",
		"posts.delete",
		"org.invite",
		"billing.read",
	],
	admin: [
		"profile.update",
		"posts.create",
		"posts.update",
		"posts.delete",
		"org.invite",
		"billing.read",
		"billing.update",
		"admin.users.list",
		"admin.users.set_role",
	],
};

const roleOf = (subject: string): Role | null => users[subject]?.role ?? null;

const coversRequested = (allowed: Cap[], requested: Cap[]) =>
	requested.every((want) =>
		allowed.some(
			(have) =>
				fnOf(have) === fnOf(want) &&
				// unpinned allowed covers any pin; identical pins match
				(typeof have === "string" ||
					typeof want === "string" ||
					JSON.stringify(have.input) === JSON.stringify(want.input)),
		),
	);

const modules = {
	signUp,
	signIn,
	me,
	readProfile,
	updateProfile,
	listPosts,
	createPost,
	updatePost,
	deletePost,
	inviteMember,
	readBilling,
	updateBilling,
	listUsers,
	setRole,
	deleteAccount,
	audit,
};

const server = await serve(modules, {
	ttl: 3600,

	/**
	 * First grant after createAgent / after attestation trades in.
	 * null subject = anonymous bootstrap (only enough to become someone).
	 */
	defaults: (subject) => {
		if (!subject) return ["auth.sign_in", "auth.sign_up"];

		const role = roleOf(subject);
		if (role === "admin") {
			return [
				"auth.me",
				"profile.read",
				"posts.list",
				"admin.users.list",
				"billing.read",
			];
		}
		if (role === "owner") {
			return ["auth.me", "profile.read", "posts.list", "billing.read"];
		}
		// members
		return ["auth.me", "profile.read", "posts.list"];
	},

	/** Any fn result can prove WHO — here auth.sign_in / auth.sign_up. */
	identify: (result) =>
		(result as { user?: { id?: string } } | null)?.user?.id ?? null,

	/**
	 * Widening policy when agent.request(caps) is called.
	 * approve  → mint immediately
	 * challenge → park until server.decide(id, true|false)
	 * deny     → refuse
	 */
	decide: ({ subject, caps, goal }) => {
		if (caps.some((cap) => NEVER_GRANT.has(fnOf(cap)))) return "deny";

		const role = roleOf(subject);
		if (!role) return "deny";

		// Account suicide always needs an explicit human OK + matching goal.
		if (caps.some((cap) => fnOf(cap) === "account.delete")) {
			return goal === "I understand this is permanent" ? "challenge" : "deny";
		}

		const auto = AUTO_APPROVE[role];
		const withinRole = coversRequested(auto, caps);
		if (!withinRole && role !== "admin") return "deny";

		// Destructive / money-moving caps always need a human, even for admin.
		if (caps.some((cap) => SENSITIVE.has(fnOf(cap)))) {
			if (
				caps.some((cap) => fnOf(cap) === "posts.delete") &&
				goal === "cleanup"
			) {
				return "approve";
			}
			return "challenge";
		}

		return "approve";
	},
});

const transport = async (message: unknown) =>
	JSON.parse(
		JSON.stringify(
			await server.exec(JSON.parse(JSON.stringify(message)) as never),
		),
	);

const logCaps = (
	label: string,
	agent: { held: () => { caps: Cap[] } | null },
) =>
	console.log(
		label,
		(agent.held()?.caps ?? []).map(fmtCap).join(", ") || "(none)",
	);

/* ---------------------------------- arc ---------------------------------- */

async function main() {
	console.log("=== anonymous bootstrap ===");
	const alice = await createAgent(transport);
	logCaps("alice bootstrap:", alice);
	await alice
		.call("posts.list")
		.catch((e) => console.log("posts.list blocked:", (e as Error).message));

	console.log("\n=== sign in as Alice (owner) ===");
	await alice.call("auth.sign_in", {
		email: "alice@acme.com",
		password: "alice-pw",
	});
	console.log("subject:", (alice.attestation() as Attestation).sub);
	logCaps("alice defaults:", alice);
	console.log("auth.me:", await alice.call("auth.me"));
	console.log("posts.list:", await alice.call("posts.list"));

	console.log("\n=== auto-approve: posts.create (owner) ===");
	const created = await alice.request(["posts.create"]);
	console.log("request posts.create:", created.status);
	console.log(
		"create:",
		await alice.call("posts.create", {
			title: "Second",
			body: "from capability demo",
		}),
	);

	console.log("\n=== challenge: posts.delete without cleanup goal ===");
	const delAsk = await alice.request(["posts.delete"], "remove spam");
	console.log("request:", delAsk.status, delAsk.id);
	server.decide(delAsk.id!, true);
	const delAgain = await alice.request(["posts.delete"], "remove spam");
	console.log("after approve:", delAgain.status);
	console.log("delete:", await alice.call("posts.delete", { id: "post:1" }));

	console.log("\n=== deny: member cannot get admin caps ===");
	const bob = await createAgent(transport);
	await bob.call("auth.sign_in", {
		email: "bob@acme.com",
		password: "bob-pw",
	});
	logCaps("bob defaults:", bob);
	console.log(
		"bob asks admin.users.list:",
		(await bob.request(["admin.users.list"])).status,
	);
	console.log(
		"bob asks posts.create (auto):",
		(await bob.request(["posts.create"])).status,
	);

	console.log("\n=== admin path ===");
	const root = await createAgent(transport);
	await root.call("auth.sign_in", {
		email: "root@acme.com",
		password: "root-pw",
	});
	logCaps("root defaults:", root);
	console.log("users:", await root.call("admin.users.list"));
	const roleAsk = await root.request(["admin.users.set_role"]);
	console.log("set_role request (sensitive):", roleAsk.status, roleAsk.id);
	server.decide(roleAsk.id!, true);
	await root.request(["admin.users.set_role"]);
	console.log(
		"promote bob:",
		await root.call("admin.users.set_role", {
			userId: "user:bob",
			role: "owner",
		}),
	);

	console.log("\n=== wire cannot call audit.log; body can ===");
	await alice
		.call("audit.log", { event: "forged" })
		.catch((e) => console.log("from wire:", (e as Error).message));
	console.log(
		"request audit.log:",
		(await alice.request(["audit.log"])).status,
	);
	console.log("audit trail (from inner use):", auditTrail);

	console.log("\n=== pinned delegation: Bob may only rename to Coach ===");
	await bob.request(["profile.update"]); // bob is now owner after promote
	const coach = await createAgent(transport);
	coach.hold(
		await bob.delegate(coach.id, [
			{ fn: "profile.update", input: { name: "Coach" } },
		]),
	);
	console.log(
		"pinned ok:",
		await coach.call("profile.update", { name: "Coach" }),
	);
	await coach
		.call("profile.update", { name: "Hacker" })
		.catch((e) => console.log("other name:", (e as Error).message));
}

main();
