import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		error: "src/error.ts",
		schema: "src/schema.ts",
		http: "src/plugins/http/index.ts",
		"http/client/index": "src/plugins/http/client/index.ts",
		"http/client/react": "src/plugins/http/client/react.ts",
		"read-only": "src/plugins/read-only.ts",
		db: "src/plugins/db.ts",
		cache: "src/plugins/cache/index.ts",
		otel: "src/plugins/otel/index.ts",
		capability: "src/capability.ts",
	},
	dts: { build: true, incremental: true },
	sourcemap: true,
	format: ["esm", "cjs"],
	unbundle: true,
	target: "es2022",
});
