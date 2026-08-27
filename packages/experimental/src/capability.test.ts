import { beforeAll, describe, expect, it } from "vitest";
import {
	type Attestation,
	type Cap,
	CapabilityError,
	capability,
	covers,
	createAgent,
	type Delegation,
	fmtCap,
	fnOf,
	generateKeypair,
	type Invocation,
	type Keypair,
	MAX_DELEGATION_DEPTH,
	mintDelegation,
	mintInvocation,
	permits,
	serve,
	type Transport,
	verifyAttestation,
	verifyDelegation,
	verifyInvocation,
} from "./capability";
import { v } from "./index";

const now = () => Math.floor(Date.now() / 1000);

describe("caps", () => {
	it("names the fn, string or pinned", () => {
		expect(fnOf("profile.read")).toBe("profile.read");
		expect(fnOf({ fn: "profile.update", input: { name: "X" } })).toBe(
			"profile.update",
		);
	});

	it("formats pinned caps with their input", () => {
		expect(fmtCap("profile.read")).toBe("profile.read");
		expect(fmtCap({ fn: "profile.update", input: { name: "X" } })).toBe(
			'profile.update({"name":"X"})',
		);
	});

	it("an unpinned cap permits any input", () => {
		expect(permits(["profile.update"], "profile.update", { name: "A" })).toBe(
			true,
		);
		expect(permits(["profile.update"], "profile.read", undefined)).toBe(false);
	});

	it("a pinned cap permits only matching input", () => {
		const caps: Cap[] = [{ fn: "profile.update", input: { name: "X" } }];
		expect(permits(caps, "profile.update", { name: "X" })).toBe(true);
		expect(permits(caps, "profile.update", { name: "Y" })).toBe(false);
		expect(permits(caps, "profile.update", undefined)).toBe(false);
	});

	it("a pin only constrains the fields it names", () => {
		const caps: Cap[] = [{ fn: "profile.update", input: { name: "X" } }];
		expect(permits(caps, "profile.update", { name: "X", extra: 1 })).toBe(true);
	});

	it("covers: unpinned covers pinned, never the reverse", () => {
		expect(
			covers("profile.update", { fn: "profile.update", input: { name: "X" } }),
		).toBe(true);
		expect(
			covers({ fn: "profile.update", input: { name: "X" } }, "profile.update"),
		).toBe(false);
		expect(
			covers(
				{ fn: "profile.update", input: { name: "X" } },
				{ fn: "profile.update", input: { name: "X", role: "admin" } },
			),
		).toBe(true);
		expect(
			covers(
				{ fn: "profile.update", input: { name: "X" } },
				{ fn: "profile.update", input: { name: "Y" } },
			),
		).toBe(false);
		expect(covers("profile.read", "profile.update")).toBe(false);
	});
});

