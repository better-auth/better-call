import { v } from "../src/index";

const createTool = v.fn(
	"create_tool",
	{
		input: [
			v.string({ min: 1 }),
			v.object({ description: v.string() }),
			v.fn({ input: { location: v.string() } }),
		],
	},
	(c) => {
		const [name, meta, call] = c.input;
		return { name, description: meta.description, call };
	},
);

const tool = createTool(
	"get_weather",
	{ description: "current weather for a location" },
	async ({ location }) => ({ location, forecast: "sunny" }),
);

await Promise.resolve()
	.then(() => tool.call({ location: 42 as never }))
	.then(
		() => console.log("3 bad input    : (should have thrown)"),
		(e) => console.log("3 bad input    :", (e as Error).message),
	);

// Positions validate too: the tuple is the signature.
await Promise.resolve()
	.then(() => createTool("", { description: "d" }, async () => null))
	.then(
		() => console.log("4 bad position : (should have thrown)"),
		(e) => console.log("4 bad position :", (e as Error).message),
	);
