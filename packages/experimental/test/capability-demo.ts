import { v } from "../src";
import {
	type Attestation,
	capability,
	createAgent,
	fmtCap,
	serve,
} from "../src/capability";

const profiles: Record<string, { name: string; email: string }> = {
	"user:1": { name: "Bereket", email: "b@acme.com" },
};

/* --------------------------------- the fns --------------------------------- */

const trail: string[] = [];

/** Nobody is ever GRANTED this fn: no default pays it out, and the
 * authority below denies every request naming it. It is still reachable -
 * by any fn whose body holds a reference to it. */
const audit = v.fn("audit.log", { input: { event: v.string() } }, async (c) => {
	trail.push(c.input.event);
	return { ok: true };
});

/** Guarded like everything else - this IS the attestation challenge. Its
 * result carries who was proven; authority attests it into an id token. */
const signIn = v.fn(
	"sign_in.email",
	{ input: { email: v.string(), password: v.string() } },
	async (c) => {
		if (c.input.password !== "pw") throw new Error("bad credentials");
		return { user: { id: "user:1", email: c.input.email } };
	},
);

const readProfile = v.fn(
	"profile.read",
	{ use: [{ capability }] },
	async (c) => profiles[c.capability?.subject ?? ""] ?? null,
);

const updateProfile = v.fn(
	"profile.update",
	{ input: { name: v.string() }, use: [{ capability, audit }] },
	async (c) => {
		const subject = c.capability?.subject ?? "";
		const existing = profiles[subject];
		if (!existing) throw new Error("no profile");
		existing.name = c.input.name;
		// fn to fn: no token, no ceremony. `use` handed this body a
		// REFERENCE to audit, and in-process possession IS authorization.
		await c.audit({ event: `${subject} renamed to "${c.input.name}"` });
		return existing;
	},
);

const deleteAccount = v.fn("account.delete", {}, async () => {
	throw new Error("unreachable in this demo");
});

/* --------------------------------- server --------------------------------- */

// Nothing here creates a capability, and nothing is public: the fns
// served ARE the capability space, and every one validates its caller.
// What the AUTHORITY adds is smaller - it never checks a call. It sets
// the initial references (nobody's defaults are more than just enough to
// go prove who they are), reads WHO out of results, and settles requests
// for more.
const server = await serve(
	{ signIn, readProfile, updateProfile, deleteAccount, audit },
	{
		defaults: (subject) => (subject ? ["profile.read"] : ["sign_in.email"]),
		identify: (result) =>
			(result as { user?: { id?: string } })?.user?.id ?? null,
		decide: ({ caps }) =>
			caps.some(
				(cap) =>
					fmtCap(cap).startsWith("account.delete") ||
					fmtCap(cap).startsWith("audit.log"),
			)
				? "deny"
				: "challenge",
	},
);

// The remote boundary: everything crosses as JSON, nothing shares memory.
const transport = async (message: unknown) =>
	JSON.parse(
		JSON.stringify(
			await server.exec(JSON.parse(JSON.stringify(message)) as never),
		),
	);

/* --------------------------------- the arc -------------------------------- */

