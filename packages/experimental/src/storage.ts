import { captureCallerStack, ValidationError } from "./error";
import { createRandomStringGenerator } from "./helpers/random";
import {
	isVarExtension,
	matchesTarget,
	type OnEntry,
	type VarExtension,
} from "./module";
import {
	asType,
	attrsOf,
	type InferArgs,
	type InferInput,
	isType,
	isVar,
	validate,
	vTypes,
	withAttrs,
} from "./schema";
import type { Prettify } from "./types";
import {
	makeVar,
	type NameOfVar,
	type ValueOfVar,
	type VarDefination,
} from "./var";

const mintStorageId = createRandomStringGenerator("a-z", "A-Z", "0-9");

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

/** One model's CRUD surface. `create` takes the schema's *args* shape
 * (defaulted fields like `db.id` are omittable) and returns the full row,
 * preserving any EXTENDED keys the caller supplied. Inside a scope that
 * mounts `v.extend` / same-name customize on the model var, {@link
 * WidenSchemaFns} rewrites `R` (see `$modelVar`) the same way it widens
 * `v.fn.type({ input: user })`. */
export type Collection<R, N extends string = string, CreateIn = R> = {
	create: <T extends CreateIn>(data: T) => Promise<Prettify<R & T>>;
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
	/**
	 * Phantom: the model var's name. Scope resolution reads it to WIDEN
	 * `R` with everything the scope mounts on that var - same role as
	 * `$fnVar` on fn schemas. Optional, so plain collection objects still
	 * satisfy the type.
	 */
	readonly $modelVar?: [N];
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
 * runs plainly (Better Auth's "as-is" transaction). Implement them where the
 * backend has the primitive.
 *
 * `setup` is how an adapter LEARNS the schema: every storage built on it
 * (and every `$extend` / `$adapter` swap) hands over the models it knows,
 * keyed by model name - field metadata, table-level indexes, the object
 * schema. A unique violation should surface as {@link UniqueConstraintError}.
 */
export type StorageAdapter = {
	/** Receive model metadata - called again as storages add models. */
	setup?: (models: Record<string, ModelMeta>) => void;
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

/** Two rows would share a unique value (or value tuple). Thrown by the
 * memory adapter; SQL adapters should map their constraint error onto it. */
export class UniqueConstraintError extends Error {
	constructor(
		/** The model NAME. */
		public model: string,
		/** The logical fields of the violated constraint, in index order. */
		public fields: readonly string[],
		/** The constraint's index name. */
		public index: string,
	) {
		super(
			`${model}: unique constraint "${index}" violated on (${fields.join(", ")})`,
		);
		this.name = "UniqueConstraintError";
	}
}

type Row = Record<string, unknown>;
type Tables = Map<string, Row[]>;

/** Every unique constraint of a model: the id, `unique` fields, unique
 * indexes. A tuple with a null member never conflicts - SQL semantics. */
const uniqueConstraints = (meta: ModelMeta | undefined) => {
	if (!meta) return [];
	const out: { fields: readonly string[]; index: string }[] = [];
	for (const [field, info] of Object.entries(meta.fields)) {
		if (info.id || info.unique) {
			out.push({
				fields: [field],
				index: modelIndexName(meta.name, { fields: [field], unique: true }),
			});
		}
	}
	for (const index of meta.indexes) {
		if (index.unique) {
			out.push({
				fields: index.fields,
				index: modelIndexName(meta.name, index),
			});
		}
	}
	return out;
};

/** Did a transaction change this row? Shallow, Date-aware. */
const rowChanged = (before: Row, after: Row) => {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of keys) {
		if (!equals(before[key], after[key])) return true;
	}
	return false;
};

/** The DUMMY adapter: rows in arrays, one per model. Implements the whole
 * surface - the optional verbs by mutation (single-threaded, so "atomic"),
 * unique constraints from `setup` metadata (ids, `db.unique`, unique
 * indexes), and transactions by copy-on-write: the block runs against a
 * clone, a throw discards it, a commit replays only the rows it created,
 * changed or removed - writes that interleaved outside survive either way
 * (Better Auth's memory adapter, row-granular, last writer wins). */
export const memoryAdapter = (): StorageAdapter => {
	const meta = new Map<string, ModelMeta>();
	return memoryOver(new Map(), meta);
};

const memoryOver = (tables: Tables, meta: Map<string, ModelMeta>) => {
	const rows = (model: string) => {
		let list = tables.get(model);
		if (!list) {
			list = [];
			tables.set(model, list);
		}
		return list;
	};
	/** Throw when `candidate` would collide with a row other than `self`. */
	const checkUnique = (model: string, candidate: Row, self?: Row) => {
		for (const { fields, index } of uniqueConstraints(meta.get(model))) {
			if (fields.some((field) => candidate[field] == null)) continue;
			const clash = rows(model).some(
				(row) =>
					row !== self &&
					fields.every((field) => equals(row[field], candidate[field])),
			);
			if (clash) throw new UniqueConstraintError(model, fields, index);
		}
	};
	const self: StorageAdapter = {
		setup: (models) => {
			for (const [name, model] of Object.entries(models)) meta.set(name, model);
		},
		create: (model, data) => {
			const row = { ...data };
			checkUnique(model, row);
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
			if (!row) return null;
			checkUnique(model, { ...row, ...patch }, row);
			return Object.assign(row, patch);
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
			const next = { ...row };
			for (const [field, by] of Object.entries(increments)) {
				next[field] = ((row[field] as number) ?? 0) + by;
			}
			checkUnique(model, next, row);
			return Object.assign(row, next);
		},
		transaction: async (run) => {
			// Clone every row, remembering which live row it came from and
			// what it looked like at the start.
			const origin = new Map<Row, Row>();
			const start = new Map<Row, Row>();
			const clone: Tables = new Map();
			for (const [model, list] of tables) {
				clone.set(
					model,
					list.map((live) => {
						const copy = { ...live };
						origin.set(copy, live);
						start.set(copy, { ...live });
						return copy;
					}),
				);
			}
			const baseRows = new Set(origin.values());
			// A throw propagates here and the clone is simply dropped.
			const result = await run(memoryOver(clone, meta));
			for (const [model, list] of clone) {
				const kept = new Set<Row>();
				const appended: Row[] = [];
				for (const copy of list) {
					const live = origin.get(copy);
					if (!live) {
						appended.push(copy);
						continue;
					}
					kept.add(live);
					if (rowChanged(start.get(copy) as Row, copy)) {
						for (const key of Object.keys(live)) delete live[key];
						Object.assign(live, copy);
					}
				}
				// Drop rows the block removed; keep rows created meanwhile.
				const merged = rows(model).filter(
					(live) => !baseRows.has(live) || kept.has(live),
				);
				tables.set(model, [...merged, ...appended]);
			}
			return result;
		},
	};
	return self;
};

/* ---------------------------------- models ---------------------------------- */

type AnyVar = VarDefination<any, any, any, any>;

/** Persistence facts about one field the ROW SHAPE can't say. Prefer declaring
 * these via `db.unique` / `db.indexed` / `db.references` / `db.id` on the
 * field schema; `ModelConfig.fields` remains an override.
 *
 * `id` is honored at write time by {@link prepareCreate} (auto-fill when
 * absent). `unique` / `index` / `references` reach the adapter through
 * `setup` (the memory adapter enforces `id` / `unique`; SQL adapters and
 * schema generators build constraints from them). Multi-field indexes are
 * model-level: {@link ModelIndex}. Read shaping like redaction is a `$on`
 * hook, not metadata. */
export type FieldMeta = {
	/** Primary key for this model - auto-filled on create when absent. */
	id?: boolean;
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

/** A table-level index over one or more fields - Better Auth's
 * `DBTableIndex`. Declared on the model (`schema(name, fields, { indexes })`
 * or `ModelConfig.indexes`); single-field facts stay on the field
 * (`db.unique` / `db.indexed`). */
export type ModelIndex = {
	/** Logical field names, in index order (one to sixteen). */
	fields: readonly [string, ...string[]];
	/** The field tuple must be unique across rows. */
	unique?: boolean;
	/** Database index name; {@link modelIndexName} derives one when absent. */
	name?: string;
};

/** Everything an adapter / schema generator learns about one model. */
export type ModelMeta = {
	/** The model NAME - what adapter verbs address. */
	name: string;
	/** The model's object schema (field types, optionality, defaults). */
	schema: unknown;
	/** Per-field facts: id, unique, index, references. */
	fields: Record<string, FieldMeta>;
	/** Table-level (composite) indexes. */
	indexes: ModelIndex[];
};

const MAX_INDEX_NAME_BYTES = 63;
const MAX_INDEX_FIELDS = 16;

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

const truncateUtf8 = (value: string, maxBytes: number) => {
	let out = "";
	let bytes = 0;
	for (const character of value) {
		const size = utf8Length(character);
		if (bytes + size > maxBytes) break;
		out += character;
		bytes += size;
	}
	return out;
};

/** FNV-1a, hex - keeps truncated generated names distinct and stable. */
const indexNameHash = (value: string) => {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
};

/** The index's database name - Better Auth's `getDatabaseIndexName`:
 * the declared `name`, else `${table}_${fields}_uidx|idx`, truncated with a
 * stable hash past 63 bytes. Pass physical column names to name a
 * resolved index. */
export const modelIndexName = (
	table: string,
	index: Pick<ModelIndex, "fields" | "unique" | "name">,
): string => {
	if (index.name !== undefined) return index.name;
	const kind = index.unique ? "uidx" : "idx";
	const generated = `${table}_${index.fields.join("_")}_${kind}`;
	if (utf8Length(generated) <= MAX_INDEX_NAME_BYTES) return generated;
	const suffix = `_${indexNameHash(generated)}_${kind}`;
	return `${truncateUtf8(
		generated.slice(0, -kind.length - 1),
		MAX_INDEX_NAME_BYTES - utf8Length(suffix),
	)}${suffix}`;
};

/** Reject indexes no database could build the same way - Better Auth's
 * `resolveDatabaseTableIndexes` rules: 1-16 known, distinct fields; a
 * unique index over required fields only; a portable name. */
export const checkModelIndexes = (
	model: string,
	schema: unknown,
	indexes: readonly ModelIndex[],
): void => {
	const type = asType(schema ?? {});
	const shape = (type.shape ?? {}) as Record<string, unknown>;
	for (const index of indexes) {
		const where = `Index on model "${model}"`;
		if (index.fields.length === 0) {
			throw new Error(`${where} must include at least one field.`);
		}
		if (index.fields.length > MAX_INDEX_FIELDS) {
			throw new Error(
				`${where} can include at most ${MAX_INDEX_FIELDS} fields so it works across supported databases.`,
			);
		}
		if (new Set(index.fields).size !== index.fields.length) {
			throw new Error(`${where} contains the same field more than once.`);
		}
		for (const field of index.fields) {
			if (!(field in shape)) {
				throw new Error(`${where} references unknown field "${field}".`);
			}
			if (index.unique && asType(shape[field]).optional) {
				throw new Error(
					`Unique index on model "${model}" can only include required fields so its behavior is consistent across databases.`,
				);
			}
		}
		if (index.name !== undefined) {
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(index.name)) {
				throw new Error(
					`Index names must start with a letter or underscore and contain only letters, numbers, and underscores (got "${index.name}").`,
				);
			}
			if (utf8Length(index.name) > MAX_INDEX_NAME_BYTES) {
				throw new Error(
					`Index names must be at most ${MAX_INDEX_NAME_BYTES} UTF-8 bytes.`,
				);
			}
		}
	}
};

/** Same `(name, fields, unique)` twice is one index. */
const mergeIndexes = (
	...lists: readonly (readonly ModelIndex[] | undefined)[]
): ModelIndex[] => {
	const seen = new Set<string>();
	const out: ModelIndex[] = [];
	for (const index of lists.flatMap((list) => list ?? [])) {
		const key = JSON.stringify([
			index.name ?? null,
			index.fields,
			index.unique ?? false,
		]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(index);
	}
	return out;
};

/** Read `$attrs.db.indexes` off a model var (`schema(name, fields, { indexes })`). */
export const indexesFromSchema = (sv: AnyVar): ModelIndex[] => [
	...((attrsOf(sv, "db")?.indexes as ModelIndex[] | undefined) ?? []),
];

/** The var's indexes plus `ModelConfig.indexes`, deduplicated. */
export const resolveModelIndexes = (model: ModelInput): ModelIndex[] => {
	const input = asModelInput(model);
	if (isVar(input)) return indexesFromSchema(input as AnyVar);
	const config = input as ModelConfig<AnyVar>;
	return mergeIndexes(indexesFromSchema(config.schema), config.indexes);
};

/** Everything {@link StorageAdapter.setup} receives for one model. */
export const resolveModelMeta = (model: ModelInput): ModelMeta => {
	const input = asModelInput(model);
	const def = (isVar(input) ? input : (input as ModelConfig).schema) as {
		name: string;
	};
	return {
		name: def.name,
		schema: schemaOfModel(input),
		fields: resolveModelFields(input) ?? {},
		indexes: resolveModelIndexes(input),
	};
};

/** Read `$attrs.db` off each field of a var's object schema. */
export const fieldsFromSchema = (sv: AnyVar): Record<string, FieldMeta> => {
	const schema = asType((sv as { schema?: unknown }).schema ?? {});
	if (schema.name !== "object" || schema.shape === undefined) return {};
	const fields: Record<string, FieldMeta> = {};
	for (const [key, child] of Object.entries(
		schema.shape as Record<string, unknown>,
	)) {
		const meta = attrsOf(child, "db") as FieldMeta | undefined;
		if (meta && Object.keys(meta).length > 0) fields[key] = { ...meta };
	}
	return fields;
};

/**
 * Schema attrs first; `ModelConfig.fields[k]` replaces that key entirely
 * when present (compat override).
 */
export const resolveModelFields = (
	model: ModelInput,
): Record<string, FieldMeta> | undefined => {
	const input = asModelInput(model);
	if (isVar(input)) {
		const fromSchema = fieldsFromSchema(input as AnyVar);
		return Object.keys(fromSchema).length > 0 ? fromSchema : undefined;
	}
	const config = input as ModelConfig<AnyVar>;
	const fromSchema = fieldsFromSchema(config.schema);
	const override = config.fields ?? {};
	const merged: Record<string, FieldMeta> = { ...fromSchema };
	for (const [key, meta] of Object.entries(override)) {
		if (meta !== undefined) merged[key] = meta;
	}
	return Object.keys(merged).length > 0 ? merged : undefined;
};

/**
 * `$attrs.db` write-time effects. Schema defaults (including `db.id`'s
 * `generateId` factory) are applied by validate first; this seam covers
 * attr-driven behavior that isn't already a field default, and leaves
 * room for future hooks. `unique` / `index` / `references` stay adapter /
 * schema-generator concerns.
 */
const applyDbWriteAttrs = (
	shape: Record<string, unknown>,
	row: Record<string, unknown>,
	op: "create" | "update",
): Record<string, unknown> => {
	if (op !== "create") return row;
	const out: Record<string, unknown> = { ...row };
	for (const [key, child] of Object.entries(shape)) {
		const meta = attrsOf(child, "db") as FieldMeta | undefined;
		if (!meta?.id || out[key] !== undefined) continue;
		// Auto-id when `$attrs.db.id` is set and the field is still absent
		// (attrs-only marking, or a default that somehow didn't fire).
		// Mirrors generateId's default size/alphabet without importing the
		// db plugin (storage <- db would cycle through the package entry).
		out[key] = mintStorageId(32);
	}
	return out;
};

/**
 * Prepare a create payload: validate against the model object schema
 * (fills defaults, including async factories), keep caller EXTENDED keys
 * validate would strip, then run `$attrs.db` write hooks.
 */
const prepareCreate = (
	modelSchema: unknown,
	data: Record<string, unknown>,
	path: string,
): Record<string, unknown> | Promise<Record<string, unknown>> => {
	const schema = asType(modelSchema ?? {});
	if (schema.name !== "object" || schema.shape === undefined) {
		return data;
	}
	const shape = schema.shape as Record<string, unknown>;
	const validated = validate(schema, data, path);
	const finish = (parsed: Record<string, unknown>) => {
		// Validate only materializes declared fields - put EXTENDED keys back.
		const extras = Object.fromEntries(
			Object.entries(data).filter(([key]) => !(key in shape)),
		);
		return applyDbWriteAttrs(shape, { ...parsed, ...extras }, "create");
	};
	if (
		validated !== null &&
		typeof (validated as { then?: unknown })?.then === "function"
	) {
		return (validated as Promise<Record<string, unknown>>).then(finish);
	}
	return finish(validated as Record<string, unknown>);
};

const schemaOfModel = (input: ModelInput): unknown => {
	const def = isVar(input) ? input : (input as ModelConfig).schema;
	return (def as { schema?: unknown }).schema;
};

/** One model var per extension, so every read of it sees the same var. */
const extensionModels = new WeakMap<object, AnyVar>();

/**
 * A `v.extend(model, fields)` value as a model: ONE var named like the
 * base, whose object schema is the base's fields plus the extension's
 * (extension wins on a clash), carrying the extension's whole-var attrs -
 * the base's `db.model` / `db.indexes` plus whatever `db.extend` added.
 * Per-field attrs (`db.unique`, `db.indexed`, ...) ride on the fields.
 */
export const modelOfExtension = (
	extension: VarExtension<string, any, any, any>,
): AnyVar => {
	const cached = extensionModels.get(extension);
	if (cached) return cached;
	const shapeOf = (schema: unknown): Record<string, unknown> => {
		if (schema === undefined || schema === null) return {};
		if (!isType(schema)) return schema as Record<string, unknown>;
		const type = asType(schema);
		return type.name === "object"
			? ((type.shape ?? {}) as Record<string, unknown>)
			: {};
	};
	const base = extension.base as { schema?: unknown } | undefined;
	let model = makeVar(extension.name, {
		default: null,
		schema: vTypes.object({
			...shapeOf(base?.schema),
			...shapeOf(extension.schema),
		}),
	}) as AnyVar;
	for (const [namespace, attrs] of Object.entries(extension.$attrs ?? {})) {
		model = withAttrs(model, namespace, attrs);
	}
	extensionModels.set(extension, model);
	return model;
};

/** Extensions become model vars - bare or as a `ModelConfig.schema`. */
const asModelInput = (input: ModelInput): AnyVar | ModelConfig<AnyVar> => {
	if (isVarExtension(input)) return modelOfExtension(input);
	const schema = (input as { schema?: unknown }).schema;
	if (!isVar(input) && isVarExtension(schema)) {
		return { ...(input as ModelConfig), schema: modelOfExtension(schema) };
	}
	return input as AnyVar | ModelConfig<AnyVar>;
};

const normalizeModels = <M extends StorageModels>(models: M): M =>
	Object.fromEntries(
		Object.entries(models).map(([key, input]) => [key, asModelInput(input)]),
	) as M;

/** Normalize `$models` entries so adapters always see merged `fields`.
 * Bare vars stay bare vars (identity preserved); use
 * {@link resolveModelFields} to read schema attrs off them. ModelConfig
 * entries get `fields` filled from schema attrs + overrides. */
const resolveModels = <M extends StorageModels>(models: M): M => {
	const out: Record<string, unknown> = {};
	for (const [key, input] of Object.entries(models)) {
		if (isVar(input)) {
			out[key] = input;
			continue;
		}
		const config = input as ModelConfig;
		const fields = resolveModelFields(config);
		const indexes = resolveModelIndexes(config);
		out[key] = {
			...config,
			...(fields === undefined ? {} : { fields }),
			...(indexes.length === 0 ? {} : { indexes }),
		};
	}
	return out as M;
};

/** Model metadata by NAME - what {@link StorageAdapter.setup} receives.
 * Validates `ModelConfig.indexes` (schema-declared ones were checked by
 * `schema()`). */
const metaByName = (models: StorageModels): Record<string, ModelMeta> => {
	const out: Record<string, ModelMeta> = {};
	for (const input of Object.values(models)) {
		const meta = resolveModelMeta(input);
		if (!isVar(input) && (input as ModelConfig).indexes) {
			checkModelIndexes(
				meta.name,
				meta.schema,
				(input as ModelConfig).indexes ?? [],
			);
		}
		out[meta.name] = meta;
	}
	return out;
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
export type ModelConfig<SV extends ModelVarLike = ModelVarLike> = {
	/** The model var - or a `v.extend` of one (its fields plus the
	 * extension's). */
	schema: SV;
	fields?: {
		[F in keyof RowOfModel<SV>]?: FieldMeta;
	};
	/** Table-level indexes, added to those the var declares. */
	indexes?: readonly ModelIndex[];
} & {
	[Op in StorageOp]?:
		| ((action: Collection<RowOfModel<SV>>[Op]) => SubscriptionEntries)
		| SubscriptionEntries;
};

type AnyExtension = VarExtension<string, any, any, any>;

/** What can stand for a model's shape: a var, or a `v.extend` of one. */
type ModelVarLike = AnyVar | AnyExtension;

/** A model is a bare var, a `v.extend` of one (its fields plus the
 * extension's), or a config carrying either as `schema`. */
type ModelInput = ModelVarLike | ModelConfig;

/** The var (or extension) behind a model input. Checked through `$var` /
 * `$varExtend`, never `schema` - both ALSO have a `schema` property. */
type SchemaOf<T> = T extends { $var: true }
	? T
	: T extends { $varExtend: true }
		? T
		: T extends { schema: infer SV }
			? SV
			: never;

/** The row a var or extension describes. */
type RowOfModel<V> =
	V extends VarExtension<any, infer S, infer B, any>
		? Prettify<NonNullable<B> & InferInput<S>>
		: NonNullable<ValueOfVar<V>>;

type RowOf<T> = RowOfModel<SchemaOf<T>>;

/** The var's object schema - what create validates / default-fills against. */
type ModelSchemaOf<T> =
	SchemaOf<T> extends { schema?: infer S } ? NonNullable<S> : never;

/** Create payload: InferArgs so `db.id` / other defaults are omittable. */
type CreateInputOf<T> =
	SchemaOf<T> extends VarExtension<any, infer S, any, infer BS>
		? Prettify<InferArgs<NonNullable<BS>> & InferArgs<S>>
		: [ModelSchemaOf<T>] extends [never]
			? RowOf<T>
			: InferArgs<ModelSchemaOf<T>>;

/** Declared name of the var behind a model input - brands the collection. */
type ModelVarName<T> =
	SchemaOf<T> extends VarExtension<infer N, any, any, any>
		? N
		: NameOfVar<SchemaOf<T>> & string;

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
	[K in keyof M]: Collection<
		RowOf<M[K]>,
		ModelVarName<M[K]>,
		CreateInputOf<M[K]>
	>;
} & StorageApi<M>;

/** Duck-type a storage instance - `$models` plus the `$adapter` method. */
export const isStorage = (value: unknown): value is Storage<StorageModels> =>
	typeof value === "object" &&
	value !== null &&
	"$models" in value &&
	typeof (value as { $adapter?: unknown }).$adapter === "function";

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
	/**
	 * Run `fn` against a view whose ops share ONE adapter transaction -
	 * committed when it resolves, rolled back when it throws. Same models,
	 * same hooks (they run inside). Better Auth's `runWithTransaction`:
	 * - Where `AsyncLocalStorage` exists, ops on ANY view of this storage
	 *   made while `fn` runs join the transaction too - code that only
	 *   holds the outer storage (hooks, helpers) needn't be handed `tx`.
	 * - Nested `$transaction` calls JOIN the outermost one (no savepoints):
	 *   an inner throw the outer block catches does not undo inner writes.
	 * - {@link StorageApi.$afterCommit} work queued inside runs once the
	 *   OUTERMOST block commits, in order; a rollback drops it.
	 * - An adapter without `transaction` runs `fn` plainly - no atomicity,
	 *   same answer, after-commit work still waits for `fn` to succeed.
	 */
	$transaction: <T>(
		fn: (tx: Storage<M>) => Promise<T> | T,
		options?: {
			/** Handles an after-commit failure. Without it the first failure
			 * rejects `$transaction` (the data is already committed) and
			 * skips the rest of the queue. */
			onAfterCommitError?: (error: unknown) => void | Promise<void>;
		},
	) => Promise<T>;
	/**
	 * Hold `work` until the outermost transaction commits - Better Auth's
	 * `queueAfterTransactionHook`, for side effects (after hooks, cache
	 * writes) that must not outlive a rollback. Outside a transaction it
	 * runs now; the promise settles when it has run (or was queued).
	 */
	$afterCommit: (
		work: () => unknown,
		options?: {
			/** Handles `work`'s failure instead of propagating it. */
			onError?: (error: unknown) => void | Promise<void>;
		},
	) => Promise<void>;
	/** True while this view's ops go through a transaction. */
	$inTransaction: () => boolean;
	/** The model definitions this view exposes. */
	$models: M;
};

/** Adapter, hooks and produced subscription entries live HERE, shared by
 * every view of one storage - a `$pick`ed slice still writes through the
 * same backend and hook stack, and a subscription materializes ONCE (same
 * entry object across views, so double-mounting dedups by identity).
 * `meta` is every model any view has declared, handed to `adapter.setup`. */
type StorageState = {
	adapter: StorageAdapter;
	hooks: { target: string; hook: StorageHook }[];
	subscriptions: Map<string, readonly OnEntry<string>[]>;
	meta: Record<string, ModelMeta>;
};

/** One running transaction of one storage state. */
type TxFrame = {
	adapter: StorageAdapter;
	afterCommit: (() => Promise<void>)[];
};

/* ------------------------------- transactions ------------------------------- */

type TxStore = Map<StorageState, TxFrame>;
type AmbientStorage = {
	run: <R>(store: TxStore, fn: () => R) => R;
	getStore: () => TxStore | undefined;
};

/** `undefined` until first loaded; `null` where the runtime has none. */
let ambient: AmbientStorage | null | undefined;
let ambientLoad: Promise<AmbientStorage | null> | undefined;

/** `AsyncLocalStorage` - the global (Workers, Deno, Bun) or
 * `node:async_hooks`, loaded on the first transaction. The specifier is a
 * variable so browser bundles never try to resolve it. */
const loadAmbient = (): Promise<AmbientStorage | null> => {
	ambientLoad ??= (async () => {
		const global = (
			globalThis as { AsyncLocalStorage?: new () => AmbientStorage }
		).AsyncLocalStorage;
		if (global) return new global();
		try {
			// Built at runtime so the bundler can't fold it into a literal.
			const specifier = ["node", "async_hooks"].join(":");
			const mod = (await import(/* @vite-ignore */ specifier)) as {
				AsyncLocalStorage: new () => AmbientStorage;
			};
			return new mod.AsyncLocalStorage();
		} catch {
			return null;
		}
	})().then((loaded) => {
		ambient = loaded;
		return loaded;
	});
	return ambientLoad;
};

const ambientFrame = (state: StorageState): TxFrame | undefined =>
	ambient?.getStore()?.get(state);

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

const isThenable = (value: unknown): value is Promise<unknown> =>
	value !== null &&
	typeof (value as { then?: unknown } | undefined)?.then === "function";

/** The adapter a view's ops hit right now: its own transaction, the
 * ambient one, else the storage's. */
const activeFrame = (state: StorageState, frame: TxFrame | undefined) =>
	frame ?? ambientFrame(state);

const buildStorage = <M extends StorageModels>(
	state: StorageState,
	models: M,
	/** Set on a `$transaction` view: its ops always use this transaction. */
	frame?: TxFrame,
): Storage<M> => {
	// Every op funnels here: matching hooks compose around the adapter
	// call, first mounted outermost - the `v.on` rules, one layer down.
	// `create` hooks see the CALLER's data (Better Auth's
	// `databaseHooks.*.create.before`); validation and schema defaults
	// (`db.id`, timestamps) apply after them, at the adapter boundary.
	const run = (
		key: string,
		name: string,
		op: StorageOp,
		args: unknown[],
		prepare?: (data: Row) => Row | Promise<Row>,
	) => {
		const base = () => {
			const adapter = activeFrame(state, frame)?.adapter ?? state.adapter;
			// A sync adapter's throw (a unique violation) still rejects.
			const call = (list: unknown[]) => {
				try {
					return Promise.resolve(rawOp(adapter, name, op, list));
				} catch (thrown) {
					return Promise.reject(thrown);
				}
			};
			if (!prepare) return call(args);
			return Promise.resolve(prepare((args[0] ?? {}) as Row)).then((row) =>
				call([row]),
			);
		};
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
		const stamp = (thrown: unknown): never => {
			if (thrown instanceof ValidationError) {
				captureCallerStack(thrown, collection.create);
			}
			throw thrown;
		};
		// Throws synchronously when nothing async stands in front of it, so
		// `create(bad)` still throws at the call site with no hooks mounted.
		const prepare = (data: Row) => {
			try {
				const row = prepareCreate(schemaOfModel(input), data, `${key}.create`);
				return isThenable(row) ? row.catch(stamp) : row;
			} catch (thrown) {
				return stamp(thrown);
			}
		};
		const collection = {
			create: (data: unknown) =>
				run(key, name, "create", [data ?? {}], prepare),
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
			adapter.setup?.(state.meta);
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
				frame,
			),
		$pick: (...keys: string[]) =>
			buildStorage(
				state,
				Object.fromEntries(
					keys.map((key) => [key, models[key]]),
				) as StorageModels,
				frame,
			),
		$extend: (added: StorageModels) => {
			const more = normalizeModels(added);
			declareModels(state, more);
			return buildStorage(state, { ...models, ...more }, frame);
		},
		$transaction: async <T>(
			fn: (tx: Storage<M>) => Promise<T> | T,
			options?: {
				onAfterCommitError?: (error: unknown) => void | Promise<void>;
			},
		): Promise<T> => {
			// Already inside one: join it (Better Auth's
			// `isTransactionActive` short-circuit).
			const active = activeFrame(state, frame);
			if (active) return fn(buildStorage(state, models, active));

			const als = await loadAmbient();
			const afterCommit: TxFrame["afterCommit"] = [];
			// The tx view is this storage bound to the transaction's adapter:
			// hooks and subscriptions stay the SHARED state, so they apply
			// (and mount) inside exactly as outside.
			const inside = (adapter: StorageAdapter): Promise<T> => {
				const txFrame: TxFrame = { adapter, afterCommit };
				const body = () =>
					Promise.resolve(fn(buildStorage(state, models, txFrame)));
				if (!als) return body();
				const store: TxStore = new Map(als.getStore());
				store.set(state, txFrame);
				return als.run(store, body);
			};
			const adapter = state.adapter;
			const result = adapter.transaction
				? await adapter.transaction(inside)
				: await inside(adapter);
			for (const work of afterCommit) {
				try {
					await work();
				} catch (error) {
					if (!options?.onAfterCommitError) throw error;
					try {
						await options.onAfterCommitError(error);
					} catch {
						// Reporting cannot undo committed work or skip later hooks.
					}
				}
			}
			return result;
		},
		$afterCommit: async (
			work: () => unknown,
			options?: { onError?: (error: unknown) => void | Promise<void> },
		): Promise<void> => {
			const execute = async () => {
				try {
					await work();
				} catch (error) {
					if (!options?.onError) throw error;
					await options.onError(error);
				}
			};
			const active = activeFrame(state, frame);
			if (!active) return execute();
			active.afterCommit.push(execute);
		},
		$inTransaction: () => activeFrame(state, frame) !== undefined,
		$models: resolveModels(models),
	} as StorageApi<M>) as Storage<M>;
	return self;
};

/** Record models on the state and tell the adapter. */
const declareModels = (state: StorageState, models: StorageModels) => {
	const added = metaByName(models);
	Object.assign(state.meta, added);
	state.adapter.setup?.(added);
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
 *
 * A `v.extend(model, fields)` value works as a model too: the storage gets
 * the base's fields plus the extension's, attrs included - so
 * `v.storage(adapter, { user: userWithEmail })` enforces the extension's
 * `db.unique(email)`. See {@link modelOfExtension}.
 */
export const makeStorage = <const M extends StorageModels>(
	adapter: StorageAdapter,
	models: M,
): Storage<M> => {
	const state: StorageState = {
		adapter,
		hooks: [],
		subscriptions: new Map(),
		meta: {},
	};
	const normalized = normalizeModels(models);
	declareModels(state, normalized);
	return buildStorage(state, normalized);
};
