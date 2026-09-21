import { cookieCacheApi } from "./api";
import {
	codecFor,
	compactCodec,
	jweCodec,
	jwtCodec,
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
	cookieCacheOptionSchemaFor,
	type CookieCacheFnOption,
	type CookieCacheFnOptionObject,
	type CookieCacheMountConfig,
	type CookieCachePolicy,
	type CookieCachePreset,
	type SoftAlias,
	type SoftCookieCacheOptionSchema,
} from "./options";

export type {
	CookieCachePolicy,
	CookieCacheFnOption,
	CookieCacheFnOptionObject,
	CookieCacheMountConfig,
	CookieCachePreset,
	SoftAlias,
	SoftCookieCacheOptionSchema,
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
	cookieCacheOptionSchemaFor,
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
export {
	createCookieCacheApi,
	resolveCookieCachePolicy,
} from "./api";
