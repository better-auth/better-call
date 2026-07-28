import { collectFns, type FnDefination, type Module, v } from "../src";

/*
 * Capability security in one sentence: a fn may be called exactly by
 * whoever HOLDS A REFERENCE to it, and every fn validates that about its
 * caller before doing anything.
 *
 * How the reference arrives is the whole story. In one process it is the
 * fn object itself: if a body can name a fn (`use`, an import, a
 * closure), some scope that held the reference chose to hand it over -
 * so fn-to-fn calls carry no token and check nothing. Across a boundary
 * no memory reference can travel, so the reference is REIFIED: a signed
 * delegation naming the fn (optionally pinned to input), exercised one
 * call at a time by a signed invocation. Same model, two encodings.
 *
 * AUTHORITY is a separate, smaller concern. It never checks a call -
 * `validateCaller` owns that. It decides what references a caller STARTS
 * with, what counts as proof of WHO a caller acts for, and how requests
 * for more references are settled.
 */

/* --------------------------------- crypto --------------------------------- */

const subtle = globalThis.crypto.subtle;

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
	Buffer.from(bytes as Uint8Array).toString("base64url");

const utf8 = (text: string) => new TextEncoder().encode(text);

export type Keypair = {
	/** base64url raw public key - the agent's identity. */
	id: string;
	sign: (payload: string) => Promise<string>;
};

export const generateKeypair = async (): Promise<Keypair> => {
	const pair = (await subtle.generateKey({ name: "Ed25519" }, true, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const id = b64(await subtle.exportKey("raw", pair.publicKey));
	return {
		id,
		sign: async (payload) =>
			b64(await subtle.sign("Ed25519", pair.privateKey, utf8(payload))),
	};
};

const verifySignature = async (
	publicKeyId: string,
	payload: string,
	signature: string,
) => {
	const key = await subtle.importKey(
		"raw",
		Buffer.from(publicKeyId, "base64url"),
		{ name: "Ed25519" },
		false,
		["verify"],
	);
	return subtle.verify(
		"Ed25519",
		key,
		Buffer.from(signature, "base64url"),
		utf8(payload),
	);
};

/* -------------------------------- references ------------------------------- */

/**
 * A capability is a REFERENCE to a fn, written down. It is never created
 * or registered - it is inferred from the fn it names - and it answers
 * exactly one question: may the holder call THAT fn, with THAT input?
 * `"profile.update"` says yes for any input; adding an input pin
 * (`{ fn: "profile.update", input: { name: "X" } }`) says yes only when
 * the pinned fields match. Nothing else exists to define.
 */
export type Cap = string | { fn: string; input?: Record<string, unknown> };

export const fnOf = (cap: Cap) => (typeof cap === "string" ? cap : cap.fn);

const pinOf = (cap: Cap) => (typeof cap === "string" ? undefined : cap.input);

export const fmtCap = (cap: Cap) =>
	typeof cap === "string" || !cap.input
		? fnOf(cap)
		: `${cap.fn}(${JSON.stringify(cap.input)})`;

const sameJson = (a: unknown, b: unknown) =>
	JSON.stringify(a) === JSON.stringify(b);

/** Does `parent` cover `child`? Same fn, and child at least as narrow:
 * every field the parent pins, the child pins to the same value. */
const covers = (parent: Cap, child: Cap) => {
	if (fnOf(parent) !== fnOf(child)) return false;
	const pin = pinOf(parent);
	if (!pin) return true;
	const childPin = pinOf(child);
	if (!childPin) return false;
	return Object.entries(pin).every(([field, value]) =>
		sameJson(childPin[field], value),
	);
};

/** Does any held reference authorize calling `fn` with `input`? */
export const permits = (caps: Cap[], fn: string, input: unknown) =>
	caps.some((cap) => {
		if (fnOf(cap) !== fn) return false;
		const pin = pinOf(cap);
		if (!pin) return true;
		return Object.entries(pin).every(([field, value]) =>
			sameJson((input as Record<string, unknown>)?.[field], value),
		);
	});

/* --------------------------------- the wire -------------------------------- */

/** A reference changing hands: the issuer hands the audience a slice of
 * the references it holds, signed. Chains, and only ever narrows. */
export type Delegation = {
	typ: "dlg";
	/** Public key that signed this link. */
	iss: string;
	/** Public key allowed to spend or re-delegate it. */
	aud: string;
	/** Whose authority this is ("user:1"). */
	sub: string;
	/** The references this link hands over - each child must attenuate. */
	caps: Cap[];
	exp: number;
	/** Parent link; absent means iss must be the server root key. */
	prf?: Delegation;
	sig: string;
};

/** One exercise of a held reference: minted fresh per call, signed by
 * the delegation's audience. The INPUT is inside the signature - the
 * token authorizes this exact call with this exact input, nothing else. */
export type Invocation = {
	typ: "inv";
	iss: string;
	call: string;
	input?: unknown;
	exp: number;
	nonce: string;
	prf: Delegation;
	sig: string;
};

const now = () => Math.floor(Date.now() / 1000);

const payloadOf = (token: Record<string, unknown>) => {
	const { sig, ...rest } = token;
	return JSON.stringify(rest);
};

export const mintDelegation = async (
	issuer: Keypair,
	body: Omit<Delegation, "typ" | "iss" | "sig">,
): Promise<Delegation> => {
	const unsigned = { typ: "dlg" as const, iss: issuer.id, ...body };
	return { ...unsigned, sig: await issuer.sign(payloadOf(unsigned)) };
};

export const mintInvocation = async (
	holder: Keypair,
	call: string,
	proof: Delegation,
	input?: unknown,
): Promise<Invocation> => {
	const unsigned = {
		typ: "inv" as const,
		iss: holder.id,
		call,
		input,
		exp: now() + 30,
		nonce: b64(crypto.getRandomValues(new Uint8Array(8))),
		prf: proof,
	};
	return { ...unsigned, sig: await holder.sign(payloadOf(unsigned)) };
};

export class CapabilityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CapabilityError";
	}
}

