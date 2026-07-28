import { v } from "../src";

export const userBirthday = v.extend("user", {
	birthday: v.string(),
});

export const onSignUpBirthday = v.on(
	"sign_up",
	{ input: { birthday: v.string() } },
	async (c, next) => {
		const result = await next();
		c.var.user.set({ ...c.var.user.get(), birthday: c.input.birthday });
		return result;
	},
);
