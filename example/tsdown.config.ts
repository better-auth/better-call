import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		bundle: "bundle.ts",
	},
	dts: { build: true, incremental: true },
	sourcemap: true,
	treeshake: true,
	clean: true,
	unbundle: true,
});
