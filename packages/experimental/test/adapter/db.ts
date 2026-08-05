import { v } from "../../src";
import { generateTable } from "./ddl";
import { pipeline } from "./pipeline";
import {
	applySchemaInput,
	consumeOneInput,
	countInput,
	createInput,
	deleteInput,
	findManyInput,
	findOneInput,
	incrementOneInput,
	updateInput,
	updateManyInput,
} from "./schemas";
import { adapterVars } from "./vars";

type FieldAttr = {
	type?: string;
	fieldName?: string;
	unique?: boolean;
	bigint?: boolean;
	required?: boolean;
	sortable?: boolean;
};

type Schema = Record<
	string,
	{ modelName?: string; fields: Record<string, FieldAttr> }
>;

type StorageModule = Record<string, unknown>;

type DbInstance = {
	schema: unknown;
	config: unknown;
	client: unknown;
};

/**
 * Seed this assembly's schema/config/client onto the current call scope.
 * Does not touch `trx` — the active transaction owns that cell.
 */
const seedInstance = (c: any, instance: DbInstance) => {
	c.var.schema.set(instance.schema);
	c.var.adapterConfig.set(instance.config);
	c.var.client.set(instance.client);
};

/** Ensure every public handler seeds before running — can't forget a call site. */
const withInstance =
	<R>(instance: DbInstance, body: (c: any) => R) =>
	async (c: any): Promise<Awaited<R>> => {
		seedInstance(c, instance);
		return await body(c);
	};

const attachJoins = async (
	c: any,
	baseModel: string,
	baseRow: Record<string, any> | null,
	joinOpt: Record<string, unknown> | undefined,
	select?: string[],
) => {
	if (!baseRow || !joinOpt || !Object.keys(joinOpt).length) {
		return c.use.transformOutput({
			model: baseModel,
			data: baseRow,
			select,
		});
	}

	const config = c.var.adapterConfig.get() as {
		supportsJoins?: boolean;
	};
	const resolved = c.use.resolveJoin({
		model: baseModel,
		join: joinOpt,
		select,
	}) as {
		join: Record<
			string,
			{
				on: { from: string; to: string };
				limit: number;
				relation: "one-to-one" | "one-to-many";
				logicalModel: string;
			}
		>;
		select?: string[];
	};

	const transformed = (await c.use.transformOutput({
		model: baseModel,
		data: baseRow,
		select: resolved.select,
	})) as Record<string, any>;

	if (config.supportsJoins) {
		for (const [, meta] of Object.entries(resolved.join)) {
			const raw = baseRow[meta.logicalModel];
			transformed[meta.logicalModel] = await c.use.transformOutput({
				model: meta.logicalModel,
				data: raw ?? (meta.relation === "one-to-one" ? null : []),
			});
		}
		return transformed;
	}

	for (const [physicalModel, meta] of Object.entries(resolved.join)) {
		const baseFields =
			(c.var.schema.get() as Schema)?.[baseModel]?.fields ?? {};
		const fromLogical =
			Object.entries(baseFields).find(
				([key, attr]) => (attr.fieldName ?? key) === meta.on.from,
			)?.[0] ?? meta.on.from;
		const value = transformed[fromLogical] ?? baseRow[meta.on.from];
		if (value === null || value === undefined) {
			transformed[meta.logicalModel] =
				meta.relation === "one-to-one" ? null : [];
			continue;
		}
		const where = [
			{
				field: meta.on.to,
				value,
				operator: "eq" as const,
				connector: "AND" as const,
				mode: "sensitive" as const,
			},
		];
		if (meta.relation === "one-to-one") {
			const joined = await c.use.storageFindOne({
				model: physicalModel,
				where,
			});
			transformed[meta.logicalModel] = await c.use.transformOutput({
				model: meta.logicalModel,
				data: joined,
			});
		} else {
			const joined = await c.use.storageFindMany({
				model: physicalModel,
				where,
				limit: meta.limit,
			});
			transformed[meta.logicalModel] = await Promise.all(
				(joined as unknown[]).map((row) =>
					c.use.transformOutput({
						model: meta.logicalModel,
						data: row,
					}),
				),
			);
		}
	}
	return transformed;
};

/** Bind public db ops to the active transaction scope (parent context). */
const bindTx = (c: any, api: Record<string, any>) => {
	const call = (fn: any) => (input?: unknown) => fn(input, c);
	return {
		create: call(api.create),
		findOne: call(api.findOne),
		findMany: call(api.findMany),
		count: call(api.count),
		update: call(api.update),
		updateMany: call(api.updateMany),
		delete: call(api.delete),
		deleteMany: call(api.deleteMany),
		consumeOne: call(api.consumeOne),
		incrementOne: call(api.incrementOne),
		applySchema: call(api.applySchema),
		/** Nested begin hits the storage guard via the shared scope. */
		transaction: (input?: unknown) => api.transaction(input, c),
	};
};

