# Better Call UI (sketch)

JSX templates with named slots. Modules fill slots. Actions are fns. Slot *kind* lives on the template (`Slot` vs `Slot.Meta` vs `Slot.Card`), not in a config bag.

## Shape

```tsx
const signIn = v.ui("auth.sign_in", () => (
  <Page title="Sign in">
    <Form action={signInEmail}>
      <Input name="email" />
      <Input name="password" type="password" />
      <Button type="submit">Sign in</Button>
    </Form>

    <Slot.Meta name="methods" />
    <Slot name="footer" />
  </Page>
));

const settings = v.ui("auth.settings", () => (
  <Page title="Settings">
    <Slot.Card name="cards" />
  </Page>
));

// hang contributions off the page — no "auth.methods" strings
signIn.meta("methods", {
  order: 10,
  id: "passkey",
  action: passkeyAuth,
});

signIn.slot("footer", { order: 20 }, () => (
  <Link href="/legal">Terms</Link>
));

settings.card("cards", {
  order: 40,
  id: "passkey",
  title: "Passkeys",
}, () => <PasskeyBody />);

const app = v.ui({ use: [signIn, settings, /* modules that call the above */] });
```

Plugins export the same calls from their module; mounting via `use` registers them.

## Rules (v0)

- Write the page as JSX first; slots are markers in the tree.
- Contribute with `page.slot` / `page.meta` / `page.card` — kind must match the marker.
- `order` sorts siblings; page owns layout for `meta`, chrome for `card`.
- `<Form action={someFn}>` serializes the fn key; effects stay data.
- JSX → IR → HTML + tiny runtime (not React).
