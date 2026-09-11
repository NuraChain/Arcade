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

`npm test` runs with **no Postgres**, and that promise is why the database-backed suite is opt-in:
`npm run test:db --workspace server` with `TEST_DATABASE_URL` pointing at a database you do not
mind losing. It truncates before every test, so it owns whatever it is pointed at - which is also
why it runs `--no-file-parallelism`: two spec files truncating the same tables from two workers
deadlock each other, and the failure reads like a product bug rather than a test one. Everything that
is a claim about the DATABASE lives there - mirrored writes, partial unique indexes, CHECK
constraints, the races - because a fake DataSource can only prove that the fake agrees with the
code.

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

Run it against the BUILT server when the result has to be trustworthy. Under `npm run dev` the
conductor restarts the api whenever `dist/` is rewritten — a `npm run build` or `npm test` in
another terminal is enough — and every restart costs the matrix one cell: vite answers the
in-flight `/api/_manifest` with a 502, the page boots without its data, and the header controls
fail the 44px check in their pre-hydration state. Three runs in a row each lost exactly one cell
that way, each time to a different route. The same matrix against `npm start` is 600/600.

It needs the **api** either way, because it signs in for real: one `POST /api/auth/demo` as
`alex`, then every context is built from the resulting `storageState`. There is no longer a
session key it could write into `localStorage` — the cookie is HttpOnly — and a matrix run against
a database with no demo rows fails on the first line rather than touring 600 signed-out pages.

**The matrix is a load generator, not a visitor.** It pulls 600 pages as fast as it can from one
address, so anything metered per IP will refuse it - and now that a page load makes real API
calls, it does. Run it against a server started with `API_RATE_MAX` raised
(`API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production npm start`); the limit is configuration
for exactly this reason, rather than the product shipping a limit shaped around a test. That is why the rate limit is scoped to
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

**`DataSource.query()` does not return one shape, and the difference is silent.** A SELECT gives
the rows. An INSERT, UPDATE or DELETE — *even with `returning`* — gives `[rows, affectedCount]`.
So `result.length === 0` is never true for a mutation that matched nothing, and `result[0].x`
reads the rows ARRAY rather than the first row. A "did this UPDATE match?" check written the
obvious way always says yes, and the value it reads is always `undefined`. It cost an afternoon:
a sign-in that burned its nonce correctly, handed `undefined` to the signature verifier, and
reported "that signature did not match the address" for a perfectly good signature. **Every
mutating query in this server goes through `lib/rows.ts`** — `rowsOf`, `firstRow`, `affectedBy` —
and `tests/rows.spec.ts` pins all three shapes.

**No application test may reach the network.** `application/src/api.ts` fetches the route manifest
at module load, so importing any store from a spec opens a real socket. `application/tests/setup.ts`
mocks that module globally with `tests/fake-api.ts`, an in-memory server that records its calls
and can be told to refuse; specs that assert on those calls import `server` from it. The fake
derives handles with the REAL `handleFromName`, imported from the server, so the two cannot drift.

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

## Migrations and reference data

Two things that look alike and are not.

**Migrations** change the schema. `server/src/migrations/NNNN-name.ts`, registered in the barrel,
applied in order inside a transaction. Two names, both load-bearing: the FILE is numbered for
people so the directory reads in order, and the CLASS must end in a JavaScript timestamp because
that is what TypeORM sorts by — it refuses a class without one ("migration name is wrong"). The
class name is also what it records as applied, so it must never change once it has run anywhere.

Use `npm run migration:generate` to DISCOVER the SQL; it is very good at that. Then commit the
result by hand: the generator names the class after the file, and a file starting with a digit
produces `export class 0001Reference…`, which is not a valid JavaScript identifier. Watch for
backticks in SQL comments — inside a template literal they end the string.

**Reference data** is content the product cannot run without: the games, their rules, the
achievement definitions, and the three demo personas. `server/src/db/seed-reference.ts` upserts it on every boot, so a changed
blurb ships without a migration. It is not development fixtures — those are a separate file that
refuses to run outside development.

