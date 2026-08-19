// PROTOTYPE ONLY. The smallest useful model for page-owned slot markers.

export type SlotKind = "slot" | "meta" | "card";
export type Fn = { key: string };
export type Content = { label: string; description?: string; href?: string };
export type Contribution = {
	id: string;
	order: number;
	slot: string;
	kind: SlotKind;
	action?: Fn;
	title?: string;
	content: Content;
};
export type TemplateNode =
	| { kind: "form"; action: Fn; fields: Array<{ name: string; type: string }> }
	| { kind: "slot"; name: string; slotKind: SlotKind };
export type Template = { title: string; nodes: TemplateNode[] };
export type ContributionOptions = {
	id: string;
	order: number;
	action?: Fn;
	title?: string;
};
export type UiPage = ReturnType<typeof createPage>;

export const fn = (key: string): Fn => ({ key });

export function createPage(key: string, template: Template) {
	const contributions: Contribution[] = [];

	function contribute(
		kind: SlotKind,
		name: string,
		options: ContributionOptions,
		content: Content,
	) {
		const marker = template.nodes.find(
			(node): node is Extract<TemplateNode, { kind: "slot" }> =>
				node.kind === "slot" && node.name === name,
		);
		if (!marker) throw new Error(`${key} has no slot named ${name}`);
		if (marker.slotKind !== kind) {
			throw new Error(`${key}.${name} is ${marker.slotKind}, not ${kind}`);
		}
		if (contributions.some((contribution) => contribution.id === options.id)) {
			throw new Error(`${key} already has a contribution named ${options.id}`);
		}

		contributions.push({ kind, slot: name, content, ...options });
		return page;
	}

	function resolve(name: string) {
		return contributions
			.filter((contribution) => contribution.slot === name)
			.toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	}

	function inspect() {
		return {
			key,
			template: template.nodes.map((node) =>
				node.kind === "form"
					? { kind: node.kind, action: node.action.key, fields: node.fields }
					: { kind: node.slotKind, name: node.name },
			),
			contributions: contributions.map(({ action, ...contribution }) => ({
				...contribution,
				action: action?.key,
			})),
		};
	}

	const page = {
		key,
		template,
		slot: (name: string, options: ContributionOptions, content: Content) =>
			contribute("slot", name, options, content),
		meta: (name: string, options: ContributionOptions, content: Content) =>
			contribute("meta", name, options, content),
		card: (
			name: string,
			options: ContributionOptions & { title: string },
			content: Content,
		) => contribute("card", name, options, content),
		resolve,
		inspect,
	};

	return page;
}

export function createApp(pages: UiPage[]) {
	return {
		page(key: string) {
			const page = pages.find((candidate) => candidate.key === key);
			if (!page) throw new Error(`No page registered for ${key}`);
			return page;
		},
		inspect: () => pages.map((page) => page.inspect()),
	};
}
