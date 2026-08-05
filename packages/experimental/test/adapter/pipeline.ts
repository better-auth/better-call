import { ValidationError, v } from "../../src";
import { adapterVars } from "./vars";

type FieldAttr = {
	type?: string;
	required?: boolean;
	returned?: boolean;
	input?: boolean;
	unique?: boolean;
	bigint?: boolean;
	fieldName?: string;
	defaultValue?: unknown;
	references?: { model: string; field: string };
};

type Schema = Record<
	string,
	{ modelName?: string; fields: Record<string, FieldAttr> }
>;

type Config = {
	supportsJSON?: boolean;
	supportsDates?: boolean;
	supportsBooleans?: boolean;
	disableIdGeneration?: boolean;
	usePlural?: boolean;
	defaultFindManyLimit?: number;
	supportsJoins?: boolean;
	supportsTransactions?: boolean;
	adapterId?: string;
};

const vars = { use: [adapterVars] };

export const getModelName = v.fn(
	"pipeline.getModelName",
	{ input: { model: v.string() }, ...vars },
	(c) => {
		const schema = c.var.schema.get() as Schema;
		const config = c.var.adapterConfig.get() as Config;
		const table = schema?.[c.input.model];
		if (table?.modelName) return table.modelName;
		return config.usePlural ? `${c.input.model}s` : c.input.model;
	},
);

export const getFieldName = v.fn(
	"pipeline.getFieldName",
	{ input: { model: v.string(), field: v.string() }, ...vars },
	(c) => {
		const schema = c.var.schema.get() as Schema;
		return (
			schema?.[c.input.model]?.fields?.[c.input.field]?.fieldName ??
			c.input.field
		);
	},
);

export const cleanWhere = v.fn(
	"pipeline.cleanWhere",
	{
		input: {
			model: v.string(),
			where: v.array(v.any(), { optional: true }),
		},
		use: [adapterVars, { getFieldName }],
	},
	(c) => {
		const schema = c.var.schema.get() as Schema;
		const config = c.var.adapterConfig.get() as Config;
		const where = (c.input.where ?? []) as Array<{
			field: string;
			value: unknown;
			operator?: string;
			connector?: string;
			mode?: string;
		}>;
		return where.map((clause) => {
			const attr = schema?.[c.input.model]?.fields?.[clause.field];
			let value = clause.value;
			if (
				attr?.type === "boolean" &&
				typeof value === "boolean" &&
				config.supportsBooleans === false
			) {
				value = value ? 1 : 0;
			}
			if (
				attr?.type === "date" &&
				value instanceof Date &&
				config.supportsDates === false
			) {
				value = value.toISOString();
			}
			if (
				(attr?.type === "json" ||
					attr?.type === "string[]" ||
					attr?.type === "number[]") &&
				config.supportsJSON === false &&
				typeof value === "object" &&
				value !== null
			) {
				value = JSON.stringify(value);
			}
			return {
				field: c.use.getFieldName({
					model: c.input.model,
					field: clause.field,
				}),
				value,
				operator: clause.operator ?? "eq",
				connector: clause.connector ?? "AND",
				mode: clause.mode ?? "sensitive",
			};
		});
	},
);

const transformValueIn = (
	value: unknown,
	attr: FieldAttr | undefined,
	config: Config,
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
	attr: FieldAttr | undefined,
	config: Config,
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

const typeMatches = (attr: FieldAttr, value: unknown): boolean => {
	if (value === null || value === undefined) return true;
	switch (attr.type) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number";
		case "boolean":
			return typeof value === "boolean";
		case "date":
			return value instanceof Date || typeof value === "string";
		case "json":
			return typeof value === "object";
		case "string[]":
			return Array.isArray(value) && value.every((x) => typeof x === "string");
		case "number[]":
			return Array.isArray(value) && value.every((x) => typeof x === "number");
		default:
			return true;
	}
};

export const validateData = v.fn(
	"pipeline.validateData",
	{
		input: {
			model: v.string(),
			data: v.record(v.any()),
			action: v.enum(["create", "update"]),
			strict: v.boolean({ optional: true, default: true }),
		},
		...vars,
	},
	(c) => {
		if (!c.input.strict) return c.input.data;
		const schema = c.var.schema.get() as Schema;
		const fields = schema?.[c.input.model]?.fields ?? {};
		const data = c.input.data;
		const issues: { path: string; message: string }[] = [];

		for (const key of Object.keys(data)) {
			if (key === "id") continue;
			if (!(key in fields)) {
				issues.push({
					path: `data.${key}`,
					message: `unknown field "${key}" on model "${c.input.model}"`,
				});
			}
		}

		if (c.input.action === "create") {
			for (const [key, attr] of Object.entries(fields)) {
				if (attr.input === false) continue;
				if (attr.required === false) continue;
				if (attr.defaultValue !== undefined) continue;
				if (data[key] !== undefined) continue;
				issues.push({
					path: `data.${key}`,
					message: `required field "${key}" is missing`,
				});
			}
		}

		for (const [key, value] of Object.entries(data)) {
			if (key === "id") continue;
			const attr = fields[key];
			if (!attr || value === undefined) continue;
			if (!typeMatches(attr, value)) {
				issues.push({
					path: `data.${key}`,
					message: `expected ${attr.type}, received ${typeof value}`,
				});
			}
		}

		if (issues[0]) {
			throw new ValidationError(issues[0].path, issues[0].message, issues);
		}
		return data;
	},
);

export const generateId = v.fn(
	"pipeline.generateId",
	{ input: { model: v.string() }, ...vars },
	() => crypto.randomUUID(),
);

