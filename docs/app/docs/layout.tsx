import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { MouseDownSidebarItem } from "../../components/mouse-down-sidebar-item";
import { baseOptions } from "../../lib/layout";
import { source } from "../../lib/source";

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			sidebar={{ components: { Item: MouseDownSidebarItem } }}
			tree={source.getPageTree()}
			{...baseOptions()}
		>
			{children}
		</DocsLayout>
	);
}
