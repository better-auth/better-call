import type { Schema } from "../index";
import type { Provider } from "./query-builders";

export type DebugLogOption =
	| boolean
	| Partial<
			Record<
				| "create"
				| "findOne"
				| "findMany"
				| "count"
				| "update"
				| "updateMany"
				| "delete"
				| "deleteMany"
				| "consumeOne"
				| "incrementOne"
				| "transaction",
				boolean
			>
	  >;

export interface DrizzleAdapterConfig {
	/** Drizzle table/relations schema. Falls back to `db._.fullSchema`. */
	schema?: Record<string, any>;
	provider: Provider;
	usePlural?: boolean;
	debugLogs?: DebugLogOption;
	/** Kept for parity with Better Auth's generated-schema configuration. */
	camelCase?: boolean;
	/** Use `db.transaction`; otherwise transaction callbacks run sequentially. */
	transaction?: boolean;
	/**
	 * Logical model metadata. Better Auth normally supplies this to its adapter
	 * factory; the standalone fn architecture receives it explicitly.
	 */
	models?: Schema;
	defaultFindManyLimit?: number;
	generateId?: false | "serial" | ((model: string) => string);
	codec?: {
		date?: true | "iso" | "number";
		bool?: true | "integer";
		json?: true | "stringify";
		array?: true | "stringify";
	};
	/** Prefer Drizzle relational queries when `db.query` is available. */
	joins?: boolean;
}

export type Client = Record<string, any>;

export type Action = "create" | "update" | "where";
