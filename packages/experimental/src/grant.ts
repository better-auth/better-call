import type { CtxBound } from "./fn";
import { fnOptions } from "./fn-options";
import { fnOut, fnOutput } from "./fn-output";
import { extendVar, type UseEntry } from "./module";
import { vTypes as v } from "./schema";
import type { LiteralString } from "./types";

type Awaitable<T> = T | Promise<T>;

/** Permission strings a grant callback may return; `null` means denied. */
export type GrantResult = readonly string[] | null;

export type GrantCallback = (c: any) => Awaitable<GrantResult>;

/** One entry in a fn's `gate` array. */
export type GateEntry = {
	name: string;
	grant: GrantCallback;
	/** When false, failure does not block the call. Default true. */
	required?: boolean;
};

/**
 * Product of `app.grant(...)`: usable directly in `gate: [adminGrant]`,
 * or call with `{ required: false }` for a soft gate.
 */
export type Grant = GateEntry & ((opts?: { required?: boolean }) => GateEntry);

export type GrantModuleOptions = {
	/**
	 * Seeds the permission bag once per call tree when the first gated
	 * fn runs. Same shape as a grant callback.
	 */
	default?: GrantCallback;
};

export class GrantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GrantError";
	}
}

/** Shared across a call tree via the var-store cells object. */
export const GRANT_BAG = Symbol.for("better-call:grant-bag");

/**
 * Does permission `pattern` cover grant `name`?
 * - `*` → everything
 * - `admin.*` → `admin`, `admin.createUser`, …
 * - exact match otherwise
 */
export const covers = (pattern: string, name: string): boolean => {
	if (pattern === "*") return true;
	if (pattern === name) return true;
	if (pattern.endsWith(".*")) {
		const prefix = pattern.slice(0, -2);
		return name === prefix || name.startsWith(`${prefix}.`);
	}
	return false;
};

/** True when any pattern in `bag` covers `name`. */
export const bagCovers = (bag: Iterable<string>, name: string): boolean => {
	for (const pattern of bag) {
		if (covers(pattern, name)) return true;
	}
	return false;
};

const isThenable = (value: any): value is Promise<unknown> =>
	typeof value?.then === "function";

const thenMaybe = <T, R>(
	value: T | Promise<T>,
	next: (value: T) => R | Promise<R>,
): R | Promise<R> => (isThenable(value) ? value.then(next) : next(value as T));

const createGrant = (name: string, cb: GrantCallback): Grant => {
	const asEntry = (required: boolean): GateEntry => ({
		name,
		grant: cb,
		required,
	});
	function grantFn(opts?: { required?: boolean }): GateEntry {
		return asEntry(opts?.required ?? true);
	}
	// Function#name is read-only; redefine so gate entries expose the grant name.
	Object.defineProperties(grantFn, {
		name: {
			value: name,
			configurable: true,
			enumerable: true,
			writable: false,
		},
		grant: { value: cb, enumerable: true, configurable: true },
		required: {
			value: true,
			enumerable: true,
			configurable: true,
			writable: true,
		},
	});
	return grantFn as Grant;
};

/**
 * Evaluate `gates` against the permission bag on `cells` (shared store).
 * Seeds from `defaultGrant` when the bag is first created.
 */
export const evaluateGates = (
	c: any,
	cells: Record<PropertyKey, any>,
	gates: readonly GateEntry[],
	fnKey: string,
	defaultGrant?: GrantCallback | null,
): void | Promise<void> => {
	let bag = cells[GRANT_BAG] as Set<string> | undefined;
	const ensureBag = (seed: GrantResult | undefined) => {
		if (!bag) {
			bag = new Set();
			cells[GRANT_BAG] = bag;
			if (seed && seed.length > 0) {
				for (const p of seed) bag.add(p);
			}
		}
		return bag;
	};

	const walk = (index: number): void | Promise<void> => {
		if (index >= gates.length) return;
		const entry = gates[index]!;
		const required = entry.required !== false;
		const name = entry.name;

		const current = ensureBag(undefined);
		if (bagCovers(current, name)) {
			return walk(index + 1);
		}

		const fail = () => {
			if (required) {
				throw new GrantError(`grant "${name}" denied for "${fnKey}"`);
			}
			return walk(index + 1);
		};

		const after = (result: GrantResult) => {
			if (result === null || result.length === 0) return fail();
			if (!result.some((p) => covers(p, name))) return fail();
			const b = ensureBag(undefined);
			for (const p of result) b.add(p);
			return walk(index + 1);
		};

		return thenMaybe(entry.grant(c), after);
	};

	if (!bag && defaultGrant) {
		return thenMaybe(defaultGrant(c), (seed) => {
			ensureBag(seed === null ? undefined : seed);
			return walk(0);
		});
	}
	ensureBag(undefined);
	return walk(0);
};

/** Find `$grantDefault` on mounted grant plugin modules (nested ok). */
export const findGrantDefault = (
	modules: readonly unknown[] | undefined,
): GrantCallback | null | undefined => {
	if (!modules?.length) return undefined;
	const visit = (mod: unknown): GrantCallback | null | undefined => {
		if (!mod || typeof mod !== "object") return undefined;
		if (
			"$grantPlugin" in mod &&
			(mod as { $grantPlugin?: boolean }).$grantPlugin === true
		) {
			return (mod as { $grantDefault?: GrantCallback | null }).$grantDefault;
		}
		for (const value of Object.values(mod as Record<string, unknown>)) {
			const found = visit(value);
			if (found !== undefined) return found;
		}
		return undefined;
	};
	for (const mod of modules) {
		const found = visit(mod);
		if (found !== undefined) return found;
	}
	return undefined;
};

/**
 * Mount grant/gate authz: unlocks `gate` on fn options and `app.grant`
 * via `fnOutput`.
 *
 * @example
 * ```ts
 * const app = v.fn({ use: [grant({ default: () => null })] });
 * const admin = app.grant({ name: "admin.createUser" }, async (c) => ["*"]);
 * app.fn("create", { gate: [admin] }, handler);
 * ```
 */
export function grant(options?: GrantModuleOptions) {
	const defaultGrant = options?.default;

	const grantOptions = extendVar(fnOptions, {
		gate: v.array(
			v.object({
				name: v.string({ literal: true }),
				grant: v.any<CtxBound<GrantResult>>(),
				required: v.boolean({ optional: true }),
			}),
			{ optional: true },
		),
	});

	const grantOutput = extendVar(fnOutput, {
		grant: fnOut<
			[
				{
					name: LiteralString;
					use?: readonly UseEntry[];
				},
				CtxBound<GrantResult>,
			],
			Grant
		>((opts, cb) => createGrant(String(opts.name), cb as GrantCallback)),
	});

	return {
		$grantPlugin: true as const,
		$grantDefault: defaultGrant ?? null,
		grantOptions,
		grantOutput,
	};
}
