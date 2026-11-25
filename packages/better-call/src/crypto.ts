import { getWebcryptoSubtle } from "@better-auth/utils";

const algorithm = { name: "HMAC", hash: "SHA-256" };

const importKey = (secret: BufferSource) =>
	getWebcryptoSubtle().importKey("raw", secret, algorithm, false, [
		"sign",
		"verify",
	]);

/**
 * Keys imported from string secrets. Signing or verifying a cookie used to
 * import the same secret every time. The map is cleared when it fills up, so
 * rotated secrets don't pile up. Buffer secrets are not cached because the
 * caller can change their contents.
 */
const keyCache = new Map<string, CryptoKey>();
const KEY_CACHE_LIMIT = 16;

export const getCryptoKey = async (secret: string | BufferSource) => {
	if (typeof secret !== "string") {
		return await importKey(secret);
	}
	const cached = keyCache.get(secret);
	if (cached) {
		return cached;
	}
	const key = await importKey(new TextEncoder().encode(secret));
	// A concurrent call may have stored the same secret while this one waited.
	const stored = keyCache.get(secret);
	if (stored) {
		return stored;
	}
	if (keyCache.size >= KEY_CACHE_LIMIT) {
		keyCache.clear();
	}
	keyCache.set(secret, key);
	return key;
};

export const verifySignature = async (
	base64Signature: string,
	value: string,
	secret: CryptoKey,
): Promise<boolean> => {
	try {
		const signatureBinStr = atob(base64Signature);
		const signature = new Uint8Array(signatureBinStr.length);
		for (let i = 0, len = signatureBinStr.length; i < len; i++) {
			signature[i] = signatureBinStr.charCodeAt(i);
		}
		return await getWebcryptoSubtle().verify(
			algorithm,
			secret,
			signature,
			new TextEncoder().encode(value),
		);
	} catch {
		return false;
	}
};

const makeSignature = async (
	value: string,
	secret: string | BufferSource,
): Promise<string> => {
	const key = await getCryptoKey(secret);
	const signature = await getWebcryptoSubtle().sign(
		algorithm.name,
		key,
		new TextEncoder().encode(value),
	);
	// the returned base64 encoded signature will always be 44 characters long and end with one or two equal signs
	return btoa(String.fromCharCode(...new Uint8Array(signature)));
};

export const signCookieValue = async (
	value: string,
	secret: string | BufferSource,
) => {
	const signature = await makeSignature(value, secret);
	value = `${value}.${signature}`;
	value = encodeURIComponent(value);
	return value;
};
