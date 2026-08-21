"use client";

import { SidebarItem } from "fumadocs-ui/components/sidebar/base";
import { usePathname, useRouter } from "next/navigation";
import { type MouseEvent, type ReactNode, useRef } from "react";

type SidebarPage = {
	external?: boolean;
	icon?: ReactNode;
	name: ReactNode;
	url: string;
};

export function MouseDownSidebarItem({ item }: { item: SidebarPage }) {
	const pathname = usePathname();
	const router = useRouter();
	const suppressClick = useRef(false);

	function onMouseDown(event: MouseEvent<HTMLAnchorElement>) {
		if (
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			item.external
		) {
			return;
		}

		event.preventDefault();
		suppressClick.current = true;
		router.push(item.url);
	}

	function onClick(event: MouseEvent<HTMLAnchorElement>) {
		if (!suppressClick.current) return;
		event.preventDefault();
		suppressClick.current = false;
	}

	return (
		<SidebarItem
			active={pathname === item.url}
			className="sidebar-page-button"
			external={item.external}
			href={item.url}
			icon={item.icon}
			onClick={onClick}
			onMouseDown={onMouseDown}
		>
			{item.name}
		</SidebarItem>
	);
}
