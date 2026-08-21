/**
 * Module-local JSX runtime so this prototype's types do not merge with
 * React's global JSX namespace (present elsewhere in the monorepo).
 */
// cspell:ignore jsxs jsxDEV
import type { UiNode } from "./model";
import { jsx as createElement, Fragment } from "./model";

export { Fragment };

export const jsx = createElement;
export const jsxs = createElement;
export const jsxDEV = createElement;

export namespace JSX {
	export type Element = UiNode;
	export interface IntrinsicElements {
		[element: string]: Record<string, unknown>;
	}
	export interface ElementChildrenAttribute {
		children: unknown;
	}
}
