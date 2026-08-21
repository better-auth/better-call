/**
 * PROTOTYPE ONLY
 *
 * Question: does the shells -> slots -> pages composition described in
 * docs/content/docs/experimental-ui.mdx give plugins enough control without
 * letting them own a page's layout?
 */

export type UiContext = { options: { appName: string } };
export type UiNode =
	| string
	| number
	| null
	| undefined
	| false
	| UiElement
	| UiNode[];
export type Render = (context: UiContext) => UiNode;
export const Fragment = Symbol.for("better-call.ui.fragment");
type UiComponent = (props: JsxProps) => UiNode;
type UiTag = string | typeof Fragment | UiComponent;

export type UiElement = {
	tag: string | typeof Fragment;
	props: Record<string, unknown>;
	children: UiNode[];
};

type JsxProps = Record<string, unknown> & {
	children?: UiNode | UiNode[];
};

export type UiSlot = {
	name: string;
	render: Render;
	script?: string;
};

export type UiPage = {
	key: string;
	render(context: UiContext): UiNode;
	inspect(): unknown;
};

type SlotMap<Names extends string> = Record<Names, readonly UiSlot[]>;
type RenderedSlots<Names extends string> = Record<Names, UiNode[]>;

export function shell<const Names extends readonly string[]>(
	render: (context: UiContext, slots: RenderedSlots<Names[number]>) => UiNode,
) {
	type Name = Names[number];

	return {
		assemble(key: string, slots: Partial<SlotMap<Name>>): UiPage {
			const names = Object.keys(slots) as Name[];

			return {
				key,
				render(context) {
					const rendered = Object.fromEntries(
						names.map((name) => [
							name,
							slots[name]?.map((entry) => entry.render(context)) ?? [],
						]),
					) as RenderedSlots<Name>;
					return render(context, rendered);
				},
				inspect() {
					return {
						key,
						shellSlots: names,
						contributions: Object.fromEntries(
							names.map((name) => [
								name,
								slots[name]?.map((entry) => entry.name) ?? [],
							]),
						),
					};
				},
			};
		},
	};
}

export function slot(name: string, render: Render, script?: string): UiSlot {
	return { name, render, script };
}

export function app(pages: readonly UiPage[]) {
	const pagesByKey = new Map(pages.map((page) => [page.key, page]));
	if (pagesByKey.size !== pages.length)
		throw new Error("Page keys must be unique");

	return {
		page(key: string) {
			const page = pagesByKey.get(key);
			if (!page) throw new Error(`No page registered for ${key}`);
			return page;
		},
		inspect: () => pages.map((page) => page.inspect()),
	};
}

/** Automatic JSX runtime: children live on props (not rest args). */
export function jsx(
	tag: UiTag,
	props: JsxProps | null,
	_key?: string | number,
): UiNode {
	const { children, ...rest } = props ?? {};
	const normalized =
		children === undefined
			? []
			: Array.isArray(children)
				? children
				: [children];
	if (typeof tag === "function") {
		return tag({ ...rest, children: normalized });
	}
	return { tag, props: rest, children: normalized };
}

export function renderToHtml(node: UiNode): string {
	return renderNode(node, false);
}

function renderNode(node: UiNode, raw: boolean): string {
	if (node === null || node === undefined || node === false) return "";
	if (typeof node === "string" || typeof node === "number")
		return raw ? `${node}` : escapeHtml(`${node}`);
	if (Array.isArray(node))
		return node.map((child) => renderNode(child, raw)).join("");
	if (node.tag === Fragment)
		return node.children.map((child) => renderNode(child, raw)).join("");

	const attributes = Object.entries(node.props)
		.filter(
			([, value]) => value !== false && value !== null && value !== undefined,
		)
		.map(([key, value]) => {
			const name = key === "className" ? "class" : key;
			return value === true ? name : `${name}="${escapeHtml(`${value}`)}"`;
		})
		.join(" ");
	const openingTag = attributes
		? `<${node.tag} ${attributes}>`
		: `<${node.tag}>`;
	const rawChildren = node.tag === "script" || node.tag === "style";
	return `${openingTag}${node.children.map((child) => renderNode(child, rawChildren)).join("")}</${node.tag}>`;
}

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
