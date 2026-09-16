import {
	base64url,
	type CompactJWEHeaderParameters,
	calculateJwkThumbprint,
	decodeProtectedHeader,
	EncryptJWT,
	jwtDecrypt,
	jwtVerify,
	SignJWT,
} from "jose";

export type CookieCacheStrategy = "compact" | "jwt" | "jwe";

export type CookieCacheSigner = {
	sign: (
		payload: unknown,
		expiresIn: number,
		c: any,
	) => string | Promise<string>;
	verify: (
		token: string,
		c: any,
	) =>
		| { payload: unknown; expiresAt: number }
		| null
		| Promise<{ payload: unknown; expiresAt: number } | null>;
};

export type DecodeResult = {
	payload: unknown;
	/** Outer expiry in epoch ms, when known. */
	expiresAt: number;
};

export type CookieCacheCodec = {
	encode: (payload: unknown, maxAge: number) => Promise<string>;
	decode: (value: string) => Promise<DecodeResult | null>;
};

const textEncoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
	return base64url.encode(bytes);
}

function base64UrlToBytes(value: string): Uint8Array {
	return base64url.decode(value);
}

async function hmacSign(secret: string, data: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		textEncoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
	return bytesToBase64Url(new Uint8Array(sig));
}

async function hmacVerify(
	secret: string,
	data: string,
	signature: string,
): Promise<boolean> {
	const expected = await hmacSign(secret, data);
	if (expected.length !== signature.length) return false;
	let ok = 0;
	for (let i = 0; i < expected.length; i++) {
		ok |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	}
	return ok === 0;
}

/**
 * Compact: base64url({ data, expiresAt, signature }) with HMAC-SHA256.
 */
export function compactCodec(secret: string): CookieCacheCodec {
	return {
		encode: async (payload, maxAge) => {
			const expiresAt = Date.now() + maxAge * 1000;
			const data = payload;
			const signature = await hmacSign(
				secret,
				JSON.stringify({ data, expiresAt }),
			);
			return bytesToBase64Url(
				textEncoder.encode(JSON.stringify({ data, expiresAt, signature })),
			);
		},
		decode: async (value) => {
			try {
				const raw = new TextDecoder().decode(base64UrlToBytes(value));
				const parsed = JSON.parse(raw) as {
					data?: unknown;
					expiresAt?: number;
					signature?: string;
				};
				if (
					typeof parsed.expiresAt !== "number" ||
					typeof parsed.signature !== "string"
				) {
					return null;
				}
				if (parsed.expiresAt < Date.now()) return null;
				const ok = await hmacVerify(
					secret,
					JSON.stringify({
						data: parsed.data,
						expiresAt: parsed.expiresAt,
					}),
					parsed.signature,
				);
				if (!ok) return null;
				return { payload: parsed.data, expiresAt: parsed.expiresAt };
			} catch {
				return null;
			}
		},
	};
}

/**
 * JWT HS256 via jose. Payload claims are the cached value fields plus exp.
 */
export function jwtCodec(secret: string): CookieCacheCodec {
	const key = textEncoder.encode(secret);
	return {
		encode: async (payload, maxAge) => {
			const claims =
				payload !== null &&
				typeof payload === "object" &&
				!Array.isArray(payload)
					? { ...(payload as Record<string, unknown>) }
					: { data: payload };
			return new SignJWT(claims as Record<string, unknown>)
				.setProtectedHeader({ alg: "HS256" })
				.setIssuedAt()
				.setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
				.sign(key);
		},
		decode: async (value) => {
			try {
				const verified = await jwtVerify(value, key);
				const exp = verified.payload.exp;
				return {
					payload: verified.payload,
					expiresAt: exp ? exp * 1000 : Date.now(),
				};
			} catch {
				return null;
			}
		},
	};
}

async function deriveEncryptionSecret(
	secret: string,
	salt: string,
	info: string,
): Promise<Uint8Array> {
	const baseKey = await crypto.subtle.importKey(
		"raw",
		textEncoder.encode(secret),
		"HKDF",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: textEncoder.encode(salt),
			info: textEncoder.encode(info),
		},
		baseKey,
		64 * 8,
	);
	return new Uint8Array(bits);
}

function secretsList(secret: string | readonly string[]): string[] {
	return typeof secret === "string" ? [secret] : [...secret];
}

/**
 * JWE dir + A256CBC-HS512 with HKDF-derived key. `salt` and `info` are
 * required (no library defaults).
 */
