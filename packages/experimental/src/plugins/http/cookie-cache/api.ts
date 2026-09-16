import type { CookieOptions } from "../cookie";
import {
	type ChunkCookie,
	createChunkedCookieStore,
	getChunkedCookie,
} from "./chunk";
import type {
	CookieCacheSigner,
	CookieCacheStrategy,
	DecodeResult,
} from "./codecs";
import { codecFor } from "./codecs";

export type CookieCachePolicy = {
	name: string;
	strategy?: CookieCacheStrategy;
	maxAge: number;
	version?: string | ((payload: unknown, c: any) => string | Promise<string>);
	secret?: string | readonly string[];
	jwe?: { salt: string; info: string };
	signer?: CookieCacheSigner;
	refreshCache?: boolean | { updateAge: number };
	cookie?: CookieOptions;
	disableWhen?: (c: any) => boolean | Promise<boolean>;
	validate?: (payload: unknown, c: any) => boolean | Promise<boolean>;
	prepare?: (value: unknown, c: any) => unknown | Promise<unknown>;
};

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

function refreshUpdateAge(
	maxAge: number,
	refreshCache: boolean | { updateAge: number } | undefined,
): number | null {
	if (!refreshCache) return null;
	if (refreshCache === true) return Math.floor(maxAge * 0.2);
	return refreshCache.updateAge;
}

async function resolveVersion(
	version: CookieCachePolicy["version"],
	payload: unknown,
	c: any,
): Promise<string> {
	if (version === undefined) return "1";
	if (typeof version === "string") return version;
	return version(payload, c);
}

function payloadVersion(payload: unknown): string {
	if (
		payload !== null &&
		typeof payload === "object" &&
		"version" in payload &&
		typeof (payload as { version?: unknown }).version === "string"
	) {
		return (payload as { version: string }).version;
	}
	return "1";
}

function serializeCookie(
	name: string,
	value: string,
	options: CookieOptions = {},
): string {
	const parts = [`${name}=${encodeURIComponent(value)}`];
	if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
	if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
	if (options.path) parts.push(`Path=${options.path}`);
	if (options.domain) parts.push(`Domain=${options.domain}`);
	if (options.secure) parts.push("Secure");
	if (options.httpOnly) parts.push("HttpOnly");
	if (options.sameSite) {
		parts.push(
			`SameSite=${options.sameSite.charAt(0).toUpperCase()}${options.sameSite.slice(1)}`,
		);
	}
	return parts.join("; ");
}

function scrubSetCookie(headers: Headers, names: Set<string>) {
	const existing = headers.getSetCookie?.() ?? [];
	const single = headers.get("set-cookie");
	const list = existing.length > 0 ? existing : single ? [single] : [];
	if (list.length === 0) return;
	const kept: string[] = [];
	for (const line of list) {
		const cookieName = line.split("=")[0]?.trim();
		if (cookieName && names.has(cookieName)) continue;
		kept.push(line);
	}
	headers.delete("set-cookie");
	for (const line of kept) headers.append("set-cookie", line);
}

function applyCookies(
	c: any,
	cookies: ChunkCookie[],
	scrubNames?: Set<string>,
) {
	let response = c.res;
	if (!response) {
		response = { headers: new Headers() };
		c.res = response;
	}
	const headers: Headers = response.headers;
	if (scrubNames && scrubNames.size > 0) {
		scrubSetCookie(headers, scrubNames);
	}
	const jar = { ...(c.req?.cookies ?? {}) };
	for (const cookie of cookies) {
		const attrs = cookie.attributes;
		headers.append(
			"set-cookie",
			serializeCookie(cookie.name, cookie.value, {
				...c.cookieOptions,
				...attrs,
			}),
		);
		if (attrs.maxAge === 0) {
			delete jar[cookie.name];
		} else {
			jar[cookie.name] = cookie.value;
		}
	}
	if (c.req) {
		c.req = { ...c.req, cookies: jar };
	}
}

export type CookieCacheApi = {
	get: (c: any, policy: CookieCachePolicy) => Promise<DecodeResult | null>;
	set: (
		c: any,
		policy: CookieCachePolicy,
		payload: unknown,
		opts?: { session?: boolean },
	) => Promise<void>;
	clear: (c: any, policy: CookieCachePolicy) => Promise<void>;
	run: (c: any, policy: CookieCachePolicy, next: () => any) => any;
};

