# Better Call v3 (Expt)

An experimental rewrite of better-call around three primitives: **fns**, **vars**, and **modules**. Everything else — plugins, HTTP, capability security — is a usage of those three, not a new concept.

## Core

### fns

A fn is a typed, keyed, callable unit. The key is what interceptors target; the input is validated at the door.

```ts
import { v } from "better-call";

const signIn = v.fn(
  "sign_in.email",
  { input: { email: v.string(), password: v.string() } },
  async (c) => {
    // c.input is validated and typed
    return { user: { id: "user:1" } };
  },
);

await signIn({ email: "b@acme.com", password: "pw" });
```

Called without a key or options, `v.fn` becomes a builder: keys concatenate, options merge, and the first handler terminates the chain.

```ts
const auth = v.fn({ use: [{ session, user }] });
const createSession = auth.fn("create_session", { ... }, async (c) => { ... });
```

A **tuple input** declares positional args — one schema per position, each validated at its index, and `c.input` is the parsed tuple:

```ts
const add = v.fn({ input: [v.number(), v.number()] }, (c) => c.input[0] + c.input[1]);
add(2, 3); // 5
```

A handler-less builder doubles as an **input schema for a fn**: the value crossing is a fn with that signature. A plain closure passed there gets the declared input validated at its door on every call; a real `v.fn` passes through untouched and validates itself. Both compose (see `test/tools.ts`):

```ts
const createTool = v.fn("create_tool", {
  input: [
    v.string(),
    v.object({ description: v.string() }),
    v.fn({ input: { location: v.string() } }), // "a fn taking { location }"
  ],
}, (c) => { const [name, , execute] = c.input; ... });

createTool("get_weather", { description: "..." }, async ({ location }) => ({ ... }));
```

