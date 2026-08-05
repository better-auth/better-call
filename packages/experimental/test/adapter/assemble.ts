import { v } from "../../src";
import { createDbApi } from "./db";
import { ddl } from "./ddl";
import type { Driver } from "./driver";
import type { BetterAuthDBSchema } from "./types";

/** App-facing options — codecs/capabilities come from `driver`. */
export type CreateBetterDBOptions = {
	driver: Driver;
	schema?: BetterAuthDBSchema;
	/** Instance-specific id factory; default is `crypto.randomUUID`. */
	generateId?: (ctx: { model: string }) => string;
	usePlural?: boolean;
	defaultFindManyLimit?: number;
	disableIdGeneration?: boolean;
	adapterName?: string;
};

export type BetterDBInstance = {
	schema: BetterAuthDBSchema;
	config: {
		adapterId: string;
		adapterName?: string;
		supportsJSON: boolean;
		supportsDates: boolean;
		supportsBooleans: boolean;
		supportsArrays: boolean;
		supportsJoins: boolean;
		supportsNumericIds: boolean;
		supportsUUIDs: boolean;
		supportsTransactions: boolean;
		disableIdGeneration: boolean;
		usePlural: boolean;
		defaultFindManyLimit: number;
	};
	client: unknown;
};

/**
 * Assemble a mountable Better DB module of public `db.*` fns only.
 * Pipeline/storage/vars stay on each fn's internal `use` chain — not leaked
 * onto the returned module.
 */
export const createBetterDB = (options: CreateBetterDBOptions) => {
	const { driver } = options;
	const instance: BetterDBInstance = {
		schema: options.schema ?? {},
		config: {
			...driver.capabilities,
			adapterId: driver.adapterId,
			adapterName: options.adapterName ?? driver.adapterName,
			disableIdGeneration: options.disableIdGeneration ?? false,
			usePlural: options.usePlural ?? false,
			defaultFindManyLimit: options.defaultFindManyLimit ?? 100,
		},
		client: driver.client,
	};

	const hooks = options.generateId
		? {
				customGenerateId: v.on("pipeline.generateId", (c) =>
					options.generateId!({
						model: (c.input as { model: string }).model,
					}),
				),
			}
		: {};

	return createDbApi(driver.storage, instance, hooks);
};

/** @deprecated Use `ddl` from `./ddl`. */
export const betterDB = ddl;

export type BetterDBModule = ReturnType<typeof createBetterDB>;
