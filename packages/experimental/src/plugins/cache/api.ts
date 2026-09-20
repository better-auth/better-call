import { ValidationError } from "../../error";
import type {
	CacheMountConfig,
	CachePolicy,
	CachePolicyObject,
	InvalidateTags,
	ResolvedCachePolicy,
} from "./options";
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
	value: NonNullable<ResolvedCachePolicy["key"]>,
	c: any,
): string | Promise<string> => (typeof value === "function" ? value(c) : value);

const resolveTags = (
	tags: NonNullable<ResolvedCachePolicy["tags"]> | InvalidateTags | null | undefined,
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

async function resolveEnabled(
	enabled: ResolvedCachePolicy["enabled"],
	c: any,
): Promise<boolean> {
	if (enabled === undefined || enabled === null) return true;
	if (typeof enabled === "boolean") return enabled;
	return enabled(c);
}

/**
 * Resolve a cache option: await callback, merge mount defaults by alias.
 * Requires `key` after merge.
 */
export async function resolveCachePolicy(
	c: any,
	input: CachePolicy | ResolvedCachePolicy | undefined,
	mount: CacheMountConfig,
	fnKey: string,
): Promise<ResolvedCachePolicy | undefined> {
	if (input === undefined) return undefined;
	const raw: CachePolicyObject =
		typeof input === "function" ? await input(c) : input;

	const alias =
		typeof raw.name === "string" && raw.name.length > 0 ? raw.name : undefined;
	const preset =
		alias && mount.defaults?.[alias] ? mount.defaults[alias] : undefined;

	const merged: CachePolicyObject = {
		...preset,
		...raw,
	};

	if (merged.key === undefined || merged.key === null) {
		throw new ValidationError(
			`${fnKey}.cache.key`,
			"cache requires a key (set it on the option or mount defaults)",
		);
	}

	return {
		...merged,
		name: alias,
		key: merged.key,
	};
}

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
		policy: CachePolicy | ResolvedCachePolicy | undefined,
		invalidateTags: InvalidateTags | undefined,
		next: () => any,
	) => any;
};

export function createCacheApi(
	store: CacheStore,
	mount: CacheMountConfig = {},
): CacheApi {
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
		run: (ctx, policyInput, invalidateTags, next) => {
			const fnKey = String(ctx.fn?.key ?? ctx.fn ?? "fn");

			const bust = (value: unknown) =>
				thenMaybe(resolveTags(invalidateTags, ctx), (tags) => {
					if (tags.length === 0) return value;
					return thenMaybe(
						store.invalidateTags?.(tags) ?? undefined,
						() => value,
					);
				});

			const writeBack = (policy: ResolvedCachePolicy, value: unknown) => {
				const prepared = policy.prepare
					? thenMaybe(policy.prepare(value, ctx), (p) => p)
					: value;

				return thenMaybe(prepared, (toStore) =>
					thenMaybe(resolveString(policy.key, ctx), (key) =>
						thenMaybe(resolveTags(policy.tags, ctx), (tags) => {
							const payload = JSON.stringify(toStore);
							return thenMaybe(
								store.set(key, payload, policy.ttl ?? undefined),
								() => {
									const tagged =
										tags.length > 0 && store.tag
											? store.tag(key, tags)
											: undefined;
									return thenMaybe(tagged, () => bust(value));
								},
							);
						}),
					),
				);
			};

			return thenMaybe(
				resolveCachePolicy(ctx, policyInput, mount, fnKey),
				(policy) => {
					if (!policy) {
						return thenMaybe(next(), bust);
					}

					return thenMaybe(resolveEnabled(policy.enabled, ctx), (isEnabled) => {
						if (!isEnabled) {
							return thenMaybe(next(), bust);
						}

						return thenMaybe(resolveString(policy.key, ctx), (key) =>
							thenMaybe(store.get(key), (raw) => {
								if (raw !== undefined && raw !== null) {
									const parsed = parseStored(raw);
									if (policy.onHit) {
										return thenMaybe(policy.onHit(parsed, ctx), (v) => v);
									}
									return parsed;
								}
								return thenMaybe(next(), (value) =>
									writeBack(policy, value),
								);
							}),
						);
					});
				},
			);
		},
	};
}
