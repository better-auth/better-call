import { v } from "../src";
import { http } from "../src/plugins/http";

/**
 * Prefer `http()` over bare `http`: the callable∩module intersection often
 * fails to unlock fn-options (`path` / `method`) under tsc. Interceptor `c`
 * is typed from the builder's `use` via `app.on`, plus the target's own
 * `use` / `requires` (stamped as `$use` / `$requires`).
 */
const app = v.fn({
	use: [http()],
});

const getSession = app.fn(
	"get-session",
	{
		path: "/get-session",
		method: "GET",
		use: [
			{
				test: v.var(
					"test",
					v.object({
						name: v.string(),
					}),
				),
			},
		],
	},
	async (c) => {
		c.test;
		return { path: "" };
	},
);

app.on(getSession, (c, next) => {
	const path = c.req?.path;
	const method = c.route?.method;
	const name = c.test?.name;

	return next().then((out) => ({ ...out, path, method, name }));
});
