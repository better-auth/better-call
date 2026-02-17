import {
	type BetterFetchOption,
	type BetterFetchResponse,
	createFetch,
} from "@better-fetch/fetch";
import type { Router } from "./router";
import type { HasRequiredKeys, Prettify, UnionToIntersection } from "../helper";
import type { Endpoint } from "./endpoint";

export type HasRequired<T extends object> = T extends {}
	? false
	: T extends {
				body?: any;
				query?: any;
				params?: any;
			}
		? T["body"] extends object
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
					: false
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

/**
 * Filter out endpoints that should not be exposed to the client.
 * Checks the typed metadata on the Endpoint's options.
 */
type InferClientRoutes<T extends Record<string, Endpoint>> = {
	[K in keyof T]: T[K] extends Endpoint<
		any,
		any,
		any,
		any,
		any,
		any,
		infer Meta
	>
		? Meta extends
				| { scope: "http" }
				| { scope: "server" }
				| { SERVER_ONLY: true }
				| { isAction: false }
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
		? T extends Endpoint<infer P, infer M>
			? {
					[key in M extends "GET"
						? P
						: `@${M extends string ? Lowercase<M> : never}${P}`]: T;
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

export * from "../error";
