import { matchesTarget, type OnEntry } from "./module";
import { isVar } from "./schema";
import type { ValueOfVar, VarDefination } from "./var";

/* ---------------------------------- where ---------------------------------- */

/** Per-field operators, for everything equality can't say: expiry sweeps
 * (`lt`), revocation lists (`in`), guarded counters (`lt` as the guard).
 * A bare value stays plain equality - the common case reads like data. */
export type WhereOps<V> = {
	eq?: V;
	ne?: V;
	lt?: V;
	lte?: V;
	gt?: V;
	gte?: V;
	in?: readonly V[];
	notIn?: readonly V[];
	contains?: string;
	startsWith?: string;
	endsWith?: string;
};

export type WhereOp = keyof WhereOps<unknown>;

/** AND across fields; each field a bare value (equality) or operators. */
export type Where<R> = { [K in keyof R]?: R[K] | WhereOps<R[K]> };

/** One normalized clause: `{ tag: "a" }` -> `{ field: "tag", op: "eq" }`. */
export type Condition = { field: string; op: WhereOp; value: unknown };

const WHERE_OPS: Record<WhereOp, true> = {
	eq: true,
	ne: true,
	lt: true,
	lte: true,
	gt: true,
	gte: true,
	in: true,
	notIn: true,
	contains: true,
	startsWith: true,
	endsWith: true,
};

/** An operator object is a plain record whose keys are ALL operator names.
 * Anything else - a Date, an array, an empty object - is a value. */
const isOps = (value: unknown): value is WhereOps<unknown> =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	!(value instanceof Date) &&
	Object.keys(value).length > 0 &&
	Object.keys(value).every((key) => key in WHERE_OPS);

/** Flatten a where to normalized conditions - the adapter author's
 * translation seam: map each condition onto your query language, AND them. */
export const conditionsOf = (
	where: Record<string, unknown> = {},
): Condition[] =>
	Object.entries(where).flatMap(([field, spec]) =>
		isOps(spec)
			? Object.entries(spec).map(([op, value]) => ({
					field,
					op: op as WhereOp,
					value,
				}))
			: [{ field, op: "eq" as const, value: spec }],
	);

/** Dates equate and order by their instant. */
const rawValue = (value: unknown) =>
	value instanceof Date ? value.getTime() : value;

const equals = (a: unknown, b: unknown) => rawValue(a) === rawValue(b);

const compare = (a: unknown, b: unknown): number => {
	const left = rawValue(a) as number;
	const right = rawValue(b) as number;
	return left < right ? -1 : left > right ? 1 : 0;
};

const holds = (
	row: Record<string, unknown>,
	{ field, op, value }: Condition,
): boolean => {
	const current = row[field];
	switch (op) {
		case "eq":
			return equals(current, value);
		case "ne":
			return !equals(current, value);
		case "lt":
		case "lte":
		case "gt":
		case "gte": {
			if (current == null || value == null) return false;
			const order = compare(current, value);
			if (op === "lt") return order < 0;
			if (op === "lte") return order <= 0;
			if (op === "gt") return order > 0;
			return order >= 0;
		}
		case "in":
			return (value as readonly unknown[]).some((member) =>
				equals(current, member),
			);
		case "notIn":
			return !(value as readonly unknown[]).some((member) =>
				equals(current, member),
			);
		case "contains":
			return typeof current === "string" && current.includes(value as string);
		case "startsWith":
			return typeof current === "string" && current.startsWith(value as string);
		case "endsWith":
			return typeof current === "string" && current.endsWith(value as string);
	}
};

/** Does a row satisfy a where? The in-memory evaluator - the dummy adapter
 * runs on it, and any adapter over an unqueryable backend can too. */
export const matchesWhere = (
	row: Record<string, unknown>,
	where: Record<string, unknown> = {},
): boolean => conditionsOf(where).every((condition) => holds(row, condition));

/* ----------------------------------- ops ----------------------------------- */

/** Shaping for `findMany`: sort, then window. */
export type FindManyOptions<R> = {
	limit?: number;
	offset?: number;
	sortBy?: { field: keyof R & string; direction?: "asc" | "desc" };
};

/** One model's CRUD surface. `create` is generic so a row EXTENDED by a
 * mounted module (an account with a password field) keeps its extra
 * fields through the round-trip. */
