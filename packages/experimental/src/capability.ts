import { FnError, ValidationError } from "./error";
import { fnOptions } from "./fn-options";
import { type FnDefination, isFn, v } from "./index";
import { extendVar, type Module, type Next } from "./module";
import { asType, type InferInput, validate } from "./schema";

/**
 * Capabilities: authority carried by a token instead of looked up from an
 * identity. A capability holds GRANTS; each grant names one fn and may fix
 * some of its input. Holding it is the permission - nothing asks who the
 * caller is.
 *
 * better-call owns the mechanism: which fns accept a capability, how a
 * grant matches a call, how locked input is applied, and how a grant is
 * narrowed. Where capabilities are stored, how a token is read off a
 * request and who may mint one belong to the host ({@link capabilities}'
 * `resolve`).
 */

/** A rule on an input field the caller still supplies. */
export type Constraint =
	/** A string matching the pattern; `*` spans any run of characters. */
	| { glob: string }
	/** One of these values (deep equality). */
	| { oneOf: readonly unknown[] };

/** One fn a capability may call, with the input it fixes. */
export type Grant = {
	/** The fn key, as `c.fnKey` reads it (`auth.update_user`). */
	fn: string;
	/** Input fields fixed to exact values. A call may omit them (they are
	 * filled in) or send the same value; any other value is refused. */
	lock?: Record<string, unknown>;
	/** Input fields the caller supplies, held to a rule. */
	constrain?: Record<string, Constraint>;
};

/** What a host's `resolve` hands back for a presented token. */
export type HeldCapability = {
	/** The host's id for the capability (a row id, a token hash, …). */
	id: string;
	grants: readonly Grant[];
	/** Anything else the host wants the fn to see (issuer, expiry, …). */
	[key: string]: unknown;
};

/** `c.capability` while a call runs under a capability. */
export type ActiveCapability = HeldCapability & {
	/** The grant the entry fn was called under; `null` until it runs. */
	grant: Grant | null;
	/** Set once the entry fn's check ran. The fns it calls are reached by
	 * reference, not by the token, so they pass unchecked. */
	spent: boolean;
};

/** The capability the current call runs under; `null` for an ordinary
 * call (a session, an internal call). */
export const capability = v.var("capability", {
	default: null as ActiveCapability | null,
});

/** Unlocks the `capability` fn option: `true` lets the fn be called with
 * a capability. Fns without it refuse every capability call. */
export const capabilityOptions = extendVar(fnOptions, {
	capability: v.boolean({ optional: true }),
});

/** The tag every refused capability call throws, as a 403. */
export const CAPABILITY_DENIED = "CAPABILITY_DENIED";

const denied = (fnKey: string, message: string) =>
	new FnError(CAPABILITY_DENIED, {}, fnKey, 403, message);

/* --------------------------------- matching -------------------------------- */

const deepEqual = (a: unknown, b: unknown): boolean => {
	if (Object.is(a, b)) return true;
	if (a instanceof Date && b instanceof Date) {
		return a.getTime() === b.getTime();
	}
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	) {
		return false;
	}
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	return keysA.every(
		(key) =>
			Object.hasOwn(b, key) &&
			deepEqual(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
			),
	);
};

const globCache = new Map<string, RegExp>();

/** Does `value` match `pattern`? `*` spans any run of characters (empty
 * included); everything else is literal. */
export const matchesGlob = (pattern: string, value: string): boolean => {
	let re = globCache.get(pattern);
	if (!re) {
		const source = pattern
			.split("*")
			.map((part) => part.replace(/[.+?^${}()|[\]\\/-]/g, "\\$&"))
			.join(".*");
		re = new RegExp(`^${source}$`, "s");
		globCache.set(pattern, re);
	}
	return re.test(value);
};

/** Does `value` satisfy `constraint`? */
export const satisfies = (constraint: Constraint, value: unknown): boolean => {
	if ("glob" in constraint) {
		return typeof value === "string" && matchesGlob(constraint.glob, value);
	}
	return constraint.oneOf.some((allowed) => deepEqual(allowed, value));
};

/** Is every value `inner` accepts also accepted by `outer`? Exact for
 * `oneOf`; for globs only the provable cases (equal patterns, `*`, or a
 * literal inner pattern the outer matches), never a guess. */