A seed that upserts into a table real people also write to needs a guard, and the demo personas
are that case: their `on conflict (handle)` ends in `where users.kind = 'demo'`. Without it, a
deploy would silently convert whoever had claimed `alex` into a shared account anyone could sign
into through `/auth/demo`. That is not hypothetical — it happened in development the first time
this seed ran, against an account that had claimed `sara.k` minutes earlier.

One sharp edge, because it will surprise someone: `status` is deliberately never overwritten on
conflict. An operator who disabled a game did so for a reason and a deploy must not re-enable it.
That makes the `status` in the seed an INITIAL value only — changing it on a database that already
has the row is `update games set status = …`, not a redeploy.

**The catalogue is split, and the split is the point.** The server owns what a game IS — seats,
modes, targets, fairness, whether it can be opened. `application/src/data/games.ts` keeps where its
table STANDS in the 3D market — `anchor`, `rotation`, `table`, `set` — because that is scene
geometry and the landing route is `render: 'static'`: it must paint with no JavaScript and no
server. The two merge by id, the server wins where both hold a field, and
`server/tests/reference-parity.spec.ts` fails if they ever drift.

**The live counts on the home page are SIMULATED, and deliberately not zero.** No table has ever
been opened — tables arrive with the play domain — so `BASE` and `seededStats` in
`catalogue.store.ts` drift on a seeded RNG. Both are deleted outright the moment the server
answers with real counts. Zeroing them instead would be a different lie: "0 people at the tables"
reads as a broken product rather than an unbuilt feature.

**A store that reads the server must be read reactively.** `catalogue.rules()` used to be a
synchronous array and is now backed by a resource, so `const rules = catalogue.rules(id)` captures
whatever was there before the answer landed — silently, with no error. Use `derived`, and where a
component's whole premise is the server's answer (the create form exists to offer the legal seat
counts), do not mount it until `catalogue.loading()` is false. Reading inside an event handler is
fine: by click time the answer is in.

## The social graph, and the privacy over it

`server/src/domains/social/` is two files and the split matters. `policy.ts` is PURE - it decides
who may write to whom, who may see somebody online, who may knock, and what a minor is allowed to
hold - and `service.ts` resolves two accounts and a relation from the database and then does
nothing but call it. Four places ask the same question (starting a chat, sending a message,
inviting to a table, adding a friend), and four copies of the answer would be four chances to be
generous by accident.

**The rules, in the order they are checked.** Blocking first, because a blocked pair is refused
whatever anybody set. Friendship next, because a friend is somebody you already said yes to.
Only then the RECIPIENT's settings - and a minor's setting can never be the permissive one.

| | strangers | friends | blocked |
|---|---|---|---|
| ordinary account | may write | may write | refused |
| strangers turned off | `strangers-off` | may write | refused |
| minor | `minor-safety`, both directions | may write | refused |

Presence has the same shape: invisible means invisible to everyone but friends, and a minor is
offline to strangers whatever they set. Discovery does NOT: being a stranger is not grounds for
invisibility, because this is a product for finding people to play with. What a stranger cannot do
is write.

**A minor who allows stranger messages is not a row this database can hold.**
`users_minor_no_strangers` is a CHECK, and `clampPrivacy` applies the same rule in the service so
the route can answer with what was STORED rather than with a 500. Two locks on one door, and they
are not redundant: the constraint makes the unsafe row unrepresentable whoever writes it, the
function makes the unsafe answer unrepresentable whoever asks. The constraint earned its keep
immediately - the demo seed inserted the minor persona with the column default and took the whole
server down at boot, which is exactly the failure it exists to cause.

**Friendships are mirrored**: two rows, written by one function, so "my friends" is one index scan
rather than a union of two half-queries. **A friend request is unique on the UNORDERED pair while
pending**, so A asking B while B is asking A cannot become two rows describing one intention - the
second call finds the first and accepts it. Both are proved in `social.db.spec.ts` against a real
Postgres, because neither is a claim about TypeScript.

