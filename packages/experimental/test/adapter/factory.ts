import type {
	AdapterFactoryConfig,
	BetterAuthDBSchema,
	CleanedWhere,
	CustomAdapter,
	DBAdapter,
	DBAdapterSchemaCreation,
	DBFieldAttribute,
	DBTransactionAdapter,
	Where,
} from "./types";

/**
 * @deprecated Legacy object-adapter factory. Prefer `createBetterDB` +
 * `storage.*` / `db.*` modules. Kept for reference while the module path
 * is the primary surface.
 */
const DEFAULT_FIND_MANY_LIMIT = 100;

export const cleanWhere = (where: Where[] | undefined): CleanedWhere[] =>
	(where ?? []).map((clause) => ({
		field: clause.field,
		value: clause.value,
		operator: clause.operator ?? "eq",
		connector: clause.connector ?? "AND",
		mode: clause.mode ?? "sensitive",
	}));

const generateId = () => crypto.randomUUID();

const getModelName = (
	model: string,
	schema: BetterAuthDBSchema | undefined,
	usePlural: boolean,
) => {
	const table = schema?.[model];
	if (table?.modelName) return table.modelName;
	return usePlural ? `${model}s` : model;
};

const getFieldName = (
	model: string,
	field: string,
	schema: BetterAuthDBSchema | undefined,
) => schema?.[model]?.fields?.[field]?.fieldName ?? field;

const fieldsOf = (
	model: string,
	schema: BetterAuthDBSchema | undefined,
): Record<string, DBFieldAttribute> => schema?.[model]?.fields ?? {};

const transformValueIn = (
	value: unknown,
	attr: DBFieldAttribute | undefined,
	config: AdapterFactoryConfig,
): unknown => {
	if (value === undefined || value === null || !attr) return value;
	if (attr.type === "boolean" && config.supportsBooleans === false) {
		return value ? 1 : 0;
	}
	if (attr.type === "date" && config.supportsDates === false) {
		return value instanceof Date ? value.toISOString() : value;
	}
	if (
		(attr.type === "json" ||
			attr.type === "string[]" ||
			attr.type === "number[]") &&
		config.supportsJSON === false
	) {
		return typeof value === "string" ? value : JSON.stringify(value);
	}
	return value;
};

const transformValueOut = (
	value: unknown,
	attr: DBFieldAttribute | undefined,
	config: AdapterFactoryConfig,
): unknown => {
	if (value === undefined || value === null || !attr) return value;
	if (attr.type === "boolean" && config.supportsBooleans === false) {
		return value === 1 || value === true;
	}
	if (attr.type === "date" && config.supportsDates === false) {
		return typeof value === "string" || typeof value === "number"
			? new Date(value)
			: value;
	}
	if (
		(attr.type === "json" ||
			attr.type === "string[]" ||
			attr.type === "number[]") &&
		config.supportsJSON === false
	) {
		if (typeof value === "string") {
			try {
				return JSON.parse(value);
			} catch {
				return value;
			}
		}
	}
	return value;
};

const transformInput = (
	data: Record<string, unknown>,
	model: string,
	schema: BetterAuthDBSchema | undefined,
	config: AdapterFactoryConfig,
	action: "create" | "update",
): Record<string, unknown> => {
	const fields = fieldsOf(model, schema);
	const out: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(data)) {
		const attr = fields[key];
		if (attr?.input === false && action === "create") continue;
		const dbKey = getFieldName(model, key, schema);
		out[dbKey] = transformValueIn(value, attr, config);
	}

	if (action === "create") {
		for (const [key, attr] of Object.entries(fields)) {
			const dbKey = attr.fieldName ?? key;
			if (out[dbKey] !== undefined) continue;
			if (attr.defaultValue === undefined) continue;
			const def =
				typeof attr.defaultValue === "function"
					? attr.defaultValue()
					: attr.defaultValue;
			out[dbKey] = transformValueIn(def, attr, config);
		}
		// Provided id wins; otherwise generate unless disabled.
		if (out.id === undefined && !config.disableIdGeneration) {
			out.id = config.customIdGenerator?.({ model }) ?? generateId();
		}
	}

	return out;
};

const transformOutput = (
	data: Record<string, unknown> | null,
	model: string,
	schema: BetterAuthDBSchema | undefined,
	config: AdapterFactoryConfig,
	select?: string[],
): Record<string, unknown> | null => {
	if (!data) return null;
	const fields = fieldsOf(model, schema);
	const inverted = new Map<string, string>();
	for (const [key, attr] of Object.entries(fields)) {
		inverted.set(attr.fieldName ?? key, key);
	}

	const out: Record<string, unknown> = {};
	for (const [dbKey, value] of Object.entries(data)) {
		const logical = inverted.get(dbKey) ?? dbKey;
		if (select && logical !== "id" && !select.includes(logical)) continue;
		const attr = fields[logical];
		if (attr?.returned === false) continue;
		out[logical] = transformValueOut(value, attr, config);
	}
	return out;
};

const mapWhereFields = (
	where: CleanedWhere[],
	model: string,
	schema: BetterAuthDBSchema | undefined,
): CleanedWhere[] =>
	where.map((clause) => ({
		...clause,
		field: getFieldName(model, clause.field, schema),
	}));

const rejectJoin = (join: unknown) => {
	if (join !== undefined) {
		throw new Error(
			"adapter join is not implemented yet — omit join or wait for a later slice",
		);
	}
};

export type AdapterFactoryOptions = {
	config: AdapterFactoryConfig;
	adapter: (helpers: {
		options: AdapterFactoryConfig;
		schema: BetterAuthDBSchema;
		getModelName: (model: string) => string;
		getFieldName: (args: { model: string; field: string }) => string;
	}) => CustomAdapter;
	schema?: BetterAuthDBSchema;
};

