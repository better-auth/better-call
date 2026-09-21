import { ValidationError } from "../../../error";
import type { CookieOptions } from "../cookie";
import {
	type ChunkCookie,
	createChunkedCookieStore,
	getChunkedCookie,
} from "./chunk";
import type { DecodeResult } from "./codecs";
import { codecFor } from "./codecs";
import type {
	CookieCacheFnOption,
	CookieCacheFnOptionObject,
	CookieCacheMountConfig,
	CookieCachePolicy,
} from "./options";

export type { CookieCachePolicy };

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
	refreshCache: boolean | { updateAge: number } | null | undefined,
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
	if (version == null) return "1";
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

function isDisableCookieCache(input: unknown): boolean {
	return input === true || input === "true";
}

function mergeCookieAttrs(
	preset: CookieCacheFnOptionObject | undefined,
	option: CookieCacheFnOptionObject,
): CookieCacheFnOptionObject["cookie"] {
	if (!preset?.cookie && !option.cookie) return option.cookie;
	return { ...(preset?.cookie ?? {}), ...(option.cookie ?? {}) };
}

/**
 * Resolve a fn/API option: await callback, merge mount policy by alias,
 * apply mount secret. Requires `cookieName` + `maxAge`.
 */
export async function resolveCookieCachePolicy(
	c: any,
	input: CookieCacheFnOption | CookieCachePolicy,
	mount: CookieCacheMountConfig,
	fnKey: string,
): Promise<CookieCachePolicy> {
	const raw: CookieCacheFnOptionObject =
		typeof input === "function" ? await input(c) : input;

	const alias =
		typeof raw.name === "string" && raw.name.length > 0 ? raw.name : undefined;
	const preset =
		alias && mount.policies?.[alias] ? mount.policies[alias] : undefined;

	const merged: CookieCacheFnOptionObject = {
		...preset,
		...raw,
		cookie: mergeCookieAttrs(preset, raw),
		secret: raw.secret ?? preset?.secret ?? mount.secret,
	};

	const cookieName = merged.cookieName;
	const maxAge = merged.maxAge;
	if (typeof cookieName !== "string" || cookieName.length === 0) {
		throw new ValidationError(
			`${fnKey}.cookieCache.cookieName`,
			"cookieCache requires a non-empty cookieName (set it on the option or mount policy)",
		);
	}
	if (typeof maxAge !== "number") {
		throw new ValidationError(
			`${fnKey}.cookieCache.maxAge`,
			"cookieCache requires maxAge (seconds)",
		);
	}

	return {
		...merged,
		name: alias,
		cookieName,
		maxAge,
	};
}

async function resolveEnabled(
	enabled: CookieCachePolicy["enabled"],
	c: any,
): Promise<boolean> {
	if (enabled === undefined || enabled === null) return true;
	if (typeof enabled === "boolean") return enabled;
	return enabled(c);
}

export type CookieCacheApi = {
	get: (
		c: any,
		policy: CookieCacheFnOption | CookieCachePolicy,
	) => Promise<DecodeResult | null>;
	set: (
		c: any,
		policy: CookieCacheFnOption | CookieCachePolicy,
		payload: unknown,
		opts?: { session?: boolean },
	) => Promise<void>;
	clear: (
		c: any,
		policy: CookieCacheFnOption | CookieCachePolicy,
	) => Promise<void>;
	run: (
		c: any,
		policy: CookieCacheFnOption | CookieCachePolicy,
		next: () => any,
	) => any;
};