**Privacy is enforced by what the server does not SEND.** `lastSeenAt` is absent from a person
payload the viewer may not have it for - not null, not flagged. A client cannot render what it was
never given, and a filter it is trusted to apply is a filter one component forgets.

**One mute, three kinds of subject.** `mutes (user_id, subject_kind, subject_id)` holds people,
conversations and games. The product used to keep a muted-people list in `social.store.ts` and
muted conversations and games in `settings.store.ts` - three spellings of one idea, and every
feature had to remember all three. `settings.store.ts` is now only what this DEVICE prefers:
sound, haptics, the rail, notification categories. Nothing in it belongs to the account.

**The whole graph is the server's now.** `social.store.ts` reads friends, both request
directions, blocks, the directory, suggestions, mutes, privacy and my own reports from the API,
and every one of them is a handle. The browser's mock is a PROFILE cache - portrait, favourite
game, region, statistics - joined by handle, because no domain owns those fields yet.

Two behaviours went away with it, and both were furniture:

- **Nobody answers a friend request on a timer.** `planRequestReply` used to accept for them
  after a few seconds. A request now sits pending until the other person answers it.
- **Nothing walks a report to "reviewed".** The client used to move its own report along on a
  20-second timer. It says what was filed and waits, because nothing in a browser knows what
  moderation did.

**Blocking ends the friendship, and unblocking does not restore it.** The block deletes both
friendship rows inside the same transaction, so afterwards there is nothing left to disagree
about; getting back to friends means asking again. Worth knowing before writing a test that
blocks the same person twice and wonders why the second one measures nothing.

**Three of the reads are LAZY, and pages ask for them.** `graph` and `privacy` are fetched on
boot because the shell reads both on every route. The directory, the suggestions and my reports
are not - that would be three more requests on every navigation for three lists that two pages
between them ever show - so a page calls `social.want('people' | 'suggestions' | 'reports')` in
its `mount`. The responsive matrix is what found this: nine API calls per page over six hundred
pages took the rate limiter out, and the limiter was right.

## People are handles

**The client's person id IS the handle.** `person.id === person.handle` for all twenty-four mock
people, the wire speaks handles wherever it names somebody - a conversation's members, a message's
author - and `server/tests/fixture-parity.spec.ts` fails if that stops being true.

The alternative was projecting the server's uuid and re-keying the browser at boot, which needs
every `personById` call site to be correct across an async window where the ids change underneath
it. A handle is already the public identifier, already the URL key, and already unique
case-insensitively in the database. The one thing it is not is immutable - somebody can rename
themselves - and the answer is that a rename refetches, which is what the client does anyway.

The server still keys everything on uuid internally. Handles are the EDGE.

## Chat is the server's

`server/src/domains/chat/` owns conversations, membership and messages; the browser reads them
through `createApiSource()` and nothing else. The local source that stood in for it is gone.

**`pinned` and `last_read_at` are per MEMBER.** The mock kept both on the conversation, which
meant one person pinning a thread pinned it for everybody in it. Unread is a count of messages
after my own watermark - which is also the only way to count them once the bodies are sealed and
the server cannot read one.

**A message is words XOR a line.** `body` for what somebody typed, `payload` `{ key, params }` for
the three kinds the server authors, and a CHECK constraint so a row can never be both or neither.
The browser renders a line through `lib/lines.ts`, which declares the keys it knows; an unknown
key renders as NOTHING rather than as its own name, because an old client meeting a new server is
a designed state and not an excuse to print an internal identifier on the screen.

**History pages by keyset**, `(created_at, id)` descending. An OFFSET page repeats or skips a line
every time a message arrives at the other end while somebody is scrolling up, and
`chat.db.spec.ts` has a test that does exactly that and expects the page not to move.

