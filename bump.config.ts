import { defineConfig } from "bumpp";
import { globSync } from "tinyglobby";

export const releaseConfig = {
	branch: "v1.3.x",
	npmTag: "release-1.3",
} as const;

export default defineConfig({
	commit: "chore: release {tag}",
	files: globSync(["./packages/*/package.json"], { expandDirectories: false }),
	pr: {
		base: releaseConfig.branch,
		branch: "release/v{version}",
		title: "chore: release {tag}",
	},
});