describe("delegations", () => {
	let server: Keypair;
	let alice: Keypair;
	let bob: Keypair;

	beforeAll(async () => {
		server = await generateKeypair();
		alice = await generateKeypair();
		bob = await generateKeypair();
	});

	const grant = (caps: Cap[], overrides?: Partial<Delegation>) =>
		mintDelegation(server, {
			aud: alice.id,
			sub: "user:1",
			caps,
			exp: now() + 60,
			...overrides,
		});

	it("verifies a root delegation signed by the server", async () => {
		const dlg = await grant(["profile.read"]);
		await expect(verifyDelegation(server.id, dlg)).resolves.toEqual(dlg);
	});

	it("rejects a delegation not rooted at this server", async () => {
		const dlg = await mintDelegation(bob, {
			aud: alice.id,
			sub: "user:1",
			caps: ["profile.read"],
			exp: now() + 60,
		});
		await expect(verifyDelegation(server.id, dlg)).rejects.toThrow(
			/does not root at this server/,
		);
	});

	it("rejects an expired delegation", async () => {
		const dlg = await grant(["profile.read"], { exp: now() - 10 });
		await expect(verifyDelegation(server.id, dlg)).rejects.toThrow(/expired/);
	});

	it("rejects a tampered delegation", async () => {
		const dlg = await grant(["profile.read"]);
		const forged = { ...dlg, caps: ["profile.read", "account.delete"] };
		await expect(verifyDelegation(server.id, forged)).rejects.toThrow(
			/bad delegation signature/,
		);
	});

	it("accepts an attenuating chain", async () => {
		const parent = await grant(["profile.read", "profile.update"]);
		const child = await mintDelegation(alice, {
			aud: bob.id,
			sub: "user:1",
			caps: [{ fn: "profile.update", input: { name: "X" } }],
			exp: now() + 60,
			prf: parent,
		});
		await expect(verifyDelegation(server.id, child)).resolves.toEqual(child);
	});

	it("rejects escalation anywhere in the chain", async () => {
		const parent = await grant(["profile.read"]);
		const child = await mintDelegation(alice, {
			aud: bob.id,
			sub: "user:1",
			caps: ["profile.update"],
			exp: now() + 60,
			prf: parent,
		});
		await expect(verifyDelegation(server.id, child)).rejects.toThrow(
			/escalates: profile.update/,
		);
	});

	it("rejects a link not issued by its parent's audience", async () => {
		const parent = await grant(["profile.read"]);
		const child = await mintDelegation(bob, {
			aud: bob.id,
			sub: "user:1",
			caps: ["profile.read"],
			exp: now() + 60,
			prf: parent,
		});
		await expect(verifyDelegation(server.id, child)).rejects.toThrow(
			/not issued by its parent's audience/,
		);
	});

	it("rejects a chain that changes subject", async () => {
		const parent = await grant(["profile.read"]);
		const child = await mintDelegation(alice, {
			aud: bob.id,
			sub: "user:2",
			caps: ["profile.read"],
			exp: now() + 60,
			prf: parent,
		});
		await expect(verifyDelegation(server.id, child)).rejects.toThrow(
			/changes subject/,
		);
	});

	it("rejects an over-deep chain before walking it all", async () => {
		const root = await generateKeypair();
		const [first, ...rest] = await Promise.all(
			Array.from({ length: MAX_DELEGATION_DEPTH + 3 }, () => generateKeypair()),
		);
		if (!first) throw new Error("expected at least one key");
		let link = await mintDelegation(root, {
			aud: first.id,
			sub: "user:1",
			caps: ["profile.read"],
			exp: now() + 60,
		});
		let issuer = first;
		for (const next of rest) {
			link = await mintDelegation(issuer, {
				aud: next.id,
				sub: "user:1",
				caps: ["profile.read"],
				exp: now() + 60,
				prf: link,
			});
			issuer = next;
		}
		await expect(verifyDelegation(root.id, link)).rejects.toThrow(/too deep/);
	});
});

describe("invocations", () => {
	let server: Keypair;
	let alice: Keypair;
	let mallory: Keypair;
	let dlg: Delegation;

	beforeAll(async () => {
		server = await generateKeypair();
		alice = await generateKeypair();
		mallory = await generateKeypair();
		dlg = await mintDelegation(server, {
			aud: alice.id,
			sub: "user:1",
			caps: ["profile.read"],
			exp: now() + 60,
		});
	});

	it("verifies a spend signed by the delegation's audience", async () => {
		const inv = await mintInvocation(alice, "profile.read", dlg);
		await expect(verifyInvocation(server.id, inv)).resolves.toEqual({
			subject: "user:1",
			caps: ["profile.read"],
			holder: alice.id,
		});
	});

	it("a stolen delegation is inert: only `aud` can spend", async () => {
		const inv = await mintInvocation(mallory, "profile.read", dlg);
		await expect(verifyInvocation(server.id, inv)).rejects.toThrow(
			/not signed by delegation holder/,
		);
	});

	it("rejects a tampered invocation", async () => {
		const inv = await mintInvocation(alice, "profile.read", dlg, { a: 1 });
		const forged = { ...inv, input: { a: 2 } };
		await expect(verifyInvocation(server.id, forged)).rejects.toThrow(
			/bad invocation signature/,
		);
	});

	it("rejects an expired invocation", async () => {
		const inv = await mintInvocation(alice, "profile.read", dlg);
		const stale = { ...inv, exp: now() - 10 };
		await expect(verifyInvocation(server.id, stale)).rejects.toThrow(/expired/);
	});
});