**A conversation you are not in answers exactly as one that does not exist**, and so does a
malformed id - which is not only tidiness. Postgres raises 22P02 when a path parameter that is not
a uuid is compared against one, and that surfaces as a 500, so any visitor could turn a typo in the
address bar into a server error. `membership()` checks the shape before the query.

**A block hides the thread, not just the person.** The membership row stays - unblocking has to
give the conversation back - so the list and every read filter on the block instead.

**Nothing invents a message any more.** The store used to run an ambient timer that wrote lines
from people who were not there, and a per-send timer that typed a reply back; both are deleted.
Until the realtime work lands, the only thing that produces a message is somebody sending one, and
the list refreshes when the app asks it to.

**Development fixtures** live in `server/src/db/seed-fixtures.ts` and refuse to run outside
development. They seed the same twenty-four people, friendships and conversations the mock
describes, so the demo tour still opens onto a populated room. `tests/fake-api.ts` imports the
same file, so the browser specs and the server agree about who exists by construction. Deleting
that file is how the mock finally goes away.

Each fixture conversation is written in ONE language, because a real message is one language. The
bilingual strings were a mock convenience the wire format does not have.

## Reading chat

`chat.store.ts` reads through `services/chat.source.ts` and nothing else. That interface is the
whole seam the server slots into: `conversations`, `thread`, `post`, `openDirect`, `archive`.
Today `createLocalSource()` implements it over the mock; `setChatSource()` swaps it, which is how
the failure states are tested and how the API implementation will arrive.

**Two reads, two shapes, and the split is the point.** The LIST carries a row per conversation —
the conversation, its last message, its unread count — and the THREAD carries the messages of the
one conversation that is open. So `unread()`, `lastOf()` and `totalUnread` are answered from the
list, never by loading every thread; under E2EE the server cannot count unread messages by reading
them, so it has to be a column on the row, and the client has to ask for it that way.

Both are `createResource`. The list's source is the `ChatScope` (who I am, who I have blocked), so
blocking somebody refetches it rather than filtering a stale copy. The thread's source is the open
conversation id, and returning `null` while nothing is open is the framework's documented way to
skip a fetch — which is why `messages()` is `[]` on the chats list rather than the last thread you
happened to visit. `chat.page.azeroth` calls `openThread` in an effect and `closeThread` on
teardown; no page loads anything by hand.

**A failed fetch keeps the data it already had.** `createResource` retains the last resolved value
and reports the failure alongside it, so the failure SCREEN is gated on having nothing to show
(`failed && all.length === 0`). A dropped connection must not blank a list that is still perfectly
readable — the connection banner is what says the network is the problem.

**`chats.page` filters what the list row holds** — the title and the last message — and its search
box says "Search conversations" because that is what it does. Full-text search over messages is
`search.store.ts`, and it reads `chat.archive()`: the messages THIS DEVICE holds. That is the
honest shape for E2EE, where a server-side message index cannot exist, and it is the one call site
PR 15 changes when the archive becomes the locally decrypted one.

**Sending is not optimistic yet.** `send` posts to the source and revalidates, so the message
appears when the source acknowledges it. With a local source that is the same microtask.

**Do not put `await import()` inside a spec.** Resolving a module mid-run races the other workers
resolving `@azerothjs/testing` through its junction, and `npm run test:shuffle` starts failing
three or six FILES at a time with `Failed to resolve import` — a resolution error that looks
nothing like the isolation bug the gate is meant to catch. Import at the top of the file.

## The chat wire format — `nura-e2ee/v1`

Written down before any of it is implemented, because a wire format decided while coding is a
wire format nobody can review. `GET /api/meta` reports the version the client must speak.

**Only user-authored text is sealed.** A message is one of four kinds, and the line is absolute:

| kind | body | who can read it |
|---|---|---|
| `text` | ciphertext | the conversation's member devices |
| `system` | `{ key, params }` | the server — it authored it |
| `invite` | `{ key, params }` | the server — it authored it |
| `result` | `{ key, params }` | the server — it authored it |

