import { v } from "../src";
import { http } from "../src/plugins/http";
import { emailAndPassword } from "./email-password";
import { coreSession } from "./session";
import { twoFactor } from "./two-factor";

const openAPI = v.fn(async (c) => {
	//if an endpoint uses http -> parse the validator to openAPI spec
});

const createEndpoint = v.fn(
	{
		input: { path: v.string(), method: v.string(), fn: v.any() },
	},
	async (c) => {},
);

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
		c.var.user?.birthday;
		return c.use;
	},
);

v.on(emailAndPassword.updateUser, async (c, next) => {
	return next();
});

v.fn(
	"/github/list-issues",
	{
		use: [http],
	},
	async (c) => {
		c.var.path;
	},
);

const auth = betterAuth();

console.log("created user:", res);

/// first call (sign/in) - id_token ... fetch("/update-user", { header: { cookie: idToken, Capability: JSON.stringify({ name: "/update-user", constraints: { userId: "<user-id>" } }) } })

//createClient(...) //idenitty ({ name: "my-app", keys }) // sign-in ... authority token _ id token...

//server (/...) authorize

//store("...") /// capabilty don't accept it...