describe("attestations", () => {
	let server: Keypair;
	let other: Keypair;

	beforeAll(async () => {
		server = await generateKeypair();
		other = await generateKeypair();
	});

	const mint = async (issuer: Keypair, exp = now() + 60) => {
		const unsigned = {
			typ: "idt" as const,
			iss: issuer.id,
			sub: "user:1",
			exp,
		};
		// Match the library's canonical (sorted-key) signing format.
		const payload = JSON.stringify({
			exp: unsigned.exp,
			iss: unsigned.iss,
			sub: unsigned.sub,
			typ: unsigned.typ,
		});
		return {
			...unsigned,
			sig: await issuer.sign(payload),
		} satisfies Attestation;
	};

	it("verifies the server's own attestation", async () => {
		const idt = await mint(server);
		await expect(verifyAttestation(server.id, idt)).resolves.toBe("user:1");
	});

	it("rejects attestations from anyone else", async () => {
		const idt = await mint(other);
		await expect(verifyAttestation(server.id, idt)).rejects.toThrow(
			/not signed by this server/,
		);
	});

	it("rejects expired attestations", async () => {
		const idt = await mint(server, now() - 10);
		await expect(verifyAttestation(server.id, idt)).rejects.toThrow(/expired/);
	});
});

/* ------------------------- the served boundary ------------------------- */

const makeApp = async (
	decide?: (request: {
		subject: string;
		caps: Cap[];
		goal?: string;
	}) => "approve" | "challenge" | "deny",
) => {
	const profiles: Record<string, { name: string; email: string }> = {
		"user:1": { name: "Bereket", email: "b@acme.com" },
	};
	const trail: string[] = [];

	const audit = v.fn(
		"audit.log",
		{ input: { event: v.string() } },
		async (c) => {
			trail.push(c.input.event);
			return { ok: true };
		},
	);

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
			await c.audit({ event: `${subject} renamed to "${c.input.name}"` });
			return existing;
		},
	);

	const server = await serve(
		{ signIn, readProfile, updateProfile, audit },
		{
			defaults: (subject) => (subject ? ["profile.read"] : ["sign_in.email"]),
			identify: (result) =>
				(result as { user?: { id?: string } })?.user?.id ?? null,
			decide,
		},
	);

	// The remote boundary: everything crosses as JSON, nothing shares memory.
	const transport: Transport = async (message) =>
		JSON.parse(
			JSON.stringify(
				await server.exec(JSON.parse(JSON.stringify(message)) as never),
			),
		);

	return { server, transport, trail, profiles, signIn };
};

const heldOf = (agent: { held: () => Delegation | null }) => {
	const held = agent.held();
	if (!held) throw new Error("agent holds no delegation");
	return held;
};

const signedInAgent = async (transport: Transport) => {
	const agent = await createAgent(transport);
	await agent.call("sign_in.email", { email: "b@acme.com", password: "pw" });
	return agent;
};

