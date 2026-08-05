/** Better-auth-compatible DB adapter types (clean-room; no better-auth dep). */

export type DBPrimitive =
	| string
	| number
	| boolean
	| Date
	| null
	| Record<string, unknown>
	| unknown[];

export type DBFieldType =
	| "string"
	| "number"
	| "boolean"
	| "date"
	| "json"
	| "string[]"
	| "number[]";

export type DBFieldAttribute = {
	type: DBFieldType;
	required?: boolean;
	returned?: boolean;
	input?: boolean;
	unique?: boolean;
	bigint?: boolean;
	sortable?: boolean;
	fieldName?: string;
	defaultValue?: DBPrimitive | (() => DBPrimitive);
	references?: {
		model: string;
		field: string;
		onDelete?:
			| "no action"
			| "restrict"
			| "cascade"
			| "set null"
			| "set default";
	};
};

export type BetterAuthDBTable = {
	modelName?: string;
	fields: Record<string, DBFieldAttribute>;
};

export type BetterAuthDBSchema = Record<string, BetterAuthDBTable>;

export const whereOperators = [
	"eq",
	"ne",
	"lt",
	"lte",
	"gt",
	"gte",
	"in",
	"not_in",
	"contains",
	"starts_with",
	"ends_with",
] as const;

export type WhereOperator = (typeof whereOperators)[number];

export type Where = {
	field: string;
	value: string | number | boolean | string[] | number[] | Date | null;
	operator?: WhereOperator;
	connector?: "AND" | "OR";
	mode?: "sensitive" | "insensitive";
};

export type CleanedWhere = Required<
	Pick<Where, "field" | "value" | "operator" | "connector">
> & {
	mode: "sensitive" | "insensitive";
};

export type JoinOption = {
	[model: string]: boolean | { limit?: number };
};

export type JoinConfig = {
	[model: string]: {
		on: { from: string; to: string };
		limit?: number;
		relation?: "one-to-one" | "one-to-many" | "many-to-many";
	};
};

export type SortBy = {
	field: string;
	direction: "asc" | "desc";
};

export type DBAdapterSchemaCreation = {
	code: string;
	path: string;
	append?: boolean;
	overwrite?: boolean;
};

export type DBTransactionAdapter = Omit<DBAdapter, "transaction">;

export type DBAdapter = {
	id: string;
	create: <T extends Record<string, any> = Record<string, any>, R = T>(data: {
		model: string;
		data: Omit<T, "id"> & { id?: string };
		select?: string[];
	}) => Promise<R>;
	findOne: <T = Record<string, any>>(data: {
		model: string;
		where: Where[];
		select?: string[];
		join?: JoinOption;
	}) => Promise<T | null>;
	findMany: <T = Record<string, any>>(data: {
		model: string;
		where?: Where[];
		limit?: number;
		select?: string[];
		sortBy?: SortBy;
		offset?: number;
		join?: JoinOption;
	}) => Promise<T[]>;
	count: (data: { model: string; where?: Where[] }) => Promise<number>;
	update: <T = Record<string, any>>(data: {
		model: string;
		where: Where[];
		update: Record<string, any>;
	}) => Promise<T | null>;
	updateMany: (data: {
		model: string;
		where: Where[];
		update: Record<string, any>;
	}) => Promise<number>;
	delete: (data: { model: string; where: Where[] }) => Promise<void>;
	deleteMany: (data: { model: string; where: Where[] }) => Promise<number>;
	consumeOne: <T = Record<string, any>>(data: {
		model: string;
		where: Where[];
	}) => Promise<T | null>;
	incrementOne: <T = Record<string, any>>(data: {
		model: string;
		where: Where[];
		increment: Record<string, number>;
		set?: Record<string, unknown>;
	}) => Promise<T | null>;
	transaction: <R>(
		callback: (trx: DBTransactionAdapter) => Promise<R>,
	) => Promise<R>;
	applySchema?: (props: {
		file?: string;
		tables: BetterAuthDBSchema;
	}) => Promise<DBAdapterSchemaCreation>;
	/** @deprecated Use `applySchema`. */
	createSchema?: (props: {
		file?: string;
		tables: BetterAuthDBSchema;
	}) => Promise<DBAdapterSchemaCreation>;
	options?: Record<string, any>;
};

export type CustomAdapter = {
	create: <T extends Record<string, any>>(data: {
		model: string;
		data: T;
		select?: string[];
	}) => Promise<T>;
	update: <T extends Record<string, any>>(data: {
		model: string;
		where: CleanedWhere[];
		update: T;
	}) => Promise<T | null>;
	updateMany: (data: {
		model: string;
		where: CleanedWhere[];
		update: Record<string, any>;
	}) => Promise<number>;
	findOne: <T = Record<string, any>>(data: {
		model: string;
		where: CleanedWhere[];
		select?: string[];
		join?: JoinConfig;
	}) => Promise<T | null>;
	findMany: <T = Record<string, any>>(data: {
		model: string;
		where?: CleanedWhere[];
		limit: number;
		select?: string[];
		sortBy?: SortBy;
		offset?: number;
		join?: JoinConfig;
	}) => Promise<T[]>;
	delete: (data: { model: string; where: CleanedWhere[] }) => Promise<void>;
	deleteMany: (data: {
		model: string;
		where: CleanedWhere[];
	}) => Promise<number>;
	count: (data: { model: string; where?: CleanedWhere[] }) => Promise<number>;
	consumeOne?: <T = Record<string, any>>(data: {
		model: string;
		where: CleanedWhere[];
	}) => Promise<T | null>;
	incrementOne?: <T = Record<string, any>>(data: {
		model: string;
		where: CleanedWhere[];
		increment: Record<string, number>;
		set?: Record<string, unknown>;
	}) => Promise<T | null>;
	createSchema?: (props: {
		file?: string;
		tables: BetterAuthDBSchema;
	}) => Promise<DBAdapterSchemaCreation>;
	options?: Record<string, any>;
};

export type AdapterFactoryConfig = {
	adapterId: string;
	adapterName?: string;
	supportsNumericIds?: boolean;
	supportsUUIDs?: boolean;
	supportsJSON?: boolean;
	supportsDates?: boolean;
	supportsBooleans?: boolean;
	supportsArrays?: boolean;
	supportsTransactions?:
		| boolean
		| ((
				callback: (trx: DBTransactionAdapter) => Promise<unknown>,
		  ) => Promise<unknown>);
	disableIdGeneration?: boolean;
	usePlural?: boolean;
	/** @deprecated Use `supportsTransactions`. */
	transaction?:
		| false
		| ((
				callback: (trx: DBTransactionAdapter) => Promise<unknown>,
		  ) => Promise<unknown>);
	customIdGenerator?: (props: { model: string }) => string;
};