export type Collection<R> = {
	create: <T extends R>(data: T) => Promise<T>;
	findOne: (where: Where<R>) => Promise<R | null>;
	findMany: (where?: Where<R>, options?: FindManyOptions<R>) => Promise<R[]>;
	/** Merge `patch` into the FIRST match - null when nothing matched. */
	update: (where: Where<R>, patch: Partial<R>) => Promise<R | null>;
	/** Remove every match; how many is the answer. */
	delete: (where: Where<R>) => Promise<number>;
	count: (where?: Where<R>) => Promise<number>;
	/** Claim the FIRST match: the row comes back and is GONE, atomically -
	 * two racing consumers never both get it. Single-use credentials
	 * (verification tokens, one-time codes) hang off this. */
	consumeOne: (where: Where<R>) => Promise<R | null>;
	/** Add to numeric fields of the FIRST match, atomically; the where is
	 * also the GUARD (`count: { lt: max }`), so check-and-bump is one op -
	 * null means no row passed it. Rate limiting hangs off this. */
	incrementOne: (
		where: Where<R>,
		increments: Partial<Record<keyof R & string, number>>,
	) => Promise<R | null>;
};

/**
 * What a real database implements: six required verbs, models addressed by
 * NAME, `where` as bare-equality fields and/or operator objects
 * (`conditionsOf` normalizes either form). The storage API above never
 * changes - adapters translate it, sync or async.
 *
 * The optional verbs are ATOMICITY upgrades: without `consumeOne` /
 * `incrementOne` the storage falls back to find-then-write - correct alone,
 * racy under contention - and without `transaction` a `$transaction` block
 * runs plainly. Implement them where the backend has the primitive.
 */
export type StorageAdapter = {
	create: (model: string, data: Record<string, unknown>) => unknown;
	findOne: (model: string, where: Record<string, unknown>) => unknown;
	findMany: (
		model: string,
		where?: Record<string, unknown>,
		options?: FindManyOptions<Record<string, unknown>>,
	) => unknown;
	update: (
		model: string,
		where: Record<string, unknown>,
		patch: Record<string, unknown>,
	) => unknown;
	delete: (model: string, where: Record<string, unknown>) => unknown;
	count: (model: string, where?: Record<string, unknown>) => unknown;
	/** Atomic find-and-delete of the first match. */
	consumeOne?: (model: string, where: Record<string, unknown>) => unknown;
	/** Atomic guarded add to numeric fields of the first match. */
	incrementOne?: (
		model: string,
		where: Record<string, unknown>,
		increments: Record<string, number>,
	) => unknown;
	/** Run `run` against a transaction-bound view of this adapter:
	 * committed when it resolves, rolled back when it throws. */
	transaction?: <T>(run: (tx: StorageAdapter) => Promise<T>) => Promise<T>;
};

/** The DUMMY adapter: rows in arrays, one per model. Implements the whole
 * surface - the optional verbs by mutation (single-threaded, so "atomic"),
 * transactions by snapshot-and-restore. */
export const memoryAdapter = (): StorageAdapter => {
	let tables = new Map<string, Record<string, unknown>[]>();
	const rows = (model: string) => {
		let list = tables.get(model);
		if (!list) {
			list = [];
			tables.set(model, list);
		}
		return list;
	};
	const self: StorageAdapter = {
		create: (model, data) => {
			const row = { ...data };
			rows(model).push(row);
			return row;
		},
		findOne: (model, where) =>
			rows(model).find((row) => matchesWhere(row, where)) ?? null,
		findMany: (model, where, options) => {
			let list = rows(model).filter((row) => matchesWhere(row, where));
			const sort = options?.sortBy;
			if (sort) {
				const direction = sort.direction === "desc" ? -1 : 1;
				list = [...list].sort(
					(a, b) => direction * compare(a[sort.field], b[sort.field]),
				);
			}
			const start = options?.offset ?? 0;
			const end =
				options?.limit === undefined ? undefined : start + options.limit;
			return start === 0 && end === undefined ? list : list.slice(start, end);
		},
		update: (model, where, patch) => {
			const row = rows(model).find((r) => matchesWhere(r, where));
			return row ? Object.assign(row, patch) : null;
		},
		delete: (model, where) => {
			const list = rows(model);
			const keep = list.filter((row) => !matchesWhere(row, where));
			tables.set(model, keep);
			return list.length - keep.length;
		},
		count: (model, where) =>
			rows(model).filter((row) => matchesWhere(row, where)).length,
		consumeOne: (model, where) => {
			const list = rows(model);
			const index = list.findIndex((row) => matchesWhere(row, where));
			return index === -1 ? null : list.splice(index, 1)[0];
		},
		incrementOne: (model, where, increments) => {
			const row = rows(model).find((r) => matchesWhere(r, where));
			if (!row) return null;
			for (const [field, by] of Object.entries(increments)) {
				row[field] = ((row[field] as number) ?? 0) + by;
			}
			return row;
		},
		transaction: async (run) => {
			const snapshot = new Map(
				[...tables].map(([model, list]) => [
					model,
					list.map((row) => ({ ...row })),
				]),
			);
			try {
				return await run(self);
			} catch (thrown) {
				tables = snapshot;
				throw thrown;
			}
		},
	};
	return self;
};