const constraintCovers = (outer: Constraint, inner: Constraint): boolean => {
	if ("oneOf" in inner) {
		return inner.oneOf.every((value) => satisfies(outer, value));
	}
	if ("oneOf" in outer) return false;
	if (outer.glob === "*" || outer.glob === inner.glob) return true;
	return !inner.glob.includes("*") && matchesGlob(outer.glob, inner.glob);
};

/** Can the holder of `parent` mint `child`? Same fn; every field the
 * parent locks is locked to the same value; every field the parent
 * constrains is locked to a value the rule accepts, or constrained at
 * least as tightly. The child may add locks and constraints freely. */
export const covers = (parent: Grant, child: Grant): boolean => {
	if (parent.fn !== child.fn) return false;
	const childLock = child.lock ?? {};
	const childConstrain = child.constrain ?? {};
	for (const [field, value] of Object.entries(parent.lock ?? {})) {
		if (!Object.hasOwn(childLock, field)) return false;
		if (!deepEqual(childLock[field], value)) return false;
	}
	for (const [field, rule] of Object.entries(parent.constrain ?? {})) {
		if (Object.hasOwn(childLock, field)) {
			if (!satisfies(rule, childLock[field])) return false;
			continue;
		}
		const inner = childConstrain[field];
		if (!inner || !constraintCovers(rule, inner)) return false;
	}
	return true;
};

/** Does every grant in `children` follow from some grant in `parents`? */
export const coversAll = (
	parents: readonly Grant[],
	children: readonly Grant[],
): boolean =>
	children.every((child) => parents.some((parent) => covers(parent, child)));

/** The input a call under `grant` runs with, or `null` when the grant
 * refuses it: locked fields filled in (or checked when sent), constrained
 * fields checked. */
export const applyGrant = (grant: Grant, input: unknown): unknown | null => {
	const lock = grant.lock ?? {};
	const constrain = grant.constrain ?? {};
	const hasRules =
		Object.keys(lock).length > 0 || Object.keys(constrain).length > 0;
	if (!hasRules) return input;
	if (input !== undefined && (typeof input !== "object" || input === null)) {
		return null;
	}
	const given = (input ?? {}) as Record<string, unknown>;
	for (const [field, value] of Object.entries(lock)) {
		if (given[field] !== undefined && !deepEqual(given[field], value)) {
			return null;
		}
	}
	const next = { ...given, ...lock };
	for (const [field, rule] of Object.entries(constrain)) {
		if (!satisfies(rule, next[field])) return null;
	}
	return next;
};

/** The first of `grants` that allows calling `fnKey` with `input`, and
 * the input to call it with. */
export const matchGrant = (
	grants: readonly Grant[],
	fnKey: string,
	input: unknown,
): { grant: Grant; input: unknown } | null => {
	for (const grant of grants) {
		if (grant.fn !== fnKey) continue;
		const applied = applyGrant(grant, input);
		if (applied !== null) return { grant, input: applied };
	}
	return null;
};

/* --------------------------------- minting --------------------------------- */

type InputOf<F> =
	F extends FnDefination<any, any, any, infer I, any, any>
		? InferInput<I>
		: never;

type FieldsOf<F> = InputOf<F> extends Record<string, unknown> ? InputOf<F> : {};

/** A grant for `fn`, its locks typed against the fn's input. */
export const grant = <F extends FnDefination<any, any, any, any, any, any>>(
	fn: F,
	rules?: {
		lock?: Partial<FieldsOf<F>>;
		constrain?: { [K in keyof FieldsOf<F>]?: Constraint };
	},
): Grant => ({
	fn: fn.key,
	...(rules?.lock
		? { lock: { ...rules.lock } as Record<string, unknown> }
		: {}),
	...(rules?.constrain
		? { constrain: { ...rules.constrain } as Record<string, Constraint> }
		: {}),
});

/**
 * Check a grant against the fn it names before storing it: the fn must
 * accept capabilities, each locked or constrained field must be one of
 * its input fields, no field may be both locked and constrained (the lock
 * would leave the rule nothing to choose), and each locked value must
 * pass the field's own schema. Calls validate locked values again, as
 * part of the fn's input; this catches a bad grant when it is minted
 * instead of when it is used. Throws a `ValidationError`.
 */
