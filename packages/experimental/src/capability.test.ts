import { describe, expect, it } from "vitest";
import {
	applyGrant,
	CAPABILITY_DENIED,
	capabilities,
	capabilityOptions,
	checkGrant,
	covers,
	coversAll,
	type Grant,
	grant,
	type HeldCapability,
	matchesGlob,
	matchGrant,
} from "./capability";
import { ValidationError } from "./error";
import { v } from "./index";
import { createRouter, http } from "./plugins/http";

describe("matchesGlob", () => {
	it("treats * as any run and everything else literally", () => {
		expect(matchesGlob("*@acme.com", "dave@acme.com")).toBe(true);
		expect(matchesGlob("*@acme.com", "dave@acme.com.evil")).toBe(false);
		expect(matchesGlob("feat/*", "feat/")).toBe(true);
		expect(matchesGlob("a.b", "axb")).toBe(false);
		expect(matchesGlob("*", "")).toBe(true);
	});
});

describe("applyGrant", () => {
	const g: Grant = {
		fn: "invite",
		lock: { org: "acme", role: "member" },
		constrain: { email: { glob: "*@acme.com" } },
	};

	it("fills locked fields the call omits", () => {
		expect(applyGrant(g, { email: "dave@acme.com" })).toEqual({
			email: "dave@acme.com",
			org: "acme",
			role: "member",
		});
	});

	it("accepts a locked field sent with the same value", () => {
		expect(applyGrant(g, { email: "d@acme.com", role: "member" })).not.toBe(
			null,
		);
	});

	it("refuses a locked field sent with another value", () => {
		expect(applyGrant(g, { email: "d@acme.com", role: "owner" })).toBe(null);
	});

	it("refuses a constrained field outside its rule, or missing", () => {
		expect(applyGrant(g, { email: "x@evil.com" })).toBe(null);
		expect(applyGrant(g, {})).toBe(null);
	});

	it("passes any input through a grant without rules", () => {
		expect(applyGrant({ fn: "f" }, "anything")).toBe("anything");
	});

	it("checks oneOf by deep equality", () => {
		const one: Grant = {
			fn: "f",
			constrain: { tags: { oneOf: [["a"], ["b"]] } },
		};
		expect(applyGrant(one, { tags: ["b"] })).not.toBe(null);
		expect(applyGrant(one, { tags: ["c"] })).toBe(null);
	});
});

describe("matchGrant", () => {
	it("picks the grant the input fits when several name the fn", () => {
		const grants: Grant[] = [
			{ fn: "deploy", lock: { project: "shop", target: "preview" } },
			{ fn: "deploy", lock: { project: "docs", target: "production" } },
		];
		expect(matchGrant(grants, "deploy", { project: "docs" })).toEqual({
			grant: grants[1],
			input: { project: "docs", target: "production" },
		});
		expect(
			matchGrant(grants, "deploy", { project: "shop", target: "production" }),
		).toBe(null);
		expect(matchGrant(grants, "other", {})).toBe(null);
	});
});

describe("covers (attenuation)", () => {
	const parent: Grant = {
		fn: "invite",
		lock: { org: "acme" },
		constrain: { email: { glob: "*@acme.com" } },
	};

	it("allows adding locks and keeping or tightening rules", () => {
		expect(
			covers(parent, { ...parent, lock: { org: "acme", role: "member" } }),
		).toBe(true);
		expect(
			covers(parent, {
				fn: "invite",
				lock: { org: "acme", email: "dave@acme.com" },
			}),
		).toBe(true);
		expect(
			covers(parent, {
				fn: "invite",
				lock: { org: "acme" },
				constrain: { email: { oneOf: ["a@acme.com", "b@acme.com"] } },
			}),
		).toBe(true);
	});

	it("refuses dropping or changing a lock, loosening a rule, or another fn", () => {
		expect(
			covers(parent, {
				fn: "invite",
				constrain: { email: { glob: "*@acme.com" } },
			}),
		).toBe(false);
		expect(covers(parent, { ...parent, lock: { org: "other" } })).toBe(false);
		expect(
			covers(parent, {
				fn: "invite",
				lock: { org: "acme" },
				constrain: { email: { glob: "*" } },
			}),
		).toBe(false);
		expect(
			covers(parent, {
				fn: "invite",
				lock: { org: "acme", email: "x@evil.com" },
			}),
		).toBe(false);
		expect(covers(parent, { ...parent, fn: "delete" })).toBe(false);
	});

	it("coversAll needs every child covered by some parent", () => {
		const a: Grant = { fn: "a" };
		const b: Grant = { fn: "b" };
		expect(coversAll([a, b], [b])).toBe(true);
		expect(coversAll([a], [a, b])).toBe(false);
	});
});

