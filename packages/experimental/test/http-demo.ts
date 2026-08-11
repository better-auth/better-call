import { v } from "../src";
import * as http from "../src/plugins/http";

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

const handle = v
	.fn({ use: [http, { whoami }] })
	.fn("handle", { input: { request: v.any<Request>() } }, async (c) => {
		await c.fromRequest({ request: c.input.request });
		c.res?.headers.set("x-powered-by", "better-call");
		return Response.json(c.whoami(), {
			headers: c.res?.headers,
		});
	});

export const handler = (request: Request) => handle({ request });

const res = await handler(
	new Request("https://example.com/me?a=1", {
		headers: { "user-agent": "demo/1.0", cookie: "theme=dark" },
	}),
);
console.log("request :", await res.json());

/* Concurrency needs no mechanism at all now: two root calls are two
   invocations, and invocations never share state unless asked. */
const paths = await Promise.all([
	handler(new Request("https://a.test/one")).then((r) => r.json()),
	handler(new Request("https://b.test/two")).then((r) => r.json()),
]);
console.log("isolated:", paths.map((p) => p.path).join(" "));
