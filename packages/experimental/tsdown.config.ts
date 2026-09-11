import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		error: "src/error.ts",
		schema: "src/schema.ts",
		"plugins/http": "src/plugins/http/index.ts",
		"plugins/http/client/index": "src/plugins/http/client/index.ts",
		"plugins/http/client/react": "src/plugins/http/client/react.ts",
		"plugins/read-only": "src/plugins/read-only.ts",
		"plugins/db": "src/plugins/db.ts",
		capability: "src/capability.ts",
	},
	dts: { build: true, incremental: true },
	sourcemap: true,
	format: ["esm", "cjs"],
	unbundle: true,
	target: "es2022",
});
