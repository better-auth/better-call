/** PROTOTYPE ONLY. Run `pnpm --filter better-call prototype:ui`. */

import { signInPage } from "./app";
import { renderToHtml } from "./model";

declare const Bun: {
	serve(options: { port: number; fetch(request: Request): Response }): {
		url: URL;
	};
};

function content() {
	return renderToHtml(
		signInPage.render({ options: { appName: "Better Call" } }),
	);
}

function frame() {
	return `<main class="minimal">${content()}</main>`;
}

function document() {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in</title><style>${styles}</style></head><body>${frame()}</body></html>`;
}

const styles = `:root{font:16px/1.45 system-ui,sans-serif;color:#f5f5f5;background:#000}*{box-sizing:border-box}body{display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;background:#000}.minimal{width:min(100%,510px)}.sign-in-shell{padding:28px;border:1px solid #2c2c2c;border-radius:14px;background:#111}.sign-in-shell h2{margin:0 0 22px}label{display:grid;gap:5px;margin:12px 0;font-size:13px;color:#d6d6d6}input,button{width:100%;padding:10px;border:1px solid #383838;border-radius:6px;font:inherit}input{background:#050505;color:#f5f5f5}button{cursor:pointer;background:#f5f5f5;color:#050505}.methods{display:grid;gap:8px;margin-top:22px}.methods button{background:#1b1b1b;color:#f5f5f5;text-align:left}.sign-in-shell footer{margin-top:18px;font-size:13px;color:#999}.sign-in-shell a{color:#f5f5f5}`;

const server = Bun.serve({
	port: 4317,
	fetch() {
		return new Response(document(), {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	},
});

console.log(`Experimental UI prototype: ${server.url}`);
