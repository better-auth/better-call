import { v } from "../src";
import { createHandler, http } from "../src/plugins/http";

const app = v.fn({ use: [http] });

export const whoami = app.fn("whoami", { requires: ["req"] }, (c) => {
	// requiring `req` makes the whole request non-null - one var, all of it:
	const req = c.req;
	return {
		method: req.method,
		path: req.path,
		ua: req.headers.get("user-agent") ?? null,
		q: req.query,
		cookie: req.cookies.theme ?? null,
	};
});

export const handler = createHandler(
	async (c) => {
		c.res?.headers.set("x-powered-by", "better-call");
		if (c.req?.path === "/go") {
			c.redirect({ url: "/me" });
		}
		return Response.json(c.whoami(), {
			headers: c.res?.headers,
		});
	},
	{ use: [{ whoami }] },
);

const res = await handler(
	new Request("https://example.com/me?a=1", {
		headers: { "user-agent": "demo/1.0", cookie: "theme=dark" },
	}),
);
console.log("request :", await res.json());

const redirected = await handler(new Request("https://example.com/go"));
console.log("redirect:", redirected.status, redirected.headers.get("location"));

/* Concurrency needs no mechanism at all now: two root calls are two
   invocations, and invocations never share state unless asked. */
const paths = await Promise.all([
	handler(new Request("https://a.test/one")).then((r) => r.json()),
	handler(new Request("https://b.test/two")).then((r) => r.json()),
]);
console.log("isolated:", paths.map((p) => p.path).join(" "));
