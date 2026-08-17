import {
	column,
	type FindManyInput,
	type FindOneInput,
	type JoinConfig,
	type JoinOption,
	pick,
	type Row,
	type Schema,
	table as tableName,
	type Where,
	type WhereValue,
} from "../index";
import {
	AdapterError,
	buildOrderBy,
	buildSelect,
	buildWhere,
} from "./query-builders";
import type { ResolvedTable, TransformTools } from "./transforms";
import type { Client, DrizzleAdapterConfig } from "./types";

export type QueryTools = {
	convertWhere: (
		client: Client,
		model: string,
		where: Where[] | undefined,
	) => Promise<ResolvedTable & { expression: unknown }>;
	findMany: (client: Client, input: FindManyInput) => Promise<Row[]>;
	findOne: (client: Client, input: FindOneInput) => Promise<Row | null>;
};

export const createQueryTools = (
	config: DrizzleAdapterConfig,
	models: Schema,
	transforms: TransformTools,
): QueryTools => {
	const { prepareWhere, resolveTable, transformOutput } = transforms;

	const convertWhere = async (
		client: Client,
		model: string,
		where: Where[] | undefined,
	) => {
		const resolved = resolveTable(client, model);
		const prepared = await prepareWhere(model, where);
		return {
			...resolved,
			expression: buildWhere(
				models,
				resolved.value,
				model,
				prepared,
				config.provider,
			),
		};
	};

	const executeSelect = async (
		client: Client,
		input: FindManyInput,
		select = input.select,
	): Promise<Row[]> => {
		const resolved = await convertWhere(client, input.model, input.where);
		const projection = buildSelect(models, resolved.value, input.model, select);
		let query = client.select(projection).from(resolved.value);
		if (resolved.expression) query = query.where(resolved.expression);
		const order = buildOrderBy(
			models,
			resolved.value,
			input.model,
			input.sortBy,
		);
		if (order) query = query.orderBy(order);
		if (input.limit !== undefined) query = query.limit(input.limit);
		if (input.offset !== undefined) query = query.offset(input.offset);
		return await query;
	};

	const relation = (
		baseModel: string,
		joinModel: string,
	): JoinConfig[string] => {
		const joinedFields = Object.entries(models[joinModel]?.fields ?? {}).filter(
			([, definition]) => definition.references?.model === baseModel,
		);
		const baseFields = Object.entries(models[baseModel]?.fields ?? {}).filter(
			([, definition]) => definition.references?.model === joinModel,
		);
		const candidates = joinedFields.length ? joinedFields : baseFields;
		if (candidates.length !== 1) {
			throw new AdapterError("invalid_join", {
				model: baseModel,
				join: joinModel,
				message:
					candidates.length === 0
						? `No relation exists between "${baseModel}" and "${joinModel}".`
						: `Multiple relations exist between "${baseModel}" and "${joinModel}".`,
			});
		}
		const candidate = candidates[0];
		if (!candidate) {
			throw new AdapterError("invalid_join", {
				model: baseModel,
				join: joinModel,
				message: `No relation exists between "${baseModel}" and "${joinModel}".`,
			});
		}
		const [name, definition] = candidate;
		const forward = joinedFields.length > 0;
		const reference = definition.references;
		if (!reference) {
			throw new AdapterError("invalid_join", {
				model: baseModel,
				join: joinModel,
				message: `The relation between "${baseModel}" and "${joinModel}" is incomplete.`,
			});
		}
		const one = forward ? Boolean(definition.unique || name === "id") : true;
		return {
			on: forward
				? { from: reference.field, to: name }
				: { from: name, to: reference.field },
			relation: one ? "one-to-one" : "one-to-many",
			limit: one ? 1 : (config.defaultFindManyLimit ?? 100),
		};
	};

	const joinConfig = (baseModel: string, join: JoinOption): JoinConfig =>
		Object.fromEntries(
			Object.entries(join)
				.filter(([, option]) => option !== false)
				.map(([model, option]) => {
					const value = relation(baseModel, model);
					if (
						value.relation !== "one-to-one" &&
						typeof option === "object" &&
						option.limit !== undefined
					) {
						value.limit = option.limit;
					}
					return [model, value];
				}),
		);

	const attachFallbackJoins = async (
		client: Client,
		baseModel: string,
		rows: Row[],
		join: JoinOption,
	): Promise<Row[]> => {
		const relations = joinConfig(baseModel, join);
		return Promise.all(
			rows.map(async (row) => {
				const result = { ...row };
				for (const [model, relation] of Object.entries(relations)) {
					const value = row[relation.on.from];
					if (value === null || value === undefined) {
						result[model] = relation.relation === "one-to-one" ? null : [];
						continue;
					}
					const where: Where[] = [
						{
							field: relation.on.to,
							value: value as WhereValue,
							operator: "eq",
						},
					];
					if (relation.relation === "one-to-one") {
						const joined = await findOneCore(client, {
							model,
							where,
						});
						result[model] = joined;
					} else {
						result[model] = await findManyCore(client, {
							model,
							where,
							limit: relation.limit,
						});
					}
				}
				return result;
			}),
		);
	};

	const nativeRelationKey = (
		joinModel: string,
		relation: JoinConfig[string],
	) => {
		const explicit = tableName(models, joinModel);
		if (explicit !== joinModel) return explicit;
		return relation.relation === "one-to-one" || config.usePlural
			? joinModel
			: `${joinModel}s`;
	};

	const executeRelational = async (
		client: Client,
		input: FindManyInput,
		first: boolean,
	): Promise<Row[] | null> => {
		if (!input.join || config.joins === false || !client.query) return null;
		const resolved = await convertWhere(client, input.model, input.where);
		const query = client.query[resolved.key];
		if (!query) return null;
		const relations = joinConfig(input.model, input.join);
		const relationKeys = new Map<string, string>();
		const include: Record<string, boolean | { limit: number }> = {};
		for (const [model, relation] of Object.entries(relations)) {
			const key = nativeRelationKey(model, relation);
			relationKeys.set(key, model);
			include[key] =
				relation.relation === "one-to-one"
					? true
					: { limit: relation.limit ?? config.defaultFindManyLimit ?? 100 };
		}
		const columns = input.select?.length
			? Object.fromEntries(
					input.select.map((name) => [column(models, input.model, name), true]),
				)
			: undefined;
		const options = {
			where: resolved.expression,
			columns,
			with: include,
			limit: first ? 1 : input.limit,
			offset: input.offset,
			orderBy: buildOrderBy(models, resolved.value, input.model, input.sortBy)
				? [buildOrderBy(models, resolved.value, input.model, input.sortBy)]
				: undefined,
		};
		const raw = first
			? await query.findFirst(options)
			: await query.findMany(options);
		const list = first ? (raw ? [raw] : []) : raw;
		return await Promise.all(
			list.map(async (item: Row) => {
				const base: Row = { ...item };
				for (const [key, model] of relationKeys) {
					const joined = base[key];
					delete base[key];
					if (Array.isArray(joined)) {
						base[model] = await Promise.all(
							joined.map((row) => transformOutput(model, row)),
						);
					} else {
						base[model] = await transformOutput(model, joined as Row);
					}
				}
				return (await transformOutput(input.model, base, input.select)) as Row;
			}),
		);
	};

	async function findManyCore(
		client: Client,
		input: FindManyInput,
	): Promise<Row[]> {
		const limit = input.limit ?? config.defaultFindManyLimit ?? 100;
		const normalized = { ...input, limit };
		const native = await executeRelational(client, normalized, false);
		if (native) return native;
		const raw = await executeSelect(
			client,
			normalized,
			input.join ? undefined : input.select,
		);
		let output = (
			await Promise.all(
				raw.map((row) => transformOutput(input.model, row, input.select)),
			)
		).filter((row): row is Row => Boolean(row));
		if (input.join) {
			const requestedJoin = input.join;
			// Query all base fields for fallback joins, then apply the caller's
			// projection after relation keys have been attached.
			const full = (
				await Promise.all(raw.map((row) => transformOutput(input.model, row)))
			).filter((row): row is Row => Boolean(row));
			const joined = await attachFallbackJoins(
				client,
				input.model,
				full,
				input.join,
			);
			output = joined.map((row) => ({
				...(pick(row, input.select) ?? {}),
				...Object.fromEntries(
					Object.keys(requestedJoin).map((key) => [key, row[key]]),
				),
			}));
		}
		return output;
	}

	async function findOneCore(
		client: Client,
		input: FindOneInput,
	): Promise<Row | null> {
		const native = await executeRelational(
			client,
			{ ...input, limit: 1 },
			true,
		);
		if (native) return native[0] ?? null;
		const rows = await findManyCore(client, { ...input, limit: 1 });
		return rows[0] ?? null;
	}

	return {
		convertWhere,
		findMany: findManyCore,
		findOne: findOneCore,
	};
};
