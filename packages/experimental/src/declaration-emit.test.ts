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
			// Opaque W - no intersected `.with(WithSeed<RV,U>)` and no use-graph.
			expect(dts).not.toMatch(/with\(context:/);
			expect(dts).not.toMatch(/createUser\?:/);
		} finally {
			rmSync(outDir, { recursive: true, force: true });
		}
	});

	it("exports leaf createAccount / core bags / signUpEmail with db use", () => {
		const outDir = mkdtempSync(join(tmpdir(), "bc-decl-leaf-"));
		try {
			execFileSync(
				process.execPath,
				[tsc, "-p", join(fixtureDir, "tsconfig.json"), "--outDir", outDir],
				{ cwd: root, stdio: "pipe" },
			);

			const dts = readFileSync(
				join(outDir, "test/declaration-emit/leaf-exports.d.ts"),
				"utf8",
			);
			expect(dts.length).toBeLessThan(MAX_DTS_BYTES);
			expect(dts).not.toMatch(/ScopeOf|ResolvedVars/);
			expect(dts).not.toMatch(/\$models/);
			expect(dts).toMatch(/export declare const createAccount:/);
			expect(dts).toMatch(/export declare const createUser:/);
			expect(dts).toMatch(/export declare const signUpEmail:/);
			expect(dts).toMatch(/export declare const coreUser:/);
			expect(dts).toMatch(/export declare const emailPassword:/);
			expect(dts).not.toMatch(/with\(context:/);
			expect(dts).not.toMatch(/createUser\?:/);
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
			// Error maps ride as FnDefination / BoundCall type args (with
			// TypeDefination fields); FnErrorsOf only surfaces on .try results.
			expect(dts).toMatch(/import\("better-call"\)\.FnDefination/);
			expect(dts).toMatch(/import\("better-call"\)\.BoundCall/);
			expect(dts).toMatch(/import\("better-call"\)\.TypeDefination/);
			expect(dts).not.toMatch(/dist\/fn\.mjs/);
		} finally {
			rmSync(consumerDir, { recursive: true, force: true });
		}
	});

	it("exports v.fn builder scopes through better-call package entry under node16", () => {
		expect(
			existsSync(join(root, "dist/index.d.mts")),
			"dist/index.d.mts missing - run pnpm build in packages/experimental",
		).toBe(true);
		// InstanceOn must be public so emit can name Instance.portably (TS2883).
		expect(readFileSync(join(root, "dist/index.d.mts"), "utf8")).toMatch(
			/\bInstanceOn\b/,
		);

		const consumerDir = mkdtempSync(join(tmpdir(), "bc-decl-app-"));
		try {
			mkdirSync(join(consumerDir, "node_modules"));
			symlinkSync(root, join(consumerDir, "node_modules/better-call"));
			symlinkSync(
				join(consumerFixtureDir, "app-scope.ts"),
				join(consumerDir, "app-scope.ts"),
			);
			writeFileSync(
				join(consumerDir, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						strict: true,
						declaration: true,
						composite: true,
						emitDeclarationOnly: true,
						outDir: "./out",
						module: "Node16",
						moduleResolution: "Node16",
						target: "ESNext",
						skipLibCheck: true,
						lib: ["esnext"],
					},
					include: ["./app-scope.ts"],
				}),
			);
			writeFileSync(
				join(consumerDir, "package.json"),
				JSON.stringify({
					name: "better-call-declaration-emit-app-scope",
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
						"app-scope declaration emit failed:",
						e.stderr?.toString("utf8"),
						e.stdout?.toString("utf8"),
					]
						.filter(Boolean)
						.join("\n"),
				);
			}

			const dts = readFileSync(join(consumerDir, "out/app-scope.d.ts"), "utf8");
			// Builders still carry Base/BaseFns in type args (larger than
			// terminating PublicFn exports) but must stay under TS7056.
			expect(dts.length).toBeLessThan(250_000);
			expect(dts).toMatch(/export declare const app:/);
			expect(dts).toMatch(/export declare const signIn:/);
			expect(dts).toMatch(/import\("better-call"\)\.Instance/);
			expect(dts).not.toMatch(/dist\/fn\.mjs/);
			expect(dts).not.toMatch(/InstanceOn/);
		} finally {
			rmSync(consumerDir, { recursive: true, force: true });
		}
	});

	it("emits db schema under the serialize limit", () => {
		const dtsPath = join(root, "dist/db.d.mts");
		expect(existsSync(dtsPath), "dist/db.d.mts missing - run pnpm build").toBe(
			true,
		);
		const dts = readFileSync(dtsPath, "utf8");
		expect(dts.length).toBeLessThan(MAX_DTS_BYTES);
		expect(dts).toMatch(/declare const schema:/);
		expect(dts).toMatch(/export \{[^}]*\bschema\b/);
	});
});
