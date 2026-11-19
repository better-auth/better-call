import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			exclude: ["node_modules", "dist", "example", "benchmarks", "*.config.ts"],
		},
	},
});