/* ---------------------------------- models ---------------------------------- */

type AnyVar = VarDefination<any, any, any, any>;

/** Persistence facts about one field the ROW SHAPE can't say - consumed by
 * schema generators and adapters, never acted on by the runtime. (Read
 * shaping like redaction is a `$on` hook, not metadata.) */
export type FieldMeta = {
	/** No two rows share a value. */
	unique?: boolean;
	/** Worth an index. */
	index?: boolean;
	/** Foreign key: this field holds `model.field` values. */
	references?: {
		model: string;
		field: string;
		onDelete?: "cascade" | "set null" | "restrict";
	};
};

/** What an op subscription hands back: `v.on` entries to mount. */
type SubscriptionEntries = OnEntry<string> | readonly OnEntry<string>[];

/**
 * A model declared WITH its persistence: `schema` is the var (the shape),
 * `fields` carries per-field storage metadata, and each op key SUBSCRIBES
 * that op to app events - handed the bound collection op, it returns `v.on`
 * entries that mount wherever the storage does (`use: [db]`). An
 * already-built entry works in place of the fn.
 */
export type ModelConfig<SV extends AnyVar = AnyVar> = {
	schema: SV;
	fields?: {
		[F in keyof NonNullable<ValueOfVar<SV>>]?: FieldMeta;
	};
} & {
	[Op in StorageOp]?:
		| ((
				action: Collection<NonNullable<ValueOfVar<SV>>>[Op],
		  ) => SubscriptionEntries)
		| SubscriptionEntries;
};

/** A model is a bare var, or a config carrying the var as `schema`. */
type ModelInput = AnyVar | ModelConfig;

/** The var behind a model input. Checked through `$var`, never `schema` -
 * a bare var also HAS a `schema` property (its type shape). */
type SchemaOf<T> = T extends { $var: true }
	? T
	: T extends { schema: infer SV }
		? SV
		: never;

type RowOf<T> = NonNullable<ValueOfVar<SchemaOf<T>>>;

export type StorageModels = Record<string, ModelInput>;

export type StorageOp =
	| "create"
	| "findOne"
	| "findMany"
	| "update"
	| "delete"
	| "count"
	| "consumeOne"
	| "incrementOne";

/** What a storage hook sees: which model and op, with the op's arguments
 * positionally (`create` -> [data], `update` -> [where, patch], `findMany`
 * -> [where, options], `incrementOne` -> [where, increments], ...). */
export type StorageHookContext = {
	/** The model KEY being addressed (the storage's property name). */
	model: string;
	op: StorageOp;
	args: readonly unknown[];
};

/** `next()` runs the op (hooks below it included) and resolves its result;
 * the hook's own return value IS the op's result - wrap, veto, transform. */
export type StorageHook = (
	c: StorageHookContext,
	next: () => Promise<unknown>,
) => unknown;

/** Every target a storage hook can name - a flat union, so editors offer
 * the whole surface: exact ("user.create"), per-model ("user.*"), per-op
 * ("*.create"), everything ("*"). */
export type StorageTarget<M> =
	| "*"
	| `${keyof M & string}.${StorageOp | "*"}`
	| `*.${StorageOp}`;

