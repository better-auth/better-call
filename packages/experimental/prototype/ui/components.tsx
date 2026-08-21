import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { JSX } from "./jsx-runtime";

const getFile = (path: string) => {
	const url = new URL(path, import.meta.url);
	try {
		return readFileSync(fileURLToPath(url), "utf8");
	} catch {
		return "";
	}
};

export const Script = ({ src }: { src: string }): JSX.Element => (
	<script type="module">{getFile(src)}</script>
);
