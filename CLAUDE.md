# Nura Games — working notes for Claude Code

A social gaming platform: a cinematic 3D landing page at `/`, and the signed-in product —
matchmaking, tables, friends, chat, groups, search, notifications, profile and settings — at
`/app/*`. **Two npm workspaces**, `application/` (the browser) and `server/` (the api, the
database and the realtime gateway), plus `tools/blender/` where the 3D assets come from and
`tools/qa/` which is the responsive gate. Everything below is drawn from the repository as it
stands — if a rule here disagrees with the code, the code is right and this file needs fixing.

## Commands

```sh
npm run dev            # the conductor: tsc -w on the server, node --watch on dist, vite on 3100
npm run check          # api typecheck + server test typecheck + azeroth-tsc + eslint — the gate
npm run build          # server tsc, then client bundle, SSR bundle, prerender
npm test               # every suite, both workspaces
npm run test:shuffle   # every suite in random order — the isolation gate
npm run qa             # 600-cell Playwright matrix: 12 widths × orientation × locale × route
npm start              # the built server, serving the api AND the built client on one origin
npm run migration:run  # apply pending migrations (generate/revert/show alongside)
npm run assets         # rebuild the GLB kit from tools/blender (needs Blender 5.2)
```

`npm run check`, `npm test`, `npm run test:shuffle` and `npm run qa` must all pass before a
change is done.

**The database is Postgres.** `server/.env` carries `DATABASE_URL`; create the database once with
`psql -U postgres -c "create database nura_games"`. Nothing is ever `synchronize`d — every schema
change is a migration in `server/src/migrations/`, applied in order inside a transaction.

**There is no `npm run preview` and no `tools/preview.mjs`.** The server serves the built client
itself through `mountPages`, so the preview path and the production path are the same code:
`npm run build && SERVE_PAGES=true NODE_ENV=production npm start`. The old script kept its own MIME
table and its own copy of the client route list, which drifted from `application/src/routes.ts`
silently.

`npm run qa` drives a real browser over every route at 320–1920, portrait and landscape, in both
languages, and fails on horizontal overflow, a control smaller than 44px under a coarse pointer
(hit-tested with `elementFromPoint`, so an expanded hit area counts), a missing `main` landmark
or a dirty console. Findings land in `tools/qa/out/matrix/report.json` with a screenshot per
failing cell.

Point it at whichever half is running: `npm run dev` (vite on 3100, the default) or the built
server (`QA_BASE=http://localhost:3200`). The server run is the stronger one — it exercises
`mountPages`, the prerendered landing page and the real asset headers, which vite does not.

**The matrix is a load generator, not a visitor.** It pulls 600 pages as fast as it can from one
address, so anything metered per IP will refuse it. That is why the rate limit is scoped to
`/api` and `/ws` in `server/src/http/rate-limit.ts` rather than wrapped around the whole handler:
a page load pulls forty static assets, a file served from disk with an ETag costs almost nothing,
and one budget cannot be right for both. Metering the cheap thing at the rate the expensive thing
needs is how a normal visitor ends up taking 429s on their own JavaScript — which is exactly what
the first run of this matrix showed, as 808 console errors and 377 pages that never booted.

`tools/blender/art.py` renders the game card and hero art; it is run by hand
(`blender -b -P tools/blender/art.py`, `NURA_ART=<game>` for one) because it needs Blender, and
`build.mjs` audits the output against its budgets.

## House rules

**No comments in code.** Names and structure carry the meaning. This file, and the tests, are
where reasoning is written down.

Allman braces, 4-space indent, single quotes, no trailing comma, LF endings. All of it is
enforced by `eslint.config.ts` — `npm run check` will tell you.

## The framework is local

`azerothjs` and every `@azerothjs/*` package is consumed from `../../AzerothJS` through `file:`
specs, which npm installs as Windows junctions.

- **`AzerothJS` must be built** (`npm run build` there) before anything here resolves — every
  package's `exports` points at `dist/`, and npm does not run `prepare` for a linked directory.
  Rebuild it after any framework edit.
