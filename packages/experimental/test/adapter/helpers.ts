import type { Database } from "bun:sqlite";
import type { BetterDBModule } from "./assemble";
import { createBetterDB } from "./assemble";
import { memoryDriver, sqliteDriver } from "./driver";
import type { BetterAuthDBSchema } from "./types";

export const testSchema: BetterAuthDBSchema = {
	user: {
		fields: {
			name: { type: "string", required: true },
			email: { type: "string", unique: true, required: true },
			age: { type: "number", required: false },
			active: { type: "boolean", required: false, defaultValue: true },
		},
	},
	token: {
		fields: {
			value: { type: "string", required: true },
			remaining: { type: "number", required: true, defaultValue: 3 },
		},
	},
	session: {
		fields: {
			userId: {
				type: "string",
				required: true,
				references: { model: "user", field: "id" },
			},
			token: { type: "string", required: true },
		},
	},
};

export const memoryDb = (
	schema: BetterAuthDBSchema = testSchema,
): BetterDBModule =>
	createBetterDB({
		driver: memoryDriver(),
		schema,
	});

export const sqliteDb = (
	db: Database,
	schema: BetterAuthDBSchema = testSchema,
): BetterDBModule =>
	createBetterDB({
		driver: sqliteDriver(db),
		schema,
	});