/** Walk the chain: every link signed, attenuating, unexpired, rooted. */
const verifyDelegation = async (
	root: string,
	link: Delegation,
): Promise<Delegation> => {
	if (link.typ !== "dlg") throw new CapabilityError("not a delegation");
	if (link.exp < now()) throw new CapabilityError("delegation expired");
	if (!(await verifySignature(link.iss, payloadOf(link), link.sig))) {
		throw new CapabilityError("bad delegation signature");
	}
	if (!link.prf) {
		if (link.iss !== root) {
			throw new CapabilityError("chain does not root at this server");
		}
		return link;
	}
	const parent = await verifyDelegation(root, link.prf);
	if (parent.aud !== link.iss) {
		throw new CapabilityError("delegation not issued by its parent's audience");
	}
	if (parent.sub !== link.sub) {
		throw new CapabilityError("delegation changes subject");
	}
	for (const cap of link.caps) {
		if (!parent.caps.some((held) => covers(held, cap))) {
			throw new CapabilityError(`delegation escalates: ${fmtCap(cap)}`);
		}
	}
	return link;
};

/**
 * Proves the sender genuinely HOLDS a chain of references: every link
 * signed, attenuating, unexpired, rooted at this server, and the spend
 * itself signed by the chain's audience. Deliberately silent on whether
 * the chain covers any particular call - that is the callee's question,
 * and every fn asks it itself (see `validateCaller`).
 */
export const verifyInvocation = async (root: string, token: Invocation) => {
	if (token?.typ !== "inv") throw new CapabilityError("not an invocation");
	if (token.exp < now()) throw new CapabilityError("invocation expired");
	if (!(await verifySignature(token.iss, payloadOf(token), token.sig))) {
		throw new CapabilityError("bad invocation signature");
	}
	const proof = await verifyDelegation(root, token.prf);
	// Proof of possession: ONLY the delegation's audience can spend it. A
	// stolen delegation is inert - spending demands a re-mint by `aud`.
	if (proof.aud !== token.iss) {
		throw new CapabilityError("invocation not signed by delegation holder");
	}
	return { subject: proof.sub, caps: proof.caps, holder: token.iss };
};

/* ------------------------------- attestation ------------------------------- */

/** Proof of WHO, not of what may be called: the server attesting with
 * its own signature whom an agent acts for. Not a reference - it grants
 * nothing by itself; it trades for the subject's default references at
 * `capability.request`. What passes as attestation is the authority's
 * policy, so a server may accept something else entirely (an IDP's JWT,
 * a session id). */
export type Attestation = {
	typ: "idt";
	/** The server key that attested. */
	iss: string;
	/** The proven subject ("user:1"). */
	sub: string;
	exp: number;
	sig: string;
};

export const verifyAttestation = async (root: string, token: Attestation) => {
	if (token?.typ !== "idt") throw new CapabilityError("not an attestation");
	if (token.exp < now()) throw new CapabilityError("attestation expired");
	if (token.iss !== root) {
		throw new CapabilityError("attestation not signed by this server");
	}
	if (!(await verifySignature(token.iss, payloadOf(token), token.sig))) {
		throw new CapabilityError("bad attestation signature");
	}
	return token.sub;
};