export type Storage<M extends StorageModels> = {
	[K in keyof M]: Collection<RowOf<M[K]>>;
} & StorageApi<M>;

/** The customization surface, `$`-prefixed so model keys never collide. */
export type StorageApi<M extends StorageModels> = {
	/** Swap the backend IN PLACE: every view of this storage - and every
	 * module that captured it - starts hitting the new adapter. */
	$adapter: (adapter: StorageAdapter) => Storage<M>;
	/** Intercept ops: hooks stack in mount order and apply to every view
	 * sharing this storage's state. */
	$on: (target: StorageTarget<M>, hook: StorageHook) => Storage<M>;
	/** A view WITHOUT these models - same adapter, same hooks. */
	$omit: <K extends keyof M & string>(...keys: K[]) => Storage<Omit<M, K>>;
	/** A view of ONLY these models - same adapter, same hooks. */
	$pick: <K extends keyof M & string>(...keys: K[]) => Storage<Pick<M, K>>;
	/** A view with MORE models - same adapter, same hooks. */
	$extend: <M2 extends StorageModels>(models: M2) => Storage<M & M2>;
	/** Run `fn` against a view whose ops share ONE adapter transaction -
	 * committed when it resolves, rolled back when it throws. Same models,
	 * same hooks (they run inside). An adapter without `transaction` runs
	 * `fn` plainly - no atomicity, same answer. */
	$transaction: <T>(fn: (tx: Storage<M>) => Promise<T> | T) => Promise<T>;
	/** The model definitions this view exposes. */
	$models: M;
};

/** Adapter, hooks and produced subscription entries live HERE, shared by
 * every view of one storage - a `$pick`ed slice still writes through the
 * same backend and hook stack, and a subscription materializes ONCE (same
 * entry object across views, so double-mounting dedups by identity). */
type StorageState = {
	adapter: StorageAdapter;
	hooks: { target: string; hook: StorageHook }[];
	subscriptions: Map<string, readonly OnEntry<string>[]>;
};

const OPS: readonly StorageOp[] = [
	"create",
	"findOne",
	"findMany",
	"update",
	"delete",
	"count",
	"consumeOne",
	"incrementOne",
];

/** The op against the backend, optional verbs falling back to the required
 * six: find-then-write - correct alone, racy under contention. The comment
 * every fallback deserves lives on `StorageAdapter`. */
const rawOp = (
	adapter: StorageAdapter,
	name: string,
	op: StorageOp,
	args: unknown[],
) => {
	if (op === "consumeOne" && !adapter.consumeOne) {
		return (async () => {
			const where = args[0] as Record<string, unknown>;
			const row = (await adapter.findOne(name, where)) as Record<
				string,
				unknown
			> | null;
			if (!row) return null;
			// Delete THE row by its own fields, not the where - an operator
			// where (`expiresAt: { lt }`) must not sweep other matches.
			await adapter.delete(name, row);
			return row;
		})();
	}
	if (op === "incrementOne" && !adapter.incrementOne) {
		return (async () => {
			const [where, increments] = args as [
				Record<string, unknown>,
				Record<string, number>,
			];
			const row = (await adapter.findOne(name, where)) as Record<
				string,
				unknown
			> | null;
			if (!row) return null;
			const patch = Object.fromEntries(
				Object.entries(increments).map(([field, by]) => [
					field,
					((row[field] as number) ?? 0) + by,
				]),
			);
			return adapter.update(name, where, patch);
		})();
	}
	return (adapter[op] as (...a: unknown[]) => unknown)(name, ...args);
};

