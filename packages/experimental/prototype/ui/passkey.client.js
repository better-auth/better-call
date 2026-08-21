const authClient = createAuthClient({ plugins: [passkeyClient()] });

const button = document.getElementById("sign-in-with-passkey");

button.addEventListener("click", async () => {
	const response = await authClient.signIn.passkey();
	console.log(response);
});