export const createAdapterFactory = (
	options: AdapterFactoryOptions,
): DBAdapter => {
	const config: AdapterFactoryConfig = {
		supportsNumericIds: true,
		supportsDates: true,
		supportsBooleans: true,
		supportsJSON: false,
		supportsArrays: false,
		disableIdGeneration: false,
		usePlural: false,
		...options.config,
	};
	const schema = options.schema ?? {};
	const custom = options.adapter({
		options: config,
		schema,
		getModelName: (model) => getModelName(model, schema, !!config.usePlural),
		getFieldName: ({ model, field }) => getFieldName(model, field, schema),
	});

	const resolveModel = (model: string) =>
		getModelName(model, schema, !!config.usePlural);

	const withWhere = (model: string, where: Where[] | undefined) =>
		mapWhereFields(cleanWhere(where), model, schema);

	const runTransaction = async <R>(
		callback: (trx: DBTransactionAdapter) => Promise<R>,
	): Promise<R> => {
		const txn = config.supportsTransactions ?? config.transaction;
		if (txn === false || txn === undefined || txn === true) {
			return callback(adapterAsTransaction());
		}
		return txn(callback as any) as Promise<R>;
	};

	const adapterAsTransaction = (): DBTransactionAdapter => {
		const { transaction: _, ...rest } = api;
		return rest;
	};

	const api: DBAdapter = {
		id: config.adapterId,
		options: {
			adapterConfig: config,
			...custom.options,
		},
		create: async ({ model, data, select }) => {
			const table = resolveModel(model);
			const input = transformInput(
				data as Record<string, unknown>,
				model,
				schema,
				config,
				"create",
			);
			const created = await custom.create({
				model: table,
				data: input,
				select,
			});
			return transformOutput(created, model, schema, config, select) as any;
		},
		findOne: async ({ model, where, select, join }) => {
			rejectJoin(join);
			const table = resolveModel(model);
			const found = await custom.findOne({
				model: table,
				where: withWhere(model, where),
				select,
			});
			return transformOutput(found, model, schema, config, select) as any;
		},
		findMany: async ({ model, where, limit, select, sortBy, offset, join }) => {
			rejectJoin(join);
			const table = resolveModel(model);
			const rows = await custom.findMany({
				model: table,
				where: where ? withWhere(model, where) : undefined,
				limit: limit ?? DEFAULT_FIND_MANY_LIMIT,
				select,
				sortBy: sortBy
					? {
							field: getFieldName(model, sortBy.field, schema),
							direction: sortBy.direction,
						}
					: undefined,
				offset,
			});
			return rows.map(
				(row) => transformOutput(row, model, schema, config, select)!,
			) as any;
		},
		count: async ({ model, where }) => {
			const table = resolveModel(model);
			return custom.count({
				model: table,
				where: where ? withWhere(model, where) : undefined,
			});
		},
		update: async ({ model, where, update }) => {
			if (!where.length) return null;
			const table = resolveModel(model);
			const input = transformInput(update, model, schema, config, "update");
			const updated = await custom.update({
				model: table,
				where: withWhere(model, where),
				update: input,
			});
			return transformOutput(updated, model, schema, config) as any;
		},
		updateMany: async ({ model, where, update }) => {
			const table = resolveModel(model);
			const input = transformInput(update, model, schema, config, "update");
			return custom.updateMany({
				model: table,
				where: withWhere(model, where),
				update: input,
			});
		},
		delete: async ({ model, where }) => {
			const table = resolveModel(model);
			await custom.delete({
				model: table,
				where: withWhere(model, where),
			});
		},
		deleteMany: async ({ model, where }) => {
			const table = resolveModel(model);
			return custom.deleteMany({
				model: table,
				where: withWhere(model, where),
			});
		},
		consumeOne: async ({ model, where }) => {
			if (custom.consumeOne) {
				const table = resolveModel(model);
				const row = await custom.consumeOne({
					model: table,
					where: withWhere(model, where),
				});
				return transformOutput(row, model, schema, config) as any;
			}
			return runTransaction(async (trx) => {
				const rows = await trx.findMany({ model, where, limit: 1 });
				const row = rows[0];
				if (!row) return null;
				const deleted = await trx.deleteMany({ model, where });
				return deleted > 0 ? (row as any) : null;
			});
		},
		incrementOne: async ({ model, where, increment, set }) => {
			if (custom.incrementOne) {
				const table = resolveModel(model);
				const row = await custom.incrementOne({
					model: table,
					where: withWhere(model, where),
					increment,
					set,
				});
				return transformOutput(row, model, schema, config) as any;
			}
			return runTransaction(async (trx) => {
				const rows = await trx.findMany({ model, where, limit: 1 });
				const row = rows[0] as Record<string, any> | undefined;
				if (!row) return null;
				const update: Record<string, any> = { ...(set ?? {}) };
				for (const [field, delta] of Object.entries(increment)) {
					update[field] = Number(row[field] ?? 0) + delta;
				}
				const idWhere = row.id ? [{ field: "id", value: row.id }] : where;
				return trx.update({ model, where: idWhere, update });
			});
		},
		transaction: (callback) => runTransaction(callback),
		applySchema: custom.createSchema
			? async (props): Promise<DBAdapterSchemaCreation> =>
					custom.createSchema!(props)
			: undefined,
		createSchema: custom.createSchema
			? async (props): Promise<DBAdapterSchemaCreation> =>
					custom.createSchema!(props)
			: undefined,
	};

	return api;
};
