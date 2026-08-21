import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		error: "src/error.ts",
		"plugins/http": "src/plugins/http.ts",
	},
	dts: { build: true, incremental: true },
	sourcemap: true,
	format: ["esm", "cjs"],
	unbundle: true,
	target: "es2022",
});
