import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "test/declaration-emit");

/** Soft ceiling well under TS7056 (~1e6 chars). Pre-fix auth emits were
 * ~750KB for two fns because ScopeOf/ResolvedVars inlined the module graph. */
const MAX_DTS_BYTES = 80_000;

describe("declaration emit (TS7056)", () => {
	it("exports auth-sized e.fn results without ScopeOf graph expansion", () => {
		const outDir = mkdtempSync(join(tmpdir(), "bc-decl-emit-"));
		try {
			execFileSync(
				process.execPath,
				[
					join(root, "../../node_modules/typescript/bin/tsc"),
					"-p",
					join(fixtureDir, "tsconfig.json"),
					"--outDir",
					outDir,
				],
				{ cwd: root, stdio: "pipe" },
			);

			const dts = readFileSync(
				join(outDir, "test/declaration-emit/auth-fns.d.ts"),
				"utf8",
			);
			expect(dts.length).toBeLessThan(MAX_DTS_BYTES);
			expect(dts).not.toMatch(/ScopeOf|ResolvedVars/);
			expect(dts).not.toMatch(/\$models/);
			expect(dts).toMatch(/export declare const signUpEmail:/);
			expect(dts).toMatch(/export declare const signInEmail:/);
			// Flat `.with` seeds: var leaves + bound creates, not module wrappers.
			expect(dts).toMatch(/createUser\?:/);
			expect(dts).toMatch(/user\?:/);
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});
});
