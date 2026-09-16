import {
	codecFor,
	type CookieCacheStrategy,
	type CookieCacheSigner,
} from "./codecs";
import { getChunkedCookie } from "./chunk";

export type GetCookieCacheConfig = {
	name: string;
	strategy?: CookieCacheStrategy;
	secret?: string | readonly string[];
	jwe?: { salt: string; info: string };
	signer?: CookieCacheSigner;
	version?:
		| string
		| ((payload: unknown) => string | Promise<string>);
};

function cookiesFrom(
	source: Request | Headers | Record<string, string> | string,
): Record<string, string> {
	if (typeof source === "string") {
		return parseCookieHeader(source);
	}
	if (source instanceof Request) {
		return parseCookieHeader(source.headers.get("cookie") ?? "");
	}
	if (typeof Headers !== "undefined" && source instanceof Headers) {
		return parseCookieHeader(source.get("cookie") ?? "");
	}
	return { ...(source as Record<string, string>) };
}

function parseCookieHeader(header: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const idx = part.indexOf("=");
		if (idx === -1) continue;
		const name = part.slice(0, idx).trim();
		const value = part.slice(idx + 1).trim();
		if (!name) continue;
		try {
			out[name] = decodeURIComponent(value);
		} catch {
			out[name] = value;
		}
	}
	return out;
}

/**
 * Standalone read/decode of a cookie-cache value from a Request, Headers,
 * cookie header string, or name→value map.
 */
export async function getCookieCache(
	source: Request | Headers | Record<string, string> | string,
	config: GetCookieCacheConfig,
): Promise<unknown | null> {
	const cookies = cookiesFrom(source);
	const raw = getChunkedCookie(cookies, config.name);
	if (!raw) return null;
	const strategy = config.strategy ?? "compact";
	const codec = codecFor(strategy, {
		secret: config.secret,
		jwe: config.jwe,
		signer: config.signer,
	});
	const decoded = await codec.decode(raw);
	if (!decoded) return null;
	if (decoded.expiresAt < Date.now()) return null;
	if (config.version !== undefined) {
		const expected =
			typeof config.version === "string"
				? config.version
				: await config.version(decoded.payload);
		const actual =
			decoded.payload !== null &&
			typeof decoded.payload === "object" &&
			"version" in decoded.payload &&
			typeof (decoded.payload as { version?: unknown }).version === "string"
				? (decoded.payload as { version: string }).version
				: "1";
		if (actual !== expected) return null;
	}
	return decoded.payload;
}