/* --------------------------------- the rule -------------------------------- */

/** What the boundary verified about the current call tree. `entry` names
 * the one fn the wire call targeted - the single frame with no memory
 * reference behind it - and clears once that frame's check passes. */
export const capability = v.var("capability", {
	default: null as null | {
		subject: string;
		caps: Cap[];
		holder: string;
		entry: string | null;
	},
});

/**
 * The one rule of the whole model, mounted on every served fn: before
 * the body runs, WAS THE CALLER AUTHORIZED TO MAKE THIS CALL WITH THIS
 * INPUT? The authorization is a reference, and it arrives two ways:
 *
 * - Direct: the caller is another fn whose body holds this fn in memory
 *   (`use`, an import, a closure). Possession IS authorization - some
 *   scope that held the reference chose to hand it over - so there is
 *   nothing to verify. This is every in-process fn-to-fn call, and it is
 *   why those calls never see a token.
 *
 * - Reified: the call crossed a boundary, where no memory reference can
 *   travel. The reference arrived as verified data, and this fn checks
 *   that it names this fn with this input. Once the entry frame passes,
 *   execution is in-process again - everything the body calls, it calls
 *   by direct reference.
 */
export const validateCaller = (fnKey: string) =>
	v.on(fnKey, async (c, next) => {
		const wire = c.var.capability;
		// No boundary above this call: the caller reached this fn through
		// a memory reference it was handed. That possession is the
		// capability - nothing to verify.
		if (!wire) return next();
		if (wire.entry === fnKey) {
			// The boundary frame itself: the caller holds no memory
			// reference here, only the reified one - it must cover this fn
			// AND this input.
			if (!permits(wire.caps, fnKey, c.input)) {
				throw new CapabilityError(
					`"${fnKey}" refused: caller's references do not cover it (held: ${wire.caps.map(fmtCap).join(", ") || "none"})`,
				);
			}
			// The wire hop is spent: below this frame, every call is
			// fn-to-fn by direct reference again.
			c.var.capability = { ...wire, entry: null };
			return next();
		}
		// Called from inside by a fn that already passed the boundary
		// check: its body holds this fn by reference - implied.
		return next();
	});

/* -------------------------------- authority -------------------------------- */

export type Challenge = {
	id: string;
	subject: string;
	holder: string;
	caps: Cap[];
	goal?: string;
	status: "pending" | "approved" | "denied";
};

/**
 * Authority never checks a call - `validateCaller` owns that. It answers
 * the questions that come BEFORE any call: what references does a caller
 * start with, what proves WHO a caller acts for, and how are requests
 * for more settled?
 */
export type Authority = {
	/**
	 * The first grant: what a request with no caps named pays out, given
	 * who was proven - and `null` IS an answer. Nobody's defaults should
	 * be just enough to go earn attestation (here: sign in); there is no
	 * separate "bootstrap caps" list.
	 */
	defaults: (subject: string | null) => Cap[];
	/**
	 * Reads a proven subject out of ANY fn's result: the moment authority
	 * learns WHO, attested proof rides back alongside the result.
	 */
	identify: (result: unknown) => string | null;
	/**
	 * Turns a subject into the portable attestation handed back. Defaults
	 * to a token this server signs itself; swap together with `verify` to
	 * lean on an external IDP instead.
	 */
	attest?: (subject: string) => unknown | Promise<unknown>;
	/** Decides whether a presented attestation passes. */
	verify?: (attestation: unknown) => string | null | Promise<string | null>;
	/** How widening requests are settled. Default: challenge everything. */
	decide?: (request: {
		subject: string;
		caps: Cap[];
		goal?: string;
	}) => "approve" | "challenge" | "deny";
	/** Delegation and attestation lifetime, seconds. */
	ttl?: number;
};

/* --------------------------------- server --------------------------------- */

/**
 * The remote boundary - the ONLY place a reference is ever reified or
 * verified, and the only construction in the whole model. Capabilities
 * are not registered or created anywhere: the fns you serve ARE the
 * capability space, one per key, and EVERY one of them validates its
 * caller - there is no public list. Everything crosses as data: a fn
 * key, JSON input, and a freshly minted invocation. Verification sets
 * `c.var.capability`; `validateCaller` on every fn does the rest.
 */
