import {
	type BetterFetchOption,
	type BetterFetchResponse,
	createFetch,
} from "@better-fetch/fetch";
import type { Router } from "./router";
import type { HasRequiredKeys, Prettify, UnionToIntersection } from "./helper";
import type { Endpoint } from "./endpoint";

type HasRequired<
	T extends {
		body?: any;
		query?: any;
		params?: any;
	},
> = T["body"] extends object
	? HasRequiredKeys<T["body"]> extends true
		? true
		: T["query"] extends object
			? HasRequiredKeys<T["query"]> extends true
				? true
				: T["params"] extends object
					? HasRequiredKeys<T["params"]>
					: false
			: T["params"] extends object
				? HasRequiredKeys<T["params"]>
				: false
	: T["query"] extends object
		? HasRequiredKeys<T["query"]> extends true
			? true
			: T["params"] extends object
				? HasRequiredKeys<T["params"]>
				: false
		: T["params"] extends object
			? HasRequiredKeys<T["params"]>
			: false;

type InferContext<T> = T extends (ctx: infer Ctx) => any
	? Ctx extends object
		? Ctx
		: never
	: never;

export interface ClientOptions extends BetterFetchOption {
	baseURL?: string;
}

type WithRequired<T, K> = T & {
	[P in K extends string ? K : never]-?: T[P extends keyof T ? P : never];
};

type InferClientRoutes<T extends Record<string, Endpoint>> = {
	[K in keyof T]: T[K] extends Endpoint<any, infer O>
		? O extends
				| { metadata: { scope: "http" } }
				| { metadata: { scope: "server" } }
				| { metadata: { SERVER_ONLY: true } }
				| { metadata: { isAction: false } }
			? never
			: T[K]
		: T[K];
};

export type RequiredOptionKeys<
	C extends {
		body?: any;
		query?: any;
		params?: any;
	},
> = (undefined extends C["body"]
	? {}
	: {
			body: true;
		}) &
	(undefined extends C["query"]
		? {}
		: {
				query: true;
			}) &
	(undefined extends C["params"]
		? {}
		: {
				params: true;
			});

export const createClient = <R extends Router | Router["endpoints"]>(
	options?: ClientOptions,
) => {
	const fetch = createFetch(options ?? {});
	type API = InferClientRoutes<
		R extends { endpoints: Record<string, Endpoint> } ? R["endpoints"] : R
	>;
	type Options = API extends {
		[key: string]: infer T;
	}
		? T extends Endpoint
			? {
					[key in T["options"]["method"] extends "GET"
						? T["path"]
						: `@${T["options"]["method"] extends string ? Lowercase<T["options"]["method"]> : never}${T["path"]}`]: T;
				}
			: {}
		: {};

	type O = Prettify<UnionToIntersection<Options>>;
	return async <
		OPT extends O,
		K extends keyof OPT,
		C extends InferContext<OPT[K]>,
	>(
		path: K,
		...options: HasRequired<C> extends true
			? [
					WithRequired<
						BetterFetchOption<C["body"], C["query"], C["params"]>,
						keyof RequiredOptionKeys<C>
					>,
				]
			: [BetterFetchOption<C["body"], C["query"], C["params"]>?]
	): Promise<
		BetterFetchResponse<
			Awaited<ReturnType<OPT[K] extends Endpoint ? OPT[K] : never>>
		>
	> => {
		return (await fetch(path as string, {
			...options[0],
		})) as any;
	};
};

export * from "./error";
