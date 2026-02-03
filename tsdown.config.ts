import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		client: "src/client.ts",
		error: "src/error.ts",
		node: "src/adapters/node/index.ts",
	},
	dts: true,
	sourcemap: true,
	format: "esm",
	unbundle: true,
	target: "es2022",
});