export const checkGrant = async (
	fn: FnDefination<any, any, any, any, any, any>,
	grant: Grant,
): Promise<void> => {
	const path = `${fn.key}.capability`;
	if (!isFn(fn) || fn.key !== grant.fn) {
		throw new ValidationError(
			path,
			`grant names "${grant.fn}", not "${fn.key}"`,
		);
	}
	if (fn.$schema?.capability !== true) {
		throw new ValidationError(path, `"${fn.key}" does not accept capabilities`);
	}
	const input = fn.$schema?.input;
	const shape =
		input === undefined
			? undefined
			: (asType(input) as { name?: string; shape?: Record<string, unknown> });
	const fieldOf = (rule: "lock" | "constrain", field: string) => {
		const fieldSchema =
			shape?.name === "object" ? shape.shape?.[field] : undefined;
		if (shape?.name === "object" && fieldSchema === undefined) {
			throw new ValidationError(
				`${path}.${rule}.${field}`,
				`"${fn.key}" has no input field "${field}"`,
			);
		}
		return fieldSchema;
	};
	for (const field of Object.keys(grant.constrain ?? {})) {
		fieldOf("constrain", field);
		if (grant.lock && Object.hasOwn(grant.lock, field)) {
			throw new ValidationError(
				`${path}.constrain.${field}`,
				`"${field}" is locked; a field is locked or constrained, not both`,
			);
		}
	}
	for (const [field, value] of Object.entries(grant.lock ?? {})) {
		const fieldSchema = fieldOf("lock", field);
		if (fieldSchema !== undefined) {
			await validate(asType(fieldSchema), value, `${path}.lock.${field}`);
		}
	}
};

/* -------------------------------- enforcement ------------------------------- */

type Target = string | RegExp | readonly (string | RegExp)[];

const hits = (target: Target, key: string): boolean => {
	if (typeof target === "string") return matchesGlob(target, key);
	if (target instanceof RegExp) return target.test(key);
	return target.some((one) => hits(one, key));
};

export type CapabilitiesOptions = {
	/**
	 * The fns a call enters through: the token is read in their frame and
	 * the first fn called below one is the call's entry. Default: the http
	 * router's `http.router.dispatch`.
	 */
	boundary?: Target;
	/**
	 * Read the presented token off the boundary frame and look it up.
	 * `null`: no capability presented - the call runs as usual. Throw to
	 * refuse a token that is presented but invalid.
	 */
	resolve: (
		c: Record<string, any>,
	) => HeldCapability | null | Promise<HeldCapability | null>;
};

/**
 * Mount on the root (`use: [capabilities({ resolve })]`) to enforce
 * capabilities for every fn below:
 *
 * - At a boundary frame, `resolve` reads the token; a held capability
 *   becomes `c.capability`.
 * - The first fn called below the boundary is the entry. It must have
 *   opted in (`capability: true`) and a grant must allow it with its
 *   input; locked fields are applied to the input it runs with. Otherwise
 *   the call fails with a 403 {@link CAPABILITY_DENIED}.
 * - Every fn the entry calls runs unchecked: the entry reaches them by
 *   reference, not by the token.
 *
 * Mount it after other boundary hooks: a fn called by a boundary hook
 * that runs inside this one would count as the entry.
 */
export const capabilities = (options: CapabilitiesOptions) => {
	const boundary = options.boundary ?? "http.router.dispatch";
	return {
		capability,
		capabilityOptions,
		$capabilityResolve: v.on(
			boundary as string,
			async (c: any, next: () => Promise<unknown>) => {
				if (c.capability) return next();
				const held = await options.resolve(c);
				if (held) c.capability = { ...held, grant: null, spent: false };
				return next();
			},
		),
		$capabilityGuard: v.on(
			"*",
			(c: any, next: Next<any>) => {
				const held = c.capability as ActiveCapability | null | undefined;
				if (!held || held.spent || hits(boundary, c.fnKey)) return next();
				// Marked on the value, not written as a var: the entry may be a
				// readonly fn, where var writes throw.
				held.spent = true;
				if (c.$schema?.capability !== true) {
					throw denied(c.fnKey, `"${c.fnKey}" does not accept capabilities`);
				}
				const matched = matchGrant(held.grants, c.fnKey, c.input);
				if (!matched) {
					throw denied(
						c.fnKey,
						`the capability does not allow "${c.fnKey}" with this input`,
					);
				}
				held.grant = matched.grant;
				return next({ input: matched.input });
			},
			// Before validation: a locked field the caller left out is filled
			// in first, and the fn's own schema then checks the result.
			{ raw: true },
		),
	} satisfies Module;
};
