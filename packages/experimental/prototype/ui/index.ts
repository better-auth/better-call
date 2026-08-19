/** PROTOTYPE ONLY. A thin viewer for the resolved model. */

import { app, settings, signIn } from "./app";
import type { Contribution, TemplateNode, UiPage } from "./model";

declare const Bun: {
	serve(options: { port: number; fetch(request: Request): Response }): {
		url: URL;
	};
};

const variants = ["product", "workbench", "settings"] as const;
type Variant = (typeof variants)[number];

function renderSignIn() {
	return signIn.template.nodes
		.map((node) => {
			if (node.kind === "form") return renderForm(node);
			const entries = signIn.resolve(node.name);
			if (node.slotKind === "meta") return renderMeta(entries);
			return entries
				.map(
					(entry) =>
						`<a class="footer-link" href="${entry.content.href}">${entry.content.label}</a>`,
				)
				.join("");
		})
		.join("");
}

function renderForm(node: Extract<TemplateNode, { kind: "form" }>) {
	return `<form data-action="${node.action.key}">${node.fields
		.map(
			(field) =>
				`<label>${capitalize(field.name)}<input name="${field.name}" type="${field.type}" /></label>`,
		)
		.join("")}<button type="submit">Sign in</button></form>`;
}

function renderMeta(entries: Contribution[]) {
	return `<section class="meta"><small>Slot.Meta("methods")</small>${entries
		.map(
			(entry) =>
				`<button data-action="${entry.action?.key}">${entry.content.label} <i>${entry.order}</i></button>`,
		)
		.join("")}</section>`;
}

function renderCards() {
	return settings
		.resolve("cards")
		.map(
			(card) =>
				`<article><b>${card.title}</b><p>${card.content.description}</p><small>order ${card.order}</small></article>`,
		)
		.join("");
}

function renderVariant(variant: Variant) {
	if (variant === "workbench") {
		return `<main class="workbench"><aside><b>better-call / ui</b><p>auth.sign_in</p><p>auth.settings</p></aside><section><small>template: ${signIn.key}</small><h1>${signIn.template.title}</h1>${renderSignIn()}</section><aside><b>Resolved tree</b><pre>${tree(signIn)}</pre></aside></main>`;
	}
	if (variant === "settings") {
		return `<main class="settings"><header><small>account / security</small><h1>Sign in and security</h1></header><div><section><h2>Sign in</h2>${renderSignIn()}</section><section><small>Slot.Card("cards")</small><h2>Security</h2>${renderCards()}</section></div></main>`;
	}
	return `<main class="product"><section><small>${signIn.key}</small><h1>Your account, without the fuss.</h1><p>Pages mark insertion points. Contributions are sorted data, and this renderer decides where each kind belongs.</p></section><section class="card"><h2>Sign in</h2>${renderSignIn()}</section></main>`;
}

function tree(page: UiPage) {
	return page.template.nodes
		.map((node) => {
			if (node.kind === "form") return `Form [${node.action.key}]`;
			return [
				`Slot.${capitalize(node.slotKind)}(${node.name})`,
				...page
					.resolve(node.name)
					.map((entry) => `  ${entry.id} · ${entry.order}`),
			].join("\n");
		})
		.join("\n");
}

function page(variant: Variant) {
	const links = variants
		.map(
			(name) =>
				`<a class="${name === variant ? "selected" : ""}" href="/?variant=${name}">${name}</a>`,
		)
		.join("");
	return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Better Call UI prototype</title><style>${styles}</style></head><body><small class="note">PROTOTYPE ONLY / resolver first, UI second</small>${renderVariant(variant)}<pre class="state"><b>Resolved UI state</b>\n${JSON.stringify(app.inspect(), null, 2)}\n\n<b>Last action</b>\n<span id="action">None</span></pre><nav>${links}</nav><script>document.querySelectorAll("[data-action]").forEach((element) => element.addEventListener(element.tagName === "FORM" ? "submit" : "click", (event) => { event.preventDefault(); document.querySelector("#action").textContent = element.dataset.action + " serialized as a function key"; }));</script></body></html>`;
}

function capitalize(value: string) {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

const styles = `:root{font:16px/1.45 system-ui,sans-serif;color:#1f2328;background:#f6f6f3}*{box-sizing:border-box}body{margin:0;padding:72px max(24px,8vw) 130px}.note{position:fixed;top:16px;left:18px;color:#6a6863;font-family:monospace}h1{font-size:clamp(36px,6vw,72px);letter-spacing:-.06em;line-height:.95;margin:10px 0 20px}h2{margin-top:0}p{color:#68645e}label{display:grid;gap:5px;margin:12px 0;font-size:13px}input,button{font:inherit;padding:10px;border:1px solid #cfcac2;border-radius:6px}button{cursor:pointer;background:#20201e;color:white}form button{width:100%;margin-top:6px}.meta{display:grid;gap:7px;margin-top:24px}.meta button{background:transparent;color:#292724;text-align:left}.meta small,main>small{color:#9a553c;font-family:monospace}.footer-link{display:inline-block;margin-top:22px;color:#67635e}.product{display:grid;grid-template-columns:1.3fr .7fr;gap:min(12vw,170px);max-width:1080px;margin:auto}.product p{max-width:430px}.card,.settings section{padding:26px;border:1px solid #d8d3cb;border-radius:14px;background:#fffefa}.workbench{display:grid;grid-template-columns:190px minmax(0,1fr) 290px;gap:35px;min-height:600px;padding:28px;background:#171a20;color:#dae0e8;font-family:monospace}.workbench aside{border-right:1px solid #343b45;padding-right:18px}.workbench aside:last-child{border:0;padding:0}.workbench p{color:#99a5b3}.workbench input{background:#1e232b;color:white;border-color:#454e5b}.workbench .meta button{color:#dce3eb;border-color:#4d5867}.workbench .meta small,.workbench section>small{color:#facb69}.workbench .footer-link{color:#c4cdd8}.settings{max-width:920px;margin:auto}.settings header{margin-bottom:28px}.settings h1{font-size:42px}.settings>div{display:grid;grid-template-columns:1fr 1fr;gap:18px}.settings article{padding:14px;margin-top:10px;border:1px solid #ddd;border-radius:8px;background:white}.settings article p{margin:5px 0}.state{position:fixed;right:18px;bottom:16px;width:360px;max-height:220px;overflow:auto;padding:13px;border:1px solid #ddd;border-radius:10px;background:#fffc;font:11px/1.45 monospace;white-space:pre-wrap}nav{position:fixed;bottom:18px;left:50%;display:flex;gap:4px;padding:5px;border-radius:999px;background:white;box-shadow:0 6px 20px #0002;transform:translateX(-50%)}nav a{padding:7px 12px;border-radius:999px;color:#555;text-decoration:none;font-size:13px}nav .selected{background:#20201e;color:#fff}@media(max-width:760px){body{padding:58px 20px 100px}.product,.settings>div,.workbench{display:block}.product .card,.settings section{margin-top:18px}.workbench aside{display:none}.state{display:none}}`;

const server = Bun.serve({
	port: 4317,
	fetch(request) {
		const value = new URL(request.url).searchParams.get("variant");
		const variant = variants.includes(value as Variant)
			? (value as Variant)
			: "product";
		return new Response(page(variant), {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	},
});

console.log(`Better Call UI prototype: ${server.url}`);
