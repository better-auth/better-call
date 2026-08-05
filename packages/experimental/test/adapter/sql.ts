import { v } from "../../src";
import { fieldAttribute } from "./field";

export const modifiers = v.fn(
	"sql.modifiers",
	{ input: fieldAttribute },
	(c) => {
		const out: string[] = [];
		if (c.input.unique) out.push("UNIQUE");
		return out.join(" ").trim();
	},
);

export const assemble = v.fn(
	"sql.assemble",
	{ input: [v.string(), fieldAttribute] },
	(c) => {
		const [type, attr] = c.input;
		const mod = modifiers(attr);
		return mod ? `${type} ${mod}` : type;
	},
);
