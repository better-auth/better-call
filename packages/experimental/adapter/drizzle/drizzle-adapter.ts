import { count, eq, inArray, sql } from "drizzle-orm";
import { v } from "../../src";
import {
	type AdapterModule,
	column,
	type DBTransactionAdapter,
	type DeleteInput,
	db as dbFn,
	type FindManyInput,
	type IncrementOneInput,
	inputs,
	type Row,
	type Schema,
	type UpdateInput,
} from "../index";
import { mysqlCreateResult, mysqlTarget } from "./mysql";
import { AdapterError, affectedRows } from "./query-builders";
import { createQueryTools } from "./relations";
import { createTransformTools } from "./transforms";
import type { Client, DrizzleAdapterConfig } from "./types";

export const drizzleAdapter = (
	root: Client,
	config: DrizzleAdapterConfig,
): AdapterModule => {
	const models: Schema = config.models ?? {};
	const transforms = createTransformTools(root, config, models);
	const queries = createQueryTools(config, models, transforms);
	const { resolveTable, transformInput, transformOutput } = transforms;
	const { convertWhere, findMany, findOne } = queries;

	const debug = (method: string, stage: string, value?: unknown) => {
		const enabled =
			config.debugLogs === true ||
			(typeof config.debugLogs === "object" &&
				config.debugLogs[method as keyof typeof config.debugLogs]);
		if (enabled) {
			console.debug(`[Drizzle Adapter] ${method} ${stage}`, value ?? "");
		}
	};

	const tagged = async <T>(
		context: any,
		work: () => Promise<T>,
	): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof AdapterError) {
				throw context.error(error.tag, error.data);
			}
			throw error;
		}
	};

	const makeAdapter = (
		client: Client,
		inTransaction = false,
	): AdapterModule => {
		const create = dbFn.fn(".create", { input: inputs.create }, (c) =>
			tagged(c, async () => {
				const { model, select, forceAllowId } = c.input;
				const resolved = resolveTable(client, model);
				const data = await transformInput(
					resolved.value,
					model,
					c.input.data,
					"create",
					forceAllowId,
				);
				debug("create", "input", { model, data });
				let raw: Row | null;
				if (config.provider === "mysql") {
					const insert = async (tx: Client) => {
						const result = await tx
							.insert(resolved.value)
							.values(data)
							.execute();
						return mysqlCreateResult(
							tx,
							models,
							model,
							resolved.value,
							data,
							result,
						);
					};
					raw = inTransaction
						? await insert(client)
						: await client.transaction(insert);
				} else {
					const rows = await client
						.insert(resolved.value)
						.values(data)
						.returning();
					raw = rows[0] ?? null;
				}
				const output = await transformOutput(model, raw, select);
				debug("create", "result", output);
				return output;
			}),
		);

		const findOneFn = dbFn.fn(".find_one", { input: inputs.findOne }, (c) =>
			tagged(c, async () => {
				const result = await findOne(client, c.input);
				debug("findOne", "result", result);
				return result;
			}),
		);

		const findManyFn = dbFn.fn(".find_many", { input: inputs.findMany }, (c) =>
			tagged(c, async () => {
				const result = await findMany(client, c.input as FindManyInput);
				debug("findMany", "result", result);
				return result;
			}),
		);

		const countRows = dbFn.fn(".count", { input: inputs.count }, (c) =>
			tagged(c, async () => {
				const resolved = await convertWhere(
					client,
					c.input.model,
					c.input.where,
				);
				let query = client.select({ count: count() }).from(resolved.value);
				if (resolved.expression) query = query.where(resolved.expression);
				const rows = await query;
				return Number(rows[0]?.count ?? 0);
			}),
		);

		const updateCore = async (
			input: UpdateInput,
			many: boolean,
		): Promise<Row | number | null> => {
			if (!many && input.where.length === 0) return null;
			const resolved = await convertWhere(client, input.model, input.where);
			const data = await transformInput(
				resolved.value,
				input.model,
				input.update,
				"update",
			);
			if (config.provider === "mysql" && !many) {
				const mutate = async (tx: Client) => {
					const target = await mysqlTarget(
						tx,
						input.model,
						input.where,
						convertWhere,
						true,
					);
					if (!target.row) return null;
					const idName = column(models, input.model, "id");
					const id = target.row[idName];
					if (id === undefined || !target.resolved.value[idName]) return null;
					await tx
						.update(target.resolved.value)
						.set(data)
						.where(eq(target.resolved.value[idName], id))
						.execute();
					const rows = await tx
						.select()
						.from(target.resolved.value)
						.where(eq(target.resolved.value[idName], id))
						.limit(1);
					return transformOutput(input.model, rows[0]);
				};
				return inTransaction ? mutate(client) : client.transaction(mutate);
			}
			let query = client.update(resolved.value).set(data);
			if (resolved.expression) query = query.where(resolved.expression);
			if (many) {
				const result = await query;
				return affectedRows(result, "updateMany");
			}
			const rows = await query.returning();
			return transformOutput(input.model, rows[0]);
		};

		const update = dbFn.fn(".update", { input: inputs.update }, (c) =>
			tagged(c, () => updateCore(c.input, false)),
		);

		const updateMany = dbFn.fn(".update_many", { input: inputs.update }, (c) =>
			tagged(c, () => updateCore(c.input, true)),
		);

		const deleteCore = async (
			input: DeleteInput,
			many: boolean,
		): Promise<void | number> => {
			const resolved = await convertWhere(client, input.model, input.where);
			let query = client.delete(resolved.value);
			if (resolved.expression) query = query.where(resolved.expression);
			const result = await query;
			if (many) return affectedRows(result, "deleteMany");
		};

		const deleteOne = dbFn.fn(".delete", { input: inputs.delete }, (c) =>
			tagged(c, () => deleteCore(c.input, false)),
		);

		const deleteMany = dbFn.fn(".delete_many", { input: inputs.delete }, (c) =>
			tagged(c, () => deleteCore(c.input, true)),
		);

		const consumeOne = dbFn.fn(".consume_one", { input: inputs.delete }, (c) =>
			tagged(c, async () => {
				const { model, where } = c.input;
				if (config.provider === "mysql") {
					const consume = async (tx: Client) => {
						const target = await mysqlTarget(
							tx,
							model,
							where,
							convertWhere,
							true,
						);
						if (!target.row) return null;
						const idName = column(models, model, "id");
						const id = target.row[idName];
						if (id === undefined || !target.resolved.value[idName]) {
							return null;
						}
						const result = await tx
							.delete(target.resolved.value)
							.where(eq(target.resolved.value[idName], id))
							.execute();
						return affectedRows(result, "consumeOne") > 0
							? transformOutput(model, target.row)
							: null;
					};
					return inTransaction ? consume(client) : client.transaction(consume);
				}
				const resolved = await convertWhere(client, model, where);
				const idName = column(models, model, "id");
				const idField = resolved.value[idName];
				if (!idField) return null;
				let target = client.select({ id: idField }).from(resolved.value);
				if (resolved.expression) target = target.where(resolved.expression);
				target = target.limit(1);
				const rows = await client
					.delete(resolved.value)
					.where(inArray(idField, target))
					.returning();
				return transformOutput(model, rows[0]);
			}),
		);

		const incrementOne = dbFn.fn(
			".increment_one",
			{ input: inputs.incrementOne },
			(c) =>
				tagged(c, async () => {
					const input = c.input as IncrementOneInput;
					if (
						Object.keys(input.increment).length === 0 &&
						(!input.set || Object.keys(input.set).length === 0)
					) {
						throw new AdapterError("invalid_operation", {
							operation: "incrementOne",
							message:
								"incrementOne requires a non-empty increment or set object.",
						});
					}
					const resolved = await convertWhere(client, input.model, input.where);
					const assignments = input.set
						? await transformInput(
								resolved.value,
								input.model,
								input.set,
								"update",
							)
						: {};
					for (const [name, delta] of Object.entries(input.increment)) {
						const dbName = column(models, input.model, name);
						const dbField = resolved.value[dbName];
						if (!dbField) {
							throw new AdapterError("unknown_field", {
								model: input.model,
								field: name,
							});
						}
						assignments[dbName] = sql`${dbField} + ${delta}`;
					}
					const idName = column(models, input.model, "id");
					const idField = resolved.value[idName];
					if (!idField) return null;

					if (config.provider === "mysql") {
						const mutate = async (tx: Client) => {
							const target = await mysqlTarget(
								tx,
								input.model,
								input.where,
								convertWhere,
								true,
							);
							if (!target.row) return null;
							const id = target.row[idName];
							if (id === undefined) return null;
							await tx
								.update(target.resolved.value)
								.set(assignments)
								.where(eq(idField, id))
								.execute();
							const rows = await tx
								.select()
								.from(target.resolved.value)
								.where(eq(idField, id))
								.limit(1);
							return transformOutput(input.model, rows[0]);
						};
						return inTransaction ? mutate(client) : client.transaction(mutate);
					}

					let target = client.select({ id: idField }).from(resolved.value);
					if (resolved.expression) target = target.where(resolved.expression);
					target = target.limit(1);
					const rows = await client
						.update(resolved.value)
						.set(assignments)
						.where(inArray(idField, target))
						.returning();
					return transformOutput(input.model, rows[0]);
				}),
		);

		const transaction = dbFn.fn(
			".transaction",
			{
				input: [v.any<(adapter: DBTransactionAdapter) => Promise<unknown>>()],
			},
			(c) =>
				tagged(c, async () => {
					const callback = c.input[0];
					debug("transaction", "begin");
					if (!config.transaction || inTransaction) {
						return callback(adapter as DBTransactionAdapter);
					}
					return client.transaction((tx: Client) =>
						callback(makeAdapter(tx, true) as DBTransactionAdapter),
					);
				}),
		);

		const adapter = {
			$module: true as const,
			id: "drizzle",
			create,
			findOne: findOneFn,
			findMany: findManyFn,
			count: countRows,
			update,
			updateMany,
			delete: deleteOne,
			deleteMany,
			consumeOne,
			incrementOne,
			transaction,
			options: { adapterConfig: config },
		} as unknown as AdapterModule;
		Object.defineProperty(adapter, "$fns", {
			value: adapter,
			enumerable: false,
		});
		return adapter;
	};

	return makeAdapter(root);
};