- **`npm ls azerothjs` must show exactly one node.** Two copies of the runtime means two
  independent signal graphs: effects stop firing, `onCleanup` never runs, and nothing throws.
  `vite.config.ts` carries `resolve.dedupe` for this reason, and `preserveSymlinks` must stay off.
- TypeScript is pinned to `^6.0.3`. typescript@7 ships the native CLI without the JS compiler API
  that the language server needs.

## The server

`server/` owns the wire shape. A new field starts in `server/src/schemas.ts`; the browser's type is
inferred from that declaration, so it is decided in exactly one place.

```
server/src/
  main.ts          composition root: env, logger, DataSource, pipeline, serve, shutdown
  app.ts           the App: /api/healthz, register(api), mountPages LAST
  api.ts           every route, declared once   <- CLIENT-SAFE
  schemas.ts       every wire shape             <- CLIENT-SAFE
  ports.ts         what the routes may call     <- CLIENT-SAFE
  services.ts      the real implementations behind Ports   (server-only, touches entities)
  data-source.ts   the single DataSource export, for the app and the migration CLI
  env.ts logger.ts entities/ migrations/ domains/ realtime/ jobs/ lib/
```

**The client-safe triangle is load-bearing.** `application/src/api.ts` does
`import type { Api } from '../../server/src/api.ts'`, which pulls `api.ts`, `schemas.ts` and
`ports.ts` into the WEB typecheck program — and that program is `application/tsconfig.json`, which
has no `experimentalDecorators`. One entity reached from those three files, even as a type, is
parsed as an ES decorator instead of a legacy one and fails `azeroth check`. That is why route
handlers are **injected** through `Ports` rather than imported: `api.ts` names what it needs,
`services.ts` provides it, and the decorated half never crosses the line.

**This backend compiles.** `typeorm` in `dependencies` is what decides that — the CLI carries
`DECORATOR_PACKAGES = ['typeorm', '@mikro-orm/core']` and the name alone flips the project from
running `src/` directly to emitting `dist/`. Node's TypeScript support is strip-only and rejects
decorator syntax outright, so there is no other way to run an `@Entity` file. Consequences that
are not obvious, each of which costs an afternoon to rediscover:

- **`rootDir: "src"` is mandatory.** The CLI hard-codes `builtEntry` as a flat `dist/main.js`. One
  file pulled in from outside `src/` moves emit to `dist/src/main.js`, and `azeroth dev` then polls
  `existsSync` forever with no error and no timeout. Stating `rootDir` turns that into a TS6059.
- **`useDefineForClassFields: false`, explicitly.** At the ES2022 default every declared entity
  field installs `undefined` over the accessors TypeORM attaches for relations. Silent corruption,
  never a crash.
- **`rewriteRelativeImportExtensions: true`**, because house style keeps `.ts` on relative imports
  and real emit would otherwise be TS5096.
- **No `incremental`/`composite`**: `azeroth check` (`--noEmit`) and `azeroth build` share one
  tsconfig and would share one `.tsbuildinfo`.
- **`server/vitest.config.ts`, never `vite.config.ts`.** A vite config in a directory that declares
  no vite drops it to `kind: 'none'` and every `azeroth` command exits 2.
- **Two compilers transform this workspace, and both are configured.** `tsc` builds it from
  `tsconfig.json`; **vitest transforms it with oxc**, which does NOT read that tsconfig for files
  under `tests/`, so `server/vitest.config.ts` states the decorator transform itself
  (`oxc.decorator.legacy`, `oxc.decorator.emitDecoratorMetadata`,
  `oxc.typescript.removeClassFieldsWithoutInitializer` — oxc's spelling of
  `useDefineForClassFields: false`). An `esbuild` block there is silently ignored with a warning.
  Without this, a spec importing an entity dies with a bare `SyntaxError: Invalid or unexpected
  token` that names neither decorators nor the config that fixes them.
  `server/tests/decorator-metadata.spec.ts` pins all three properties — registration,
  `design:type`, and class fields staying off the instance — so none of it can regress quietly.
- **`azeroth doctor` warns `version skew` permanently.** It compares raw dependency spec strings,
  and every `file:` link is a different string. Exit code stays 0. Do not spend an afternoon
  "aligning" it.