describe("serve", () => {
	it("refuses to start if defaults name an unserved fn", async () => {
		await expect(
			serve({}, { defaults: () => ["nope"], identify: () => null }),
		).rejects.toThrow(/no fn "nope" to have a cap for/);
	});

	it("a new agent is born with only the bootstrap caps", async () => {
		const { transport } = await makeApp();
		const agent = await createAgent(transport);
		expect(agent.held()?.caps).toEqual(["sign_in.email"]);
	});

	it("nothing is public: calls outside held caps are refused", async () => {
		const { transport } = await makeApp();
		const agent = await createAgent(transport);
		await expect(agent.call("profile.read")).rejects.toThrow(
			/"profile.read" refused/,
		);
	});

	it("refuses unknown fns", async () => {
		const { transport } = await makeApp();
		const agent = await createAgent(transport);
		await expect(agent.call("nope")).rejects.toThrow(/no fn "nope"/);
	});

	it("refuses calls with no token", async () => {
		const { transport } = await makeApp();
		await expect(transport({ call: "profile.read" })).rejects.toThrow(
			/no capability presented/,
		);
	});

	it("refuses a token minted for a different fn or input", async () => {
		const { transport } = await makeApp();
		const agent = await createAgent(transport);
		const held = heldOf(agent);
		// Re-mint by hand to mismatch the message.
		const me = await generateKeypair();
		const stolen = await mintInvocation(me, "sign_in.email", held);
		await expect(
			transport({ call: "profile.read", token: stolen }),
		).rejects.toThrow(/minted for a different fn/);
		await expect(
			transport({
				call: "sign_in.email",
				input: { email: "x", password: "y" },
				token: stolen,
			}),
		).rejects.toThrow(/minted for different input/);
	});

	it("sign-in attests, and attestation trades for the defaults", async () => {
		const { transport } = await makeApp();
		const agent = await signedInAgent(transport);
		expect((agent.attestation() as Attestation).sub).toBe("user:1");
		expect(agent.held()?.caps).toEqual(["profile.read"]);
		expect(agent.held()?.sub).toBe("user:1");
	});

	it("held caps spend: profile.read works after sign-in", async () => {
		const { transport } = await makeApp();
		const agent = await signedInAgent(transport);
		await expect(agent.call("profile.read")).resolves.toEqual({
			name: "Bereket",
			email: "b@acme.com",
		});
	});

	it("an agent created with a prior attestation skips the bootstrap", async () => {
		const { transport } = await makeApp();
		const first = await signedInAgent(transport);
		const second = await createAgent(transport, {
			attestation: first.attestation(),
		});
		expect(second.held()?.caps).toEqual(["profile.read"]);
	});

	it("an invocation spends once: a replay of the same token is refused", async () => {
		const { server, transport } = await makeApp();
		const captured: { call: string; input?: unknown; token?: Invocation }[] =
			[];
		const spy: Transport = async (message) => {
			captured.push(message);
			return transport(message);
		};
		const agent = await createAgent(spy);
		await agent.call("sign_in.email", { email: "b@acme.com", password: "pw" });
		await agent.call("profile.read");
		const replay = captured.at(-1);
		if (!replay?.token) throw new Error("no captured invocation to replay");
		await expect(
			server.exec(JSON.parse(JSON.stringify(replay)) as never),
		).rejects.toThrow(/already spent/);
	});

	it("a bad attestation is refused outright", async () => {
		const { transport } = await makeApp();
		const forger = await generateKeypair();
		const forged = {
			typ: "idt",
			iss: forger.id,
			sub: "user:1",
			exp: now() + 60,
			sig: "junk",
		};
		await expect(
			createAgent(transport, { attestation: forged }),
		).rejects.toThrow(/attestation not signed by this server/);
	});
});

describe("the rule: every fn validates its caller", () => {
	it("fn-to-fn inside the process needs no cap: possession is authorization", async () => {
		const { transport, trail } = await makeApp(() => "approve");
		const agent = await signedInAgent(transport);
		await agent.request(["profile.update"]);
		await agent.call("profile.update", { name: "Bekacru" });
		// updateProfile's body called audit.log by reference - no cap ever
		// granted for it, and none needed.
		expect(trail).toEqual(['user:1 renamed to "Bekacru"']);
	});

	it("the same inner fn from the wire is refused", async () => {
		const { transport } = await makeApp();
		const agent = await signedInAgent(transport);
		await expect(agent.call("audit.log", { event: "forged" })).rejects.toThrow(
			/"audit.log" refused/,
		);
	});

	it("a pinned cap authorizes exactly that input", async () => {
		const { transport } = await makeApp(() => "approve");
		const agent = await signedInAgent(transport);
		await agent.request([{ fn: "profile.update", input: { name: "Only" } }]);
		await expect(
			agent.call("profile.update", { name: "Other" }),
		).rejects.toThrow(/"profile.update" refused/);
		await expect(
			agent.call("profile.update", { name: "Only" }),
		).resolves.toMatchObject({ name: "Only" });
	});
});