export type Tx = ReturnType<typeof bindTx>;

/**
 * Build public `db.*` fns bound to a concrete storage module and instance bag.
 * Storage stays on each fn's internal `use` chain (export names `storageCreate`, …).
 */
export const createDbApi = (
	storage: StorageModule,
	instance: DbInstance,
	hooks: Record<string, unknown> = {},
) => {
	const withStorage = {
		use: [adapterVars, pipeline, storage, hooks],
	};

	const create = v.fn(
		"db.create",
		{ input: createInput, ...withStorage },
		withInstance(instance, async (c) => {
			const table = c.use.getModelName({ model: c.input.model });
			const input = c.use.transformInput({
				model: c.input.model,
				data: c.input.data,
				action: "create",
				strict: true,
			});
			const created = await c.use.storageCreate({
				model: table,
				data: input,
				select: c.input.select,
			});
			return (await c.use.transformOutput({
				model: c.input.model,
				data: created,
				select: c.input.select,
			})) as Record<string, any>;
		}),
	);

	const findOne = v.fn(
		"db.findOne",
		{ input: findOneInput, ...withStorage },
		withInstance(instance, async (c) => {
			const table = c.use.getModelName({ model: c.input.model });
			const where = c.use.cleanWhere({
				model: c.input.model,
				where: c.input.where,
			});
			let select = c.input.select;
			if (c.input.join && Object.keys(c.input.join).length) {
				const resolved = c.use.resolveJoin({
					model: c.input.model,
					join: c.input.join,
					select,
				});
				select = resolved.select;
			}
			const found = await c.use.storageFindOne({
				model: table,
				where,
				select,
			});
			return attachJoins(c, c.input.model, found, c.input.join, select);
		}),
	);

	const findMany = v.fn(
		"db.findMany",
		{ input: findManyInput, ...withStorage },
		withInstance(instance, async (c) => {
			const config = c.var.adapterConfig.get() as {
				defaultFindManyLimit?: number;
			};
			const table = c.use.getModelName({ model: c.input.model });
			const where = c.input.where
				? c.use.cleanWhere({
						model: c.input.model,
						where: c.input.where,
					})
				: undefined;
			let select = c.input.select;
			if (c.input.join && Object.keys(c.input.join).length) {
				const resolved = c.use.resolveJoin({
					model: c.input.model,
					join: c.input.join,
					select,
				});
				select = resolved.select;
			}
			const sortBy = c.input.sortBy
				? {
						field: c.use.getFieldName({
							model: c.input.model,
							field: c.input.sortBy.field,
						}),
						direction: c.input.sortBy.direction,
					}
				: undefined;
			const rows = await c.use.storageFindMany({
				model: table,
				where,
				limit: c.input.limit ?? config.defaultFindManyLimit ?? 100,
				select,
				sortBy,
				offset: c.input.offset,
			});
			return Promise.all(
				(rows as Record<string, any>[]).map((row) =>
					attachJoins(c, c.input.model, row, c.input.join, select),
				),
			);
		}),
	);

	const count = v.fn(
		"db.count",
		{ input: countInput, ...withStorage },
		withInstance(instance, async (c) => {
			const table = c.use.getModelName({ model: c.input.model });
			const where = c.input.where
				? c.use.cleanWhere({
						model: c.input.model,
						where: c.input.where,
					})
				: undefined;
			return c.use.storageCount({ model: table, where });
		}),
	);

	const update = v.fn(
		"db.update",
		{ input: updateInput, ...withStorage },
		withInstance(instance, async (c) => {
			if (!c.input.where.length) return null;
			const table = c.use.getModelName({ model: c.input.model });
			const input = c.use.transformInput({
				model: c.input.model,
				data: c.input.update,
				action: "update",
				strict: true,
			});
			const updated = await c.use.storageUpdate({
				model: table,
				where: c.use.cleanWhere({
					model: c.input.model,
					where: c.input.where,
				}),
				update: input,
			});
			return c.use.transformOutput({
				model: c.input.model,
				data: updated,
			});
		}),
	);

	const updateMany = v.fn(
		"db.updateMany",
		{ input: updateManyInput, ...withStorage },
		withInstance(instance, async (c) => {
			// Empty where matches every row in storage - refuse to wipe the table.
			if (!c.input.where.length) return 0;
			const table = c.use.getModelName({ model: c.input.model });
			const input = c.use.transformInput({
				model: c.input.model,
				data: c.input.update,
				action: "update",
				strict: true,
			});
			return c.use.storageUpdateMany({
				model: table,
				where: c.use.cleanWhere({
					model: c.input.model,
					where: c.input.where,
				}),
				update: input,
			});
		}),
	);

	const deleteOne = v.fn(
		"db.delete",
		{ input: deleteInput, ...withStorage },
		withInstance(instance, async (c) => {
			if (!c.input.where.length) return;
			const table = c.use.getModelName({ model: c.input.model });
			await c.use.storageDelete({
				model: table,
				where: c.use.cleanWhere({
					model: c.input.model,
					where: c.input.where,
				}),
			});
		}),
	);

	const deleteMany = v.fn(
		"db.deleteMany",
		{ input: deleteInput, ...withStorage },
		withInstance(instance, async (c) => {
			if (!c.input.where.length) return 0;
			const table = c.use.getModelName({ model: c.input.model });
			return c.use.storageDeleteMany({
				model: table,
				where: c.use.cleanWhere({
					model: c.input.model,
					where: c.input.where,
				}),
			});
		}),
	);

	const consumeOne = v.fn(
		"db.consumeOne",
		{ input: consumeOneInput, ...withStorage },
		withInstance(instance, async (c) => {
			if (!c.input.where.length) return null;
			const table = c.use.getModelName({ model: c.input.model });
			const where = c.use.cleanWhere({
				model: c.input.model,
				where: c.input.where,
			});
			const row = await c.use.storageConsumeOne({ model: table, where });
			return c.use.transformOutput({ model: c.input.model, data: row });
		}),
	);

	const incrementOne = v.fn(
		"db.incrementOne",
		{ input: incrementOneInput, ...withStorage },
		withInstance(instance, async (c) => {
			if (!c.input.where.length) return null;
			const table = c.use.getModelName({ model: c.input.model });
			const where = c.use.cleanWhere({
				model: c.input.model,
				where: c.input.where,
			});
			const row = await c.use.storageIncrementOne({
				model: table,
				where,
				increment: c.input.increment,
				set: c.input.set,
			});
			return c.use.transformOutput({ model: c.input.model, data: row });
		}),
	);

	const applySchema = v.fn(
		"db.applySchema",
		{
			input: applySchemaInput,
			use: [adapterVars, pipeline, storage, hooks, { generateTable }],
		},
		withInstance(instance, async (c) => {
			const schema = (c.input.tables ?? c.var.schema.get()) as Schema;
			const statements: string[] = [];
			for (const [key, table] of Object.entries(schema)) {
				const name = table.modelName ?? key;
				const fields: Record<string, FieldAttr> = {
					id: { type: "string", unique: true, required: true },
				};
				for (const [field, attr] of Object.entries(table.fields)) {
					const col = attr.fieldName ?? field;
					fields[col] = {
						type: attr.type ?? "string",
						unique: attr.unique ?? false,
						bigint: attr.bigint ?? false,
						required: attr.required ?? true,
						sortable: attr.sortable ?? false,
						fieldName: attr.fieldName,
					};
				}
				const sql = c.use.generateTable({ name, fields });
				statements.push(sql);
			}
			await c.use.storageApplyDDL({
				statements,
				file: c.input.file,
			});
			return {
				code: statements.join(";\n"),
				path: c.input.file ?? "schema.sql",
			};
		}),
	);

	const api: Record<string, any> = {
		create,
		findOne,
		findMany,
		count,
		update,
		updateMany,
		delete: deleteOne,
		deleteMany,
		consumeOne,
		incrementOne,
		applySchema,
	};

	/**
	 * Run a callback inside a storage transaction.
	 *
	 * Prefer the bound handle: `db.transaction(async (tx) => tx.create(...))`.
	 * Unbound module-level `db.create(...)` inside the callback does **not**
	 * participate (fresh scope) and will not roll back with the transaction.
	 */
	type TxCallback = (tx: Tx) => unknown | Promise<unknown>;

	const transaction = v.fn(
		"db.transaction",
		{
			input: v.any<TxCallback>(),
			use: [adapterVars, pipeline, storage, hooks, api],
		},
		withInstance(instance, async (c) => {
			const config = c.var.adapterConfig.get() as {
				supportsTransactions?: boolean;
			};
			const run = c.input;
			if (typeof run !== "function") {
				throw new Error("db.transaction expects a callback (tx) => ...");
			}
			const tx = bindTx(c, { ...api, transaction });
			if (config.supportsTransactions === false) {
				return run(tx);
			}
			await c.use.storageBegin({});
			try {
				const result = await run(tx);
				await c.use.storageCommit({});
				return result;
			} catch (err) {
				await c.use.storageRollback({});
				throw err;
			}
		}),
	);
	api.transaction = transaction;

	return {
		create,
		findOne,
		findMany,
		count,
		update,
		updateMany,
		delete: deleteOne,
		deleteMany,
		consumeOne,
		incrementOne,
		applySchema,
		transaction,
	};
};