Ports: server **3200**, vite **3100**. 3000/3001 belong to Explorer. In development the two halves
are two processes and `application/vite.config.ts` proxies `/api`, `/ws` and `/_image`; in
production one process answers everything, so there is no CORS between halves in either mode.

## Frontend architecture

**AzerothJS — not React.** `.azeroth` single-file components, signals (`state`, `derived`,
`effect`), `<Show>` and `<For>`. There are no hooks, no VDOM, no JSX runtime.

```
application/src/
  world/            THE 3D MARKET. Zero AzerothJS imports.
    world.ts          lifecycle: build, run, dispose
    bridge.ts         the only UI <-> 3D contract
    camera/           path.ts (pure maths) · shots.ts (the shot list) · rig.ts (damping)
    quality/          tiers.ts (capability probe) · governor.ts (runtime downgrade)
    scene/            market.ts · lamps.ts · atmosphere.ts · procedural.ts · textures.ts
    render/materials.ts   five shared material families
    assets/loader.ts      GLB load + material remap
  components/world/ the ONE component that touches three.js
  sections/         one component per cinematic scene
  data/games.ts     the catalogue — read by the DOM roster AND by the 3D market
  stores/           theme · locale · focus · scroll
  styles/tokens.css every colour, font and motion value
```

**`world/` importing nothing from AzerothJS is load-bearing.** It is what lets the camera maths,
tier selection and governor hysteresis be unit-tested with no GPU, and it keeps three.js out of
the page's bundle — the world is a dynamic import inside `mount { }`, so it never reaches the
prerenderer and never blocks first paint.

## The fallback is the default state

The landing route is `render: 'static'`. Every heading, blurb and CTA is in the prerendered HTML.
The canvas lives behind `<Show when={ ready }>`, and `ready` flips inside `mount` — after
hydration has adopted the server's markup.

If WebGL is missing, the kit fails to load, or the device cannot cope, `ready` never flips and the
page stays exactly as it prerendered. Nobody has to remember to write a fallback branch.

## Design system — Arena Blue

Tailwind v4, CSS-first. **There is no `tailwind.config.js` and none should be created.**
Everything lives in `styles/tokens.css` (`@theme`, the two theme blocks, `@theme inline`),
`styles/base.css` (element rules, `@custom-variant`, `@utility`) and `styles/app.css` (the
shell, overlay, tooltip and toast CSS that Tailwind cannot see as utilities).

Two themes, `[data-theme='dark']` (the default) and `[data-theme='light']`. Colours are authored
in **OKLCH** so both themes come from one perceptual scale.

**Five surfaces, not one grey**: `sunk → void → field → raised → lifted`. `sunk` is a well
(inputs, segmented tracks), `void` the page, `field` cards and bars, `raised` hover and inner
tiles, `lifted` anything floating (sheet, modal, popover, tooltip, toast). Borders are
`line` (hairline) and `line-strong` (emphasis).

Accents: `accent` (electric blue — primary action, links, focus ring), `live` (mint — online,
playing), `gold` (rewards, premium, XP), `win` (victory), `danger` (destructive, errors).
`accent-ink` is the text colour that sits **on** a saturated fill; never use `text-void` for
that, it is wrong in the light theme.

`madder` is **functional**: it means a table is playing for something. It is never decoration,
and it is not the destructive colour — that is `danger`.

**Type is a scale, not arbitrary values.** `text-ui-2xs` (11) through `text-ui-4xl` (38), plus
`text-ui-input` (16, the iOS zoom guard, for `Input` only) and four display clamps
`text-display-sm|md|lg|xl`. Do not add `text-[Npx]`.

**Shape is crisp**: `rounded-control` (8px) for buttons, chips, icon buttons and inputs,
`rounded-tile` (10px) for rows, `rounded-panel` (14px) for cards, `rounded-sheet` (18px).
`rounded-full` is reserved for avatars, presence dots and badges.