export const serve = async (
	modules: Record<string, unknown>,
	authority: Authority,
) => {
	const key = await generateKeypair();
	const ttl = authority.ttl ?? 3600;
	const challenges = new Map<string, Challenge>();
	let challengeSeq = 0;

	const issue = (holder: string, subject: string, caps: Cap[]) =>
		mintDelegation(key, { aud: holder, sub: subject, caps, exp: now() + ttl });

	const mintAttestation = async (subject: string): Promise<Attestation> => {
		const unsigned = {
			typ: "idt" as const,
			iss: key.id,
			sub: subject,
			exp: now() + ttl,
		};
		return { ...unsigned, sig: await key.sign(payloadOf(unsigned)) };
	};

	// What passes as proof of WHO is the authority's policy. The default
	// pair is self-generated: this server attests subjects with its own
	// signed id token, and only such tokens verify back.
	const attest = authority.attest ?? mintAttestation;
	const verify =
		authority.verify ??
		((attestation: unknown) =>
			verifyAttestation(key.id, attestation as Attestation));

	/** A reference is only as real as its fn: naming one that is not
	 * served is refused outright - there is no registry it could exist in
	 * instead. */
	const assertServed = (caps: Cap[], fns: Record<string, unknown>) => {
		for (const cap of caps) {
			if (!fns[fnOf(cap)]) {
				throw new CapabilityError(`no fn "${fnOf(cap)}" to have a cap for`);
			}
		}
	};

	const fns: Record<string, FnDefination<any, any>> = {};

	/**
	 * The one entry point that needs no capability - it is where reified
	 * references come from. No caps named = asking for the DEFAULTS:
	 * whoever the presented attestation proves gets that subject's
	 * defaults; empty hands get NOBODY'S defaults as a challenge - just
	 * enough power to go earn attestation. Caps named = widening: approve
	 * / challenge / deny by the authority, and asking again with the same
	 * caps resumes an open challenge.
	 */
	const request = v.fn(
		"capability.request",
		{
			input: {
				holder: v.string({ optional: true }),
				token: v.any(),
				attestation: v.any(),
				caps: v.any(),
				goal: v.string({ optional: true }),
			},
		},
		async (c) => {
			const caps = c.input.caps as Cap[] | undefined;

			if (!caps) {
				const holder = c.input.holder;
				if (!holder) throw new CapabilityError("no holder");
				const subject = c.input.attestation
					? await verify(c.input.attestation)
					: null;
				if (c.input.attestation && subject == null) {
					throw new CapabilityError("attestation does not pass");
				}
				// `null` is an answer: nobody's defaults are the first grant -
				// just enough to go earn attestation.
				const granted = authority.defaults(subject);
				assertServed(granted, fns);
				return {
					status: subject ? ("approved" as const) : ("challenge" as const),
					delegation: await issue(holder, subject ?? `anon:${holder}`, granted),
				};
			}

			// The invocation here proves POSSESSION of a chain - who is
			// asking - not authority over what is asked for; that is the
			// very thing the request is trying to widen.
			const held = await verifyInvocation(key.id, c.input.token as Invocation);
			assertServed(caps, fns);
			const payout = async () => ({
				status: "approved" as const,
				delegation: await issue(held.holder, held.subject, [
					...held.caps,
					...caps,
				]),
			});
			const open = [...challenges.values()].find(
				(challenge) =>
					challenge.holder === held.holder && sameJson(challenge.caps, caps),
			);
			if (open) {
				if (open.status === "pending") {
					return { status: "challenge" as const, id: open.id };
				}
				challenges.delete(open.id);
				return open.status === "approved"
					? payout()
					: { status: "denied" as const };
			}
			const verdict = (authority.decide ?? (() => "challenge"))({
				subject: held.subject,
				caps,
				goal: c.input.goal,
			});
			if (verdict === "deny") return { status: "denied" as const };
			if (verdict === "approve") return payout();
			const id = `chal_${++challengeSeq}`;
			challenges.set(id, {
				id,
				subject: held.subject,
				holder: held.holder,
				caps,
				goal: c.input.goal,
				status: "pending",
			});
			return { status: "challenge" as const, id };
		},
	);

	const builtins = { request };
	const builtinKeys = new Set<string>(
		Object.values(builtins).map((builtin) => builtin.key),
	);
	for (const fn of Object.values({
		...collectFns([modules]),
		...builtins,
	})) {
		fns[fn.key] = fn;
	}
	assertServed(authority.defaults(null), fns);

	// The rule, mounted on every served fn: each validates its own caller.
	const guards = Object.fromEntries(
		Object.keys(fns)
			.filter((fnKey) => !builtinKeys.has(fnKey))
			.map((fnKey) => [`guard ${fnKey}`, validateCaller(fnKey)]),
	) as Module;

	/** ANY fn can prove identity: when `identify` reads a subject out of a
	 * result, attested proof of WHO rides back alongside it. */
	const attestors = Object.fromEntries(
		Object.keys(fns)
			.filter((fnKey) => !builtinKeys.has(fnKey))
			.map((fnKey) => [
				`attest ${fnKey}`,
				v.on(fnKey, async (_c, next) => {
					const result = await next();
					const subject = authority.identify(result);
					if (subject == null) return result;
					return { ...result, attestation: await attest(subject) };
				}),
			]),
	) as Module;

	const exec = v.fn(
		"capability.exec",
		{
			input: { call: v.string(), input: v.any(), token: v.any() },
			use: [modules, { capability }, guards, attestors],
		},
		async (c) => {
			const target = fns[c.input.call];
			if (!target) throw new CapabilityError(`no fn "${c.input.call}"`);
			if (!builtinKeys.has(c.input.call)) {
				const token = c.input.token as Invocation | undefined;
				if (!token) throw new CapabilityError("no capability presented");
				if (token.call !== c.input.call) {
					throw new CapabilityError("invocation minted for a different fn");
				}
				if (!sameJson(token.input, c.input.input)) {
					throw new CapabilityError("invocation minted for different input");
				}
				// The boundary only proves the chain is genuinely held and
				// bound to this exact message. Whether it covers the call is
				// the target fn's own check - `entry` tells it which frame
				// has no memory reference behind it.
				const held = await verifyInvocation(key.id, token);
				c.var.capability = { ...held, entry: c.input.call };
			}
			return (target as (i: unknown, p: unknown) => unknown)(c.input.input, c);
		},
	);

	/** The user's side of a challenge - the demo calls it directly; a real
	 * server surfaces it in the IDP, an email, wherever the user is. */
	const decide = (id: string, approve: boolean) => {
		const challenge = challenges.get(id);
		if (challenge) challenge.status = approve ? "approved" : "denied";
		return challenge;
	};

	return { exec, decide, challenges, key: key.id };
};

