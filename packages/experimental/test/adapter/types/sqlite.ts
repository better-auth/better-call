import { v } from "../../../src";
import { fieldAttribute } from "../field";
import { assemble } from "../sql";

const mapSqliteString = v.fn(
	"sqlite.types.string",
	{ input: fieldAttribute },
	({ input: fieldAttr }) => {
		if (fieldAttr.type !== "string") return null;
		return assemble("varchar(255)", fieldAttr);
	},
);

const mapSqliteNumber = v.fn(
	"sqlite.types.number",
	{ input: fieldAttribute },
	({ input: fieldAttr }) => {
		if (fieldAttr.type !== "number") return null;
		if (fieldAttr.bigint) return assemble("bigint", fieldAttr);
		return assemble("int(16)", fieldAttr);
	},
);

const mapSqliteBoolean = v.fn(
	"sqlite.types.boolean",
	{ input: fieldAttribute },
	({ input: fieldAttr }) => {
		if (fieldAttr.type !== "boolean") return null;
		return assemble("integer", fieldAttr);
	},
);

const mapSqliteDate = v.fn(
	"sqlite.types.date",
	{ input: fieldAttribute },
	({ input: fieldAttr }) => {
		if (fieldAttr.type !== "date") return null;
		return assemble("text", fieldAttr);
	},
);

const mapSqliteJson = v.fn(
	"sqlite.types.json",
	{ input: fieldAttribute },
	({ input: fieldAttr }) => {
		if (
			fieldAttr.type !== "json" &&
			fieldAttr.type !== "string[]" &&
			fieldAttr.type !== "number[]"
		) {
			return null;
		}
		return assemble("text", fieldAttr);
	},
);

export const sqliteTypes = {
	mapSqliteString,
	mapSqliteNumber,
	mapSqliteBoolean,
	mapSqliteDate,
	mapSqliteJson,
	mappers: [
		mapSqliteString,
		mapSqliteNumber,
		mapSqliteBoolean,
		mapSqliteDate,
		mapSqliteJson,
	],
};