The `--world-*` tokens carry the market's own palette, and the WebGL layer reads them twice:
once at `createWorld`, and again through `WorldHandle.relight()` whenever the theme changes
(`world-canvas.component.azeroth` drives it from `theme.theme()`). `relight` covers everything
that is a live uniform — sky, fog colour and density, the key/fill/rim lights, environment
intensity, the lamp pools and glows, and the vertex tint of the plaza slabs and bridges. Both
`--world-sky` values equal that theme's `--void`, so the canvas and the page share one ground
and the seam disappears.

What it does **not** touch is the kit itself: felt, walnut, brass, cards, dice and figures are
baked vertex colours inside the GLBs. Those are real objects — a backgammon board is walnut in
any light — so they are lit differently by theme but never re-tinted. The lamps stay warm in
both themes for the same reason: the market is lamplit, and that warmth against a cool ground is
the whole picture.

## The product shell

Everything behind `/sign-in` and `/app/*` is client-rendered and lazily chunked; the landing
stays `render: 'static'`. `components/app/app-shell.component.azeroth` is the layout route: it
starts every periodic store in `mount` and stops them on teardown, stamps `data-posture`
(`phone` < 768 ≤ `rail` < 1024 ≤ `sidebar`) and `data-social` on `#app-shell`, and hosts the
overlay, toast and lobby-notice portals.

**Stores own their timers.** No store schedules anything in its factory; periodic work sits
behind idempotent `start(): () => void` / `stop()`, one-shot timers are tracked and cleared by
`reset()`, and every one reads the clock through `runtime()` so tests can drive it.

**A store mutator must never read the signal it writes** while it can be called from an
`effect` — that forms a cycle and the scheduler gives up with "Reactive flush did not settle".
Use the updater form (`setX((current) => …)`, which does not subscribe) or `untrack`.

**Primitives** live in `components/ui/`. `Tooltip` wraps every `IconButton` automatically, so an
icon-only control has a visible name on a mouse and a long-press name on a finger; it portals to
`.anchor-root` and must never go through the overlay stack, whose `blocking()` drives `inert`.
`Badge` does counts, free text and dots. `Pagination` does numbered pages and load-more.
`Slider` is pointer-captured and keyboard-driven. `lib/anchor.ts` is the shared placement maths
(flip, shift, RTL) and `lib/swipe.ts` the two-axis drag with axis lock.

**Touch is not an afterthought.** Anything a finger hits clears 44px — use the `coarse:` variant
rather than growing the control for everyone. `npm run qa` fails the build if it does not.

## Signing in

Wallet-first: `stores/wallet.store.ts` wraps an injected EIP-1193 provider, asks for accounts,
switches to NuraChain when `data/chain.ts` is configured, and takes one `personal_sign` of a
SIWE-shaped message. The address becomes the identity — name, handle and avatar hue all derive
from it (`stores/account.store.ts`). Demo identities remain one tap away for exploring.

Chain details come from `VITE_NURA_*` env vars (see `.env.example`); with none set the app signs
in on whatever network the wallet is already on and skips the switch.

## The 3D asset kit

`tools/blender/assets/*.py` are the source of truth. `npm run assets` runs Blender headless and
writes GLBs into `application/public/world/`. **The GLBs are committed**, so `npm run build` and CI
never need Blender.

- Stylised realism at real dimensions, smooth-shaded, bevelled with `kit.finish` (Bevel +
  Weighted Normal, applied through `meshes.new_from_object`) and lathed with `kit.lathe` /
  `kit.sweep`. Vertex colour carries tint and baked contact AO (`kit.bake_ao`, Cycles).
- Two shared textures live outside the GLBs: `atlas-2048.webp` (`lib/atlas.py`: cards, chips,
  dice, Ludo field, score sheet — drawn with numpy SDFs + `blf`) and the tileable walnut pair
  `wood-512.webp` / `wood-normal-512.webp` (`lib/wood.py`). The `print` and `wood` families are
  `Image × Color Attribute → Base Color` through a Mix node with **Factor exactly 1.0**, or the
  exporter drops COLOR_0 and the mesh renders black under `vertexColors`. `kit.export` swaps the
  images for an 8×8 stub so nothing is embedded; three loads the atlas with `flipY = false`.
- Thirteen material families by name; the loader swaps every GLB material for one shared
  instance. Avatars are three metaball figures (`lib/figure.py`) instanced per variant; the
  `Shirt` mesh is the only one tinted per instance.
