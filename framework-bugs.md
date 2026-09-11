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

## BUG-003 — A `?raw` import of an `.azeroth` module emits a false `unused-import` warning

### Status
Confirmed. Open.

### Framework
AzerothJS 2.1.0-beta.2 — `@azerothjs/compiler` (`packages/compiler/src/vite.ts`,
`packages/compiler/src/diagnostics.ts`).

### Affected area
The Vite plugin's `transform` lint pass. Warning only; the emitted code is correct and the build
still succeeds.

### Symptoms
Importing an `.azeroth` module with `?raw` — which reads its SOURCE, and compiles nothing — prints
a warning about that module's imports:

```
warning: azeroth/unused-import: `bootClient` is imported but never used - remove the import.
File: src/main.azeroth?raw:1:25
export default "import { bootClient } from '@azerothjs/kit/client';\n\nimport App from ...
```

`bootClient` **is** used — `bootClient(App);` is the last line of the file. The same module
imported normally produces no warning, and `azeroth check` is silent.

### Reproduction
1. A module `entry.azeroth`:
   ```ts
   import { runtime } from './r.ts';

   runtime();
   ```
2. Import it for its text: `import.meta.glob('./entry.azeroth', { query: '?raw', import: 'default', eager: true })`.
3. The warning appears. Indent the call by one space, or bind it (`const a = runtime();`), and it
   disappears — the use has not changed, only its column.

### Evidence
`transform` in `vite.ts` strips the `?query` suffix and lints whatever `code` it was handed:

```ts
const filename = id.split('?')[0] ?? id;
if (!filename.endsWith(extension)) { return null; }
…
// Lint before compiling: …
```

For a `?raw` id that `code` is Vite's re-presentation of the module — `export default "…source…"` —
not the component source. The type checker below it excludes query variants deliberately
(`else if (id === filename)`, with a comment explaining that a variant's content is
component-less). The lint pass above it has no such exclusion.

Given the wrapper, `diagnoseUnusedImports` then fails both of its checks for the wrong reason:

- the compiled-JS walk finds no identifier, because the whole module is one string literal;
- the source cross-check looks for the name outside the import statement with
  `` new RegExp(`(?<![\\w$.])${ name }(?![\\w$])`) ``. Inside the wrapper a line break is the
  two literal characters `\n`, so a use that starts a line at column 0 is preceded by `n` — a `\w` —
  and the lookbehind rejects it.

Reproduced directly against the compiler, with no Vite involved:

```js
const wrapper = 'export default ' + JSON.stringify("import { runtime } from './r.ts';\n\nruntime();\n");
diagnoseUnusedImports(wrapper, generateVirtualCode(wrapper, 'entry.azeroth').code);
// -> [{ code: 'azeroth/unused-import', … }]     // and [] for "const a = runtime();"
```

### Why this is framework-related
Nothing in application code chooses what the plugin lints. The source is correct, the import is
used, and the only variable is which text the plugin handed its own rule.

### Workaround
None needed — it is a warning. Do not "fix" it by deleting the import or reformatting the entry
module; both would be wrong. Live with the line, or stop raw-importing that file.

### Upstream
Not reported yet.

### Impact
Low, but persistent and misleading: it prints on every `npm test` run here, because
`application/tests/lib.spec.ts` globs every source file with `?raw` to assert house rules over the
text, and `src/main.azeroth` ends with `bootClient(App);` at column 0.

---

## Investigated and NOT framework bugs

Kept deliberately, so the same suspicions are not re-investigated.

| Suspicion | Finding |
|---|---|
| `createSignal`'s setter subscribes to its own signal, deadlocking a store mutator called from an `effect` | It does not. The updater form `setX((current) => …)` reads without subscribing, and it is documented in `create-signal.d.ts`. Our mutator read the signal separately; `untrack` or the updater form is the correct fix, and the deadlock was ours. |
| `<For>`'s `index` is a broken getter | It is a plain value by design, documented in the README. Calling it is a type error, which is the intended signal. |
| A conditional `class={}` expression is not reactive | It is. Compiling probe components through the plugin's `transform` shows both the ternary and the `[…].filter(Boolean).join(' ')` forms emit `createEffect(() => setProp(n, "class", …))`. |
| `azeroth doctor` reports `version skew` across the two workspaces | Working as written. It compares raw dependency **spec strings**, and every `file:` link is a different string, so the set is always larger than one. Status is `warn`; exit code stays 0. |
