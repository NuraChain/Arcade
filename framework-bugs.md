# Framework Bugs

Framework-level defects found while building Nura Games against AzerothJS.

**Nothing lands here without a minimal reproduction proving the framework is responsible.** Before
adding an entry, rule out the alternatives in order: a misused API, a violated lifecycle rule, a
misread type, a configuration mistake, a race we created, a server/client boundary we crossed. An
application bug filed here is worse than no file at all, because it teaches the next reader to
distrust the whole document.

This file is the register. The framework repository keeps its own untracked notes; nothing here is
written there, and the **Upstream** field records only whether a finding has been reported yet.

---

## BUG-001 — Dev typecheck pins a component at a stale prop signature until the server restarts

### Status
Confirmed. Open.

### Framework
AzerothJS 2.1.0-beta.2 — `@azerothjs/compiler` (`packages/compiler/src/typecheck-ts.ts`).

### Affected area
`azeroth dev` / the Vite plugin's `transform` hook. Type-checking only; the emitted runtime code is
correct.

### Symptoms
Adding a prop to a component and passing it from a consumer **in the same edit** makes the consumer
fail to compile with the component's OLD signature:

```
azeroth/prop-type: Component prop type mismatch: Object literal may only specify known
properties, and 'onHold' does not exist in type
'{ conversation: Conversation; me: string; active?: boolean }'
```

`azeroth check` passes on the same working tree. Editing either file again, saving the child, and a
hard browser reload all fail to clear it. Only killing and restarting the dev server does.

### Reproduction
1. `azeroth dev`.
2. Component `A` declares `props: { x: string }`; consumer `B` renders `<A x="1" />`. Load `B`.
3. In one edit, change `A` to `{ x: string; y?: number }` and `B` to `<A x="1" y={ 2 } />`.
4. Request `B`. It 500s with "`y` does not exist" until the server is restarted.

Note: a two-file toy reproduces only when `A` already holds an override entry — see Evidence. In
a long-running dev session it is reliable.

### Evidence
`packages/compiler/src/typecheck-ts.ts`. The language-service host prefers an in-memory override
over disk in **both** places that matter:

```ts
getScriptVersion: (f) => {
    const override = overrides.get(f);
    return override ? `o${ override.version }` : `d${ diskVersions.get(f) ?? 0 }`;
}

const projectedFor = (tsPath) => overrides.get(tsPath)?.code ?? projectDisk(tsPath);
```

`invalidate(fileName)` bumps `diskVersions` and clears `diskCache` but **never deletes the
override**, so neither the reported version nor the snapshot changes while one exists. The watcher
notice wired in `packages/compiler/src/vite.ts` `configureServer` therefore cannot help. The only
thing that refreshes an override is `check()` running on that same file, which requires the module
to be requested — and a consumer that will not compile never fetches its import, so the pair
deadlocks.

### Why this is framework-related
The stale state lives entirely in the compiler's own language-service host, and the fix is a
one-line change to its invalidation. Nothing in application code can reach `overrides`.

### Workaround
Restart the dev server. `azeroth check` is unaffected and remains the trustworthy gate.

### Upstream
Not reported yet.

### Impact
High during this project specifically: the backend cutover changes prop signatures on nearly every
component it touches, and the error text points at the consumer rather than at the cause.

---

## BUG-002 — `<Link prefetch="viewport">` silently discards the caller's `ref`

### Status
Confirmed. Open.

### Framework
AzerothJS 2.1.0-beta.2 — `azerothjs` router (`packages/azerothjs/src/router/link.ts`).

### Affected area
`<Link>` prop forwarding.

### Symptoms
A `ref` passed to `<Link>` never runs when `prefetch="viewport"` is set. No warning, no error — the
callback is simply never called, so whatever it was wiring is dead.

### Reproduction
1. `<Link to="/x" ref={ (el) => attachSomething(el) } prefetch="hover">` — the ref runs.
2. Change only `prefetch` to `"viewport"` — the ref never runs.

Observed for real: a chat row wired a long-press recogniser through `ref` on a `<Link>`; under
`viewport` the recogniser never attached and the row navigated on what should have been a held
press.

### Evidence
`packages/azerothjs/src/router/link.ts`. `ref` is not in `OWN_PROPS` (line 139), and the forwarding
loop at line 306 special-cases `key !== 'ref'` so a ref function is passed through rather than
treated as a reactive getter. Then, for `prefetch === 'viewport'` only, line 342 assigns
`linkAttrs.ref = (element) => { … IntersectionObserver … }`, overwriting it.

`class`, `onClick` and `target` are overwritten too, but those ARE in `OWN_PROPS`, so those
overwrites are declared. `ref` is not.

### Why this is framework-related
The prop is documented as passed through to the anchor, and the component overwrites it. Only
`link.ts` can compose the two.

### Workaround
Wrap the `<Link>` in a host element and attach the ref there. `display: contents` works — event
bubbling follows the DOM tree, not the box tree — so layout is unaffected. In use at
`application/src/components/chat/chat-list-item.component.azeroth`.

### Upstream
Not reported yet.

### Impact
Medium. Silent, and only reachable through a prop combination that looks unrelated to the symptom.

---

## Investigated and NOT framework bugs

Kept deliberately, so the same suspicions are not re-investigated.

| Suspicion | Finding |
|---|---|
| `createSignal`'s setter subscribes to its own signal, deadlocking a store mutator called from an `effect` | It does not. The updater form `setX((current) => …)` reads without subscribing, and it is documented in `create-signal.d.ts`. Our mutator read the signal separately; `untrack` or the updater form is the correct fix, and the deadlock was ours. |
| `<For>`'s `index` is a broken getter | It is a plain value by design, documented in the README. Calling it is a type error, which is the intended signal. |
| A conditional `class={}` expression is not reactive | It is. Compiling probe components through the plugin's `transform` shows both the ternary and the `[…].filter(Boolean).join(' ')` forms emit `createEffect(() => setProp(n, "class", …))`. |
| `azeroth doctor` reports `version skew` across the two workspaces | Working as written. It compares raw dependency **spec strings**, and every `file:` link is a different string, so the set is always larger than one. Status is `warn`; exit code stays 0. |