describe("widening requests", () => {
	it("approve pays out old caps plus the new ones", async () => {
		const { transport } = await makeApp(() => "approve");
		const agent = await signedInAgent(transport);
		const result = await agent.request(["profile.update"]);
		expect(result.status).toBe("approved");
		expect(agent.held()?.caps).toEqual(["profile.read", "profile.update"]);
	});

	it("deny leaves held caps untouched", async () => {
		const { transport } = await makeApp(() => "deny");
		const agent = await signedInAgent(transport);
		const result = await agent.request(["profile.update"]);
		expect(result.status).toBe("denied");
		expect(agent.held()?.caps).toEqual(["profile.read"]);
	});

	it("challenge is the default; deciding settles the re-ask", async () => {
		const { transport, server } = await makeApp();
		const agent = await signedInAgent(transport);
		const asked = await agent.request(["profile.update"], "rename myself");
		expect(asked.status).toBe("challenge");
		// Asking again while pending resumes the same challenge.
		const pending = await agent.request(["profile.update"], "rename myself");
		expect(pending).toEqual({ status: "challenge", id: asked.id });
		server.decide(asked.id, true);
		const again = await agent.request(["profile.update"], "rename myself");
		expect(again.status).toBe("approved");
		await expect(
			agent.call("profile.update", { name: "Bekacru" }),
		).resolves.toMatchObject({ name: "Bekacru" });
	});

	it("a denied challenge answers denied on the re-ask", async () => {
		const { transport, server } = await makeApp();
		const agent = await signedInAgent(transport);
		const asked = await agent.request(["profile.update"]);
		server.decide(asked.id, false);
		const again = await agent.request(["profile.update"]);
		expect(again.status).toBe("denied");
	});

	it("caps for unserved fns cannot even be requested", async () => {
		const { transport } = await makeApp(() => "approve");
		const agent = await signedInAgent(transport);
		await expect(agent.request(["account.delete"])).rejects.toThrow(
			/no fn "account.delete" to have a cap for/,
		);
	});
});

describe("delegation between agents", () => {
	it("a stolen delegation spends nothing", async () => {
		const { transport } = await makeApp();
		const owner = await signedInAgent(transport);
		const thief = await createAgent(transport);
		thief.hold(heldOf(owner)); // aud still points at the owner's key
		await expect(thief.call("profile.read")).rejects.toThrow(
			/not signed by delegation holder/,
		);
	});

	it("a re-minted slice spends under the second agent's own key", async () => {
		const { transport } = await makeApp();
		const owner = await signedInAgent(transport);
		const second = await createAgent(transport);
		second.hold(await owner.delegate(second.id, ["profile.read"]));
		await expect(second.call("profile.read")).resolves.toEqual({
			name: "Bereket",
			email: "b@acme.com",
		});
	});

	it("the slice cannot exceed what the owner held", async () => {
		const { transport } = await makeApp();
		const owner = await signedInAgent(transport);
		const second = await createAgent(transport);
		second.hold(await owner.delegate(second.id, ["profile.update"]));
		await expect(second.call("profile.update", { name: "X" })).rejects.toThrow(
			/escalates: profile.update/,
		);
	});

	it("the second agent acts as the owner's subject", async () => {
		const { transport } = await makeApp();
		const owner = await signedInAgent(transport);
		const second = await createAgent(transport);
		second.hold(await owner.delegate(second.id, ["profile.read"]));
		expect(second.held()?.sub).toBe("user:1");
	});
});

describe("in-process references", () => {
	it("a direct call carries no capability at all", async () => {
		const { signIn } = await makeApp();
		await expect(
			signIn({ email: "b@acme.com", password: "pw" }),
		).resolves.toEqual({
			user: { id: "user:1", email: "b@acme.com" },
		});
	});
});

describe("errors", () => {
	it("all refusals are CapabilityError", () => {
		const err = new CapabilityError("nope");
		expect(err.name).toBe("CapabilityError");
		expect(err).toBeInstanceOf(Error);
	});
});