The server generates the last three, so it must be able to read them; they are structured data
rendered through the message catalogue at display time, never prose. That also fixes a real defect:
the hardcoded bilingual strings in `chat.store.ts` today cannot follow a language switch.

**Keys.** One AES-256-GCM key per `(conversation, epoch)`. An epoch is a frozen set of member
devices; any membership change mints the next one. The epoch key is wrapped once per recipient
device over ephemeral ECDH P-256. Each message is sealed under a per-sender key derived from the
epoch key by HKDF and signed by the sending device with ECDSA P-256 — members share the epoch key,
so without a per-message signature any member could forge another's line.

There is no ratchet. Forward secrecy is epoch-coarse and post-compromise security arrives only at
revocation. Both are stated in the privacy copy rather than implied away.

**Device identity** is client-derived and self-certifying:

```
deviceId = base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)
```

so the server cannot mint an id for keys it does not hold. A device is authorised by a SIWE-shaped
`personal_sign`, with an ERC-1271 `eth_call` branch for contract wallets. Guest accounts have no
wallet, so their devices are `attested: 'server'` — and `attested` is a REQUIRED prop on the trust
badge, so a server-asserted device cannot be rendered as wallet-verified by forgetting to say so.

**The envelope**, with its AAD fields joined by `` in exactly this order:

```
'nura-e2ee/v1' ␟ 'msg' ␟ conversationId ␟ epoch ␟ seq ␟ messageId
               ␟ senderAccountId ␟ senderDeviceId ␟ kind ␟ clientAt
```

Binding `kind` stops the server relabelling a fabricated row as a person's words; binding
`clientAt` stops it re-dating one; binding `senderDeviceId` stops it re-attributing one.

**No wallet-signature-derived backup key.** A deterministic `personal_sign` over a fixed string is
an unrevocable, phishable, remote skeleton key to the entire archive. Recovery is a *generated*
120-bit phrase only; a user-chosen passphrase is refused, because PBKDF2 is the only KDF
`SubtleCrypto` offers and it is weak enough against GPUs that a human-chosen phrase is a real
break.

**No plaintext key bytes at rest.** Keys are non-extractable `CryptoKey`s; IndexedDB holds vault
ciphertext. The honest claim is *"no key bytes at rest"*, not *"key bytes never exist"* — they
exist in memory at three moments (minting, wrapping, backup) and the buffers are zeroed after.

**What the server still sees**, stated rather than buried: who is in a conversation, who sent a
message, when, and how large it was. E2EE hides content, not the social graph.

**What it costs**, and these are consequences, not regrets: no server-side message search — the
index is per device, over the archive that device can decrypt; push notifications are contentless;
moderation sees only the excerpt a reporter chooses to disclose; a device that loses its keys and
its recovery phrase cannot get the history back, and the UI says so plainly rather than showing an
empty thread.

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

**The session belongs to the server.** It is a row in `sessions` addressed by an HttpOnly cookie
the browser cannot read, and identity is whatever `GET /api/auth/me` says it is.
`stores/session.store.ts` is a CACHE of that answer, never the source of it. The version this
replaces kept the answer in `localStorage` and trusted it, which meant editing one key in devtools
impersonated anyone.

`lib/guards.ts` is therefore a **courtesy**, not the enforcement: it exists so a signed-out visitor
lands on `/sign-in` instead of on a page of empty states. The enforcement is `requireSession` in
`server/src/http/auth.ts`, which answers 401. Both guards await `session.ready()`, which resolves
after the first `/auth/me`; one request on boot, every navigation after it synchronous. They reach
the store through a **dynamic import** — see Performance for why that import must stay dynamic.

Three ways in, and the account says which one was used through `kind`:

