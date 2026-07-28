import { v } from "../src";
import { coreSession } from "./session";

const userWithTwoFactor = v.extend("user", {
	twoFactorEnabled: v.boolean(),
});

const t = v.fn({
	use: [
		coreSession,
		{
			userWithTwoFactor,
		},
	],
});

const createTwoFactorCode = t.fn("create_two_factor_code", async () => {
	return { code: "123456" };
});

const sendTwoFactorCode = t.fn(
	"send_two_factor_code",
	{ input: { code: v.string() } },
	async (c) => {
		console.log("sending two factor code:", c.input.code);
		return { sent: true };
	},
);

export const middleware = t.on(coreSession.createSession, async (c, next) => {
	const user = c.var.user.get();
	if (!user?.twoFactorEnabled) {
		return await next();
	}
	const code = await createTwoFactorCode();
	await sendTwoFactorCode({ code: code.code });
	return { twoFactorRequired: true };
});

export const twoFactor = {
	createTwoFactorCode,
	sendTwoFactorCode,
	userWithTwoFactor,
};
