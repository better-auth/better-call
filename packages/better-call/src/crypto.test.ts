import { afterEach, describe, expect, it, vi } from "vitest";
import { getCryptoKey, signCookieValue, verifySignature } from "./crypto";

describe("getCryptoKey", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("imports a string secret once", async () => {
		const importKey = vi.spyOn(globalThis.crypto.subtle, "importKey");
		const secret = "string-secret-imported-once";

		const first = await signCookieValue("value", secret);
		const second = await signCookieValue("value", secret);
		const key = await getCryptoKey(secret);

		expect(importKey).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
		const signature = decodeURIComponent(first).split(".")[1]!;
		expect(await verifySignature(signature, "value", key)).toBe(true);
	});

	it("signs with each secret's own key", async () => {
		const a = await signCookieValue("value", "first-secret-for-signing");
		const b = await signCookieValue("value", "second-secret-for-signing");

		expect(a).not.toBe(b);
	});

	it("imports a buffer secret on every call", async () => {
		const importKey = vi.spyOn(globalThis.crypto.subtle, "importKey");
		const secret = new TextEncoder().encode("buffer-secret");

		await getCryptoKey(secret);
		await getCryptoKey(secret);

		expect(importKey).toHaveBeenCalledTimes(2);
	});

	it("keeps working after the cache fills up", async () => {
		for (let i = 0; i < 40; i++) {
			await getCryptoKey(`rotated-secret-${i}`);
		}
		const importKey = vi.spyOn(globalThis.crypto.subtle, "importKey");
		const secret = "secret-after-rotation";

		const signed = await signCookieValue("value", secret);
		const key = await getCryptoKey(secret);

		expect(importKey).toHaveBeenCalledTimes(1);
		const signature = decodeURIComponent(signed).split(".")[1]!;
		expect(await verifySignature(signature, "value", key)).toBe(true);
	});
});
