import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		error: "src/error.ts",
		schema: "src/schema.ts",
		"plugins/http": "src/plugins/http.ts",
		"plugins/read-only": "src/plugins/read-only.ts",
		"plugins/capability": "src/plugins/capability.ts",
	},
	dts: { build: true, incremental: true },
	sourcemap: true,
	format: ["esm", "cjs"],
	unbundle: true,
	target: "es2022",
});
