import { v } from "../src";

type Row = { id: string } & Record<string, any>;
type Tables = Map<string, Map<string, Row>>;

const tables: Tables = new Map();

/** Every query the db actually ran - one entry per round-trip, so a test
 * can assert that two reads batched into ONE query. */
const queries: string[] = [];

/** The open transaction's journal - writes stage here instead of landing
 * on `tables`, and only a commit moves them over. */
const journal: Tables | null = null;

const table = (from: Tables, name: string) => {
	let rows = from.get(name);
	if (!rows) {
		rows = new Map();
		from.set(name, rows);
	}
	return rows;
};

const matches = (row: Row, where?: Partial<Row>) =>
	!where || Object.entries(where).every(([key, value]) => row[key] === value);

/** Reads see the journal first - a transaction reads its own writes. */
const readOne = (from: string, where?: Partial<Row>) => {
	for (const source of journal ? [journal, tables] : [tables]) {
		for (const row of table(source, from).values()) {
			if (matches(row, where)) return row;
		}
	}
	return null;
};

const selectOne = (from: string, where?: Partial<Row>) => {
	queries.push(`SELECT * FROM ${from}`);
	return readOne(from, where);
};

/** One round-trip answering for many tables at once - how a fn that needs
 * both `user` and `session` reads them in a single query. */
const selectMany = (from: string[]) => {
	queries.push(`SELECT * FROM ${from.join(", ")}`);
	return from.map((name) => readOne(name));
};

const insert = v.fn(
	"insert",
	{
		input: v.object({ table: v.string(), row: v.object() }),
		use: [
			{
				model: v.var("model", { default: null, schema: v.object({}) }),
			},
		],
	},
	(c) => {
		const { table: name, row } = c.input;
		const rows = table(journal ?? tables, name);
		rows.set(row.id, row as Row);
		c.model;
		return { inserted: true };
	},
);

const transaction = v.on("insert", async (c, _next) => {
	c.model;
});

export const db = { selectOne, selectMany, insert, transaction, queries };
