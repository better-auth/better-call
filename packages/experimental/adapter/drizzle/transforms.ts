import {
	column,
	decode,
	defaults,
	encode,
	type Field,
	pick,
	type Row,
	type Schema,
	table as tableName,
	type Where,
	type WhereValue,
} from "../index";
import { AdapterError } from "./query-builders";
import type { Action, Client, DrizzleAdapterConfig } from "./types";

export type ResolvedTable = {
	key: string;
	value: Record<string, any>;
};

export type TransformTools = {
	resolveTable: (client: Client, model: string) => ResolvedTable;
	transformInput: (
		table: Record<string, any>,
		model: string,
		input: Row,
		action: "create" | "update",
		forceAllowId?: boolean,
	) => Promise<Row>;
	prepareWhere: (
		model: string,
		where: Where[] | undefined,
	) => Promise<Where[] | undefined>;
	transformOutput: (
		model: string,
		input: Row | null | undefined,
		select?: string[],
	) => Promise<Row | null>;
};

const resolveDefaultCodec = (config: DrizzleAdapterConfig) => ({
	date: true as const,
	bool: true as const,
	json: config.provider === "pg" ? (true as const) : ("stringify" as const),
	array: config.provider === "pg" ? (true as const) : ("stringify" as const),
	...config.codec,
});

const callDefault = (value: unknown | (() => unknown)): unknown =>
	typeof value === "function" ? value() : value;

export const createTransformTools = (
	root: Client,
	config: DrizzleAdapterConfig,
	models: Schema,
): TransformTools => {
	const codec = resolveDefaultCodec(config);
	const tables = () => config.schema ?? root._?.fullSchema;

	const resolveTable = (client: Client, model: string): ResolvedTable => {
		const registry = config.schema ?? client._?.fullSchema ?? tables();
		if (!registry) {
			throw new AdapterError("unknown_model", { model });
		}
		const explicit = tableName(models, model);
		const plural = `${model}s`;
		const candidates = config.usePlural
			? [explicit, plural, model]
			: [explicit, model, plural];
		const key = candidates.find((candidate) => registry[candidate]);
		if (!key) throw new AdapterError("unknown_model", { model });
		return { key, value: registry[key] as Record<string, any> };
	};

	const field = (model: string, name: string): Field | undefined =>
		models[model]?.fields?.[name];

	const transformValue = async (
		model: string,
		name: string,
		value: unknown,
		action: Action,
	): Promise<unknown> => {
		const definition = field(model, name);
		let transformed = value;
		if (
			action !== "where" &&
			definition?.transform?.input &&
			transformed !== undefined
		) {
			transformed = await definition.transform.input(transformed);
		}
		return encode(transformed, definition, codec);
	};

	const transformInput = async (
		table: Record<string, any>,
		model: string,
		input: Row,
		action: "create" | "update",
		forceAllowId = false,
	): Promise<Row> => {
		let data = { ...input };
		const definitions = models[model]?.fields ?? {};

		if (action === "create") {
			const hasAllowedId =
				forceAllowId && data.id !== undefined && data.id !== null;
			if (!forceAllowId) delete data.id;
			data = defaults(models, model, data);
			if (config.generateId === false || config.generateId === "serial") {
				if (!forceAllowId) delete data.id;
			} else if (!hasAllowedId) {
				data.id =
					typeof config.generateId === "function"
						? config.generateId(model)
						: crypto.randomUUID();
			}
		} else {
			for (const [name, definition] of Object.entries(definitions)) {
				if (data[name] !== undefined || definition.onUpdate === undefined) {
					continue;
				}
				data[name] = callDefault(definition.onUpdate);
			}
		}

		const result: Row = {};
		for (const [name, value] of Object.entries(data)) {
			if (value === undefined) continue;
			const dbName = column(models, model, name);
			if (!table[dbName]) {
				throw new AdapterError("unknown_field", { model, field: name });
			}
			result[dbName] = await transformValue(model, name, value, action);
		}
		return result;
	};

	const prepareWhere = async (
		model: string,
		where: Where[] | undefined,
	): Promise<Where[] | undefined> => {
		if (!where) return undefined;
		return Promise.all(
			where.map(async (item) => ({
				...item,
				value: (Array.isArray(item.value)
					? await Promise.all(
							item.value.map((value) =>
								transformValue(model, item.field, value, "where"),
							),
						)
					: await transformValue(
							model,
							item.field,
							item.value,
							"where",
						)) as WhereValue,
			})),
		);
	};

	const transformOutput = async (
		model: string,
		input: Row | null | undefined,
		select?: string[],
	): Promise<Row | null> => {
		if (!input) return null;
		const output: Row = {};
		for (const [dbName, value] of Object.entries(input)) {
			const logical =
				Object.entries(models[model]?.fields ?? {}).find(
					([name, definition]) => (definition.column ?? name) === dbName,
				)?.[0] ?? dbName;
			const definition = field(model, logical);
			let transformed = decode(value, definition, codec);
			if (definition?.transform?.output) {
				transformed = await definition.transform.output(transformed);
			}
			if (
				transformed !== null &&
				transformed !== undefined &&
				(logical === "id" || definition?.references?.field === "id")
			) {
				transformed = String(transformed);
			}
			output[logical] = transformed;
		}
		return pick(output, select);
	};

	return {
		resolveTable,
		transformInput,
		prepareWhere,
		transformOutput,
	};
};
