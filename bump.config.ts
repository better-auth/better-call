import { execFileSync } from "node:child_process";
import { defineConfig } from "bumpp";
import { globSync } from "tinyglobby";

const currentBranch = execFileSync("git", ["branch", "--show-current"], {
	encoding: "utf8",
}).trim();

export default defineConfig({
	commit: "chore: release {tag}",
	files: globSync(["./packages/*/package.json"], { expandDirectories: false }),
	pr: {
		base: currentBranch,
		branch: "release/v{version}",
		title: "chore: release {tag}",
	},
});
