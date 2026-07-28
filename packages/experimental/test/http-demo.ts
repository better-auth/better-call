import { v } from "../src";
import * as http from "../src/plugins/http";

const app = v.fn({ use: [http] });

export const whoami = app.fn("whoami", { requires: ["request"] }, (c) => ({
	// requiring `request` alone makes every var DERIVED from it non-null:
	method: c.var.method,
	path: c.var.path,
	ua: c.var.headers.get("user-agent") ?? null,
	q: c.var.query,
	cookie: c.var.cookies.theme ?? null,
}));

const handle = v
	.fn({ use: [http, { whoami }] })
	.fn("handle", { input: { request: v.any<Request>() } }, async (c) => {
		await c.use.fromRequest({ request: c.input.request });
		c.var.responseHeaders?.set("x-powered-by", "better-call");
		return Response.json(c.use.whoami(), {
			headers: c.var.responseHeaders ?? undefined,
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
