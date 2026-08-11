import { v } from "../src";
import { http } from "../src/plugins/http";
import { emailAndPassword } from "./email-password";
import { coreSession } from "./session";
import { twoFactor } from "./two-factor";

const betterAuth = v.fn(
	{
		use: [
			emailAndPassword,
			twoFactor,
			http,
			coreSession,
			{ userWithBirthday: v.extend("user", { birthday: v.string() }) },
		],
	},
	(c) => {
		c.user?.birthday;
		return c;
	},
);

v.on(emailAndPassword.updateUser, async (_c, next) => {
	return next();
});

v.fn(
	"/github/list-issues",
	{
		use: [http],
	},
	async (c) => {
		c.req?.path;
	},
);

const _auth = betterAuth();

/// first call (sign/in) - id_token ... fetch("/update-user", { header: { cookie: idToken, Capability: JSON.stringify({ name: "/update-user", constraints: { userId: "<user-id>" } }) } })

//createClient(...) //identity ({ name: "my-app", keys }) // sign-in ... authority token _ id token...

//server (/...) authorize

//store("...") /// capability don't accept it...

const _updateUser = v.fn("/update-user", {}, async (_c) => {
	// c.fn();
});
