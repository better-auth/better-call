import type { CacheStore } from "./store";

type Entry = {
	value: string;
	/** Epoch ms; omitted = no expiry. */
	expiresAt?: number;
};

/**
 * In-process {@link CacheStore} with TTL and a tag→keys index.
 */
export function memoryCache(): CacheStore {
	const data = new Map<string, Entry>();
	const tags = new Map<string, Set<string>>();
	const keyTags = new Map<string, Set<string>>();

	const alive = (entry: Entry | undefined): entry is Entry => {
		if (!entry) return false;
		if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
			return false;
		}
		return true;
	};

	const drop = (key: string) => {
		data.delete(key);
		const owned = keyTags.get(key);
		if (owned) {
			for (const tag of owned) {
				const set = tags.get(tag);
				set?.delete(key);
				if (set && set.size === 0) tags.delete(tag);
			}
			keyTags.delete(key);
		}
	};

	const purgeIfExpired = (key: string) => {
		const entry = data.get(key);
		if (entry && !alive(entry)) drop(key);
	};

	return {
		get: (key) => {
			purgeIfExpired(key);
			const entry = data.get(key);
			return entry?.value;
		},
		set: (key, value, ttl) => {
			const entry: Entry = { value };
			if (ttl !== undefined && ttl > 0) {
				entry.expiresAt = Date.now() + ttl * 1000;
			}
			data.set(key, entry);
		},
		delete: (key) => {
			drop(key);
		},
		getAndDelete: (key) => {
			purgeIfExpired(key);
			const entry = data.get(key);
			if (!entry) return undefined;
			drop(key);
			return entry.value;
		},
		increment: (key, ttl) => {
			purgeIfExpired(key);
			const entry = data.get(key);
			if (!entry) {
				data.set(key, {
					value: "1",
					expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : undefined,
				});
				return 1;
			}
			const next = (Number(entry.value) || 0) + 1;
			entry.value = String(next);
			return next;
		},
		tag: (key, list) => {
			let owned = keyTags.get(key);
			if (!owned) {
				owned = new Set();
				keyTags.set(key, owned);
			}
			for (const tag of list) {
				owned.add(tag);
				let set = tags.get(tag);
				if (!set) {
					set = new Set();
					tags.set(tag, set);
				}
				set.add(key);
			}
		},
		invalidateTags: (list) => {
			for (const tag of list) {
				const set = tags.get(tag);
				if (!set) continue;
				for (const key of [...set]) drop(key);
				tags.delete(tag);
			}
		},
	};
}