- Seats come from `seatAround()` in `data/games.ts`: a circle for round tables, a rail-normal
  offset for the poker oval. Tables and sets both get `rotation.y = -game.rotation`; a figure
  built facing Blender +Y faces three −Z, so its yaw is `π/2 − facing`.
- **Paint after every geometry op.** Faces created after `paint` have no colour and render white.
- Budgets are enforced by `build.mjs`. `node tools/blender/inspect.mjs --colours` reports
  triangles, attributes, embedded images and the linear value each palette entry converts to.
- Every set script renders Cycles previews into `tools/blender/out/` (git-ignored) from the
  landing-page dolly distance — modelling from a script means never seeing the model otherwise.

**Blender MCP** is installed (`.mcp.json`) for interactive authoring. It needs Blender open with
the addon connected (`N` → BlenderMCP → Connect) and cannot run headless. Anything arrived at
interactively must be written back into a script; the scripts stay the source of truth.

## Performance

| | budget | actual |
|---|---|---|
| initial JS, gzip | < 60 KB | 49.3 KB |
| three.js chunk | lazy | 160.9 KB gzip, after first paint |
| `/app` shell + page | lazy per route | 12 KB gzip shell, 1–15 KB per page |
| GLB kit + textures | < 4.5 MB | see `npm run assets` |
| game card art, 640 | < 60 KB each | 15–28 KB |
| game hero art, 1280 | < 110 KB each | 40–70 KB |
| kit triangles | — | ~190k, ~20% of it instanced figures |

The `/app` tree is kept out of the landing's initial payload by three things, all of which must
stay true: the `/app` layout route is `lazy`, `session.store.ts` records only an id and a handle
(`account.store.ts` is what resolves a person from the mock dataset), and the app message
catalogue is registered by `locales/app-catalogue.ts`, imported only by the shell and sign-in.

Three quality tiers picked from a capability probe, then policed by a frame-time governor that
only ever steps **down**. Most lamps are not lights: they are emissive geometry plus an additive
sprite and a painted light pool, which is why a market of lit tables affords at most four real
point lights.

## RTL

English and Persian. **Logical properties only** — `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
`border-s`/`border-e`. Every number wears `tally` so a range cannot reverse inside a mirrored
line. The 3D world does not mirror; the UI over it does. Anything that flips with the reading
direction — a chevron, an arrow, a send icon — takes `icon-flip`.

Both catalogues are split by area under `locales/{en,fa}/` and typed
`Pick<Dictionary, keyof typeof reference>`, so a key missing from Persian is a build error and a
key that is *identical* in both languages fails `tests/data.spec.ts`. Interpolation-only strings
therefore do not belong in the catalogue.

Locale is switched client-side and remembered in storage, not carried in the url, because
AzerothJS prefix routing is recorded as broken in the framework's own `framework-bugs.md`.

## No glyph the OS draws

Icons are Lucide shapes re-exported through `icons/registry.ts` as `[tag, attrs]` tuples and
rendered as inline SVG with `currentColor`. **Nothing renders an emoji, a dingbat or a symbol
character as content** — group identity is a crest (`components/social/group-crest.component
.azeroth`) drawn from the registry over a hue-tinted tile, and a separator dot is a 4px
`rounded-full` span, not a `·`. `·` and `–` inside translated sentences are punctuation and stay.

## Verification

`npm run check` · `npm test` · `npm run test:shuffle` · `npm run build` · `npm run qa`, then a
browser pass: every route at 390 and 1280 in both themes and both languages, console clean, and
the disposal check — repeatedly create and dispose the world and confirm no "Too many active
WebGL contexts" warning appears. That leak has happened twice already: once from an unreleased
capability-probe context, once because `renderer.dispose()` alone does not free the GL context
(`forceContextLoss()` does).

Two flex traps this codebase has already hit twice, worth checking first when something
overflows: a **grid item** defaults to `min-width: auto` and will not shrink around `truncate`
text (give the `<li>` `min-w-0`), and an **`<input>`** carries an intrinsic ~20-character
min-width that `flex-1` alone does not defeat (give its wrapper `min-w-0` too).
