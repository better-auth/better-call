import { type FnDefination, v } from "../src";

/**
 * The IO better-auth's adapter speaks: where clauses, row mapping,
 * create/find/update/delete/count. Not its structure - there is no
 * factory that wraps your methods. You call these from your own fns,
 * then the database.
 *
 * Shared keys (`db.find_one`, ...) mean `v.on("db.*")` works the same
 * against every engine.
 */

export type Operator =
	| "eq"
	| "ne"
	| "lt"
	| "lte"
	| "gt"
	| "gte"
	| "in"
	| "not_in"
	| "contains"
	| "starts_with"
	| "ends_with";

export type Connector = "AND" | "OR";

export type WhereValue =
	| string
	| number
	| boolean
	| string[]
	| number[]
	| Date
	| null;

export type Where = {
	field: string;
	value: WhereValue;
	operator?: Operator;
	connector?: Connector;
	mode?: "sensitive" | "insensitive";
};

/** `{ email: "a", age: { gte: 18 } }` - AND of fields. Use `Where[]` for OR. */
export type WhereRecord = Record<
	string,
	WhereValue | Partial<Record<Operator, WhereValue>>
>;

export type WhereInput = Where[] | WhereRecord;

export type SortBy = { field: string; direction: "asc" | "desc" };

export type FieldType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "json"
	| "string[]"
	| "number[]";

export type Field = {
	type: FieldType;
	column?: string;
	default?: unknown | (() => unknown);
	onUpdate?: unknown | (() => unknown);
	unique?: boolean;
	references?: {
		model: string;
		field: string;
	};
	transform?: {
		input?: (value: unknown) => unknown | Promise<unknown>;
		output?: (value: unknown) => unknown | Promise<unknown>;
	};
};

export type Model = {
	table?: string;
	fields?: Record<string, Field>;
};

export type Schema = Record<string, Model>;

export type Row = Record<string, unknown>;

/** How this engine stores values. `true` = native. */
export type Codec = {
	date?: true | "iso" | "number";
	bool?: true | "integer";
	json?: true | "stringify";
	array?: true | "stringify";
};

export type JoinOption = Record<string, boolean | { limit?: number }>;

export type JoinConfig = Record<
	string,
	{
		on: { from: string; to: string };
		limit?: number;
		relation?: "one-to-one" | "one-to-many" | "many-to-many";
	}
>;

export type FindOneInput = {
	model: string;
	where: Where[];
	select?: string[];
	join?: JoinOption;
};

export type FindManyInput = {
	model: string;
	where?: Where[];
	select?: string[];
	sortBy?: SortBy;
	limit?: number;
	offset?: number;
	join?: JoinOption;
};

export type CreateInput<T extends Row = Row> = {
	model: string;
	data: Omit<T, "id">;
	select?: string[];
	/**
	 * Better Auth normally owns id generation. Set this only when a caller
	 * deliberately needs the id present in `data` to reach the database.
	 */
	forceAllowId?: boolean;
};

export type UpdateInput = {
	model: string;
	where: Where[];
	update: Row;
};

export type UpdateManyInput = UpdateInput;

export type DeleteInput = { model: string; where: Where[] };

export type CountInput = { model: string; where?: Where[] };

export type IncrementOneInput = {
	model: string;
	where: Where[];
	increment: Record<string, number>;
	set?: Record<string, unknown>;
};

export type DBTransactionAdapter = Omit<DBAdapter, "transaction">;

/**
 * The public database surface intentionally matches Better Auth's DBAdapter.
 * Implementations may be branded `v.fn`s; callers only see these signatures.
 */
export interface DBAdapter {
	id: string;
	create: <T extends Record<string, any>, R = T>(
		input: CreateInput<T>,
	) => Promise<R>;
	findOne: <T>(input: FindOneInput) => Promise<T | null>;
	findMany: <T>(input: FindManyInput) => Promise<T[]>;
	count: (input: CountInput) => Promise<number>;
	update: <T>(input: UpdateInput) => Promise<T | null>;
	updateMany: (input: UpdateManyInput) => Promise<number>;
	delete: <_T>(input: DeleteInput) => Promise<void>;
	deleteMany: (input: DeleteInput) => Promise<number>;
	consumeOne: <T>(input: DeleteInput) => Promise<T | null>;
	incrementOne: <T>(input: IncrementOneInput) => Promise<T | null>;
	transaction: <R>(
		callback: (trx: DBTransactionAdapter) => Promise<R>,
	) => Promise<R>;
	options?: any;
}

