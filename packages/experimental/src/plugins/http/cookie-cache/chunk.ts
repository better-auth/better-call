import type { CookieOptions } from "../cookie";

/** Per-cookie byte ceiling (Safari ~4093 floor, with headroom). */
export const MAX_COOKIE_SIZE = 4050;

/** Max chunks per logical cookie. */
export const MAX_COOKIE_CHUNKS = 100;

export type ChunkCookie = {
	name: string;
	value: string;
	attributes: CookieOptions;
};

export type ChunkedCookieStore = {
	/** Expire existing chunks, then split `value` if needed. */
	chunk: (value: string, options?: Partial<CookieOptions>) => ChunkCookie[];
	/** Expire every known chunk for this name. */
	clean: () => ChunkCookie[];
};

type SerializeFn = (
	name: string,
	value: string,
	options?: CookieOptions,
) => string;

function getMaxCookieValueSize(
	name: string,
	options: CookieOptions,
	serialize: SerializeFn,
): number {
	const overhead = serialize(name, "", { ...options }).length;
	return MAX_COOKIE_SIZE - overhead;
}

/**
 * Build a store that splits oversized cookie values into `name.0`…`name.N`
 * and expires stale chunks on every write.
 */
export function createChunkedCookieStore(
	cookieName: string,
	cookieOptions: CookieOptions,
	opts: {
		/** Current request cookies (name → value). */
		cookies: Record<string, string>;
		serialize: SerializeFn;
		warn?: (message: string) => void;
	},
): ChunkedCookieStore {
	const readExisting = (): Record<string, string> => {
		const chunks: Record<string, string> = {};
		for (const [name, value] of Object.entries(opts.cookies)) {
			if (name === cookieName || name.startsWith(`${cookieName}.`)) {
				chunks[name] = value;
			}
		}
		return chunks;
	};

	let chunks = readExisting();

	const expireExisting = (): Record<string, ChunkCookie> => {
		const expired: Record<string, ChunkCookie> = {};
		for (const name of Object.keys(chunks)) {
			expired[name] = {
				name,
				value: "",
				attributes: { ...cookieOptions, maxAge: 0 },
			};
		}
		chunks = {};
		return expired;
	};

	const split = (value: string, attributes: CookieOptions): ChunkCookie[] => {
		const chunkSize = getMaxCookieValueSize(
			`${cookieName}.${MAX_COOKIE_CHUNKS - 1}`,
			attributes,
			opts.serialize,
		);
		const chunkCount =
			chunkSize > 0 ? Math.ceil(value.length / chunkSize) : Infinity;

		if (chunkCount <= 1) {
			chunks[cookieName] = value;
			return [{ name: cookieName, value, attributes }];
		}

		if (chunkCount > MAX_COOKIE_CHUNKS) {
			opts.warn?.(
				`${cookieName} cookie is too large to store even after chunking; cookie cache write was skipped.`,
			);
			return [];
		}

		const out: ChunkCookie[] = [];
		for (let i = 0; i < chunkCount; i++) {
			const name = `${cookieName}.${i}`;
			const part = value.substring(i * chunkSize, (i + 1) * chunkSize);
			out.push({ name, value: part, attributes });
			chunks[name] = part;
		}
		return out;
	};

	return {
		chunk(value, options) {
			const expired = expireExisting();
			const attributes = { ...cookieOptions, ...options };
			const chunked = split(value, attributes);
			for (const cookie of chunked) {
				expired[cookie.name] = cookie;
			}
			return Object.values(expired);
		},
		clean() {
			return Object.values(expireExisting());
		},
	};
}

/** Reassemble a chunked cookie from a name→value map. */
export function getChunkedCookie(
	cookies: Record<string, string>,
	cookieName: string,
): string | null {
	const direct = cookies[cookieName];
	if (direct) return direct;

	const parts: Array<{ index: number; value: string }> = [];
	const prefix = `${cookieName}.`;
	for (const [name, value] of Object.entries(cookies)) {
		if (!name.startsWith(prefix)) continue;
		const index = Number.parseInt(name.slice(prefix.length), 10);
		if (!Number.isNaN(index)) parts.push({ index, value });
	}
	if (parts.length === 0) return null;
	parts.sort((a, b) => a.index - b.index);
	return parts.map((p) => p.value).join("");
}
