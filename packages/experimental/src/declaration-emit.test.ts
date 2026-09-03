import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "test/declaration-emit");
const consumerFixtureDir = join(root, "test/declaration-emit-consumer");
const tsc = join(root, "../../node_modules/typescript/bin/tsc");

/** Soft ceiling well under TS7056 (~1e6 chars). Pre-fix auth emits were
 * ~750KB for two fns because ScopeOf/ResolvedVars inlined the module graph. */
const MAX_DTS_BYTES = 80_000;

describe("declaration emit (TS7056)", () => {
	it("exports auth-sized e.fn results without ScopeOf graph expansion", () => {
		const outDir = mkdtempSync(join(tmpdir(), "bc-decl-emit-"));
		try {
			execFileSync(
				process.execPath,
				[tsc, "-p", join(fixtureDir, "tsconfig.json"), "--outDir", outDir],
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
			// Compact `W` (var leaves) plus bound creates on intersected `.with`.
			expect(dts).toMatch(/createUser\?:/);
			expect(dts).toMatch(/user\?:/);
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});
});

describe("declaration emit (TS2883 / package entry)", () => {
	it("exports e.fn with errors through better-call package entry under node16", () => {
		expect(
			existsSync(join(root, "dist/index.d.mts")),
			"dist/index.d.mts missing - run pnpm build in packages/experimental",
		).toBe(true);

		const consumerDir = mkdtempSync(join(tmpdir(), "bc-decl-consumer-"));
		try {
			mkdirSync(join(consumerDir, "node_modules"));
			symlinkSync(root, join(consumerDir, "node_modules/better-call"));
			symlinkSync(
				join(consumerFixtureDir, "index.ts"),
				join(consumerDir, "index.ts"),
			);
			symlinkSync(
				join(consumerFixtureDir, "tsconfig.json"),
				join(consumerDir, "tsconfig.json"),
			);
			// Written here (not checked in) so this fixture is not a pnpm
			// workspace package that knip would police for unlisted deps.
			writeFileSync(
				join(consumerDir, "package.json"),
				JSON.stringify({
					name: "better-call-declaration-emit-consumer",
					private: true,
					type: "module",
				}),
			);

			try {
				execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
					cwd: consumerDir,
					stdio: "pipe",
				});
			} catch (err) {
				const e = err as { stderr?: Buffer; stdout?: Buffer };
				throw new Error(
					[
						"consumer declaration emit failed:",
						e.stderr?.toString("utf8"),
						e.stdout?.toString("utf8"),
					]
						.filter(Boolean)
						.join("\n"),
				);
			}

			const dts = readFileSync(join(consumerDir, "out/index.d.ts"), "utf8");
			expect(dts).toMatch(/export declare const signInEmail:/);
			expect(dts).toMatch(/export declare const bound:/);
			// Portable via package entry - not better-call/dist/fn.mjs (TS2883).
			expect(dts).toMatch(/import\("better-call"\)\.FnErrorsOf/);
			expect(dts).toMatch(/import\("better-call"\)\.BoundCall/);
			expect(dts).not.toMatch(/dist\/fn\.mjs/);
		} finally {
			rmSync(consumerDir, { recursive: true, force: true });
		}
	});
});