type MethodArgument<F> = F extends (input: infer A) => any ? A : never;
type MethodResult<F> = F extends (...args: any[]) => infer R ? R : never;
type KeyedAdapterMethod<F, K extends string> = F &
	FnDefination<
		MethodArgument<F>,
		MethodResult<F>,
		K,
		unknown,
		readonly [],
		any
	>;

export type AdapterFns = {
	create: FnDefination<
		CreateInput<any>,
		Promise<any>,
		"db.create",
		unknown,
		readonly [],
		any
	>;
	findOne: FnDefination<
		FindOneInput,
		Promise<Row | null>,
		"db.find_one",
		unknown,
		readonly [],
		any
	>;
	findMany: FnDefination<
		FindManyInput,
		Promise<Row[]>,
		"db.find_many",
		unknown,
		readonly [],
		any
	>;
	count: FnDefination<
		CountInput,
		Promise<number>,
		"db.count",
		unknown,
		readonly [],
		any
	>;
	update: FnDefination<
		UpdateInput,
		Promise<Row | null>,
		"db.update",
		unknown,
		readonly [],
		any
	>;
	updateMany: FnDefination<
		UpdateManyInput,
		Promise<number>,
		"db.update_many",
		unknown,
		readonly [],
		any
	>;
	delete: FnDefination<
		DeleteInput,
		Promise<void>,
		"db.delete",
		unknown,
		readonly [],
		any
	>;
	deleteMany: FnDefination<
		DeleteInput,
		Promise<number>,
		"db.delete_many",
		unknown,
		readonly [],
		any
	>;
	consumeOne: FnDefination<
		DeleteInput,
		Promise<Row | null>,
		"db.consume_one",
		unknown,
		readonly [],
		any
	>;
	incrementOne: FnDefination<
		IncrementOneInput,
		Promise<Row | null>,
		"db.increment_one",
		unknown,
		readonly [],
		any
	>;
	transaction: FnDefination<
		(adapter: DBTransactionAdapter) => Promise<unknown>,
		Promise<unknown>,
		"db.transaction",
		unknown,
		readonly [],
		any
	>;
};

/** A Better Auth-compatible adapter whose operations also compose as fns. */
export type AdapterModule = DBAdapter &
	Record<string, unknown> & {
		readonly $module: true;
		/** Type-only fn map used by module inference; non-enumerable at runtime. */
		readonly $fns: AdapterFns;
		create: KeyedAdapterMethod<DBAdapter["create"], "db.create">;
		findOne: KeyedAdapterMethod<DBAdapter["findOne"], "db.find_one">;
		findMany: KeyedAdapterMethod<DBAdapter["findMany"], "db.find_many">;
		count: KeyedAdapterMethod<DBAdapter["count"], "db.count">;
		update: KeyedAdapterMethod<DBAdapter["update"], "db.update">;
		updateMany: KeyedAdapterMethod<DBAdapter["updateMany"], "db.update_many">;
		delete: KeyedAdapterMethod<DBAdapter["delete"], "db.delete">;
		deleteMany: KeyedAdapterMethod<DBAdapter["deleteMany"], "db.delete_many">;
		consumeOne: KeyedAdapterMethod<DBAdapter["consumeOne"], "db.consume_one">;
		incrementOne: KeyedAdapterMethod<
			DBAdapter["incrementOne"],
			"db.increment_one"
		>;
		transaction: KeyedAdapterMethod<DBAdapter["transaction"], "db.transaction">;
	};

export const operators: readonly Operator[] = [
	"eq",
	"ne",
	"lt",
	"lte",
	"gt",
	"gte",
	"in",
	"not_in",
	"contains",
	"starts_with",
	"ends_with",
];

const OPS = new Set<string>(operators);

export const eq = (field: string, value: WhereValue): Where => ({
	field,
	value,
	operator: "eq",
});
export const ne = (field: string, value: WhereValue): Where => ({
	field,
	value,
	operator: "ne",
});
export const gt = (field: string, value: WhereValue): Where => ({
	field,
	value,
	operator: "gt",
});
export const gte = (field: string, value: WhereValue): Where => ({
	field,
	value,
	operator: "gte",
});
export const lt = (field: string, value: WhereValue): Where => ({
	field,
	value,
	operator: "lt",
});
export const lte = (field: string, value: WhereValue): Where => ({
	field,
	value,
	operator: "lte",
});

export const normalize = (w: Where): Required<Where> => ({
	field: w.field,
	value: w.value,
	operator: w.operator ?? "eq",
	connector: w.connector ?? "AND",
	mode: w.mode ?? "sensitive",
});

