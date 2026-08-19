# Goal

Provide the ability to render highly modularized and customizable user interface through Better Call.

## Constraints

- Good DX and API Design
- Highly modularized, UI that dynamically works with each other.

## Prototyping

```tsx
import { v } from "better-call";
import { Page, Main, Slot, Title, Description, ui, Link } from "better-call/ui";

// Shell
const signInPage = ui("auth.sign-in", (c) => (
    <Page>
        <Title>Sign In</Title>
        <Description>Sign into your {c.options.appName} account and get started!</Description>
        <Main class="flex justify-center items-center">
            <div class="w-64 rounded-lg border p-6 bg-card">
                <span class="text-lg font-bold">Welcome to {c.options.appName}</span>
                <div class="flex flex-col gap-4 my-4">
                    <Slot name="methods" />
                </div>
                <span class="text-sm text-muted-foreground">
                    New here? <Link href="/sign-up">sign-up</Link> instead!
                </span>
            </div>
        </Main>
    </Page>
));

// ## UI slots
// passkey method
const signInPasskey = v.fn(
  "auth.sign_in.passkey",
  async () => authenticateWithPasskey(),
);

const passkey = ui(signInPage, { name: "passkey", slot: "methods" }, () => (
    <Button action={signInPasskey}>Use a passkey</Button>
));

// Email & password method
export const emailPassword = ui(signInPage, "methods", () => (
  <Form action={signInEmail}>
    <Fields auto />
    <Button type="submit">Sign in with email</Button>
  </Form>
));

export const signInEmail = v.fn(
  "auth.sign_in.email",
  {
    input: {
      email: v.string({ type: "email" }),
      password: v.string({ min: 8 }),
    },
  },
  async ({ input }) => authenticate(input),
);

// Build UI together
export const ui = ui({ use: [signInPage, passkey, emailPassword] });
```
