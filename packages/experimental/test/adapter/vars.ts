import { v } from "../../src";
import { dbSchema } from "./field";
import { adapterConfig } from "./schemas";

/** Logical Better Auth schema for the adapter tree. */
export const schema = v.var("schema", {
	default: {},
	schema: dbSchema,
});

/** Adapter capability / naming flags (data only — no functions). */
export const adapterConfigVar = v.var("adapterConfig", {
	default: {
		adapterId: "memory",
		supportsJSON: false,
		supportsDates: true,
		supportsBooleans: true,
		supportsJoins: false,
		supportsTransactions: true,
		defaultFindManyLimit: 100,
	},
	schema: adapterConfig,
});

/**
 * Driver handle (sqlite Database, memory tables, …).
 * Storage reads `trx` when set, otherwise `client`.
 */
export const client = v.var("client", {
	default: null as object | null,
});

/** Active transaction handle / journal; null outside `db.transaction`. */
export const trx = v.var("trx", {
	default: null as object | null,
});

export const adapterVars = {
	schema,
	adapterConfig: adapterConfigVar,
	client,
	trx,
};
