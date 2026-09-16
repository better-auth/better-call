import type { CachePolicy, InvalidateTags } from "./options";
import type { CacheStore } from "./store";

const thenMaybe = <T, R>(
	value: T | Promise<T>,
	next: (value: T) => R | Promise<R>,
): R | Promise<R> =>
	value instanceof Promise ||
	(typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function")
		? Promise.resolve(value as T).then(next)
		: next(value as T);

const resolveString = (
	value: string | ((c: any) => string | Promise<string>),
	c: any,
): string | Promise<string> => (typeof value === "function" ? value(c) : value);

const resolveTags = (
	tags: (string | ((c: any) => string | Promise<string>))[] | undefined,
	c: any,
): string[] | Promise<string[]> => {
	if (!tags || tags.length === 0) return [];
	const parts = tags.map((t) => resolveString(t, c));
	if (parts.some((p) => p instanceof Promise)) {
		return Promise.all(parts);
	}
	return parts as string[];
};

const parseStored = (raw: unknown): unknown => {
	if (typeof raw !== "string") return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
};

export type CacheApi = {
	get: (key: string) => Promise<unknown>;
	set: (key: string, value: string, ttl?: number) => Promise<void>;
	delete: (key: string) => Promise<void>;
	getAndDelete: (key: string) => Promise<unknown>;
	increment: (key: string, ttl: number) => Promise<number>;
	invalidateTags: (tags: string[]) => Promise<void>;
	/**
	 * Cache-aside + tag invalidation for a synthesized fn wrap.
	 * `ctx` is the call context (for key/tag resolvers).
	 */
	run: (
		ctx: any,
		policy: CachePolicy | undefined,
		invalidateTags: InvalidateTags,
		next: () => any,
	) => any;
};

export function createCacheApi(store: CacheStore): CacheApi {
	return {
		get: async (key) => store.get(key),
		set: async (key, value, ttl) => {
			await store.set(key, value, ttl);
		},
		delete: async (key) => {
			await store.delete(key);
		},
		getAndDelete: async (key) => store.getAndDelete(key),
		increment: async (key, ttl) => store.increment(key, ttl),
		invalidateTags: async (tags) => {
			if (store.invalidateTags) await store.invalidateTags(tags);
		},
		run: (ctx, policy, invalidateTags, next) => {
			const afterBody = (value: unknown) => {
				const bust = () =>
					thenMaybe(resolveTags(invalidateTags, ctx), (tags) => {
						if (tags.length === 0) return value;
						return thenMaybe(
							store.invalidateTags?.(tags) ?? undefined,
							() => value,
						);
					});

				if (!policy) return bust();

				return thenMaybe(resolveString(policy.key, ctx), (key) =>
					thenMaybe(resolveTags(policy.tags, ctx), (tags) => {
						const payload = JSON.stringify(value);
						return thenMaybe(store.set(key, payload, policy.ttl), () => {
							const tagged =
								tags.length > 0 && store.tag ? store.tag(key, tags) : undefined;
							return thenMaybe(tagged, bust);
						});
					}),
				);
			};

			if (!policy) {
				return thenMaybe(next(), afterBody);
			}

			return thenMaybe(resolveString(policy.key, ctx), (key) =>
				thenMaybe(store.get(key), (raw) => {
					if (raw !== undefined && raw !== null) {
						return parseStored(raw);
					}
					return thenMaybe(next(), afterBody);
				}),
			);
		},
	};
}
