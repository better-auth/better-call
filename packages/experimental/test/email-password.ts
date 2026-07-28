import { v } from "../src";
import { coreSession } from "./session";

const e = v.fn({ use: [coreSession] });

const updateUser = e.fn(
	"/sign-up/email",
	{
		input: { email: v.string(), password: v.string() },
	},
	async (_c) => {
		//is the user passing a variable they shouldn't pass...
		//...
	},
);

//admin can be allowed to have a capability to call update user, with a userId that's not their own

export const emailAndPassword = { updateUser };

//user sign in -> { defaultCapabilities: [{ name: "/update-user", constraints: { userId: "<user-id>" } }] }

//anonymous user -> { defaultCapabilities: [{ name: "/sign-in" }] }
