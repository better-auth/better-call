/** Minimal bun:sqlite typings for adapter tests (package has no bun-types). */
declare module "bun:sqlite" {
	export class Statement {
		get(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
	}

	export class Database {
		constructor(
			filename?: string,
			options?: number | { readonly?: boolean; create?: boolean },
		);
		run(
			sql: string,
			params?: unknown[] | Record<string, unknown>,
		): { changes: number; lastInsertRowid: number | bigint };
		query(sql: string): Statement;
		close(): void;
	}
}
