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

/** Per-call `throw` overrides the client default. */
type ResolveThrow<DefaultThrow extends boolean, O> = O extends { throw: true }
	? true
	: O extends { throw: false }
		? false
		: DefaultThrow;

type ClientReturn<T, Throw extends boolean> = Throw extends true
	? T
	: ClientResult<T>;

/**
 * Endpoint method: return shape follows `throw` on the call opts, falling
 * back to the client-level default from `createClient({ fetchOptions })`.
 */
type ClientMethod<I, R, DefaultThrow extends boolean> = unknown extends I
	? <const O extends ClientFetchOptions | undefined = undefined>(
			input?: Record<string, never>,
			opts?: O & ClientFetchOptions,
		) => Promise<ClientReturn<R, ResolveThrow<DefaultThrow, O>>>
	: {} extends InferArgs<I>
		? <const O extends ClientFetchOptions | undefined = undefined>(
				input?: InferArgs<I>,
				opts?: O & ClientFetchOptions,
			) => Promise<ClientReturn<R, ResolveThrow<DefaultThrow, O>>>
		: <const O extends ClientFetchOptions | undefined = undefined>(
				input: InferArgs<I>,
				opts?: O & ClientFetchOptions,
			) => Promise<ClientReturn<R, ResolveThrow<DefaultThrow, O>>>;

/** Map a routes module to a nested client call tree. */
export type InferClientAPI<M, DefaultThrow extends boolean = false> = {
	[K in keyof M]: M[K] extends { $fn: true; $route: unknown }
		? M[K] extends FnDefination<any, infer R, any, infer I, any, any>
			? ClientMethod<I, Awaited<R>, DefaultThrow>
			: <const O extends ClientFetchOptions | undefined = undefined>(
					input?: unknown,
					opts?: O & ClientFetchOptions,
				) => Promise<ClientReturn<unknown, ResolveThrow<DefaultThrow, O>>>
		: M[K] extends Record<string, unknown>
			? InferClientAPI<M[K], DefaultThrow>
			: never;
};

export type CreateClientOptions<
	R extends Record<string, unknown> = Record<string, unknown>,
	F extends BetterFetchOption = BetterFetchOption,
> = {
	baseURL?: string;
	/** Runtime route module (same object used for type inference). */
	routes: R;
	fetchOptions?: F;
	plugins?: ClientPlugin[];
};

/** `true` when create-time `fetchOptions.throw` is literally `true`. */
export type InferThrowDefault<F> = F extends { throw: true } ? true : false;

/**
 * Prefer this over threading `F` through option aliases — nested generics
 * often widen `throw: true` to `boolean` and lose the literal.
 */
export type InferThrowFromOptions<O> = O extends {
	fetchOptions?: infer F;
}
	? InferThrowDefault<F>
	: false;
