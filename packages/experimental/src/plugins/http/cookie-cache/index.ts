import { cookieCacheApi } from "./api";
import {
	compactCodec,
	jwtCodec,
	jweCodec,
	codecFor,
	type CookieCacheCodec,
	type CookieCacheSigner,
	type CookieCacheStrategy,
	type DecodeResult,
} from "./codecs";
import {
	createChunkedCookieStore,
	getChunkedCookie,
	MAX_COOKIE_CHUNKS,
	MAX_COOKIE_SIZE,
	type ChunkCookie,
	type ChunkedCookieStore,
} from "./chunk";
import { getCookieCache, type GetCookieCacheConfig } from "./get";
import {
	cookieCacheOptionSchema,
	type CookieCacheFnOption,
	type CookieCachePolicy,
} from "./options";

export type {
	CookieCachePolicy,
	CookieCacheFnOption,
	CookieCacheCodec,
	CookieCacheSigner,
	CookieCacheStrategy,
	DecodeResult,
	GetCookieCacheConfig,
	ChunkCookie,
	ChunkedCookieStore,
};

export {
	cookieCacheApi,
	cookieCacheOptionSchema,
	compactCodec,
	jwtCodec,
	jweCodec,
	codecFor,
	createChunkedCookieStore,
	getChunkedCookie,
	getCookieCache,
	MAX_COOKIE_CHUNKS,
	MAX_COOKIE_SIZE,
};

export type { CookieCacheApi } from "./api";
export { createCookieCacheApi } from "./api";
