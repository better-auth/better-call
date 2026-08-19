// PROTOTYPE ONLY. This mirrors the API shape in ../UI.md.

import { createApp, createPage, fn } from "./model";

const signInEmail = fn("auth.sign_in.email");
const passkeyAuth = fn("auth.passkey");
const githubAuth = fn("auth.github");

export const signIn = createPage("auth.sign_in", {
	title: "Sign in",
	nodes: [
		{
			kind: "form",
			action: signInEmail,
			fields: [
				{ name: "email", type: "email" },
				{ name: "password", type: "password" },
			],
		},
		{ kind: "slot", name: "methods", slotKind: "meta" },
		{ kind: "slot", name: "footer", slotKind: "slot" },
	],
});

signIn
	.meta(
		"methods",
		{ id: "passkey", order: 10, action: passkeyAuth },
		{ label: "Use a passkey" },
	)
	.meta(
		"methods",
		{ id: "github", order: 20, action: githubAuth },
		{ label: "Continue with GitHub" },
	)
	.slot(
		"footer",
		{ id: "terms", order: 20 },
		{ label: "Terms", href: "/legal" },
	);

export const settings = createPage("auth.settings", {
	title: "Settings",
	nodes: [{ kind: "slot", name: "cards", slotKind: "card" }],
});

settings
	.card(
		"cards",
		{ id: "passkey", order: 40, title: "Passkeys" },
		{
			label: "Passkeys",
			description: "Use your device to sign in without a password.",
		},
	)
	.card(
		"cards",
		{ id: "sessions", order: 50, title: "Sessions" },
		{
			label: "Sessions",
			description: "Review devices that can access this account.",
		},
	);

export const app = createApp([signIn, settings]);