/* --------------------------------- client --------------------------------- */

export type Transport = (message: {
	call: string;
	input?: unknown;
	token?: Invocation;
}) => Promise<any>;

/**
 * An agent: a keypair plus whatever reified references it holds. Born
 * asking - creation requests the default caps. Without attestation, the
 * answer is the bootstrap challenge: a delegation whose only power is
 * signing in. With attestation (passed in, or earned by a call whose
 * result attests), the answer is the defaults. EVERY call re-mints a
 * single-use invocation over the fn AND the input; nothing is public.
 */
export const createAgent = async (
	transport: Transport,
	options?: { attestation?: unknown },
) => {
	const me = await generateKeypair();
	let held: Delegation | null = null;
	// Opaque to the agent: whatever the server hands back as proof of who
	// it acts for, kept and re-presented as-is.
	let attestation: unknown = options?.attestation ?? null;

	const requestDefaults = async () => {
		const result = await transport({
			call: "capability.request",
			input: { holder: me.id, attestation: attestation ?? undefined },
		});
		if (result.delegation) held = result.delegation as Delegation;
		return result;
	};

	await requestDefaults();

	return {
		id: me.id,
		attestation: () => attestation,
		hold: (delegation: Delegation) => {
			held = delegation;
		},
		held: () => held,
		call: async (call: string, input?: unknown) => {
			if (!held) throw new CapabilityError("agent holds no delegation");
			const token = await mintInvocation(me, call, held, input);
			const result = await transport({ call, input, token });
			// A result carrying attestation is the server saying "now I
			// know who you act for" - keep it, trade it for the defaults.
			if (result?.attestation != null) {
				attestation = result.attestation;
				await requestDefaults();
			}
			return result;
		},
		request: async (caps: Cap[], goal?: string) => {
			if (!held) throw new CapabilityError("agent holds no delegation");
			const token = await mintInvocation(me, "capability.request", held);
			const result = await transport({
				call: "capability.request",
				input: { token, caps, goal },
			});
			if (result.status === "approved") held = result.delegation;
			return result;
		},
		/** Hand a SLICE of held references to another agent, re-minted for
		 * their key - fewer fns, or the same fn pinned to narrower input.
		 * The other agent spends with their own signature. */
		delegate: async (toAgentId: string, caps: Cap[]) => {
			if (!held) throw new CapabilityError("agent holds no delegation");
			return mintDelegation(me, {
				aud: toAgentId,
				sub: held.sub,
				caps,
				exp: held.exp,
				prf: held,
			});
		},
	};
};
