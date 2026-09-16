import { cookieCacheApi } from "./api";
import type { CookieCachePolicy } from "./api";
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

export type {
	CookieCachePolicy,
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