const isOpMap = (value: unknown): value is Partial<Record<Operator, unknown>> =>
	!!value &&
	typeof value === "object" &&
	!Array.isArray(value) &&
	!(value instanceof Date) &&
	Object.keys(value).length > 0 &&
	Object.keys(value).every((key) => OPS.has(key));

/** Record or clause list → a flat clause list. */
export const clauses = (where?: WhereInput | null): Where[] => {
	if (!where) return [];
	if (Array.isArray(where)) return where.map(normalize);
	return Object.entries(where).flatMap(([field, value]) => {
		if (isOpMap(value)) {
			return Object.entries(value).map(([operator, v]) =>
				normalize({ field, value: v, operator: operator as Operator }),
			);
		}
		return [normalize({ field, value })];
	});
};

/** SQL-style: AND binds tighter than OR. `A AND B OR C` → (A∧B) ∨ C. */
export const groups = (where?: WhereInput | null): Where[][] => {
	const list = clauses(where);
	if (list.length === 0) return [];
	const out: Where[][] = [];
	let current: Where[] = [];
	out.push(current);
	for (const w of list) {
		if (w.connector === "OR" && current.length > 0) {
			current = [w];
			out.push(current);
		} else current.push(w);
	}
	return out;
};

const test = (row: Row, w: Where): boolean => {
	const got = row[w.field];
	const op = w.operator ?? "eq";
	const want = w.value;
	const fold = (x: unknown) =>
		w.mode === "insensitive" && typeof x === "string" ? x.toLowerCase() : x;
	const a = fold(got);
	const b = fold(want);
	switch (op) {
		case "eq":
			return a === b || (a == null && b == null);
		case "ne":
			return a !== b;
		case "lt":
			return a != null && b != null && (a as any) < b;
		case "lte":
			return a != null && b != null && (a as any) <= b;
		case "gt":
			return a != null && b != null && (a as any) > b;
		case "gte":
			return a != null && b != null && (a as any) >= b;
		case "in":
			return Array.isArray(want) && want.map(fold).includes(a);
		case "not_in":
			return Array.isArray(want) && !want.map(fold).includes(a);
		case "contains":
			return typeof a === "string" && typeof b === "string" && a.includes(b);
		case "starts_with":
			return typeof a === "string" && typeof b === "string" && a.startsWith(b);
		case "ends_with":
			return typeof a === "string" && typeof b === "string" && a.endsWith(b);
	}
};

export const match = (row: Row, where?: WhereInput | null): boolean => {
	const g = groups(where);
	return g.length === 0 || g.some((group) => group.every((w) => test(row, w)));
};

export const id = () => crypto.randomUUID();

export const table = (schema: Schema, model: string) =>
	schema[model]?.table ?? model;

export const column = (schema: Schema, model: string, field: string) =>
	schema[model]?.fields?.[field]?.column ?? field;

export const fieldOf = (schema: Schema, model: string, col: string) => {
	const fields = schema[model]?.fields;
	if (!fields) return col;
	for (const [name, f] of Object.entries(fields)) {
		if ((f.column ?? name) === col) return name;
	}
	return col;
};

const asDate = (value: unknown): Date =>
	value instanceof Date ? value : new Date(value as string | number);

export const encode = (
	value: unknown,
	field: Field | undefined,
	codec: Codec = {},
): unknown => {
	if (value == null) return value;
	const type = field?.type;
	if (type === "date" || value instanceof Date) {
		const d = asDate(value);
		if (codec.date === true) return d;
		if (codec.date === "number") return d.getTime();
		return d.toISOString();
	}
	if (type === "boolean") {
		return codec.bool === "integer" ? (value ? 1 : 0) : Boolean(value);
	}
	if (type === "json") {
		return codec.json === true || typeof value === "string"
			? value
			: JSON.stringify(value);
	}
	if (type === "string[]" || type === "number[]") {
		return codec.array === true || typeof value === "string"
			? value
			: JSON.stringify(value);
	}
	return value;
};

export const decode = (
	value: unknown,
	field: Field | undefined,
	codec: Codec = {},
): unknown => {
	if (value == null) return value;
	const type = field?.type;
	if (type === "date") {
		return asDate(value);
	}
	if (type === "boolean") {
		return value === 1 || value === true || value === "true";
	}
	if (type === "json") {
		return codec.json === true || typeof value !== "string"
			? value
			: JSON.parse(value);
	}
	if (type === "string[]" || type === "number[]") {
		return codec.array === true || typeof value !== "string"
			? value
			: JSON.parse(value);
	}
	return value;
};