const buildStorage = <M extends StorageModels>(
	state: StorageState,
	models: M,
): Storage<M> => {
	// Every op funnels here: matching hooks compose around the adapter
	// call, first mounted outermost - the `v.on` rules, one layer down.
	const run = (key: string, name: string, op: StorageOp, args: unknown[]) => {
		const base = () => Promise.resolve(rawOp(state.adapter, name, op, args));
		return state.hooks
			.filter((entry) => matchesTarget(entry.target, `${key}.${op}`))
			.reduceRight<() => Promise<unknown>>(
				(next, entry) => () =>
					Promise.resolve(entry.hook({ model: key, op, args }, next)),
				base,
			)();
	};

	const storage: Record<string, unknown> = {};
	for (const [key, input] of Object.entries(models)) {
		const def = isVar(input) ? input : (input as ModelConfig).schema;
		const name = (def as { name: string }).name;
		const collection = {
			create: (data: unknown) => run(key, name, "create", [data]),
			findOne: (where: unknown) => run(key, name, "findOne", [where]),
			findMany: (where?: unknown, options?: unknown) =>
				run(key, name, "findMany", [where, options]),
			update: (where: unknown, patch: unknown) =>
				run(key, name, "update", [where, patch]),
			delete: (where: unknown) => run(key, name, "delete", [where]),
			count: (where?: unknown) => run(key, name, "count", [where]),
			consumeOne: (where: unknown) => run(key, name, "consumeOne", [where]),
			incrementOne: (where: unknown, increments: unknown) =>
				run(key, name, "incrementOne", [where, increments]),
		} satisfies Record<StorageOp, unknown>;
		storage[key] = collection;

		// Op subscriptions become PROPERTIES of the storage, so mounting it
		// as a module (`use: [db]`) mounts the persistence it declared.
		// Materialized once per state - views share entry identity.
		if (isVar(input)) continue;
		for (const op of OPS) {
			const declared = (input as Record<string, unknown>)[op];
			if (!declared) continue;
			const cacheKey = `${key}.${op}`;
			let entries = state.subscriptions.get(cacheKey);
			if (!entries) {
				const produced =
					typeof declared === "function"
						? declared(collection[op])
						: (declared as SubscriptionEntries);
				entries = Array.isArray(produced) ? produced : [produced];
				state.subscriptions.set(cacheKey, entries as OnEntry<string>[]);
			}
			entries.forEach((entry, index) => {
				storage[`${key}$${op}${index === 0 ? "" : index}`] = entry;
			});
		}
	}

	const self: Storage<M> = Object.assign(storage, {
		$adapter: (adapter: StorageAdapter) => {
			state.adapter = adapter;
			return self;
		},
		$on: (target: StorageTarget<M>, hook: StorageHook) => {
			state.hooks.push({ target, hook });
			return self;
		},
		$omit: (...keys: string[]) =>
			buildStorage(
				state,
				Object.fromEntries(
					Object.entries(models).filter(([key]) => !keys.includes(key)),
				) as StorageModels,
			),
		$pick: (...keys: string[]) =>
			buildStorage(
				state,
				Object.fromEntries(
					keys.map((key) => [key, models[key]]),
				) as StorageModels,
			),
		$extend: (more: StorageModels) =>
			buildStorage(state, { ...models, ...more }),
		$transaction: <T>(fn: (tx: Storage<M>) => Promise<T> | T) => {
			// The tx view is this storage with only the adapter swapped:
			// hooks and subscriptions stay the SHARED arrays, so they apply
			// (and mount) inside exactly as outside.
			const inside = (adapter: StorageAdapter) =>
				Promise.resolve(fn(buildStorage({ ...state, adapter }, models)));
			return state.adapter.transaction
				? state.adapter.transaction((tx) => inside(tx))
				: inside(state.adapter);
		},
		$models: models,
	} as StorageApi<M>) as Storage<M>;
	return self;
};

/**
 * MANY instances of a var: each model is a collection of rows shaped like
 * the var's VALUE, addressed by the var's NAME - the var stays what it
 * always was (the scope's one current instance), the storage holds every
 * other one, and the query API is how rows move between the two.
 *
 * The returned storage is CUSTOMIZABLE through its `$` surface: `$adapter`
 * swaps the backend in place, `$on` mounts hooks around ops,
 * `$omit`/`$pick`/`$extend` derive model views over the same state, and
 * `$transaction` scopes ops to one adapter transaction.
 *
 * A model can also DECLARE its persistence: pass `{ schema, create: ... }`
 * instead of the bare var, and the op subscriptions ride on the storage as
 * mountable `v.on` entries - `use: [db]` wires them into the app. The same
 * config carries `fields` metadata (unique, index, references) for schema
 * generators to consume.
 */
export const makeStorage = <const M extends StorageModels>(
	adapter: StorageAdapter,
	models: M,
): Storage<M> =>
	buildStorage({ adapter, hooks: [], subscriptions: new Map() }, models);
