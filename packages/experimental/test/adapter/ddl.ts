import { v } from "../../src";
import { fieldAttribute, tableAttribute } from "./field";
import { sqliteTypes } from "./types/sqlite";

/**
 * Type packs mounted into the runner.
 * New dialect = add its `.mappers` here.
 */
const typePacks = [sqliteTypes];
const mappers = typePacks.flatMap((pack) => pack.mappers);

/**
 * Maps one field's attributes to a SQL type fragment.
 */
export const runMap = v.fn(
	"types.run",
	{ input: fieldAttribute, use: typePacks },
	(c) => {
		for (const m of mappers) {
			const out = m(c.input);
			if (out != null) return out;
		}
		return null;
	},
);

/**
 * One named column: `"id varchar(255) UNIQUE"`.
 */
export const generateColumn = v.fn(
	"ddl.column",
	{
		input: {
			name: v.string({ min: 1 }),
			field: fieldAttribute,
		},
		use: [{ runMap }],
	},
	(c) => {
		const sqlType = c.use.runMap(c.input.field);
		if (sqlType == null) return null;
		return `${c.input.name} ${sqlType}`;
	},
);

/**
 * A full table from many fields:
 * `CREATE TABLE user (id varchar(255) UNIQUE, age int(16))`.
 */
export const generateTable = v.fn(
	"ddl.table",
	{ input: tableAttribute, use: [{ generateColumn, runMap }] },
	(c) => {
		const columns: string[] = [];
		for (const [name, field] of Object.entries(c.input.fields)) {
			const column = c.use.generateColumn({ name, field });
			if (column == null) {
				throw new Error(
					`no type mapper for field "${name}" (type=${String(field.type)})`,
				);
			}
			columns.push(column);
		}
		return `CREATE TABLE ${c.input.name} (${columns.join(", ")})`;
	},
);

/** Mountable DDL builder (`generateColumn` / `generateTable` / type packs). */
export const ddl = v.fn({
	use: [...typePacks, { runMap, generateColumn, generateTable }],
});

/** @deprecated Use `ddl`. */
export const betterDB = ddl;
