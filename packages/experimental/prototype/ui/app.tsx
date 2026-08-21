/** @jsxImportSource . */
/** PROTOTYPE ONLY. */

import { Script } from "./components";
import { app, shell, slot } from "./model";

export const signInShell = shell<["methods", "after"]>((context, slots) => (
	<>
		<section class="sign-in-shell">
			<h2>Welcome to {context.options.appName}</h2>
			<div class="methods">{slots.methods}</div>
			<footer>{slots.after}</footer>
		</section>
	</>
));

const emailAndPassword = slot("email-and-password", () => (
	<>
		<form>
			<label>
				Email <input name="email" type="email" />
			</label>
			<label>
				Password <input name="password" type="password" />
			</label>
			<button type="submit">Sign in</button>
		</form>
		<Script src="./email-and-password.client.js" />
	</>
));

const passkey = slot("passkey", () => (
	<>
		<button type="button" id="sign-in-with-passkey">
			Sign in with Passkey
		</button>
		<Script src="./passkey.client.js" />
	</>
));

export const agreeToTerms = slot("agree-to-terms", () => (
	<p>
		By continuing, you agree to the <a href="/terms">Terms</a>.
	</p>
));

export const signInPage = signInShell.assemble("auth.sign-in", {
	methods: [emailAndPassword, passkey],
	after: [agreeToTerms],
});

export const ui = app([signInPage]);
