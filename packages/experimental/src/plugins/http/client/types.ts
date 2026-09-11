import type { BetterFetchOption } from "@better-fetch/fetch";
import type { FnDefination } from "../../../fn";
import type { InferArgs } from "../../../schema";
import type { Store, StoreSnapshot } from "./store";

export type ClientResult<T> = {
	data: T | null;
	error: {
		message: string;
		status: number;
		statusText: string;
	} | null;
};

export type ClientFetchOptions = BetterFetchOption & {
	/**
	 * Skip static + response invalidation for this call
	 * (better-auth `disableSignal` equivalent).
	 */
	disableInvalidate?: boolean;
};

export type ClientResource<T = unknown> = {
	query: () => Promise<T | null>;
	/** Prefetch when the client is created (default true). */
	prefetch?: boolean;
};

export type ClientPlugin = {
	id: string;
	getResources?: (ctx: {
		client: Record<string, unknown>;
		$fetch: (
			path: string,
			options?: ClientFetchOptions,
		) => Promise<ClientResult<unknown>>;
	}) => Record<string, ClientResource>;
	getActions?: (ctx: {
		client: Record<string, unknown>;
		$fetch: (
			path: string,
			options?: ClientFetchOptions,
		) => Promise<ClientResult<unknown>>;
	}) => Record<string, unknown>;
};

export type ResolvedResource<T = unknown> = {
	store: Store<T>;
	refetch: () => Promise<void>;
	get: () => StoreSnapshot<T>;
	subscribe: Store<T>["subscribe"];
};

/** Map a routes module to a nested client call tree. */
export type InferClientAPI<M> = {
	[K in keyof M]: M[K] extends { $fn: true; $route: unknown }
		? M[K] extends FnDefination<any, infer R, any, infer I, any, any>
			? unknown extends I
				? (
						input?: undefined,
						opts?: ClientFetchOptions,
					) => Promise<ClientResult<Awaited<R>>>
				: (
						input: InferArgs<I>,
						opts?: ClientFetchOptions,
					) => Promise<ClientResult<Awaited<R>>>
			: (
					input?: unknown,
					opts?: ClientFetchOptions,
				) => Promise<ClientResult<unknown>>
		: M[K] extends Record<string, unknown>
			? InferClientAPI<M[K]>
			: never;
};

export type CreateClientOptions<R extends Record<string, unknown>> = {
	baseURL?: string;
	/** Runtime route module (same object used for type inference). */
	routes: R;
	fetchOptions?: BetterFetchOption;
	plugins?: ClientPlugin[];
};