async function main() {
	// 1. In-process, the reference IS the capability. This module holds
	//    signIn - the v.fn object itself - so it may call it: possession
	//    of the reference is the whole authorization, and there is no
	//    token anywhere in sight. Capability only REIFIES at a boundary,
	//    where a memory reference cannot reach.
	await signIn({ email: "b@acme.com", password: "pw" });
	console.log("1 direct reference   : signIn() called in-process, no token");

	// 2. Born asking: creation requested the defaults. No attestation, so
	//    the authority paid out ONE reference: complete sign-in.
	const agent = await createAgent(transport);
	console.log(
		"2 bootstrap caps     :",
		agent.held()!.caps.map(fmtCap).join(", "),
	);

	// 3. Nothing is public - beyond the challenge, every door is shut.
	await agent
		.call("profile.read")
		.catch((e) => console.log("3 read, no authority :", (e as Error).message));

	// 4. Sign in: a guarded fn like any other, spent with the bootstrap
	//    reference. The result attests WHO - the agent keeps the
	//    attestation and trades it for the default caps in the background.
	await agent.call("sign_in.email", { email: "b@acme.com", password: "pw" });
	console.log(
		"4 signed in as       :",
		(agent.attestation() as Attestation).sub,
	);
	console.log(
		"  traded for caps    :",
		agent.held()!.caps.map(fmtCap).join(", "),
	);

	// 5. Spend: every call re-mints a fresh single-use invocation.
	console.log(
		"5 profile.read       :",
		JSON.stringify(await agent.call("profile.read")),
	);

	// 6. Outside held references: the fn's own check refuses the caller.
	await agent
		.call("profile.update", { name: "X" })
		.catch((e) => console.log("6 update w/o cap     :", (e as Error).message));

	// 7. Request more: the authority says challenge -> the user approves
	//    -> the SAME request, asked again, pays out. No separate claim.
	const asked = await agent.request(["profile.update"], "rename myself");
	console.log("7 request            :", asked.status, asked.id);
	server.decide(asked.id, true); // the user, out of band
	const again = await agent.request(["profile.update"], "rename myself");
	console.log("  asked again        :", again.status);
	console.log(
		"  profile.update     :",
		JSON.stringify(await agent.call("profile.update", { name: "Bekacru" })),
	);

	// 8. Two fns calling each other. update's body just called audit.log -
	//    a fn the remote caller was NEVER granted and never could be. The
	//    body held a direct reference (from `use`), and inside the process
	//    that possession is the authorization; the wire hop was already
	//    validated at profile.update, so no token exists for the inner
	//    call and none is needed.
	console.log("8 fn-to-fn, implied  :", JSON.stringify(trail));
	//    The SAME fn from outside: the remote caller holds no reference to
	//    audit.log - only reified ones it can prove - so audit.log itself
	//    refuses the call...
	await agent
		.call("audit.log", { event: "forged" })
		.catch((e) => console.log("  from the wire      :", (e as Error).message));
	//    ...and the authority won't even open a challenge for it.
	console.log(
		"  audit.log request  :",
		(await agent.request(["audit.log"])).status,
	);

	// 9. Some references are never issued, by decision.
	console.log(
		"9 account.delete req :",
		(await agent.request(["account.delete"])).status,
	);

	// 10. Delegation: a second agent with a STOLEN delegation gets nothing -
	//     only a re-mint addressed to its key spends.
	const second = await createAgent(transport);
	second.hold(agent.held()!); // stolen: aud is still the first agent
	await second
		.call("profile.read")
		.catch((e) => console.log("10 stolen token      :", (e as Error).message));
	second.hold(await agent.delegate(second.id, ["profile.read"]));
	console.log(
		"   re-minted for them:",
		JSON.stringify(await second.call("profile.read")),
	);

	// 11. Attenuation holds: the delegate cannot spend beyond its slice...
	await second
		.call("profile.update", { name: "Mallory" })
		.catch((e) => console.log("11 beyond slice      :", (e as Error).message));
	//     ...and cannot re-delegate an escalated slice into a working chain.
	const third = await createAgent(transport);
	third.hold(await second.delegate(third.id, ["profile.update"]));
	await third
		.call("profile.update", { name: "Mallory" })
		.catch((e) => console.log("   escalated chain   :", (e as Error).message));

	// 12. The reference IS (fn, input): the same fn can be delegated
	//     pinned to specific input - not "may update the profile" but
	//     "may set the name to exactly this".
	const renamer = await createAgent(transport);
	renamer.hold(
		await agent.delegate(renamer.id, [
			{ fn: "profile.update", input: { name: "Bekacru II" } },
		]),
	);
	console.log(
		"12 pinned input      :",
		JSON.stringify(
			await renamer.call("profile.update", { name: "Bekacru II" }),
		),
	);
	await renamer
		.call("profile.update", { name: "Mallory" })
		.catch((e) => console.log("   other input       :", (e as Error).message));

	// 13. Attestation outlives the agent: a NEW agent (new keypair) born
	//     with the same attestation skips sign-in - straight to the
	//     default references.
	const reborn = await createAgent(transport, {
		attestation: agent.attestation()!,
	});
	console.log(
		"13 reborn caps       :",
		reborn.held()!.caps.map(fmtCap).join(", "),
	);
	console.log(
		"   profile.read      :",
		JSON.stringify(await reborn.call("profile.read")),
	);
}

main();