export function createCookieCacheApi(
	mount: CookieCacheMountConfig = {},
): CookieCacheApi {
	const fnKeyOf = (c: any) => String(c.fn?.key ?? c.fn ?? "fn");

	const api: CookieCacheApi = {
		get: async (c, policyInput) => {
			const policy = await resolveCookieCachePolicy(
				c,
				policyInput,
				mount,
				fnKeyOf(c),
			);
			const cookies = c.req?.cookies ?? {};
			const raw = getChunkedCookie(cookies, policy.cookieName);
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

		set: async (c, policyInput, payload, opts) => {
			const policy = await resolveCookieCachePolicy(
				c,
				policyInput,
				mount,
				fnKeyOf(c),
			);
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
			const attrs: CookieOptions = { ...(policy.cookie ?? {}) };
			if (!session) attrs.maxAge = policy.maxAge;
			else delete attrs.maxAge;
			const store = createChunkedCookieStore(policy.cookieName, attrs, {
				cookies: c.req?.cookies ?? {},
				serialize: serializeCookie,
				warn: (msg) => console.warn(msg),
			});
			const cookies = store.chunk(encoded, attrs);
			const scrub = new Set<string>([policy.cookieName]);
			for (const cookie of cookies) scrub.add(cookie.name);
			applyCookies(c, cookies, scrub);
		},

		clear: async (c, policyInput) => {
			const policy = await resolveCookieCachePolicy(
				c,
				policyInput,
				mount,
				fnKeyOf(c),
			);
			const attrs: CookieOptions = { ...(policy.cookie ?? {}), maxAge: 0 };
			const store = createChunkedCookieStore(policy.cookieName, attrs, {
				cookies: c.req?.cookies ?? {},
				serialize: serializeCookie,
			});
			const cookies = store.clean();
			if (cookies.length === 0) {
				cookies.push({
					name: policy.cookieName,
					value: "",
					attributes: attrs,
				});
			}
			applyCookies(c, cookies, new Set(cookies.map((x) => x.name)));
		},

		run: (c, policyInput, next) => {
			const fnKey = fnKeyOf(c);

			const writeBack = (full: CookieCachePolicy, value: unknown) =>
				thenMaybe(api.set(c, full, value), () => value);

			const fallThrough = (full: CookieCachePolicy) =>
				thenMaybe(next(), (value) => writeBack(full, value));

			return thenMaybe(
				resolveCookieCachePolicy(c, policyInput, mount, fnKey),
				(full) =>
					thenMaybe(resolveEnabled(full.enabled, c), (isEnabled) => {
						if (!isEnabled) return next();

						if (isDisableCookieCache(c.input?.disableCookieCache)) {
							return fallThrough(full);
						}

						return thenMaybe(api.get(c, full), (decoded) => {
							if (!decoded) {
								const had = getChunkedCookie(
									c.req?.cookies ?? {},
									full.cookieName,
								);
								if (had) {
									return thenMaybe(api.clear(c, full), () => fallThrough(full));
								}
								return fallThrough(full);
							}

							if (decoded.expiresAt < Date.now()) {
								return thenMaybe(api.clear(c, full), () => fallThrough(full));
							}

							return thenMaybe(
								resolveVersion(full.version, decoded.payload, c),
								(expected) => {
									if (payloadVersion(decoded.payload) !== expected) {
										return thenMaybe(api.clear(c, full), () =>
											fallThrough(full),
										);
									}

									const check = full.validate
										? full.validate(decoded.payload, c)
										: true;

									return thenMaybe(check, (ok) => {
										if (!ok) {
											return thenMaybe(api.clear(c, full), () =>
												fallThrough(full),
											);
										}

										const afterHit = (value: unknown) => {
											const updateAge = refreshUpdateAge(
												full.maxAge,
												full.refreshCache,
											);
											if (updateAge !== null) {
												const remaining = decoded.expiresAt - Date.now();
												if (remaining <= updateAge * 1000) {
													return thenMaybe(
														api.set(c, full, decoded.payload),
														() => value,
													);
												}
											}
											return value;
										};

										if (full.onHit) {
											return thenMaybe(
												full.onHit(decoded.payload, c),
												afterHit,
											);
										}
										return afterHit(decoded.payload);
									});
								},
							);
						});
					}),
			);
		},
	};
	return api;
}

/** Shared singleton API installed as `c.cookieCache` (no mount presets). */
export const cookieCacheApi = createCookieCacheApi();