export const defaults = (schema: Schema, model: string, data: Row): Row => {
	const fields = schema[model]?.fields ?? {};
	const out: Row = { ...data };
	if (out.id === undefined) out.id = id();
	for (const [name, field] of Object.entries(fields)) {
		if (out[name] !== undefined || field.default === undefined) continue;
		out[name] =
			typeof field.default === "function" ? field.default() : field.default;
	}
	return out;
};

export const updateDefaults = (
	schema: Schema,
	model: string,
	data: Row,
): Row => {
	const fields = schema[model]?.fields ?? {};
	const out: Row = { ...data };
	for (const [name, field] of Object.entries(fields)) {
		if (out[name] !== undefined || field.onUpdate === undefined) continue;
		out[name] =
			typeof field.onUpdate === "function" ? field.onUpdate() : field.onUpdate;
	}
	return out;
};

export const toDb = (
	schema: Schema,
	model: string,
	data: Row,
	codec: Codec = {},
): Row => {
	const fields = schema[model]?.fields ?? {};
	const out: Row = {};
	for (const [name, value] of Object.entries(data)) {
		out[column(schema, model, name)] = encode(value, fields[name], codec);
	}
	return out;
};

export const fromDb = (
	schema: Schema,
	model: string,
	data: Row | null | undefined,
	codec: Codec = {},
): Row | null => {
	if (!data) return null;
	const fields = schema[model]?.fields ?? {};
	const out: Row = {};
	for (const [col, value] of Object.entries(data)) {
		const name = fieldOf(schema, model, col);
		out[name] = decode(value, fields[name], codec);
	}
	return out;
};

export const toDbWhere = (
	schema: Schema,
	model: string,
	where?: WhereInput | null,
	codec: Codec = {},
): Where[] => {
	const fields = schema[model]?.fields ?? {};
	return clauses(where).map((w) => {
		const value = Array.isArray(w.value)
			? w.value.map((item) => encode(item, fields[w.field], codec))
			: encode(w.value, fields[w.field], codec);
		return {
			...w,
			field: column(schema, model, w.field),
			value: value as WhereValue,
		};
	});
};

export const pick = (row: Row | null, select?: string[]): Row | null => {
	if (!row) return null;
	if (!select?.length) return row;
	const out: Row = {};
	for (const key of select) {
		if (key in row) out[key] = row[key];
	}
	return out;
};

/** Input contracts every adapter's fns can reuse. */
export const inputs = {
	findOne: {
		model: v.string(),
		where: v.any<Where[]>(),
		select: v.any<string[], never, true>({ optional: true }),
		join: v.any<JoinOption, never, true>({ optional: true }),
	},
	findMany: {
		model: v.string(),
		where: v.any<Where[], never, true>({ optional: true }),
		select: v.any<string[], never, true>({ optional: true }),
		sortBy: v.object(
			{
				field: v.string(),
				direction: v.string({ enum: ["asc", "desc"] as const }),
			},
			{ optional: true },
		),
		limit: v.number({ optional: true, default: 100 }),
		offset: v.number({ optional: true }),
		join: v.any<JoinOption, never, true>({ optional: true }),
	},
	create: {
		model: v.string(),
		data: v.object(),
		select: v.any<string[], never, true>({ optional: true }),
		forceAllowId: v.boolean({ optional: true, default: false }),
	},
	update: {
		model: v.string(),
		where: v.any<Where[]>(),
		update: v.object(),
	},
	delete: {
		model: v.string(),
		where: v.any<Where[]>(),
	},
	count: {
		model: v.string(),
		where: v.any<Where[], never, true>({ optional: true }),
	},
	incrementOne: {
		model: v.string(),
		where: v.any<Where[]>(),
		increment: v.any<Record<string, number>>(),
		set: v.any<Record<string, unknown>, never, true>({ optional: true }),
	},
};

export const errors = {
	unknown_model: { model: v.string() },
	unknown_field: { model: v.string(), field: v.string() },
	invalid_where: {
		model: v.string(),
		field: v.string(),
		message: v.string(),
	},
	invalid_join: {
		model: v.string(),
		join: v.string(),
		message: v.string(),
	},
	invalid_operation: { operation: v.string(), message: v.string() },
};

/**
 * Key prefix for adapter fns. `db.fn(".find_one", ...)` → `"db.find_one"`,
 * so interceptors target `db.*` no matter which engine is mounted.
 */
export const db = v.fn("db", { errors });