export function createCookieCacheApi(): CookieCacheApi {
	const api: CookieCacheApi = {
		get: async (c, policy) => {
			const cookies = c.req?.cookies ?? {};
			const raw = getChunkedCookie(cookies, policy.name);
			if (!raw) return null;
			const strategy = policy.strategy ?? "compact";
			const codec = codecFor(strategy, {
				secret: policy.secret,
				jwe: policy.jwe,
				signer: policy.signer,
				c,
			});
			return codec.decode(raw);
		},

		set: async (c, policy, payload, opts) => {
			let prepared = policy.prepare
				? await policy.prepare(payload, c)
				: payload;
			const ver = await resolveVersion(policy.version, prepared, c);
			if (
				prepared !== null &&
				typeof prepared === "object" &&
				!Array.isArray(prepared)
			) {
				prepared = {
					...(prepared as Record<string, unknown>),
					version: ver,
				};
			}
			const strategy = policy.strategy ?? "compact";
			const codec = codecFor(strategy, {
				secret: policy.secret,
				jwe: policy.jwe,
				signer: policy.signer,
				c,
			});
			const session = opts?.session === true;
			const encoded = await codec.encode(prepared, policy.maxAge);
			const attrs: CookieOptions = { ...policy.cookie };
			if (!session) attrs.maxAge = policy.maxAge;
			else delete attrs.maxAge;
			const store = createChunkedCookieStore(policy.name, attrs, {
				cookies: c.req?.cookies ?? {},
				serialize: serializeCookie,
				warn: (msg) => console.warn(msg),
			});
			const cookies = store.chunk(encoded, attrs);
			const scrub = new Set<string>([policy.name]);
			for (const cookie of cookies) scrub.add(cookie.name);
			applyCookies(c, cookies, scrub);
		},

		clear: async (c, policy) => {
			const attrs: CookieOptions = { ...policy.cookie, maxAge: 0 };
			const store = createChunkedCookieStore(policy.name, attrs, {
				cookies: c.req?.cookies ?? {},
				serialize: serializeCookie,
			});
			const cookies = store.clean();
			if (cookies.length === 0) {
				cookies.push({
					name: policy.name,
					value: "",
					attributes: attrs,
				});
			}
			applyCookies(c, cookies, new Set(cookies.map((x) => x.name)));
		},

		run: (c, policy, next) => {
			const disabled =
				c.input?.disableCookieCache === true
					? true
					: policy.disableWhen
						? policy.disableWhen(c)
						: false;

			const writeBack = (value: unknown) =>
				thenMaybe(api.set(c, policy, value), () => value);

			const fallThrough = () => thenMaybe(next(), writeBack);

			return thenMaybe(disabled, (skip) => {
				if (skip) return fallThrough();

				return thenMaybe(api.get(c, policy), (decoded) => {
					if (!decoded) {
						const had = getChunkedCookie(c.req?.cookies ?? {}, policy.name);
						if (had) {
							return thenMaybe(api.clear(c, policy), fallThrough);
						}
						return fallThrough();
					}

					if (decoded.expiresAt < Date.now()) {
						return thenMaybe(api.clear(c, policy), fallThrough);
					}

					return thenMaybe(
						resolveVersion(policy.version, decoded.payload, c),
						(expected) => {
							if (payloadVersion(decoded.payload) !== expected) {
								return thenMaybe(api.clear(c, policy), fallThrough);
							}

							const check = policy.validate
								? policy.validate(decoded.payload, c)
								: true;

							return thenMaybe(check, (ok) => {
								if (!ok) {
									return thenMaybe(api.clear(c, policy), fallThrough);
								}

								const updateAge = refreshUpdateAge(
									policy.maxAge,
									policy.refreshCache,
								);
								if (updateAge !== null) {
									const remaining = decoded.expiresAt - Date.now();
									if (remaining <= updateAge * 1000) {
										return thenMaybe(
											api.set(c, policy, decoded.payload),
											() => decoded.payload,
										);
									}
								}

								return decoded.payload;
							});
						},
					);
				});
			});
		},
	};
	return api;
}

/** Shared singleton API installed as `c.cookieCache`. */
export const cookieCacheApi = createCookieCacheApi();
