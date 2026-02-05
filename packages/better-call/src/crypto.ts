import { getWebcryptoSubtle } from "@better-auth/utils";
const algorithm = { name: "HMAC", hash: "SHA-256" };

export const getCryptoKey = async (secret: string | BufferSource) => {
	const secretBuf =
		typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
	return await getWebcryptoSubtle().importKey(
		"raw",
		secretBuf,
		algorithm,
		false,
		["sign", "verify"],
	);
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
	} catch (e) {
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
