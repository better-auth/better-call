import type { Database } from "bun:sqlite";
import { createMemoryClient, memoryStorage } from "./memory";
import { sqliteStorage } from "./sqlite";

/** Wire codecs + feature flags owned by the storage driver — not app config. */
export type DriverCapabilities = {
	supportsJSON: boolean;
	supportsDates: boolean;
	supportsBooleans: boolean;
	supportsArrays: boolean;
	supportsJoins: boolean;
	supportsNumericIds: boolean;
	supportsUUIDs: boolean;
	/** When false, `db.transaction` runs the callback without begin/commit. */
	supportsTransactions: boolean;
};

export type Driver = {
	adapterId: string;
	adapterName?: string;
	storage: Record<string, unknown>;
	client: unknown;
	capabilities: DriverCapabilities;
};

const baseCapabilities = {
	supportsNumericIds: true,
	supportsUUIDs: true,
	supportsArrays: false,
} as const;

/** In-memory tables driver (JSON/bool/date native). */
export const memoryDriver = (): Driver => ({
	adapterId: "memory",
	adapterName: "Memory",
	storage: memoryStorage,
	client: createMemoryClient(),
	capabilities: {
		...baseCapabilities,
		supportsJSON: true,
		supportsDates: true,
		supportsBooleans: true,
		supportsJoins: false,
		supportsTransactions: true,
	},
});

/** bun:sqlite driver (JSON stored as text). */
export const sqliteDriver = (db: Database): Driver => ({
	adapterId: "sqlite",
	adapterName: "SQLite",
	storage: sqliteStorage,
	client: db,
	capabilities: {
		...baseCapabilities,
		supportsJSON: false,
		supportsDates: true,
		supportsBooleans: true,
		supportsJoins: false,
		supportsTransactions: true,
	},
});