- **Wallet** (`kind: 'wallet'`). `stores/wallet.store.ts` asks an EIP-1193 provider for accounts,
  switches to NuraChain when `data/chain.ts` is configured, then asks the SERVER for the message
  to sign. The client never composes it: every field in an EIP-4361 message — the domain a
  signature is valid for, the chain, the moment, the nonce — is a claim the server relies on when
  it verifies, so a client that writes its own is a client that can sign "for" somewhere else. The
  signature goes back and is CHECKED (`viem`'s `verifyMessage`, with an ERC-1271 `eth_call`
  branch for contract wallets). The version this replaces awaited `personal_sign` and threw the
  result away, which made the whole prompt theatre.
- **Guest** (`kind: 'guest'`). A typed name, no proof of anything, and the actual onboarding for
  most people. `handleFromName` folds the name into a handle.
- **Demo** (`kind: 'demo'`). The three personas the sign-in page offers for exploring are REAL
  seeded accounts (`DEMO_SEEDS` in `seed-reference.ts`), reachable only through `POST /auth/demo`,
  which matches on `kind = 'demo'` so the route can never be a way into a real person's account.
  Their handles are in the `RESERVED` set, which is what lets the seed own them; `identity.spec.ts`
  fails if a persona is added without reserving its handle. The seed's `on conflict` carries
  `where users.kind = 'demo'` as well, so it is structurally incapable of converting somebody's
  account into a shared one.

**The nonce is single use, and it is burned FIRST.** `signInWithWallet` runs a conditional UPDATE
that only matches an unconsumed, unexpired row and takes the stored message from its `returning`
clause. Two requests replaying one signature race in the database and exactly one wins. Verifying
first would leave a window where both passed.

**A handle is claimed by INSERT, never by "check then insert."** `insertUser` loops over
`candidatesFor` and lets the unique index arbitrate, moving on only for a genuine 23505.

`personFor` in `stores/account.store.ts` turns the server's account into the `Person` the app
renders: identity from the account, and — until the profile and social domains land — statistics,
achievements and a favourite game from the mock dataset, joined on the handle for a `demo` account
only. The four mock-backed stores read `account.user()?.id`, not the raw account id, because that
join is what keeps a demo tour's friends and chats attached to it.

Chain details come from `VITE_NURA_*` env vars (see `.env.example`); with none set the app signs
in on whatever network the wallet is already on and skips the switch. Real verification makes the
chain env mandatory — a SIWE message must carry a decimal `Chain ID`, never a chain name.

`lib/wallet.ts` discovers providers through **EIP-6963** and falls back to `window.ethereum`.
It does not believe `isMetaMask` — any injector can set that flag — so with no announcement it
takes the first injected provider, and `walletName(null)` says "Browser wallet" rather than naming
a wallet that is not installed.

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
| initial JS, gzip | < 60 KB | 52.4 KB |
| three.js chunk | lazy | 160.9 KB gzip, after first paint |
| `/app` shell + page | lazy per route | 12 KB gzip shell, 1–15 KB per page |
| GLB kit + textures | < 4.5 MB | see `npm run assets` |
| game card art, 640 | < 60 KB each | 15–28 KB |
| game hero art, 1280 | < 110 KB each | 40–70 KB |
| kit triangles | — | ~190k, ~20% of it instanced figures |

The `/app` tree is kept out of the landing's initial payload by three things, all of which must
stay true: the `/app` layout route is `lazy`, the app message catalogue is registered by
`locales/app-catalogue.ts` which only the shell and sign-in import, and **`lib/guards.ts` imports
`session.store.ts` dynamically**.

That third one is not a size optimisation. Route guards are named in `routes.ts`, so `guards.ts` is
eager; a static import there would drag `api.ts` into the landing chunk, and `api.ts` has a
TOP-LEVEL await that reads the route manifest. `mountPages` embeds that manifest in a page it
renders, but the landing is `render: 'static'` and prerendered to a file — no embed — so the client
falls back to fetching `/api/_manifest`. A page whose whole promise is that it paints with no
JavaScript and no server would have opened a request to the server on every visit. The dynamic
import moves the whole typed client behind the first guarded navigation, where the app chunk is
loading anyway. `tools/qa` does not catch this; the browser pass asserts the landing makes no api
call at all.

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
