export type Awaitable<T> = T | Promise<T>;

/**
 * Pluggable key/value backend for the cache plugin. Values are strings on
 * the wire; the plugin JSON-serializes fn results before `set`.
 */
export type CacheStore = {
	get: (key: string) => Awaitable<unknown>;
	set: (key: string, value: string, ttl?: number) => Awaitable<void>;
	delete: (key: string) => Awaitable<void>;
	getAndDelete: (key: string) => Awaitable<unknown>;
	/**
	 * Atomically increment the counter at `key` by one, returning the
	 * post-increment value. When the key is absent it is created as `1`
	 * with the given `ttl` (seconds). Later increments never extend TTL.
	 */
	increment: (key: string, ttl: number) => Awaitable<number>;
	/** Drop every key registered under the given tags. */
	invalidateTags?: (tags: string[]) => Awaitable<void>;
	/** Associate `key` with `tags` for later {@link invalidateTags}. */
	tag?: (key: string, tags: string[]) => Awaitable<void>;
};
