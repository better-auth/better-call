import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		client: "src/client.ts",
		error: "src/error.ts",
		node: "src/adapters/node/index.ts",
		"v2/endpoint": "src/v2/endpoint.ts",
		"v2/middleware": "src/v2/middleware.ts",
		"v2/router": "src/v2/router.ts",
		"v2/client": "src/v2/client.ts",
		"v2/context": "src/v2/context.ts",
		"v2/types": "src/v2/types.ts",
	},
	dts: { build: true, incremental: true },
	sourcemap: true,
	format: ["esm", "cjs"],
	unbundle: true,
	target: "es2022",
});