Inside a **data schema** (a `v.object` shape, a var's `schema`), declare fn-typed fields with `v.fn.type` — and bare `v.fn` (never called) is "any function":

```ts
const db = v.var("db", {
  schema: v.object({
    user: v.object({
      create: v.fn.type({                         // a fn from { id } to { id }
        input: { id: v.string() },
        output: v.object({ id: v.string() }),
      }),
      drop: v.fn,                                 // any function at all
    }),
  }),
});
```

Validation checks what a signature *can* be checked for: the value is a function, and a plain closure gets the declared input validated at its door on every call — the rest of the signature lives at the type level. `v.fn.type` exists apart from the handler-less builder for **inline** spots like the one above: a `v.fn(...)` *call* written inline inside another call's arguments makes TypeScript defer it (the handler overloads return a callable, which trips higher-order inference), silently wiping the enclosing `v.object`/`v.var`'s type inference. A handler-less `v.fn({ ... })` still works as a schema when hoisted to its own `const`.

A fn schema whose input **is a var** (`create: v.fn.type({ input: user })`) resolves that input against the **scope it is read in**, not just the schema it was written with: whatever the scope mounts on the var — a `v.extend` extension, a `customize`d re-export — widens the fn's call args, the same way `ApplyOn` widens a used fn. Declare storage against the core `user`, let the app mount `userWithEmail`, and every `db.createUser(...)` call site inside that scope demands the email:

```ts
const db = v.var("db", {
  schema: v.object({ createUser: v.fn.type({ input: user }) }),
});
const app = v.fn({ use: [{ user, userWithEmail, db }] });
app.fn("auth.x", async (c) => {
  c.db?.createUser({ id: "1", email: "a@b.c" }); // email required HERE
});
```

### errors

Errors are the third contract door: input validates on entry, output on exit, errors at throw. A fn declares its failures as `tag -> payload schema`; `c.error` only accepts declared tags and validates the payload at mint:

```ts
const signIn = v.fn("sign_in.email", {
  input: { email: v.string(), password: v.string() },
  errors: { invalid_credentials: { attempts: v.number() } },
}, async (c) => {
  if (bad) throw c.error("invalid_credentials", { attempts: 3 });
});
```

What this buys, all Effect-inspired but with plain functions:

- **Failure vs defect.** A thrown `c.error(...)` is a `FnError` - a domain outcome, tagged, serializable (`{ tag, data, trail }` survives a wire). Once a fn declares `errors`, any *untagged* throw escaping its body is a bug and comes out as `UnexpectedError` with the original on `cause`. Callers never string-match to tell the two apart.
- **Typed recovery.** `fn.try(input)` returns `{ ok: true, value } | { ok: false, error }` where `error` is the union of declared errors - TS narrows on `error.tag`. Defects and contract violations still throw. `FnErrors<typeof fn>` gives the union for catch sites.
- **The trail.** As an error crosses fn frames it collects their keys - `["audit.log", "profile.update", "capability.exec"]` - origin first, so nothing about where a failure started is ever lost.
- **All issues, not the first.** Validation collects every bad field / tuple position in one `ValidationError.issues` list.

### vars

A var is named, scoped state that travels down the call tree — no threading through arguments. Fns declare their contract against vars: `provides` (checked on exit), `requires` (checked on entry), `readonly` (the whole subtree's scope locks).

```ts
const session = v.var("session", {
  default: null,
  schema: v.object({ userId: v.string() }),
});

const createSession = v.fn(
  "create_session",
  { input: { userId: v.string() }, provides: ["session"], use: [{ session }] },
  async (c) => {
    c.session = { userId: c.input.userId };
    return { created: true };
  },
);
```

There are also accumulating vars (`v.record`), computed vars (`v.derive`), reshaping (`customize`), and mountable widening (`v.extend`).

### modules

A module is the unit of composition: a plain record of members — fns, vars, `on` entries — usually just what a file exports. "Plugin" is not a concept, only a usage: mounting someone else's module with `use`.

```ts
const coreSession = { createUser, createSession, session, user };

const app = v.fn({ use: [coreSession] });
```

`v.on` mounts onto another fn by name (or reference): the handler replaces the target's body and receives `next` — call it to delegate, or don't. Targets take exact keys, `*` wildcards, RegExps, and `var.set.<name>` events for intercepting writes.

## Fns vs plain functions

Not everything is a fn. A fn is for an **operation** — a unit that participates in the app's composition model. A plain function is for a **primitive** — a pure computation. Everything `v.fn` buys — validation at the door, a declared error channel, vars traveling down the tree, interception by key, a name a router can serve — is aimed at the application boundary. Where none of that applies, the wrapper is dead weight.

Write a `v.fn` when at least one of these is true:

- **Its input is untrusted** — it arrives from a user, a wire, another process — so validation at the door means something.
- **It reads or provides vars** — it needs session, storage, request state without threading arguments.
- **Someone else should be able to change it** — a plugin hooking it with `on`, an override through `use`. Extensibility is the point.
- **It should be addressable** — a router exposes it, a capability names it, an error trail should record it.

Keep a plain function when the opposite holds:

- **The input is already trusted and precisely typed.** A `CryptoKey`, a `Uint8Array`, a `JsonWebKey` — TypeScript checks these better than any schema could express them. Wrapping them in `v.any()` is validation theater with runtime cost.
- **It's pure.** Same input, same output, no context — the var machinery would carry nothing, and pure helpers sit in hot paths.
- **Interception would be a liability, not a feature.** A signature check or a hash a plugin can wrap is an attack surface. Security primitives should be boringly non-extensible.
- **It should stay portable.** A leaf module that imports nothing from the runtime can be lifted anywhere — making it a fn inverts the dependency arrow.

The worked example is `expt-better-auth`: `sign_up.email` and `two_factor.enable` are fns — untrusted input, session vars, plugin surface, router paths. Its `src/crypto/` (base64url, JWK thumbprints, JWT sign/verify) is plain functions — pure, precisely typed, deliberately uninterceptable.

When you *do* want extensibility around a primitive — say, letting an app observe or veto token verification — hang the hook on the operation that calls it, not on the primitive itself. The fn layer is where `on` belongs; the primitive stays sealed.

## Capability-based security

`src/capability.ts` (exported as `better-call/capability`, demoed in `test/capability-demo.ts`) builds security out of the primitives above; a larger API-shaped example lives in `test/capability-api-demo.ts`. The model in one sentence:

> A fn may be called exactly by whoever **holds a reference** to it, and every fn validates that about its caller before doing anything.

### The reference is the capability

How the reference arrives is the whole story — there are only two ways:

**Direct (in-process).** The caller is another fn whose body holds this fn in memory — through `use`, an import, a closure. Possession IS authorization: some scope that held the reference chose to hand it over. There is nothing to verify, so fn-to-fn calls inside a process carry no token and check nothing.

```ts
const updateProfile = v.fn(
  "profile.update",
  { input: { name: v.string() }, use: [{ capability, audit }] },
  async (c) => {
    // fn to fn: no token, no ceremony. `use` handed this body a
    // REFERENCE to audit, and in-process possession IS authorization.
    await c.audit({ event: `renamed to "${c.input.name}"` });
  },
);
```

**Reified (across a boundary).** No memory reference can travel over a wire, so the reference becomes data: a signed **delegation** naming the fn (optionally pinned to input), exercised one call at a time by a signed **invocation**. Same model, two encodings.

A capability is never created or registered — it is inferred from the fn it names, and answers exactly one question: may the holder call THAT fn, with THAT input?

```ts
"profile.update"                                    // any input
{ fn: "profile.update", input: { name: "X" } }      // only this input
```

### The rule

Every served fn runs one check before its body: *was my caller authorized to make this call with this input?* (`validateCaller` in `src/capability.ts`):

- No boundary above this call → the caller reached this fn through a memory reference. Possession is the capability; nothing to verify.
- This fn is the wire entry → the caller holds no memory reference, only the reified one. It must cover this fn AND this input, or the fn refuses.
- Called from inside by a fn that already passed the boundary check → its body holds this fn by reference. Implied.

Once the entry frame passes, the wire hop is spent: everything below runs on direct references again.

The boundary (`serve`/`exec`) only proves the token is *genuinely held* — every link signed, attenuating, unexpired, rooted at this server, and the spend signed by the chain's audience (a stolen delegation is inert). Whether the chain covers a given call is deliberately not its question: each fn asks that itself.

### Authority

Authority never checks a call — the rule above owns that. It answers the questions that come *before* any call:

```ts
const server = await serve(modules, {
  // what references does a caller start with, given who was proven?
  // `null` IS an answer: nobody's defaults are just enough to go
  // earn attestation (here: sign in).
  defaults: (subject) => (subject ? ["profile.read"] : ["sign_in.email"]),

  // what proves WHO? reads a proven subject out of ANY fn's result;
  // attested proof rides back alongside it.
  identify: (result) => result?.user?.id ?? null,

  // how are requests for more references settled?
  decide: ({ caps }) => (dangerous(caps) ? "deny" : "challenge"),
});
```

`attest`/`verify` default to a token the server signs itself, and can be swapped together to lean on an external IDP instead.

### Delegation attenuates

A held reference can be re-minted for another key — fewer fns, or the same fn pinned to narrower input — and only ever narrows. Escalation anywhere in the chain fails verification.

```ts
// hand a slice: readProfile only
second.hold(await agent.delegate(second.id, ["profile.read"]));

// or the same fn, pinned: "may set the name to exactly this"
renamer.hold(
  await agent.delegate(renamer.id, [
    { fn: "profile.update", input: { name: "Bekacru II" } },
  ]),
);
```

### Run the demo

```sh
npx tsx test/capability-demo.ts
npx tsx test/capability-api-demo.ts   # richer endpoint-shaped Authority example
```

The arc it walks: in-process calls need no token → an agent is born asking and gets only the sign-in bootstrap → nothing is public → signing in attests WHO and trades for the defaults → a fn calls a fn the remote caller was never granted (implied reference) while the same fn refuses the wire → widening is challenged and user-approved → stolen delegations are inert → attenuation and input-pinning hold → attestation outlives the agent.

## Other explorations

- `test/http-demo.ts` — serving fns over HTTP via `src/plugins/http.ts`
- `test/better-auth.ts`, `test/email-password.ts`, `test/session.ts`, `test/birthday.ts` — module composition sketches