export const transformInput = v.fn(
	"pipeline.transformInput",
	{
		input: {
			model: v.string(),
			data: v.record(v.any()),
			action: v.enum(["create", "update"]),
			strict: v.boolean({ optional: true, default: true }),
		},
		use: [adapterVars, { getFieldName, validateData, generateId }],
	},
	(c) => {
		const schema = c.var.schema.get() as Schema;
		const config = c.var.adapterConfig.get() as Config;
		const data = c.use.validateData(c.input) as Record<string, unknown>;
		const fields = schema?.[c.input.model]?.fields ?? {};
		const out: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(data)) {
			const attr = fields[key];
			if (attr?.input === false && c.input.action === "create") continue;
			const dbKey = c.use.getFieldName({ model: c.input.model, field: key });
			out[dbKey] = transformValueIn(value, attr, config);
		}

		if (c.input.action === "create") {
			for (const [key, attr] of Object.entries(fields)) {
				const dbKey = attr.fieldName ?? key;
				if (out[dbKey] !== undefined) continue;
				if (attr.defaultValue === undefined) continue;
				const def =
					typeof attr.defaultValue === "function"
						? (attr.defaultValue as () => unknown)()
						: attr.defaultValue;
				out[dbKey] = transformValueIn(def, attr, config);
			}
			// Provided id wins; otherwise generate unless disabled.
			if (out.id === undefined && !config.disableIdGeneration) {
				out.id = c.use.generateId({ model: c.input.model });
			}
		}

		return out;
	},
);

export const transformOutput = v.fn(
	"pipeline.transformOutput",
	{
		input: {
			model: v.string(),
			data: v.any(),
			select: v.array(v.string(), { optional: true }),
		},
		...vars,
	},
	(c) => {
		const data = c.input.data as Record<string, any> | null;
		if (!data) return null;
		const schema = c.var.schema.get() as Schema;
		const config = c.var.adapterConfig.get() as Config;
		const fields = schema?.[c.input.model]?.fields ?? {};
		const inverted = new Map<string, string>();
		for (const [key, attr] of Object.entries(fields)) {
			inverted.set(attr.fieldName ?? key, key);
		}
		const out: Record<string, any> = {};
		for (const [dbKey, value] of Object.entries(data)) {
			const logical = inverted.get(dbKey) ?? dbKey;
			if (
				c.input.select &&
				logical !== "id" &&
				!c.input.select.includes(logical)
			) {
				continue;
			}
			const attr = fields[logical];
			if (attr?.returned === false) continue;
			out[logical] = transformValueOut(value, attr, config);
		}
		return out;
	},
);

export const resolveJoin = v.fn(
	"pipeline.resolveJoin",
	{
		input: {
			model: v.string(),
			join: v.record(v.any()),
			select: v.array(v.string(), { optional: true }),
		},
		...vars,
	},
	(c) => {
		const schema = c.var.schema.get() as Schema;
		const config = c.var.adapterConfig.get() as Config;
		const select = c.input.select ? [...c.input.select] : undefined;
		const transformed: Record<
			string,
			{
				on: { from: string; to: string };
				limit: number;
				relation: "one-to-one" | "one-to-many";
				logicalModel: string;
			}
		> = {};

		for (const [model, join] of Object.entries(c.input.join)) {
			if (!join) continue;
			const joinFields = schema?.[model]?.fields ?? {};
			const baseFields = schema?.[c.input.model]?.fields ?? {};

			let foreignKeys = Object.entries(joinFields).filter(
				([, attr]) => attr.references?.model === c.input.model,
			);
			let isForward = true;
			if (!foreignKeys.length) {
				foreignKeys = Object.entries(baseFields).filter(
					([, attr]) => attr.references?.model === model,
				);
				isForward = false;
			}
			if (!foreignKeys.length) {
				throw new ValidationError(
					"join",
					`No foreign key found for model ${model} and base model ${c.input.model}`,
				);
			}
			if (foreignKeys.length > 1) {
				throw new ValidationError(
					"join",
					`Multiple foreign keys found for model ${model} and base model ${c.input.model}`,
				);
			}
			const [foreignKey, foreignKeyAttributes] = foreignKeys[0]!;
			const refs = foreignKeyAttributes.references!;

			let fromLogical: string;
			let toLogical: string;
			let requiredSelectField: string;
			if (isForward) {
				requiredSelectField = refs.field;
				fromLogical = refs.field;
				toLogical = foreignKey;
			} else {
				requiredSelectField = foreignKey;
				fromLogical = foreignKey;
				toLogical = refs.field;
			}
			if (select && !select.includes(requiredSelectField)) {
				select.push(requiredSelectField);
			}

			const isUnique =
				toLogical === "id" ? true : (foreignKeyAttributes.unique ?? false);
			let limit = config.defaultFindManyLimit ?? 100;
			if (isUnique) limit = 1;
			else if (
				typeof join === "object" &&
				typeof (join as any).limit === "number"
			) {
				limit = (join as any).limit;
			}

			const physicalModel =
				schema?.[model]?.modelName ?? (config.usePlural ? `${model}s` : model);

			transformed[physicalModel] = {
				on: {
					from: baseFields[fromLogical]?.fieldName ?? fromLogical,
					to: joinFields[toLogical]?.fieldName ?? toLogical,
				},
				limit,
				relation: isUnique ? "one-to-one" : "one-to-many",
				logicalModel: model,
			};
		}
		return { join: transformed, select };
	},
);

export const pipeline = {
	getModelName,
	getFieldName,
	cleanWhere,
	validateData,
	generateId,
	transformInput,
	transformOutput,
	resolveJoin,
};