describe("grant / checkGrant", () => {
	const capApp = v.fn({ use: [{ capabilityOptions }] });
	const invite = capApp.fn(
		"cap.invite",
		{
			capability: true,
			input: { org: v.string(), role: v.string(), email: v.string() },
		},
		(c) => c.input,
	);
	const closed = capApp.fn(
		"cap.closed",
		{ input: { org: v.string() } },
		(c) => c.input,
	);

	it("names the fn by key", () => {
		expect(grant(invite, { lock: { org: "acme" } })).toEqual({
			fn: "cap.invite",
			lock: { org: "acme" },
		});
	});

	it("accepts locks that pass the field schemas", async () => {
		await expect(
			checkGrant(invite, grant(invite, { lock: { org: "acme" } })),
		).resolves.toBeUndefined();
	});

	it("refuses a fn that did not opt in", async () => {
		await expect(checkGrant(closed, { fn: "cap.closed" })).rejects.toThrow(
			ValidationError,
		);
	});

	it("refuses a lock of the wrong type or on an unknown field", async () => {
		await expect(
			checkGrant(invite, { fn: "cap.invite", lock: { org: 1 } }),
		).rejects.toThrow(ValidationError);
		await expect(
			checkGrant(invite, { fn: "cap.invite", lock: { nope: "x" } }),
		).rejects.toThrow(ValidationError);
	});

	it("refuses a constraint on an unknown field", async () => {
		await expect(
			checkGrant(invite, {
				fn: "cap.invite",
				constrain: { nope: { oneOf: ["x"] } },
			}),
		).rejects.toThrow(ValidationError);
	});

	it("refuses a field both locked and constrained", async () => {
		await expect(
			checkGrant(invite, {
				fn: "cap.invite",
				lock: { org: "a" },
				constrain: { org: { oneOf: ["a", "b"] } },
			}),
		).rejects.toThrow(/locked or constrained, not both/);
	});

	it("accepts locks and constraints on different fields", async () => {
		await expect(
			checkGrant(
				invite,
				grant(invite, {
					lock: { org: "acme" },
					constrain: { email: { glob: "*@acme.com" } },
				}),
			),
		).resolves.toBeUndefined();
	});

	it("refuses a grant naming another fn", async () => {
		await expect(checkGrant(invite, { fn: "cap.other" })).rejects.toThrow(
			ValidationError,
		);
	});
});

