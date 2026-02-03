import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		client: "src/client.ts",
		error: "src/error.ts",
		node: "src/adapters/node/index.ts",
	},
	format: ["esm"],
	sourcemap: true,
	treeshake: true,
	clean: true,
	unbundle: true,
});