export function jweCodec(
	secret: string | readonly string[],
	params: { salt: string; info: string },
): CookieCacheCodec {
	const { salt, info } = params;
	const secrets = secretsList(secret);
	const alg = "dir";
	const enc = "A256CBC-HS512";

	return {
		encode: async (payload, maxAge) => {
			const current = secrets[0];
			if (!current) {
				throw new Error("jweCodec requires at least one secret");
			}
			const encryptionSecret = await deriveEncryptionSecret(
				current,
				salt,
				info,
			);
			const thumbprint = await calculateJwkThumbprint(
				{ kty: "oct", k: base64url.encode(encryptionSecret) },
				"sha256",
			);
			const claims =
				payload !== null &&
				typeof payload === "object" &&
				!Array.isArray(payload)
					? { ...(payload as Record<string, unknown>) }
					: { data: payload };
			return new EncryptJWT(claims as Record<string, unknown>)
				.setProtectedHeader({ alg, enc, kid: thumbprint })
				.setIssuedAt()
				.setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
				.setJti(crypto.randomUUID())
				.encrypt(encryptionSecret);
		},
		decode: async (value) => {
			if (!value) return null;
			let hasKid = false;
			try {
				hasKid = decodeProtectedHeader(value).kid !== undefined;
			} catch {
				return null;
			}

			const decryptOpts = {
				clockTolerance: 15,
				keyManagementAlgorithms: [alg],
				contentEncryptionAlgorithms: [enc, "A256GCM"],
			};

			try {
				const { payload } = await jwtDecrypt(
					value,
					async (header: CompactJWEHeaderParameters) => {
						const kid = header.kid;
						if (kid !== undefined) {
							for (const s of secrets) {
								const encryptionSecret = await deriveEncryptionSecret(
									s,
									salt,
									info,
								);
								const thumbprint = await calculateJwkThumbprint(
									{
										kty: "oct",
										k: base64url.encode(encryptionSecret),
									},
									"sha256",
								);
								if (kid === thumbprint) return encryptionSecret;
							}
							throw new Error("no matching decryption secret");
						}
						const primary = secrets[0];
						if (!primary) {
							throw new Error("no matching decryption secret");
						}
						return deriveEncryptionSecret(primary, salt, info);
					},
					decryptOpts,
				);
				const exp = (payload as { exp?: number }).exp;
				return {
					payload,
					expiresAt: exp ? exp * 1000 : Date.now(),
				};
			} catch {
				if (hasKid || secrets.length <= 1) return null;
				for (let i = 1; i < secrets.length; i++) {
					const candidate = secrets[i];
					if (!candidate) continue;
					try {
						const encryptionSecret = await deriveEncryptionSecret(
							candidate,
							salt,
							info,
						);
						const { payload } = await jwtDecrypt(
							value,
							encryptionSecret,
							decryptOpts,
						);
						const exp = (payload as { exp?: number }).exp;
						return {
							payload,
							expiresAt: exp ? exp * 1000 : Date.now(),
						};
					} catch {}
				}
				return null;
			}
		},
	};
}

export function codecFor(
	strategy: CookieCacheStrategy,
	opts: {
		secret?: string | readonly string[] | null;
		jwe?: { salt: string; info: string } | null;
		signer?: CookieCacheSigner | null;
		c?: any;
	},
): CookieCacheCodec {
	if (strategy === "jwt" && opts.signer) {
		const signer = opts.signer;
		const c = opts.c;
		return {
			encode: async (payload, maxAge) => signer.sign(payload, maxAge, c),
			decode: async (value) => {
				const verified = await signer.verify(value, c);
				if (!verified) return null;
				return {
					payload: verified.payload,
					expiresAt: verified.expiresAt,
				};
			},
		};
	}

	const secret = opts.secret ?? undefined;
	if (secret === undefined) {
		throw new Error(
			`cookieCache strategy "${strategy}" requires a secret (or signer for jwt)`,
		);
	}

	if (strategy === "compact") {
		const s = typeof secret === "string" ? secret : secret[0];
		if (!s) throw new Error("compact strategy requires a string secret");
		return compactCodec(s);
	}
	if (strategy === "jwt") {
		const s = typeof secret === "string" ? secret : secret[0];
		if (!s) throw new Error("jwt strategy requires a string secret");
		return jwtCodec(s);
	}
	if (!opts.jwe?.salt || !opts.jwe?.info) {
		throw new Error("jwe strategy requires cookieCache.jwe: { salt, info }");
	}
	return jweCodec(secret, opts.jwe);
}