describe("capabilities over http", () => {
	const store = new Map<string, HeldCapability>();
	const caps = capabilities({
		resolve: (c) => {
			const header = c.req?.headers.get("authorization") as string | null;
			if (!header?.startsWith("Capability ")) return null;
			const held = store.get(header.slice("Capability ".length));
			if (!held) throw new Error("unknown capability");
			return held;
		},
	});
	const app = v.fn({ use: [http(), caps] });

	const audit = app.fn("capt.audit", { input: { what: v.string() } }, (c) => ({
		audited: c.input.what,
		under: c.capability?.id ?? null,
	}));
	const invite = app.fn(
		"capt.invite",
		{
			path: "/invite",
			method: "POST",
			capability: true,
			input: { org: v.string(), role: v.string(), email: v.string() },
			errors: { NOPE: http.err(400, "nope") },
			use: [{ audit }],
		},
		async (c) => ({
			...c.input,
			// Called by reference from the entry: not checked again.
			audit: await c.audit({ what: c.input.email }),
			grant: c.capability?.grant?.fn ?? null,
		}),
	);
	const remove = app.fn(
		"capt.remove",
		{ path: "/remove", method: "POST", input: { org: v.string() } },
		(c) => ({ removed: c.input.org }),
	);
	const peek = app.fn(
		"capt.peek",
		{ path: "/peek", method: "GET", capability: true },
		(c) => ({ id: c.capability?.id ?? null }),
	);

	const router = createRouter({ invite, remove, peek }, { use: [caps] });
	store.set("tok_miles", {
		id: "cap_1",
		grants: [
			grant(invite, {
				lock: { org: "acme", role: "member" },
				constrain: { email: { glob: "*@acme.com" } },
			}),
			grant(peek),
		],
	});
	// Holds a grant for a fn that never opted in.
	store.set("tok_bad", { id: "cap_2", grants: [{ fn: "capt.remove" }] });

	const call = (path: string, body?: unknown, token?: string) =>
		router(
			new Request(`http://x.test${path}`, {
				method: body === undefined ? "GET" : "POST",
				headers: {
					"content-type": "application/json",
					...(token ? { authorization: `Capability ${token}` } : {}),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}),
		);

	it("leaves calls without a capability alone", async () => {
		const res = await call("/remove", { org: "acme" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ removed: "acme" });
	});

	it("runs the entry with locked fields applied", async () => {
		const res = await call("/invite", { email: "dave@acme.com" }, "tok_miles");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			org: "acme",
			role: "member",
			email: "dave@acme.com",
			audit: { audited: "dave@acme.com", under: "cap_1" },
			grant: "capt.invite",
		});
	});

	it("refuses a locked field sent with another value", async () => {
		const res = await call(
			"/invite",
			{ org: "acme", role: "owner", email: "dave@acme.com" },
			"tok_miles",
		);
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ tag: CAPABILITY_DENIED });
	});

	it("refuses input outside a constraint", async () => {
		const res = await call("/invite", { email: "x@evil.com" }, "tok_miles");
		expect(res.status).toBe(403);
	});

	it("refuses a fn the capability holds no grant for", async () => {
		const res = await call("/remove", { org: "acme" }, "tok_miles");
		expect(res.status).toBe(403);
	});

	it("refuses a fn that did not opt in, whatever the grants say", async () => {
		const res = await call("/remove", { org: "acme" }, "tok_bad");
		expect(res.status).toBe(403);
	});

	it("checks GET calls, which have no body", async () => {
		const res = await call("/peek", undefined, "tok_miles");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "cap_1" });
	});
});

describe("capabilities at a custom boundary", () => {
	const held: HeldCapability = {
		id: "cap_ro",
		grants: [{ fn: "boundary.read", lock: { id: "a" } }],
	};
	const caps = capabilities({
		boundary: "boundary.enter",
		resolve: () => held,
	});
	const read = v.fn({ use: [caps] }).fn(
		"boundary.read",
		{
			capability: true,
			readonly: true,
			input: { id: v.string() },
			use: [caps],
		},
		(c) => ({ id: c.input.id, under: c.capability?.id ?? null }),
	);
	const enter = v.fn(
		"boundary.enter",
		{ input: { id: v.string({ optional: true }) }, use: [caps, { read }] },
		// No id: the lock fills it in before `read` validates its input.
		(c) =>
			c.read((c.input.id === undefined ? {} : { id: c.input.id }) as never),
	);

	it("runs a readonly entry: the guard writes no var", async () => {
		await expect(enter({})).resolves.toEqual({ id: "a", under: "cap_ro" });
	});

	it("refuses the entry outside its lock", async () => {
		await expect(enter({ id: "b" })).rejects.toMatchObject({
			tag: CAPABILITY_DENIED,
			status: 403,
		});
	});
});
