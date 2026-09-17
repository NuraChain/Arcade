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
npm run schema:sync    # build the schema from the entities (dev does this on every boot)
npm run assets         # rebuild the GLB kit from tools/blender (needs Blender 5.2)
```

`npm run check`, `npm test`, `npm run test:shuffle` and `npm run qa` must all pass before a
change is done.

**Run `npm run check`, never `azeroth check` on its own.** The gate is
`azeroth check && npm run check:tests --workspace server`, and the second half is a whole
tsc program over `tests/` that the first half never looks at. Skipping it is not a smaller
gate, it is a different one: vitest transforms specs with oxc, which strips types without
checking them, so a spec can import a name that does not exist and still "pass" - which is
exactly how `realtime.socket.spec.ts` came to compare every frame against `OPCODE.TEXT`
(undefined), match nothing, and report eight green tests while reading no frames at all.

`npm test` runs with **no Postgres**, and that promise is why the database-backed suite is opt-in:
`npm run test:db --workspace server` with `TEST_DATABASE_URL` pointing at a database you do not
mind losing. It truncates before every test, so it owns whatever it is pointed at - which is also
why it runs `--no-file-parallelism`: two spec files truncating the same tables from two workers
deadlock each other, and the failure reads like a product bug rather than a test one. Everything that
is a claim about the DATABASE lives there - mirrored writes, partial unique indexes, CHECK
constraints, the races - because a fake DataSource can only prove that the fake agrees with the
code.

**The database is Postgres, and the ENTITIES are the only description of it.** `server/.env`
carries `DATABASE_URL` and is the one place the name is written down; `tools/qa/db.mjs` reads it so
the browser passes cannot drift from the server the way they once did. There are no migrations.
`server/src/db/schema.ts` builds the schema with `syncSchema()`: the `citext` and `pgcrypto`
extensions, then TypeORM's `synchronize()` from the entity metadata, then the six indexes no
decorator can express. `main.ts` runs it on every boot IN DEVELOPMENT ONLY; production gets
`npm run schema:sync --workspace server`, which is the same code as a deliberate act rather than a
side effect of starting.

**That only works because the entities are complete**, and making them complete was the work. They
carry 56 `@Check` constraints, 43 relations with their `onDelete` rules, every default, every
unique and every expressible index. Three tests hold it there, all in `npm run test:db`:

- `schema.db.spec.ts` compares what `syncSchema` builds against `tests/schema-snapshot.json`, which
  was recorded from a database built by the migration sequence on the day the migrations were
  deleted. Tables, columns with types/nullability/defaults, CHECK expressions, foreign keys with
  their delete rules, primary keys, uniques and index SHAPES. Names are deliberately not compared
  for primary keys and uniques, because TypeORM calls what it generates `PK_<hash>`/`UQ_<hash>`; the
  six hand-built indexes keep their real names and are asserted by name.
- `converge.db.spec.ts` proves a second sync has nothing to do beyond two wrinkles it lists by
  name, so a THIRD one appearing fails. The two: TypeORM drops the five DESC indexes it cannot
  express (and `syncSchema` rebuilds them afterwards, which is why its order matters), and
  `conversation_members.last_read_at` re-issues its default because TypeORM compares defaults as
  strings and Postgres renders `to_timestamp(0)` back as `to_timestamp((0)::double precision)`.
- `naming.db.spec.ts` proves the database stores every handle and slug the product accepts.

**`uuidExtension: 'pgcrypto'` is on the DataSource and is not decoration.** Without it TypeORM
generates `uuid_generate_v4()` and the schema silently acquires a dependency on `uuid-ossp`.

**The entity graph has to stay acyclic.** Relations are owning sides only - `@ManyToOne`, and
`@OneToOne` where the foreign key IS the primary key (`game_rules.game_id`,
`recovery_vaults.user_id`). There are no `@OneToMany` inverses: two entity modules importing each
other is `ReferenceError: Cannot access 'X' before initialization` at load, which is what adding
`Table.chairs` and `ConversationEpoch.keys` produced. Nothing read them, and the owning sides alone
carry every foreign key.

**Six indexes are built by hand and always will be.** `friend_requests_pending_pair` is UNIQUE over
`LEAST(from_user, to_user)`/`GREATEST(...)` where the request is unanswered - a functional index,
and the only thing stopping A asking B while B is asking A from becoming two rows for one
intention. `messages_keyset`, `notifications_keyset`, `reports_against`, `groups_public` and
`tables_open` each order a column DESC, which `@Index` cannot say. `synchronize()` therefore drops
all five every time, and `syncSchema` recreating them afterwards is the whole reason it exists
rather than a bare call.

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
server (`QA_BASE=http://localhost:<port>`). The server run is the stronger one — it exercises
`mountPages`, the prerendered landing page and the real asset headers, which vite does not.

**Give the built server its own port rather than 3200.** 3200 is the development api's, and other
projects on this machine reach for it too, so `npm start` there fails with `EADDRINUSE` — or worse,
answers 200 from something that is not this product at all, which reads as a passing gate until
somebody looks at the title. `PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 …` and the matching
`QA_BASE` is what recent runs use; `PUBLIC_ORIGIN` has to move with it or the realtime origin gate
refuses every socket and each refusal is one console error the matrix cannot suppress.

Run it against the BUILT server when the result has to be trustworthy. Under `npm run dev` the
conductor restarts the api whenever `dist/` is rewritten — a `npm run build` or `npm test` in
another terminal is enough — and every restart costs the matrix one cell: vite answers the
in-flight `/api/_manifest` with a 502, the page boots without its data, and the header controls
fail the 44px check in their pre-hydration state. Three runs in a row each lost exactly one cell
that way, each time to a different route. The same matrix against `npm start` is 600/600.

It needs the **api** either way, because it signs in for real: the whole EIP-4361 round trip as the
`dana.w` wallet fixture — fetch the challenge, sign it, post the signature — and every context is
built from the resulting `storageState`. There is no session key it could write into `localStorage`,
the cookie being HttpOnly, and a matrix run against a database the wallet seed has not touched fails
on the first line rather than touring 640 signed-out pages.

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

## The framework defect register

**`framework-bugs.md` is not in this repository.** It is a register of defects in a DEPENDENCY,
not part of this product, and it lives on the desktop
(`C:/Users/IntelligentQuantum/Desktop/framework-bugs.md`). `.gitignore` holds the name so it
cannot come back by accident. Nothing goes in it without a minimal reproduction proving the
framework is responsible, and a suspicion that turns out to be ours goes in its "NOT framework
bugs" table so nobody re-investigates it.

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
  data-source.ts   the single DataSource export
  db/schema.ts     syncSchema: extensions, synchronize, the six hand-built indexes
  env.ts logger.ts entities/ domains/ realtime/ jobs/ lib/
```

**The client-safe triangle is load-bearing.** `application/src/api.ts` does
`import type { Api } from '../../server/src/api.ts'`, which pulls `api.ts`, `schemas.ts` and
`ports.ts` into the WEB typecheck program — and that program is `application/tsconfig.json`, which
has no `experimentalDecorators`. One entity reached from those three files, even as a type, is
parsed as an ES decorator instead of a legacy one and fails `azeroth check`. That is why route
handlers are **injected** through `Ports` rather than imported: `api.ts` names what it needs,
`services.ts` provides it, and the decorated half never crosses the line.

**TypeORM is on 1.x.** The major was taken behind its two canaries and both were green without a
source change: `decorator-metadata.spec.ts`, which pins entity registration, `design:type` metadata
and class fields staying off the instance - precisely the surface `experimentalDecorators` +
`emitDecoratorMetadata` + `useDefineForClassFields: false` rests on - and the whole 156-test
`test:db` suite against a real Postgres.

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

**The entities had drifted from the schema, and nothing could see it.** Every query in this server
is raw SQL through `DataSource.query()`, which never loads entity metadata - so an entity could be
missing a column the schema had carried for a long time and every gate stayed green.
`users.allow_stranger_messages` and `users.show_online` were absent from `User` while
`PERSON_COLUMNS` read them on every person payload; the whole franking disclosure was
absent from `Report`, whose docblock still said franking "arrives with the E2EE work"; and
`GameRule.stakes` carried a duplicate `@Column` - a stray decorator with a blank line after it - so
the property was registered twice and TypeORM silently used one of them.

None of that is cosmetic the moment anything reads through a repository, which is the direction this
server is moving. `tests/schema-parity.db.spec.ts` compares `entityMetadatas` against
`information_schema.columns` in BOTH directions and fails on a duplicate registration, because the
two failures are different: a column in the entity and not in the table is a query that breaks
loudly, and a column in the table and not in the entity is the drift above, which breaks nothing
until it matters.

**`DataSource.query()` does not return one shape, and the difference is silent.** A SELECT gives
the rows. An INSERT, UPDATE or DELETE — *even with `returning`* — gives `[rows, affectedCount]`.
So `result.length === 0` is never true for a mutation that matched nothing, and `result[0].x`
reads the rows ARRAY rather than the first row. A "did this UPDATE match?" check written the
obvious way always says yes, and the value it reads is always `undefined`. It cost an afternoon:
a sign-in that burned its nonce correctly, handed `undefined` to the signature verifier, and
reported "that signature did not match the address" for a perfectly good signature. **Every
mutating query in this server goes through `lib/rows.ts`** — `rowsOf`, `firstRow`, `affectedBy` —
and `tests/rows.spec.ts` pins all three shapes.

**What reads through a repository, and what cannot.** About thirty call sites moved to
`getRepository(X).find/findOne/insert/update/delete` - the plain ones, where the SQL was a `where`
and a column list and nothing else - and roughly a hundred and thirty did not. The ones that stay
are not leftovers, and each is doing something a repository cannot say: `FOR UPDATE SKIP LOCKED`
inside a scalar sub-query (the seat claim), `pg_advisory_xact_lock` (the double-tap, the
first-device test), `UNION ALL`, `ON CONFLICT (target) WHERE predicate` against a partial index,
`ON CONFLICT DO UPDATE SET count = notifications.count + 1`, `LEFT JOIN LATERAL` with `array_agg`,
keyset pagination by row-value comparison, the `CASE WHEN` that derives a table's `status`, and the
FROM-less select of four correlated sub-queries that exists precisely so four truths arrive as one
row.

And one whole class stays for a reason worth stating: **`now()` in a predicate**. The nonce burns,
session expiry and validity, the presence touch, the franked-message read and the expiry sweep are
all mechanically expressible as `MoreThan(new Date())`, and that is exactly why they should not be -
it moves a security window onto the Node process's clock while the matching predicate elsewhere in
the same feature still runs against Postgres `now()`. Session validity, nonce replay and
disappearing-message lifetime are not places to introduce clock skew.

Anything inside a transaction uses the callback's `EntityManager` (`tx.getRepository(X)`), or
`runner.manager` for `epochs.ts`, which is the one bare `QueryRunner`. A global repository checks
out a DIFFERENT pooled connection, so the write would land outside the transaction and outside its
locks - which for the seat claim means outside the advisory lock, and for the epoch mint means
outside the primary key that arbitrates the race.

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

## The schema, and reference data

Two things that look alike and are not.

**The SCHEMA** is the entities. Changing it means changing an entity and re-recording
`tests/schema-snapshot.json` - deliberately, as its own commit, so the change is visible rather than
absorbed. The check to run afterwards is the real one: drop the database, boot, and let `syncSchema`
build it from nothing.

**There is no legacy database anywhere.** Every database is built from the entities against an empty
one, so nothing can meet rows from before. A backfill that repairs rows "from before" is code
describing a database that does not exist - the attestation work carried one for exactly one
afternoon and it is gone, along with every migration.

**Watch for backticks in a `@Check` expression - inside a template literal they end the string.**
This has now cost five afternoons. The symptom is never what it looks like: the string terminates
at the backtick and the rest becomes a JavaScript expression, so you get a bare
`ReferenceError: <identifier> is not defined`, or `TS1002: Unterminated string literal` pointing at
a line that reads fine. `users_handle_shape` and `groups_slug_shape` both needed a backtick in a
character class and both broke this way; they avoid it now by checking those characters with
`strpos` instead.

**A shape CHECK must not use POSIX character classes.** `[[:alnum:]]` is evaluated against the
database's ctype, which is ASCII here - so `users_handle_shape` and `groups_slug_shape` refused
every Persian handle and every Persian slug while `checkHandle`'s own `/^[\p{L}\p{N}]/u` accepted
them. A Persian guest sign-up was a 500 on the main onboarding path, and CLAUDE.md describes Persian
slugs as a feature. Both are denylists now: length, no whitespace or control characters, no leading
or trailing separator, and none of the characters that break a URL path segment. That accepts any
letter in any script without the database having an opinion about which alphabets exist, and
`naming.db.spec.ts` holds the two halves together.

**An `on conflict` target must IMPLY the partial index's predicate**, or Postgres cannot work out
which index arbitrates and raises 42P10. `conversations_group_one` is partial on
`kind = 'group' and group_id is not null`, and an upsert stating only the first half fails. The
same rule bit `push_subscriptions`: the entity never declared `unique: true` on `endpoint`, so a
synchronized schema had no constraint for `on conflict (endpoint)` to find and every push
subscription was a 500.

**Reference data** is content the product cannot run without: the games, their rules, the
achievement definitions, and the three demo personas. `server/src/db/seed-reference.ts` upserts it on every boot, so a changed
blurb ships without a schema change. It is not development fixtures — those are a separate file that
refuses to run outside development.

A seed that upserts into a table real people also write to needs a guard, and the demo personas
were that case: their `on conflict (handle)` ended in `where users.kind = 'demo'`, because without
it a deploy would silently convert whoever had claimed `alex` into a shared account anyone could
sign into. That was not hypothetical — it happened in development the first time that seed ran,
against an account that had claimed `sara.k` minutes earlier. The personas are gone and so is the
guard, but the shape of the mistake is worth keeping: a seed that writes into a table people also
write to needs to say which rows are ITS rows.

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
and every one of them is a handle. What is left of the browser's mock is a NAME cache - a display
name, a bio and a hue for people no domain owns yet - and nothing more.

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

**The client's person id IS the handle.** `personFor` in `people.store.ts` sets it from the handle
and the wire speaks handles wherever it names somebody — a conversation's members, a message's
author. The one exception is `nura-e2ee/v1`, which binds the account UUID because a signature has to
name something a rename cannot change; see *The sealing*.

The alternative was projecting the server's uuid and re-keying the browser at boot, which needs
every `personById` call site to be correct across an async window where the ids change underneath
it. A handle is already the public identifier, already the URL key, and already unique
case-insensitively in the database. The one thing it is not is immutable - somebody can rename
themselves - and the answer is that a rename refetches, which is what the client does anyway.

The server still keys everything on uuid internally. Handles are the EDGE.

## Groups

`server/src/domains/group/` owns them, and three of its rules are INDEXES rather than application
code — because each one is a state that has to be impossible, not merely unlikely.

**The slug is claimed by INSERT.** `groups.slug` is `citext` and unique, and `create` walks
`candidatesFor` letting the index arbitrate, moving on only for a genuine 23505 — the same shape
as the handle claim, sharing `lib/naming.ts` with it. "Check then insert" is the same race with
extra steps, and two people making "Friday Night Crew" in one second is the case it has to
survive. `groups.db.spec.ts` runs five at once and expects five distinct slugs.

A slug hyphenates where a handle strips: "Friday Night Crew" is `friday-night-crew`, and Persian's
zero-width non-joiner becomes a hyphen so `تخته‌نرد` reads as `تخته-نرد` rather than gluing two
words into one. A name with nothing claimable in it — all emoji — folds to the empty string and
the service falls back to a word the product owns rather than inventing one.

**The slug does not move when the name changes.** A url that changes because somebody edited a
name is a url that breaks every link they shared. `edit` takes the whole editable surface and
never the slug.

**The owner is a ROLE on the membership row**, with a partial unique index over
`(group_id) where role = 'owner'`. An `owner_id` column on the group would let a transfer that
promotes before it demotes leave two owners behind — a state nobody notices until one of them
removes the other. This makes it unrepresentable, so `transfer` demotes FIRST inside one
transaction or fails.

**One conversation per group**, enforced by a partial unique index on
`conversations (group_id) where kind = 'group'`. Membership moves in lockstep: joining a group
seats you in its thread and leaving takes the seat back, both inside one transaction. A member who
is not in the thread cannot read what the group is saying, and a thread member who is not in the
group keeps reading it after they leave.

**The last member out takes the group with them.** An empty group is a row nobody can ever see
again. An owner who leaves a populated group hands it to the longest-standing remaining member —
which keeps the single-owner index satisfied — and the handover is ANNOUNCED with a line, so it is
visible rather than silent.

**A group is public or private, and private means it does not exist to anybody outside it.**
`groups.privacy` is two levels, and the rule is the chat domain's: a private group answers a
non-member exactly as a group that was never made - 404, "No such group." - rather than 403, because
a 403 confirms it is there and the point is that a stranger cannot tell a closed door from a typo.
One predicate, `VISIBLE_TO`, is shared by `bySlug` and `byId` so the rule cannot be applied to one
read and forgotten on the next; `discover` filters on the constant half; `join` needs no code at all,
because it already refuses what it cannot see. `mine` is deliberately untouched - it joins through
`group_members`, so membership already is the WHERE clause.

TWO levels, not three. `tables` carries `friends` as well and **no query has ever read it**: `open()`
filters on `public` strictly, so a friends table is invisible to friends too. That is a setting that
lies to whoever picks it, and `groups_privacy_known` is a CHECK so a third cannot be added here
without a WHERE clause to go with it.

**The column has NO default, and that is the interesting line.** Postgres materialises a column
default into every existing row at `add column` time, which is exactly the backfill this file forbids
elsewhere - so a default would be the forbidden thing wearing a different hat. The consequence is
real and is the documented one: a development database that already holds a group refuses the
column rather than quietly deciding for it, and the answer is to rebuild from nothing.
`groups.db.spec.ts` pins both halves - an insert naming `friends` is refused, and an insert naming no
privacy at all is refused - so neither decision can decay into a comment.

**Closing the doors writes a line.** `chat.line.group.closed` and `.opened`, for the reason the
expiry lines exist: a rule about who can walk in is not something to change behind the room's back,
and a member who does not know cannot tell "we went private" from "nobody is joining any more".

**Adding somebody is gated twice, and the two are different questions.** The server asks
`mayMessage`, because putting a person in a group is writing into their chat list and that is the
act the messaging policy already governs — blocks, stranger settings and minor safety all apply
without a second opinion. The UI offers only friends, which is narrower on purpose: a group is
somebody's room, and being put in one by a stranger with open settings wants an invitation rather
than an addition. The server's rule is the floor; the picker is the door.

**`LINE_KEYS` grew by six, and every one has a producer.** `created`, `joined`, `left`,
`removed`, `renamed` and `owner` are written by the group half of `services.ts`, and
`tests/lines.spec.ts` reads that file to prove it — the rule that a key without a producer is
filler copy, as a test rather than a convention. The line is written OUTSIDE the transaction that
changes the membership: the membership is the fact and the announcement is the courtesy, so a
failed line must not undo a completed change. Leaving writes its line BEFORE the seat goes, or it
lands in a thread the writer has just been removed from.

**A group is named by its SLUG on the wire**, the way a person is named by their handle — including
`conversationSummary.groupId`, which carries the slug and not the uuid. One identifier at the edge
means a link, a route parameter and an api call are all the same string.

**A slug nobody has claimed is an answer, not a failure.** `groups.store.ts` turns a 404 from the
view route into `null`, so the page says "No such group" rather than offering to retry the same
missing thing. Every other status still surfaces as an error.

**A group is a row, and nothing in the browser holds a copy of one.** `GROUP_FIXTURES` in
`application/tests/fixtures.ts` is what the browser specs arrange, and nothing else reads it. The
crest is a closed set the CLIENT owns (`data/crests.ts`): the server sends a string, `Icon` takes an
`IconName`, and a value from a newer server draws the first crest instead of a blank square.

Two things the browser pass caught that no type could:

- **`SectionHeading` took no children**, so a heading written with a button inside it rendered the
  heading and dropped the button — silently, on two pages at once. It takes `actions` now, the
  same named slot `FriendRow` uses, and `components.spec.ts` pins it.
- **The group page opened itself from an `effect` over `params()`.** A route parameter is shared
  router state, so the effect fired again on the way out with the NEXT route's id in hand — asking
  the groups api for a conversation id and putting a 404 in the console on every navigation away.
  It opens once in `mount` and closes in the teardown.

## Tables

A table is a SEAT CONTAINER. It opens, people sit down, and it stops there — there is no game
engine behind it and nothing in the domain pretends there is. Whatever plays the hand plugs in
here and reads the seats.

**Seats are rows, created empty with the table.** That is what turns "claim a seat" from a read
followed by a write into a single UPDATE the database arbitrates:

```sql
update table_seats set user_id = $2, joined_at = now()
 where table_id = $1
   and seat = (select s.seat from table_seats s
                where s.table_id = $1 and s.user_id is null
                  and (s.invited_id is null or s.invited_id = $2)
                order by (s.invited_id = $2) desc nulls last, s.seat
                limit 1 for update skip locked)
   and user_id is null
returning seat
```

`skip locked` is the whole trick: two people arriving in the same instant lock DIFFERENT rows, so
both succeed while two chairs are free and exactly one succeeds when one is. The outer
`user_id is null` is the belt — a row taken between the lock and the write matches nothing.
`tests/seat-race.spec.ts` fires ten claimers at three chairs and expects three seated and seven
told no, with no two in the same chair.

**One person racing themselves is a different problem, and it took three attempts to see it.**
Two requests from one account both find the table empty of them, and then either the partial
unique index `table_seats_one_per_person` refuses the second (23505) or — worse — the second
finds every free chair momentarily LOCKED by the first and concludes the table is full. Neither
is true, and a double tap must answer with the chair they are sitting in. The fix is
`pg_advisory_xact_lock(hashtext(tableId), hashtext(userId))` as the first statement in the claim:
two requests from ONE person serialise, different people never contend, and the lock releases with
the transaction whichever way it ends. Five consecutive clean runs of the race suite is what
"fixed" meant here; two out of three was not.

**A seat claim answers 200 with no seat, never an error.** Two people reaching for the last chair
is ordinary. A 409 would make the loser's client show a failure for something that simply
happened, and the client says "somebody took the last chair first" instead.

**`status` is derived where it is read**, not written beside the seat:

```sql
case when t.status = 'closed' then 'closed'
     when (count of occupied chairs) >= t.seats then 'ready'
     else 'open' end
```

`closed` is a decision somebody made and lives in the column; open-versus-ready is a fact about
how many chairs are full, and a stored copy of a derivable fact is a copy that goes stale the
first time a seat moves down a path that forgot to update it. It did, in the browser pass.

**`ready` means every chair is taken. It does not mean playing.** The furthest a table gets is
full, and the page says so in as many words: *"Every chair is taken. The game itself is still
being built — until it is, the table holds your seats and the chat stays open."*

**The server decides what a table may BE, and for a while it did not.** `isValidTable` lives in the
browser and is a courtesy to the person filling the form; `create` believed whatever it was handed,
so a caller could open a three-seat hokm table or a `turns` table for a game that only runs live.
That is worse than it sounds, because `status` is derived from occupied chairs against `t.seats`: a
table with a seat count its game does not play is one nothing downstream can question. `create` now
reads `game_rules` and refuses the seat count, the mode and the target; `cube` and `blinds` are
NORMALIZED rather than refused, because the form sends both on every table - they are fields on one
config object, not claims about the game.

It caught a live bug the moment it existed: `lobby.quick()`'s fallback config was a literal four
seats, so quick-matching backgammon - which plays two - had always asked for a four-seat table. It
asks `catalogue.defaults(game)` now.

**A wire field that reaches a bounded column says so in `schemas.ts`.** `crest` is `varchar(24)`,
`hue` is `smallint`, `blinds` is one of three levels - and none of that was stated, so an over-long
crest or an out-of-range hue reached Postgres and came back as 22001 or 22003, which is a 500. Any
signed-in caller could produce one. That is the same defect class as the 22P02 `membership()` fixes
by checking a uuid's shape before comparing it, and the fix belongs in the same place the wire shape
is already decided once.

**Nothing builds a url out of a promise.** `lobby.quick` and `lobby.host` answer with a PROMISE of a
table id, and a template literal will happily call `toString` on one - so
`navigate(\`/app/play/${ lobby.quick(game) }\`)` compiles, lints, and sends somebody to
`/app/play/[object%20Promise]`. Eight call sites did exactly that, which was every Play and
Quick-play button in the product outside the home page. `npm run qa` tours routes by url and never
presses a button, so no gate could see it. `lib/open-table.ts` takes the promise as an argument -
the caller never holds the id, so the broken form cannot be written - and owns the refusal, which
eight `void`-less calls had nowhere to put. `tests/markup.spec.ts` reads the source and fails if one
comes back.

**Every control on the table page is a `Button` with words on it.** Three of them were not, and each
failed differently. "Take a seat" - the whole point of the watching panel - was an `IconButton`,
which is icon-only with a tooltip, so the primary action of that screen was a bare chair glyph.
Closing the table and showing the chat were hand-spelled `<button>`s with their own class lists.
And the Leave button carried `text-madder` in `props.class`, which lost to the ghost variant's own
`text-muted` - two `text-*` utilities from one layer, decided by CSS source order and not by the
class attribute - so the class had never applied and the button had never been red. Leaving and
closing are both `variant="destructive"` now, which is `danger`: the same red, from the shared
variant, rather than a colour a caller appends and hopes about.

**Matchmaking is a query.** `quick(game)` reads the open public tables for that game, claims a
chair at the first one that still has one, and opens a table to wait in only when there is nothing
to join. Nobody is invented to fill it.

**The table's chat is the chat domain.** A table owns a `kind: 'game'` conversation, one per
table by partial unique index, and membership moves with the seats inside the same transaction —
sit down and you are in the thread, stand up and you are out. The version this replaces kept a
private list of invented lines in the lobby store, which was a second message system with its own
membership rules, its own watermark and its own future sealing problem.

It follows the thread the same way the chat page does, through `lib/stick.ts`, and for the same
reason: it used to read `chat.messages()` for the subscription and then scroll unconditionally, so
every change yanked the panel to the bottom - including a revalidation, which is what a realtime
nudge causes. Scrolling up to re-read a line while a table was talking was impossible. An empty
table chat also says `chat.empty` rather than showing a void, which is the state every table is in
until somebody speaks.

**What was deleted, and why it had to be.** The lobby store was a simulation: it invented
opponents on a timer (`planCandidates`), typed their small talk from a script (`planChatter`),
rolled dice nobody threw (`RollEntry`), and declared a winner nobody beat (`planFinish`). With
it went `lib/matchmaking.ts`'s seven-phase reducer, `MatchmakingPanel`, `ResultPanel`,
`RollLog`, `TablePlaceholder`, `LobbyNotices`, and thirty-seven catalogue keys. Six of the seven
phases described things that do not happen; the seventh — people in chairs — is the whole product
now.

**The provably-fair claim is gone, column and all.** `game_rules.fairness` said `dice` or
`deal`, and the UI turned that into two sentences: every roll committed before it is shown and
logged for every seat, every deal shuffled from a seed both sides can check. Neither was true and
neither was designed — the cryptography this product has specified is `nura-e2ee/v1`, which is
about messages. A claim about fairness is what a player leans on when they lose, and shipping it
ahead of the mechanism teaches people that the product's assurances are marketing.
The column is gone from the entity; `tests/lib.spec.ts` now asserts the key is ABSENT,
so it cannot come back without the mechanism. `stakes: 'play-money'` stays: that is a fact about
a table, not a promise about a random number.

## Playing a game

`server/src/domains/match/` is the first real game engine in this product, and it is what the table
domain always said it was stopping short of. A table is still a seat container; a **match** is one
game played at one, and the two are joined by `matches.table_id` with a partial unique index over
`(table_id) where finished_at is null` - one live game per table, enforced rather than assumed.

**The board is not invented, it is read off the art.** `tools/blender/lib/atlas.py` has drawn the
Ludo field since long before any of this, and `tools/blender/assets/set-ludo.py` builds the GLB from
the same 15x15 grid: 72 painted track cells, minus the four five-cell home columns, is the standard
52-square ring; `starts` gives each colour its entry; eight cells carry a star and are safe.
`ludo/board.ts` derives all of it by walking segments and `tests/ludo-board.spec.ts` re-derives the
art's own literals to compare, so the squares a token walks and the squares underneath it cannot
drift apart.

One trap, recorded because it costs nothing to avoid and an afternoon to find: `set-ludo.py` ALSO
carries `track_spots`, and those are not the entry squares - they are where the 3D model parks its
loose tokens for the market scene, two cells off. Taking the wrong dictionary would put every
token's entry beside the star it is drawn on, and nothing anywhere would fail.

**The engine is pure, and that is enforced rather than intended.** `ludo/` imports nothing but
itself: no `typeorm`, no `node:`, no clock, no randomness. `tests/ludo-purity.spec.ts` reads the
directory as text and fails on any of those tokens, which is the same technique
`realtime.socket.spec.ts` uses for "nothing in onConnection may await" - a deterministic test beats
an atmospheric one. Three things follow, and each is the reason: the rules run in the default
`npm test` with no Postgres, the same function can later run in the browser for move highlighting
without dragging a decorator into the web program, and a game is replayable because the same state
and the same die always give the same result.

**`apply` never throws.** A refusal is a value - `{ ok: false, reason }` over a closed union - so the
service maps reasons onto statuses in one place and the timeout sweep can fold actions over a state.
A pure function that throws for ordinary control flow is one nothing can fold.

**The engine never sees a uuid.** It is handed a seat number and answers with one. `match_players` is
the only join between a seat and a person, which turns "you cannot move somebody else's token" into
a lookup rather than a rule somebody remembers to write.

**One engine plays two, three and four.** The seat count chooses which of the four colours are in
play and nothing else; the rotation is over the players array, so the board never knows how many
there are. Two players take opposite quadrants - twenty-six squares apart, so neither starts a walk
behind the other. `game_rules.seats` for ludo is `[2, 3, 4]`, and `reference-parity.spec.ts` is what
stops the client's fallback disagreeing.

**The ruleset is written down, and four of its clauses are where a generic Ludo goes wrong.** It is
Variant B - the common Iranian rules - and every one of these was wrong in the first engine:

- **Own tokens share a square and never block each other**, on the track and in the home lane alike.
  There are no barriers; a token moves through an occupied square freely.
- **A six with no legal move still earns the extra roll.** Only a non-six with nothing to do ends the
  turn.
- **There is no "three tries to find a six".** A full yard rolling one to five simply passes. That
  rule belongs to other variants and was invented here.
- **Entering is a choice**, not an obligation: any yard token may come out on any six, with no
  requirement to finish a previous one first.

The rest is the ordinary game and is worth stating because each half is a test: capture happens on
exact landing only and never by passing over; the eight starred squares send nobody home; the five
home cells need an exact count, and an overshoot is simply absent from the legal set rather than
refused after the fact; three consecutive sixes end the turn and the third grants no roll; a capture
or a finish on a six still earns the roll.

**The logical board is the authority and the renderer only draws it.** Collisions compare logical
positions, never pixels, and an animation may interpolate but the final logical state always wins.
That is the same split `ludo/` already enforces by importing nothing at all.

**A client asks for two things and neither names a destination.** `POST /matches/:id/roll` carries no
value at all, and `POST /matches/:id/move` names one of the caller's own tokens - the server computes
where it lands from the die it drew itself. There is no field anywhere on the way in that carries a
dice result, and `tests/ludo-dice.spec.ts` reads `schemas.ts` and `api.ts` as text to keep it that
way.

**The die is `randomInt` from `node:crypto`, and the product says only that the server rolls it.**
Not `randomBytes(1) % 6`, which quietly favours the low faces. What cannot be claimed is fairness: a
player cannot check that the server did not draw twice and keep the one it liked, because the process
that draws is the process that records. That is exactly the claim `game_rules.fairness` was deleted
for, so `ludo-dice.spec.ts` also fails on the words *provable* and *verifiable* anywhere near this
domain. Commit-reveal is a mechanism to build before any copy changes, not a sentence to add.

**Every action is one transaction that opens with `for update` on the match row.** Deliberately NOT
the `skip locked` the seat claim uses, and the contrast is the whole point: skipping is right when a
held chair is one the claimer should look past, and wrong here, where one of four people acting at
once must win and the others must queue rather than be told nothing happened. `skip locked` returns
in the timeout sweep, where passing over a match another tick already holds IS correct.

**Two guards make a retry safe and neither subsumes the other.** The idempotency key is unique per
`(match, user, key)` and answers a repeated request with the state as it now stands - without it two
identical rolls both apply, because after a six the turn has not passed and the second is perfectly
legal. The revision precondition refuses an action composed against a board that has since moved -
without it a stale "move token 2" is still legal at the new revision, for a different reason, on a
different board. Neither is an error: `applied` is `now`, `already` or `stale`, because a retried tap
and a tap that crossed a realtime frame are both ordinary. Two values could not say which happened.

**Starting is a table verb and its preconditions live in the WHERE clause.** `POST /tables/:id/start`
inserts with `not exists`, a seat count and a readiness check all inside one statement, so there is
no window between reading a ready table and writing a match against it. That is still not enough on
its own - `not exists` cannot see another transaction's uncommitted row - so `matches_one_live`
arbitrates and a 23505 is read as "somebody else started it", which answers with their match. Any
seated player may press it: the precondition is already unanimous, so host-only would be ceremony
that strands a table whose host closed the tab.

**A table says `playing` and it is DERIVED, never stored.** `TABLE_COLUMNS` reads it from whether an
unfinished match exists, for the same reason `ready` is read from occupied chairs - and with more
force, because playing has three ways to end: a win, a timeout cascade and the host closing the
table. A stored copy would go stale the first time one of them forgot.

**Realtime gets a third scope, `game`, and this is the first one that earns it.** The objection beside
`ringTable` - that a third scope would be new vocabulary for information `chat` and `social` already
carry - is right about groups and tables and wrong about a move. `social` fans a presence snapshot to
every socket on the server and could not be afforded per roll; a `chat` nudge would hand the chat
store an id it would resolve as a conversation. It stays a doorbell: the frame carries the match id
and nothing about the move, and the client re-reads through the same route with the same
authorisation. The players ride along in the pending entry rather than being resolved at flush time,
because unlike a conversation's membership a match's seats cannot change while the frame is in the
air.

**A turn that runs out is played, not punished.** The sweep finds due matches by Postgres `now()` -
never `MoreThan(new Date())`, because the deadline was written by Postgres and a Node clock would
disagree with it - rolls or plays the lowest legal token, and bumps `timeouts`. The third miss in a
row forfeits that seat, and when forfeits leave one player standing the match ends `abandoned`. The
server's own actions are written with `user_id = null`, which is what distinguishes them in the
ledger.

**`match_actions` is an audit trail, an idempotency ledger and a catch-up feed - and NOT a rebuild
log.** `matches.state` is the authority and nothing replays those rows to reconstruct a board. A
fixed rule would change the fold, and a finished game would stop being a fact.

**`tools/qa/ludo-pass.mjs` plays complete games over the real api**, at two, three and four players,
through the routes a browser uses. It is API-level on purpose: it proves the rules, the persistence,
the turn order, the authorisation and the wire agree end to end, over hundreds of turns, in seconds.
What it cannot prove is that any of it is visible, which is the browser pass's job.

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

**`LINE_KEYS` grows when a domain starts WRITING a line, never before.** `chat.line.system` was
declared with no producer and had to be given copy - "Something changed here" - which is filler
standing in for a sentence nobody has written. It was removed; the group work adds its own keys
with the lines that actually occur.

**That shape exists for one reason, and `tests/lines.spec.ts` is the proof**: a sentence the
server authored is composed at DISPLAY time, so switching language re-renders it in place. The
version this replaces stored bilingual strings in the chat store, which could not follow a switch
at all. A message somebody TYPED does not change - words are words - and seeing both behaviours
in one thread is what the design is for.

**A list the UI renders needs an ORDER BY.** `social.mutes()` had none, so Postgres returned
whatever it found first and the settings page reshuffled between loads. It surfaced as
`social.db.spec.ts` failing the day a later schema change moved what "first" happened to mean, which
is the only warning an unordered SELECT ever gives.

**A message carries `dir="auto"`.** Fixture conversations are single-language now, so an English
sentence inside a Persian page is the normal case rather than an artefact, and a paragraph that
inherits the page direction puts its full stop on the wrong end. The direction of a message
follows its CONTENT; the direction of the UI around it does not.

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

**The browser's mock is gone.** `application/src/data/mock/` held twenty-four invented people, the
threads between them, a script of replies to type back, and a copy of the achievement definitions.
Every name on every screen came out of it - including for accounts that really exist - through
`personById`, and `account.store.ts` synthesised the rest. What replaces it is `people.store.ts`: a
cache of whatever the server has actually said, keyed by handle, where a handle nobody has described
is ABSENT and the caller renders the handle.

Two rules make that store safe to read anywhere. It only ever holds what the server sent - nothing
is derived or defaulted - and `byHandle` never fetches, so it is safe inside a `derived`; asking is
a separate `want()` the owning store calls once its own list has landed.

The chat view types moved to `data/chat.ts`, which is where they always belonged: they are the
client's view of a `ConversationSummary` and a `ChatMessage`, not fixture shapes. `Message.text` is
a plain string now, because a message is what somebody typed.

**Development fixtures are six REAL accounts.** `server/src/db/seed-wallets.ts` is the whole seed:
six wallet accounts, each holding a device whose attestation verifies, with friendships written
both ways, three direct threads and one group. They sign in through the real wallet route, so
everything a development database contains is something the product's own code path produced.

The twenty-four invented guests that used to fill it are gone, and so is `seed-fixtures.ts`. That
file did two jobs: it defined the arrangement the browser specs are written against, and it seeded
those invented people into a database the product then rendered as its population. The first job is
honest and now lives in `application/tests/fixtures.ts`, beside `fake-api.ts`, which is the
browser's server. The second job was the problem.

The seed runs on EVERY boot and is idempotent about the device as well as the account: P-256 keys
cannot be generated deterministically from a seed, so the guard is "does this account already have
a device" rather than a fixed id - which is also the rule a real account follows.

Each fixture conversation is written in ONE language, because a real message is one language. The
bilingual strings were a mock convenience the wire format does not have.

## Reading chat

`chat.store.ts` reads through `services/chat.source.ts` and nothing else. That interface is the
whole seam the server slots into: `conversations`, `thread`, `post`, `openDirect`, `archive`.
`createApiSource()` is the only implementation the product ships and `setChatSource()` swaps it,
which is how the failure states — loading, refused, offline — are driven in a spec. It is also where
the SEALING happens and the only place it does: a message goes out as ciphertext and an envelope and
comes back as a row this browser has to open for itself, and the store above never sees either half.

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
`search.store.ts`, and it reads `chat.archive()`: the messages THIS DEVICE has fetched and managed
to open. That is the only shape E2EE allows, because a server-side message index cannot exist.

**The archive is the plaintext, and it has to be surrendered like a key.** Six independent audit
routes converged on the same defect: `surrenderKeys` dropped the epoch keys, the device keypairs and
the signer cache, and left every message those keys had already opened sitting in a module-level
`Map`. Sign-out is a client-side navigation — no reload, same module — and signing in as somebody
else does not replace it. So the next person at the keyboard signed in as themselves, opened search,
typed a common word, and read the previous person's conversations **without needing a key at all**.
The plaintext outlived the keys that produced it, while `session.store.ts`'s own docstring promised
the opposite in so many words.

`forgetArchive()` is exported from `chat.source.ts` — which imports no store, so it can be reached
from `session.store.ts` without closing the session→chat→account cycle — and is called first in
`surrenderKeys`, before the keys, because it is the thing a person can read with no key. Two belts
beside it: `archive(scope)` answers nothing when `scope.me` is not the account the messages were
opened for, and search terms move to `lib/search-terms.ts` so they are dropped on the same path.
A search term against a sealed conversation is a fragment of what was said in it, and it was the one
thing this product wrote down in cleartext.

**The archive filters expiry on the way OUT, not only on the way in.** A message that runs out while
it is being held is never read again — the server stops returning it — so nothing ever comes back to
evict it, and it stayed findable by its words for as long as the tab was open. The eviction that
looked like the fix was unreachable in the normal path.

**Search says what it covers, because a person who finds nothing concludes it is not there.**
`search.thisDevice` states the scope where somebody starts a search, and `search.locked` counts the
messages this browser holds but could not open. "It is not there" and "it is not here" are very
different answers when the thing being looked for is something somebody remembers reading. A locked
message is also excluded from the results outright: its `text` is empty but its `from` is not, so it
would otherwise match on the sender's handle and render an empty row that reads as a bug.

**Sending is not optimistic.** `send` seals, posts and revalidates, so the message appears when the
server has acknowledged it. That is a round trip plus a signature rather than a microtask now, which
is why `chat.listLoading()` is what a test waits on rather than one macrotask.

**The composer is a `TextArea`, and the limit is 500.** It was an `<input>`, so a message ran off
the right-hand edge at about sixty characters and the only way to read back what you had written was
to arrow through it - nothing about the control admitted the limit it had. It grows to six lines and
scrolls after that, because past a paragraph the box is eating the conversation it belongs to. Enter
sends and Shift+Enter breaks the line, which is what `enterkeyhint="send"` already promised on a
phone keyboard. Two details are load-bearing: `height` is cleared before `scrollHeight` is read, or
a box that is already tall reports the height it HAS and only ever grows; and the effect writes the
caller's value back into the field, because a textarea holds its own content and the composer clears
its draft after a send.

**A TABLE conversation is named after its game.** `titleOf` fell through to a generic "Table chat"
for every one of them, so a chats list holding two tables held two rows with identical titles - and
a table nobody has spoken in has no timestamp either, so there was nothing else on the row to tell
them apart. It takes its names as one object now (`{ group, game }`) rather than a growing tail of
positional strings, which is what the third one would have made it. The row draws a seat tile for
one too: `AvatarGroup` rendered NOTHING for a table nobody else has joined - which is every table
while its host waits - while keeping its 40px box, so the row opened with a blank gutter where
every other row has a face.

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

**Device identity** is client-derived and self-certifying, and it is BUILT - see *Devices, and the
degraded states that shipped first* below for what the schema, the races and the states actually
are:

```
deviceId = base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)
```

so the server cannot mint an id for keys it does not hold — which proves the keys were not SWAPPED
and proves nothing about whose device it is. A device is authorised by a SIWE-shaped
`personal_sign`, with an ERC-1271 `eth_call` branch for contract wallets. Guest accounts have no
wallet, so their devices are `attested: 'server'` — and `attested` is a REQUIRED prop on the trust
badge, so a server-asserted device cannot be rendered as wallet-verified by forgetting to say so.
How a PEER decides whether to believe any of that is *Whose device is that?* below.

**The envelope**, with its AAD fields joined by the ASCII unit separator (0x1F) in exactly this order:

```
'nura-e2ee/v1' ␟ 'msg' ␟ conversationId ␟ epoch ␟ seq ␟ messageId
               ␟ senderAccountId ␟ senderDeviceId ␟ kind ␟ clientAt
               ␟ commitment ␟ expiresAt
```

Binding `kind` stops the server relabelling a fabricated row as a person's words; binding
`clientAt` stops it re-dating one; binding `senderDeviceId` stops it re-attributing one; binding
`commitment` stops either end lying about what the message can later be reported as saying; binding
`expiresAt` stops the server giving a disappearing message a longer life than its sender asked for.

**The format is settled.** It took three hard cutovers to get here — the sealing, the commitment and
the expiry — and every one of them was taken while nothing had shipped to anybody, because a wire
format patched around after the fact is one nobody can reason about. Nothing left in the plan
touches these bytes.

**No wallet-signature-derived backup key.** A deterministic `personal_sign` over a fixed string is
an unrevocable, phishable, remote skeleton key to the entire archive. Recovery is a *generated*
120-bit phrase only; a user-chosen passphrase is refused, because PBKDF2 is the only KDF
`SubtleCrypto` offers and it is weak enough against GPUs that a human-chosen phrase is a real
break. It is BUILT — see *Recovery* below.

**No plaintext key bytes at rest.** Keys are non-extractable `CryptoKey`s; IndexedDB holds vault
ciphertext. The honest claim is *"no key bytes at rest"*, not *"key bytes never exist"* — they
exist in memory at three moments (minting, wrapping, backup) and the buffers are zeroed after.

**What the server still sees**, stated rather than buried: who is in a conversation, who sent a
message, when, and how large it was. E2EE hides content, not the social graph.

**What it costs**, and these are consequences, not regrets: no server-side message search — the
index is per device, over the archive that device can decrypt; push notifications are contentless;
moderation sees only the excerpt a reporter chooses to disclose, which is what *Franking* below
makes worth reading; a device that loses its keys and its recovery phrase cannot get the history
back, and the UI says so plainly rather than showing an empty thread.

## Devices, and the degraded states that shipped first

This is the half of `nura-e2ee/v1` that had to exist before any of the sealing, and it was built in
the order the plan asks for: the states that mean something went wrong were written, rendered and
tested BEFORE the happy path, so they are exercised rather than discovered. *The sealing* below is
what was built on top of it.

**A device id is derived, not issued.** `base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)`,
computed by the client and recomputed by the server, which refuses a mismatch. An id the SERVER
hands out is an id the server can mint for keys it holds itself and quietly wrap an epoch key to;
this one can only be claimed by whoever published those two public keys. There are two
implementations of the formula — `server/src/domains/device/id.ts` over `node:crypto` and
`application/src/lib/device-id.ts` over WebCrypto — and `tests/devices.spec.ts` runs both over the
same real P-256 keys, because two implementations of one formula are two chances to disagree and a
disagreement means every enrolment on one side is refused by the other.

**The browser re-derives every id it is shown.** A server that swapped a device's exchange key for
its own would produce a row that no longer adds up, and the client can see that without trusting
anybody. Such a row renders as `tampered`: no trust badge, no confirm, no rename, and the single
offered action is to sign it out.

**A revoked id never comes back.** The row stays forever with `revoked_at` set and enrolment
refuses an id already in that state. Deleting it would let a stolen laptop re-present the same keys
and be trusted again, which is the entire thing revocation exists to stop. The browser's answer to
that 409 is to mint fresh keys and try ONCE more — a loop there would fill somebody's list with
abandoned keys.

**Revoking ends the sessions, in the same transaction.** `sessions.device_id` is what makes that
possible, and `services.ts` closes the sockets afterwards. A revoke that leaves the browser signed
in is a button that lies, and this is the column that stops it being one.

**The first device is confirmed at birth; every one after it arrives `pending`.** There is nobody
to ask about the first. A device cannot vouch for itself, and an UNCONFIRMED device cannot vouch for
another — otherwise one enrolled device could bless a chain and `pending` would mean nothing. The
"am I the first?" test and the insert are held under `pg_advisory_xact_lock(hashtext(userId))`
together, so two browsers enrolling at the same instant cannot both decide they are the first.

**Five states, and the same database fact reads two ways.** `ready`, `pending` (unconfirmed, and
NOT this browser — you can act), `waiting` (unconfirmed, and it IS this browser — you cannot),
`locked` (revoked), `tampered` (does not verify). Separately, `Readiness` says what THIS browser
can do: `unsupported` (no WebCrypto or no IndexedDB — an insecure origin, or a private mode),
`absent`, `waiting`, `ready`. Both are exhaustive `Record`s over the union, so a state added later
cannot render as nothing.

**`attested` is a required prop on the trust badge.** `'wallet' | 'contract' | 'server'`, where
`server` means NOBODY vouched — a guest has no wallet to sign with. Required, with no default, so a
server-asserted device cannot render as wallet-verified because somebody forgot the prop: forgetting
it fails to compile rather than failing quietly on a screen.

**A wallet account signs for its devices and cannot opt out.** Enrolment without a signature is
refused rather than recorded as `server` — that would be a downgrade nobody would see. The message
is the sign-in message's sibling with its own statement and the device named in EIP-4361's
`Resources` (`nura:device:<id>`), and the server checks that the burned challenge really names the
device being enrolled. Without that check, a signature collected for one device — or for signing in,
which names none — would authorise any device the caller chose to name.

**Keys live behind a seam.** `lib/device-keys.ts` generates both keypairs non-extractable and keeps
them in IndexedDB; the public halves are exported to base64url because they are published. The test
environment has no IndexedDB and neither does a browser in some private modes, so `setKeyStore`
swaps it and `available()` is what `unsupported` reads. PR 12's `keyring-db.ts` extends this file
rather than replacing it.

## Whose device is that? — the proof a peer checks

The self-certifying device id answers "were these keys swapped in transit?" and nothing else. It
does NOT answer "is this device really Bob's", and the difference is the whole of end-to-end
encryption: a device this server fabricates hashes its own keys, so it re-derives perfectly. PR 11's
confirmation covers devices of your OWN account. Without something more, "wrap the epoch key to
every member device" means wrapping it to whatever list this server hands over, and the product
would be end-to-end encrypted against everyone except the one party it is supposed to be encrypted
against.

**So the enrolment signature is kept and published.** `devices.attested_address`,
`attested_message` and `attested_signature` hold the address that signed, the exact bytes it
signed, and the signature. PR 11 verified those and threw them away, which was enough while this
server was the only one asking. A peer recovers the address ITSELF -
`application/src/lib/attestation.ts`, over `@noble/curves` - and checks that the message names that
device in its EIP-4361 `Resources` line. Two CHECK constraints make the proof non-optional: all
three columns together or none, and `attested in ('wallet','contract')` requires them. A
wallet-attested device with no proof beside it is not a row this database can hold.

**The attestation is anchored to the ACCOUNT's wallet, and that is what stops it being circular.**
`verifyPeerDevice` on its own checks four values from one response against each other: the id hashes
the keys, the signed message names that id, the signature recovers to the address printed beside it.
A server that minted a device and signed its enrolment with any key it liked passes all three — the
whole chain agrees with itself and with nothing outside the response. So `conversationMember` carries
the address the account signs in with, and `sealabilityOf` renders `wrong-address` (an alarm, not an
absence) for any device attested by anything else. Injecting a device now means also swapping the
member's published wallet: one value, in one place, that a person can compare.

**What it still cannot prove, stated plainly.** That the ADDRESS is the right person's. That is not a
gap in the maths, it is where the trust has to come from — the address is published so it can be
compared out of band, the way a safety number is. A server that swapped a peer's address would have
to swap it everywhere that person's address appears, and one comparison catches it.

**`GET /chat/:id/devices` is a separate wire shape, not `devices.list` with a different WHERE.**
The owner's list carries a label somebody typed, a last-seen time and a confirmation state; handing
those to anybody who can open a conversation publishes a device count and a description of
somebody's life for a feature that needs two public keys. `peerDevice` is the keys, the id, and the
proof. Membership is the authorisation, exactly as it is for reading the messages, so a conversation
you are not in answers precisely as one that does not exist.

**Three filters, each a rule rather than a tidy-up**, and `peer-devices.db.spec.ts` owns all three
against a real Postgres: revoked devices are absent (wrapping to a signed-out device is what
revocation exists to prevent), UNCONFIRMED devices are absent (this is the ghost-device defence —
confirmation is an assertion by another device of that account, and it is what finally makes PR 11's
confirm button mean something), and server-attested devices are absent (there is no proof to
travel, so a peer cannot check them at all).

**A member with no sealable device comes back as an EMPTY ARRAY, never omitted.** "Nobody on the
other side can read this" and "I have not loaded the other side yet" are different states, and a
missing key cannot tell them apart.

**One bad device condemns the whole list.** A list containing something that does not verify is not
a trustworthy statement about the rest of it either, so `sealabilityOf` yields NO devices for that
member and renders `tampered` — an alarm with `role="alert"`, not a shrug. Quietly using the good
ones is exactly how a fabricated device ends up wrapped in beside the real ones.

**Sealing needs a wallet on both sides.** A guest has no wallet, so a guest has no provable device,
so a conversation with one is not sealed and says so. That is a product decision with a real cost —
guests are the main onboarding path — and it is stated rather than hidden behind a padlock. A
contract wallet is refused too, for now: ERC-1271 has no signature to recover and the answer needs
an `eth_call` this browser does not make. Unverifiable is not verified, and the copy says which.

**The notice names the person it is about**, and speaks in the second person when that person is
the reader — being told about your own account in the third person reads like a bug. It shipped with
no positive case, because a padlock ahead of its mechanism is a claim rather than a fact and at the
time nothing was sealed; it has one now, and *The sealing* says what it claims.

**`@noble/curves` 2.x flipped what `sign()` is given.** 1.x signed the 32 bytes handed to it; 2.x
HASHES them first unless told `prehash: false`. `signRecovery` passes a SHA-256 digest, so on the
default it signed SHA-256(SHA-256(challenge)) and the server - which verifies through WebCrypto
ECDSA with `hash: 'SHA-256'` over the raw challenge - refused a perfectly well-formed 64-byte
signature. Recovery would simply never have worked for anybody. `recovery.spec.ts` is what said so,
which is the whole reason the crypto specs gate that upgrade rather than riding along with it. The
2.x subpaths also need their `.js` (`@noble/hashes/sha3.js`), `p256` moved to
`@noble/curves/nist.js`, `Point.toRawBytes` is `toBytes`, and `sign()` returns the compact bytes
rather than a `Signature` to call `toCompactRawBytes()` on.

**Two things about the maths that fail silently.** EIP-191's prefix begins with the byte 0x19,
written as `String.fromCharCode(0x19)` because an invisible control character in a source file is
one an editor or a lint autofix eventually eats; and the length in that prefix is the BYTE length of
the UTF-8 encoding, not the character count, so a Persian message is longer than it looks. Either
mistake recovers a perfectly valid address that is simply not the signer, with no error anywhere.
`attestation.spec.ts` signs with `viem` — the library that really produces these signatures — and
recovers with the browser's own code, because a disagreement between the two halves would mean every
peer device on earth failing to verify and nothing saying why.

**`attestation.ts` is behind a dynamic import.** It is 14 KB gzip of elliptic-curve code for a
question most conversations never reach — a thread where nobody has a provable device is answered
entirely by the empty-array branch. A static import put all of it in the chat page's chunk and
pushed that chunk from 5.7 KB to 19.8 KB, past its budget, for code that would not run.

## What was deleted because nothing produced it

A person used to carry a level, a skill band, a reliability score, a favourite game, a region, a
portrait, a per-game record of games played and won, and a list of earned achievements. Not one of
them had a source.

`buildPerson` invented the played counts from a seeded RNG, the level was the square root of that
invention, the win rate came from a per-skill constant, and the earned achievements were whichever
definitions cleared a threshold against a 0.85 coin flip. For a REAL account none of that even ran:
`blank()` in `account.store.ts` handed every wallet and guest `level: 1`, `skill: 'new'`,
`reliability: 100`, `favourite: 'hokm'` and four all-zero records — numbers about a person that
nobody measured, on a product where no game has ever been played. It also gave them a bio they
never wrote ("Signed in with a wallet on NuraChain").

**No game engine exists, so none of it can be made true.** This is the same judgement that removed
`game_rules.fairness` and the matchmaking simulation: a claim shipped ahead of its mechanism
teaches people that the product's assurances are decoration. So the fields are gone, and with them:

| gone | it rendered |
|---|---|
| `stats` | the game leaderboard, the record strips on three pages, the per-game win rates |
| `level` | the XP bar and the level chip on `me` and `person` |
| `achievements` | the achievements tab and its twelve tiles |
| `skill` | "people at your skill" on `discover` |
| `reliability` | a tooltipped chip on `person` |
| `favourite` | which game seven different Play buttons opened |
| `region` | a suggestion reason |
| `portrait` | an `<img>` pointing at a file that has never existed — every row was null |
| `dataset().activity` | the whole home activity feed, forty invented events |

`me` and `person` lost their tab bars with the tabs. What is left on a profile is what the server
actually knows: who you are, what you wrote about yourself, whether a wallet is behind the account,
and how many friends you have. `social.service.ts` lost `planRequestReply` and `rankSuggestions`
entirely — neither had a caller in the product, and only their own tests were keeping them alive.

**What a person CAN write is now writable.** `profile-sheet.component.azeroth` takes the display
name, the @handle and the bio - the three things about an account that are its own - and sends them
as TWO requests, deliberately. The name and the bio are simply stored; the handle is CLAIMED against
a unique index and can come back 409, so it goes first and a refusal leaves the rest unwritten with
the value still in the box. One request would half-succeed with nothing on the screen able to say
which half. `setProfile` re-reads through `profileFor` rather than using `returning *`, because that
is the one query that joins the wallet address in and a second composition would be a second chance
to disagree with it; and it rings `socialChanged`, because the display name travels on every person
payload the graph sends.

**What the sheet deliberately does NOT have is anything to buy or earn.** A profile effect somebody
unlocks is a claim about an economy this product does not have - no inventory, no balance, nothing
that grants one - and it is the same judgement that removed the invented levels and the
provably-fair badge. The customisation is real because it is stored; the shop would be decoration
with nothing behind it.

**A suggestion has one reason left, and it is checkable**: how many friends you already share, from
the real graph. "Plays the same game" and "same region" compared two fixture literals.

Eighty catalogue entries went with the UI, along with `record-strip`, `activity-item`,
`achievement-tile` and `progress` — components with no remaining caller. A key whose renderer is
deleted is the same dead weight as a key that never had one.

`progress-ring` was the last survivor of that family and is gone too. It drew its value from `level`
and `stats`, both deleted here, so nothing could ever produce one again — and it sat in
`components/ui/` with zero importers while every gate stayed green, because nothing renders what
nothing calls. `tests/markup.spec.ts` now fails on any primitive in that directory with no caller,
which is the rule that would have said something.

## The wallet fixtures, and why a happy path has to be reachable

`server/src/db/seed-wallets.ts` seeds the six accounts that ARE the development population, their
friendships, three direct conversations and one group. They sign in with a wallet through the real
challenge-sign-post round trip, and five of the six hold a confirmed device whose attestation really
verifies.

They exist because without them **the sealed half of this product had no reachable happy path in
any development database.** Everybody who used to be in one was a guest or a demo persona, so
`attested` was `server` for all of them, `peers.ts` published none of their devices, and
`sealabilityOf` answered `no-wallet` for every conversation that had ever existed here. The 640-cell
matrix could not reach a sealable thread; neither could a browser pass, because signing in as a
wallet account needs a wallet. The `ready` branch shipped in a PR whose gates were all green and had
never once rendered.

**The sixth, `dana.w`, deliberately has no device**, because it is the one a person and the matrix
sign in as — see *The sealing* for why an account you sign into must not already hold a device
nobody has the keys to.

**The signatures are real and the recipe is shared.** `domains/device/enrol-message.ts` composes the
bytes for a live enrolment AND for the fixture, so the two cannot drift; `deviceResource` lives in
`domains/device/resource.ts`, a module with NO imports, because the browser needs that one string
too and would otherwise carry `node:crypto` or `viem` into its bundle for a template literal.
`application/tests/wallet-fixtures.spec.ts` runs the seed's own `enrolMessage` through the browser's
own `verifyPeerDevice`, which is what makes "the browser accepts what the seed writes" a claim
rather than a hope.

**The private keys are the published hardhat test keys**, already in this repository's specs. They
are there so a person can sign in as one of these accounts through the REAL wallet route - fetch the
challenge, sign it, post it - rather than through a development-only sign-in door that would have to
exist forever afterwards. The DEVICE keys are generated at seed time and only their public halves
are kept: nobody holds these devices, which is exactly what the other end of a conversation is.

Idempotent about the device as well as the account, because P-256 keys cannot be generated
deterministically from a seed and the fixture runs on every boot. The guard is "does this account
already have a device", which is also the rule a real account follows.

## The sealing

Only `kind: 'text'` is sealed, exactly as the wire format says. Everything else in this section is
the part that had to be decided while writing it rather than before, and three of the decisions
came out of design audits that found the first draft broken.

**`chat/envelope.ts` is a zero-import module, and both halves compose their strings from it.** The
separator is `String.fromCharCode(0x1f)` for the same reason `attestation.ts` writes 0x19 that way:
an invisible control byte in a source file is one an editor or a lint autofix eventually eats, and
the failure is a signature that verifies against different bytes than it was made over — which
reads as "everyone's messages are forged" with nothing anywhere naming the cause.

**The minter signs its recipient set AND its key check value, and every recipient checks both.**
The recipient half stops the server choosing WHO reads an epoch: it picks which wrapped keys a
client is shown, so without a signature it could withhold a device to keep somebody out of their own
conversation, or wrap one of its own in beside the real members.

The key half stops it choosing WHICH KEY, and it was missing for four commits. Every input to a wrap
and to a key check value is public — the recipient's exchange key, the conversation, the epoch, the
device id — so a server could mint its own key K', wrap it to one targeted recipient, compute a
matching confirmation, and leave the genuine recipient signature untouched. That recipient verified
a real signature over a real recipient set, unwrapped K', checked it against the server's own tag,
and sealed everything it typed under a key the server had chosen. Both checks passed. **Neither of
them was about the key.** A multi-agent audit of the shipped code found it; the live reproduction
confirmed the substituted key unwraps cleanly and matches the server's tag, and that binding the
confirmation into `epochCommitment` refuses it before the unwrap is ever reached.

The lesson generalises and is worth keeping: a commitment is only as good as the list of things it
commits to, and "I signed something about this epoch" is not the same as "I signed this epoch's key".

**The server verifies the commitment too**, which is a different job from the client's. It cannot
judge whether a recipient set is RIGHT — that is the recipient's check, against devices it verified
itself — but it can tell a signature from a string, and accepting a string let any member POST an
epoch carrying junk, wedging every other member's `adopt` forever with no product path back. Refused
at the boundary, like the subset check beside it. `epoch` is bounded to what the column holds for the
same reason: 2147483647 makes the NEXT mint raise 22003 rather than the 23505 the race handler
catches.

**`GET /chat/:id/signers` is a second device read, and revoked devices are IN it.** The recipient
list must exclude a device somebody signed out — that is what revocation is for. The signer list
must not: a device that minted an epoch in March and was revoked in April still signed it, and
hiding it would make every message of that epoch permanently unverifiable the moment somebody
replaced a laptop. Devices are never deleted, only revoked, which is what keeps the past checkable.

**`senderAccountId` is the account UUID, and it is the one uuid this product puts on the wire.**
Everywhere else a person is a handle, because that is the public identifier and the url key — but a
handle can be renamed, and an identifier that changes is one an old signature stops matching. It
travels on `conversationMember.accountId` and on the message, and the reader checks that the signing
device belongs to the account the message names.

**`seq` is per SENDER DEVICE, not per conversation.** A conversation-wide counter would have two
devices picking the same number whenever two people typed at once, and the loser would refetch and
retry for nothing: the AAD already binds the device, so a sender's own counter orders that sender's
own messages and nothing needs coordinating. One honest limit, stated rather than implied away: a
gap in a sender's sequence is visible, but nothing proves there is no gap — a server that drops the
LAST message leaves nothing to see. Detecting that needs each message to commit to the one before
it, which this version does not do.

**Every epoch carries a key check value.** `confirmation` is the epoch key encrypting a fixed
sentence about itself, bound to the conversation and the epoch. Without it a device holding the
wrong key finds out at the first message it cannot open, where a failed AES-GCM tag means "wrong
key" and "corrupt ciphertext" and "edited row" all at once.

**Rotation is client-driven and server-detected.** `GET /chat/:id/epoch` reports `stale` when the
recipient set no longer equals the eligible set — which is what confirming a device or revoking one
changes — and the next sender mints the next epoch. The server cannot do it: it holds no key it
could re-wrap with, which is the point.

**Losing the race is ordinary, and `mint` must never pretend otherwise.** Two devices noticing one
change both compute the same number and the primary key on `(conversation_id, epoch)` arbitrates;
the loser is answered 200 with `minted: false` and reads the epoch again, where it usually finds the
set it was going to mint already minted. Writing that insert as `on conflict do nothing` is the
single most dangerous thing anybody could do to this codebase: the loser would believe it minted,
seal under a key nobody else holds, and the messages would be unreadable forever — with the symptom
appearing days later in somebody else's client. The client re-reads before it seals anything, and
`epochs.db.spec.ts` owns the whole race.

**Confirming or revoking a device rings every room the account is in.** `ringRooms` in
`services.ts` walks `chat.seatedIn` and sends the ordinary `chat` doorbell; `seal.store.ts`
subscribes and re-reads, dropping its signer cache with it. Without that a peer with the thread
open goes on sealing to the set it fetched when it opened — which is the one that still lists the
laptop somebody just signed out. It is the only thing this server can do about a membership change,
and it is enough, because rotation happens at the next thing anybody says.

**Rotating does not rewrite history.** The old epoch, its wrapped keys and the messages under it
stay exactly where they are, and an epoch fetched BY NUMBER is never `stale` — it describes the room
as it was. A member who joins gets no wrapped key for the epochs before them and nothing can make
one; the thread says `no-epoch-key` for those lines, which is true rather than empty. `seq` starts
again in each epoch, because a counter shared across epochs would make a message's position
meaningless the first time anybody rotated.

**The server's eligibility test is a SUBSET, deliberately.** Its idea of who can be sealed to is
"confirmed, unrevoked, attested by a wallet or a contract"; the client's is narrower, because it
refuses a contract wallet it cannot check without a chain call it does not make. Demanding they
match would refuse an honest client for being more careful than the server. So the server bounds the
set from above — nothing unknown gets wrapped in — and the signed commitment bounds it exactly, from
the only place that can.

**The epoch key is BYTES, and that is forced rather than chosen.** WebCrypto refuses both halves of
what a key object would need here: a non-extractable AES key cannot be wrapped, and HKDF cannot
derive from an AES-GCM key at all. So the bytes exist in memory while a message is being sealed or
opened and are zeroed afterwards, and at rest they live as ciphertext under a per-browser vault key
that IS a non-extractable `CryptoKey` (`lib/epoch-keys.ts`). `structuredClone` preserving
non-extractable keys is what makes that possible. The honest claim stays "no key bytes at rest".

**`lib/keyring-db.ts` owns the IndexedDB version, and both key modules go through it.** Two modules
opening one database with their own idea of the version is a `VersionError` for anyone who ran the
first one — a keyring that looks empty and a device that appears never to have enrolled.

**A message that cannot be opened is a sentence, never a blank bubble.** `MessageLock` is five
states and `message-bubble` maps every one of them; `bad-signature` and `tampered` render as alarms
because they mean the row was EDITED, and the other three mean this browser simply does not hold
what it needs. The chats LIST opens previews only from keys this browser already holds — thirty rows
each fetching an epoch is thirty requests per navigation, which is the shape that took the rate
limiter out during the responsive matrix.

**There is a "this conversation IS sealed" line now, and only because the mechanism is here.** The
seal notice shipped with a comment saying there deliberately would not be one; that was right while
nothing was sealed. What it says is what happens: the bodies are ciphertext, the server stores them,
it cannot open them.

**A thread nobody can be sealed to is a thread nothing can be said in.** There is no unsealed
message any more, so the composer is disabled when `sealabilityOf` is blocked and the notice above
it names the person in the way. The browser pass found this: a send that could not seal threw into
the console instead of being a state.

**Sealing was a HARD CUTOVER.** No pre-sealing text row survived it, because a text row whose body
is gone renders as an empty bubble forever. There is no production data; a development database is
built from nothing and reseeds as empty threads.

**One wallet fixture deliberately has no device.** The seed mints device keys and throws the private
halves away, which is the honest shape for modelling the far end of a conversation and exactly wrong
for the near end: a browser signing in as an account that already has a device enrols a SECOND one,
and every device after the first arrives `pending` — confirmable only by an existing device whose
keys nobody holds. `dana.w` is the account a person and the QA matrix sign in as, so `enrolled` is
false for it and the browser's own enrolment is its first.

**Signing out surrenders the keyring.** `surrenderKeys` in `session.store.ts` drops the epoch keys,
the archive key and the device's own keypairs. A session ends but IndexedDB does not, and
`forgetEpochKeys` sat with zero callers for four commits — so signing out on a shared machine handed
the next person every conversation the last one had open, and the ability to sign as their device.
Each step is best-effort and independent: a browser that refuses IndexedDB must still be able to
sign out.

**`tools/qa/seal-pass.mjs` is the browser pass for this, and it is run by hand.** It injects an
EIP-1193 provider backed by a hardhat key, signs in through the real chooser, enrols through the
real button, opens a thread and sends a message — at 390 and 1280, both themes, both languages,
reading the console each time. It empties the account between cells because every fresh browser
context has an empty keyring and would otherwise enrol a second, pending device. It found two
defects on its first run: the console error above, and copy still offering a demo seat.

**What a reader is shown comes from the SIGNATURE, not from the row beside it.** The author is
resolved from the account uuid in the AAD through the signers list — `from` is an unsigned column,
and rendering it made the name over a message the server's to choose. The timestamp and the ordering
are the sender's `clientAt`, also in the AAD, not `created_at`, which the server writes and can
rewrite. The envelope's stated guarantees are only true if the read path actually looks at the
authenticated values, and for four commits it did not.

**`sessions.device_id` is written by a first enrolment and never moved again.** Re-enrolling used to
rebind it, and everything that branch checks is satisfied by PUBLIC data — the id is a hash of two
published keys, and `GET /devices` hands every device's keys to any session on the account — so any
signed-in browser could name somebody else's device and become it. That binding decides which
wrapped epoch key a caller is handed. Possession is proved by USING the key, which a browser does on
every seal, so nothing is given up by refusing to move it.

Sending is therefore authorised by device OWNERSHIP rather than by the session's binding, which also
fixes a lockout: a browser that signed out and back in holds perfectly good keys, is never offered
the enrolment that would set a binding (its keyring is not empty), and could otherwise never send
again. The barrier that actually decides authorship is the per-message signature; the server's check
is defence in depth. `GET /chat/:id/epoch` takes the caller's device for the same reason.

**A sender cannot choose how long their own words last.** `send` checks the signed expiry against
`conversations.expire_after` and refuses one the room did not agree to. The server still never
CHOOSES the value, so it still cannot lengthen a message's life — but without the check, expiry was
per-sender whatever the design said, and sixty seconds on your own messages in a room with expiry off
means your words are gone before anybody can report them, taking the frank with the row.

**The signer list is not a function of who is seated today.** It is anybody in the conversation now,
plus anybody who ever sent a message or minted an epoch in it. The argument that relaxes the
revocation filter relaxes this one: leaving a group or standing up from a table deletes a membership
row, and joining those two facts made a departed member's entire history render as forgeries.

**The browser specs run the real thing.** `tests/sealed-fixtures.ts` builds a genuinely sealed
corpus once at module load — a device per fixture person with real P-256 keys and a real wallet
attestation, one epoch per thread, every line sealed by its own sender — and `fake-api.ts` serves
it. A fake handing the browser plaintext would be testing a wire format this product does not have.

## Recovery

A device that loses its keys loses what it could read, and the only honest way back is a secret the
person holds outside this product. That is a **generated** 120-bit phrase, and everything about the
design follows from refusing the two shortcuts a wallet-first product reaches for first.

**It is not derived from a wallet signature, and that is the most important sentence here.** A
deterministic `personal_sign` over a fixed string would be the obvious move on a platform where
everybody already has a wallet — and it would be an unrevocable, phishable, remote skeleton key to
every message the account has ever received. Getting one signature out of somebody is the single
most practised attack in this industry, and unlike a stolen device there would be nothing to
revoke. The phrase is random, it is shown once, and it exists only where the person put it.

**It is not chosen either.** PBKDF2 is the only KDF `SubtleCrypto` offers, and against a GPU it is
weak enough that a human-chosen phrase is a real break rather than a theoretical one. 600,000
iterations is in `recovery.ts` as belt; the 120 bits of entropy are braces, and the comment on the
constant says so — because the day somebody argues for letting people type their own phrase, that
number is what will be quoted as though it made it safe.

**Crockford base32, not a wordlist.** BIP-39 is 13 KB of dictionary shipped to every browser for a
string people write on paper once. Crockford excludes the four characters people confuse and folds
the confusable ones back on input, so a hand-copied `O` becomes `0` and nobody is told they got it
wrong for writing a capital letter.

**The phrase is minted in CANONICAL form and grouped only for the screen.** `mintPhrase` returns
twenty-four bare symbols; `groupPhrase` is for display and `normalisePhrase` is what everything
derives from. It shipped the other way round for an afternoon — minted pre-grouped, so setting up
recovery derived from `AB12-CD34-…` while using it derived from `AB12CD34…`, and the feature could
never have worked for anybody. Every gate was green. The browser pass found it, and
`recovery.spec.ts` now pins the round trip through the form a person is actually shown.

**What it protects is an ARCHIVE KEY, and the archive key seals every epoch key.** One secret
restores every conversation. It does NOT restore a device's identity: those keypairs are
non-extractable and stay that way, so a replacement browser enrols as itself with its own wallet
attestation and then restores what it can read. The working copy of the archive key lives in this
browser's vault beside the epoch keys, because otherwise archiving a key learned today would need
somebody to type twenty-four characters first.

**Confirming a device is what recovery is FOR.** A replacement browser enrols as a second device,
every device after the first arrives `pending`, and the only thing that can confirm one is another
device of the account — which is exactly what was lost. So the phrase vouches: the client signs a
one-shot challenge naming the account and the device, and the server checks it against a stored
public key. The nonce names the DEVICE for the same reason the enrolment message does, and is burned
FIRST by a conditional UPDATE, so two replays of one signature race in the database and one wins.

**The server holds nothing it could use.** The salt is public by construction, the public key
verifies and decrypts nothing, and the wrapped archive key and its check value are sealed under a
phrase that has never been here. Holding the whole table gets an attacker no closer to a message
than holding none of it.

**Writing a vault needs a CONFIRMED device.** A pending device that could write its own vault would
then present its own phrase to confirm itself, and the confirmation step would mean nothing at all —
the same reasoning that stops an unconfirmed device vouching for another.

**Rolling a phrase keeps the archive key** and re-seals it, so everything already backed up stays
readable and only the outer wrapping changes. Minting a fresh archive key instead would silently
orphan every row in the archive — and a browser confirmed the ordinary way never receives the archive
key at all, so that was the COMMON case, not the exotic one. `setUp` refuses to roll when it cannot
produce the existing key rather than quietly destroying the backup.

**An archived key is bound to its slot.** `sealForArchive` authenticates `(conversation, epoch)`
alongside the key, because otherwise the archive is a bag of interchangeable blobs whose labels the
server supplies: relabelling one key onto another conversation makes that conversation permanently
unreadable on a recovered device, and the entry is preferred over the server's own wrap and never
evicted, so it does not heal.

**An archive write replaces what is in the slot.** `do nothing` meant a slot could be poisoned once —
junk written for an epoch before the real browser got there made every honest write afterwards a
silent no-op. **Turning recovery off needs a confirmed device**, like writing a vault: it destroys
the vault AND the archive irreversibly, and it was reachable by any session at all, so a stolen
cookie could throw away somebody's only way back into their own history in one request.

**`readiness` reads this browser's keyring, never the server's `current`.** It used to fall back to
the device the SESSION is bound to, which reads as reasonable until the keyring is gone — a browser
whose storage was cleared or evicted went on reporting `ready`, the panel said "This browser is set
up", and the chat silently refused to send. That is precisely the situation recovery exists for and
the one place the product must not be confidently wrong. The browser pass found it by deleting
`nura-keyring` and reloading, which is what losing a laptop looks like from the inside.

**`tools/qa/seal-pass.mjs` loses a laptop in every cell.** It makes a phrase, throws the keyring
away, re-enrols as a pending device and types the phrase back in — at 390 and 1280, both themes,
both languages. Two of the defects above were found that way and neither was visible to any gate.

## Franking

Under end-to-end encryption moderation can only ever see what a reporter chooses to show it. Without
franking there would be no reason to believe a word of it: anybody could type a sentence, attribute
it to somebody they disliked, and nobody — including this server — could tell. That is not a small
gap on a social product. It turns the report button into a weapon aimed at whoever the most willing
liar dislikes.

**The construction, and what each half buys.** The sender mints a random franking key per message,
commits with `HMAC(key, plaintext)`, and seals the KEY inside the ciphertext while the COMMITMENT
travels in the clear. The server MACs that commitment together with the context it arrived in and
stores the result. So: the server learns nothing at send time, because a commitment under a key it
does not have is noise; a reporter cannot fabricate a message, because a valid frank needs the
server's key; and a sender cannot deny one, because the commitment binds the exact words.

**A disclosure is exactly one message.** The reporter picks it, and it proves nothing about any
other. That is the shape moderation has to take here and it is not a limitation to be engineered
around later — bulk disclosure would be a different product.

**The commitment is in the AAD**, which is why franking was the second hard cutover: every
signature before it covers ten fields and every one after covers eleven. The alternative was leaving
the commitment outside the authenticated bytes, where the server could move one message's commitment
onto another and a sender could publish one that does not match what they wrote — making their own
messages quietly unreportable. Every recipient recomputes the commitment from the key inside the
envelope, so a mismatch renders as `tampered` rather than as an unreportable message.

**The franking key is 32 bytes and lives in the first 32 bytes of the plaintext.** It is read back
out by length, so a key of any other size is silently mixed into the words — which is exactly what
happened the first time `crypto.spec.ts` used a readable string as a fixture, and every open failed
as `tampered` with nothing pointing at the length.

**The server's frank never travels.** A client cannot check it and has no reason to hold it, and
publishing it would hand every reader a token that only matters when a report is filed.

**The key is derived from `SESSION_SECRET`** by HKDF under its own label rather than being a second
environment variable to set, rotate and get wrong. One consequence, stated rather than discovered:
rotating that secret invalidates every frank. Old messages stay readable — franks are not part of
the sealing — but they stop being reportable. Splitting the two secrets is the right change the day
rotation is a real procedure rather than a paragraph.

**The disclosed message has to be the reported person's.** Franking proves what was said and that
it passed through this server; it says nothing about who is being accused. Without that check a
report against anybody could carry anybody else's words, and a moderator would read a real, verified,
correctly-attributed message and act on it against the wrong person — the exact outcome the whole
mechanism exists to prevent.

**A disclosure outlives the message it discloses.** `reports_disclosure_whole` held the four
disclosure columns all-or-none while the foreign key nulled `message_id` on delete, and those two
rules cannot both be satisfied: the first reported disappearing message wedged `sweepExpired` for
the whole deployment, every minute, forever, so nothing expired again anywhere. The CHECK says what
was meant now — the words, the key and the moment travel together, and the pointer may go null. Expiry must not become a way to
destroy the evidence in a report already filed.

**A report says what actually happened.** The sheet used to show "Report sent" and close before the
request resolved, so a refused disclosure — an expired message, a failed verification, a dropped
network — read as success. On a safety surface that is the worst failure mode there is: somebody
stops looking for another way to get help.

**A report with no message attached is still a report.** Reporting a person for what they have been
doing across a room was always legitimate and still is; attaching one message is what turns "they
said this" into something a moderator can check. A reporter who does not want to show a specific
message is not made to.

## Disappearing messages

**A property of the ROOM, not of a browser.** `conversations.expire_after` is seconds, null for off,
and anybody in the conversation may change it. The version where each device decides for the
messages it sends is the one that reads as broken: somebody turns it on, watches their own lines
vanish, and the other half of the conversation sits there forever.

**The change is ANNOUNCED.** `chat.line.expiry.on` and `.off` are written by `setExpiry`, following
the rule every other line key follows — a key without a producer is filler copy. A rule about how
long words last is not something to alter behind somebody's back, and a change nobody can see is one
people discover by noticing their history is shorter than they remember.

**The expiry is signed per message, not read from a column.** It rides in the AAD, so this server
can delete the row on time and cannot extend a message's life by a second; a recipient checks the
expiry it was signed with rather than the one a row happens to carry. That is also why changing the
setting cannot reach backwards: every message already sent carries its own, and nothing shortens or
lengthens one after the fact.

**Two places enforce it and they are not redundant.** The read filters on `expires_at > now()`, so
nobody ever sees a message in the window between its moment and the next sweep; the sweep deletes
the rows every minute. Filtering alone would leave the data; sweeping alone would show it for up to
a minute after it was supposed to be gone.

**A message that has run out cannot be reported.** `frankedMessage` filters on the same condition.
Franking proves what was said; it does not resurrect something both sides agreed would be deleted.

**Expired plaintext leaves the browser's archive.** `chat.archive()` is what `search.store.ts`
reads, so a disappearing message that stayed there went on being findable by its words long after it
stopped being readable in the thread — the opposite of what the room agreed to.

**What it does NOT do, said before what it does.** It does not un-say anything. Anybody who read a
message can screenshot it, copy it or simply remember it — that is true in every product with this
feature, and `expiry.honest` says so on the screen above the choices rather than below them. What is
real is narrower and still worth having: the row leaves this database, and it leaves the thread of
everybody following the rule. A stolen laptop, a scrollback in a year and a backup all stop
containing it.

**The minimum is a minute, not a second.** `conversations_expire_after_positive` refuses anything
shorter. Zero is what an off-by-one in a picker produces and it means "vanishes before it is read";
off is expressed by null, which is a different thing and says so.

## Notifications, and a push that carries nothing

A notification has NO TEXT. It is a kind, whoever caused it, a count and a reference, and the
sentence is composed at display time through the message catalogue — so it follows a language
switch. The version this replaces baked a bilingual string into the row when it was written, which
is the same defect `nura-e2ee/v1` calls out for chat lines and the same fix.

**The dedupe key is the whole design.** `notifications_dedupe` is unique over
`(user_id, dedupe_key)` and the write is an upsert that bumps `count`, moves `created_at` to
now and clears `read_at`. Twelve messages in one conversation are ONE row saying twelve, not
twelve rows to swipe away. The producer composes the key — `chat:<conversationId>`,
`friend:<actorId>`, `group:<groupId>`, `table:<tableId>` — and choosing it is the only
interesting decision in writing one.

**Five kinds, each with a producer**, the same rule `LINE_KEYS` follows: `friend-request`,
`friend-accepted`, `group-added`, `table-invite`, `message`. A kind with nothing writing it is
filler copy standing in for something nobody has built.

**The mute is checked when the row is WRITTEN**, not when it is rendered. A notification that
exists and is hidden is still a badge somebody has to clear. Same for a block, and for your own
actions: nobody is told about something they did.

**`ref` is a closed set** — `conversationId`, `tableId`, `groupId`, `requestId`,
`personId` — filtered on the way in. The column is `jsonb` and would happily take a sentence;
that filter is what stops a "structured" notification from carrying prose.

**The list pages by keyset**, `(created_at, id)` descending, like chat history. `more()` appends;
anything that CHANGES the list drops the older pages and refetches the first, because stitching a
fresh head onto a stale tail is how a list shows one row twice.

**A push carries no payload at all**, and that is why `domains/notify/push.ts` is forty lines
rather than four hundred. A payload would have to be encrypted to the subscription's
`p256dh`/`auth` with HKDF and AES128GCM — and an encrypted payload of a message this server will
not be able to read under `nura-e2ee/v1` is a contradiction. What is left is the VAPID half: an
ES256 JWT naming the endpoint's ORIGIN (never its path, which identifies the subscription) and
expiring within the hour. The browser wakes the worker with an empty event, the worker shows one
generic notice, and the content comes from the api when the app is opened — over a session the
reader is already authorised on.

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all three optional and all
three needed TOGETHER. With none set, `GET /notifications/push` answers with no key and the
client never asks the browser for permission: a prompt for something that cannot be delivered is
one somebody denies once and never sees again.

**`public/push-worker.js` is plain JavaScript served as-is, never bundled.** A service worker's
url is its identity, so a hashed filename would register a new worker on every deploy while the
old one kept running.

Sending is fire-and-forget and never blocks a request: a slow push service must not make sending a
message slow, and a dead one must not make it fail. A 404 or 410 from the service means the
subscription is over — the row is retired rather than retried forever.

## Realtime — `nura-rt/v1`

One WebSocket at `/ws`, and it is a **doorbell, not a delivery**. A frame says "something about
this conversation changed" and the store that cares re-reads it through the route that already
exists — with the same membership check, the same block rules, the same read watermark. A second
delivery path carrying message bodies would be a second place to get all three wrong, and it would
have to be rewritten again the moment a body becomes ciphertext.

`server/src/realtime/frames.ts` is the whole wire. Four server frames (`hello`, `presence`,
`nudge`, `typing`), three client frames (`sync`, `presence`, `typing`), and
`parseClientFrame` is total and strict — **unknown keys are refused**, because a frame carrying a
field this version does not know is a frame from something that is not this client.

**`n` is a per-connection sequence number and is NOT the e2ee `seq`.** It stamps the order frames
left this server for one socket, nothing more. The envelope's `seq` in `nura-e2ee/v1` is bound
into AAD and orders messages inside a conversation epoch. They are different numbers with different
lifetimes; do not derive one from the other.

**The origin gate is a union, and the union is load-bearing.**

```
isSameOrigin(origin, request.headers.host) || origin === config.origin
```

`config.origin` alone refuses every socket in the mandatory QA run: the browser is on `:3200`
against the built server while `PUBLIC_ORIGIN` is `:3100`, and a refused handshake writes exactly
one console error that `tools/qa` cannot suppress — 600 failing cells. `isSameOrigin` is
reimplemented in `realtime/admit.ts` because `@azerothjs/ws` does not export its own copy; that is
recorded in the framework register, and the copy is not trivial (implied ports, the opaque `null`
origin a sandboxed frame sends).

**Nothing in `onConnection` may await.** The package replays the bytes that arrived in the same TCP
segment as the handshake AFTER `onConnection` returns, so a handler assigned behind an `await`
misses an eager client's first frames and they are dropped against a null handler with no error at
all. `realtime.socket.spec.ts` asserts this over the source text rather than by racing a socket —
a deterministic test beats an atmospheric one.

**Shutdown order is load-bearing.** `handleShutdownSignals` gives two seams and they are not
interchangeable: `beforeShutdown` runs while connections are still live, which is the only moment
`hub.closeAll(1001)` can say goodbye with a code; `beforeExit` runs after they are gone, which is
where the DataSource is destroyed. Swap them and every client sees 1006 and reconnects into a
server that is on its way out.

**`isMetered('/ws')` is now nearly dead code.** The rate limiter still scopes to `/api` and
`/ws`, but a socket costs one request per connection and the gateway meters frames itself
(`sync` 5s, `presence` 2s, `typing` 3s, ten faults and the socket is closed 4400). Keep the
prefix — a handshake flood is still a flood — but the per-frame budget is where the real metering
happens.

**Presence has three states on the client, not two.** `Presence.known` says whether the server
mentioned this person at all; absent from the snapshot is NOT "offline", because it could equally
be `show_online: false`. An unknown person renders **no dot** (`presence.dot()` returns null) and
no presence word — a handle, which is always true, goes in that line instead. The store is a
projection of `useRealtime().presence()` and nothing else: the seeded roster that used to drift on
a timer is gone, so a page with no socket shows nobody online rather than inventing a room.

**A departure is a field, because it cannot be an absence.** `announce` builds its entry from the
presence record, and going dark is precisely the state where there is no record - so it used to send
`people: []`, a delta naming nobody, which the client merged into no change at all. A tab left open
showed people who had left hours earlier, and the client's own comment claimed "a delta naming
somebody with an empty list is how the server says they went dark", which is not a thing an empty
array can say. `gone: string[]` carries the handles instead, and is OMITTED rather than sent empty so
a reader can tell "nobody left" from "somebody left and I could not say who". `realtime-hub.spec.ts`
asserted the empty frame - the bug written down as an expectation - and now asserts the departure.

Removing them leaves them UNKNOWN rather than offline, which is the honest answer and the reason
`Presence.known` exists: somebody who left and somebody who turned presence off are the same thing
from outside, and `presence.dot()` draws nothing for either.

**The typing indicator is new server-visible metadata.** The server learns that somebody is typing,
in which conversation, and when — that is on the same list as who talked to whom and how large it
was, and it belongs in the privacy copy alongside them. A notice carries its own 4s expiry because
nobody ever sends "I stopped": the tab may have closed, the socket may have dropped, or they may
have walked away.

The client half is `services/realtime.source.ts` (the only module that constructs a `WebSocket`)
and `stores/realtime.store.ts` (one connection, jittered backoff seeded from `runtime().seed`, a
visibility pause, coalesced nudges). **Connecting does not reset the backoff — staying connected
for `STEADY_MS` does**, or a socket that opens and dies 200ms later in a loop is hammered at one
second forever. 4400, 4401 and 4429 are terminal and never retried.

`stores/connection.store.ts` reports only what it can see: the socket's own status plus
`navigator.onLine`. The `latency` it used to publish was never measured by any request, and the
fixed 1800ms "reconnecting" animation had nothing to do with a reconnection. It deliberately does
NOT follow every flap — between drop and retry the socket is `down`, during the retry it is
`connecting`, and at the first backoff rung that alternates once a second — so `offline` means
something that will not fix itself and everything in between is one steady `reconnecting`.

**The socket starts FIRST in the app shell's `stops` array**, which means it stops LAST, because
the teardown runs in reverse and every store under it holds an unsubscribe against it. Each stop is
wrapped in its own try/catch: one that throws must not strand the sockets, timers and listeners of
every store after it.

## The product shell

Everything behind `/sign-in` and `/app/*` is client-rendered and lazily chunked; the landing
stays `render: 'static'`. `components/app/app-shell.component.azeroth` is the layout route: it
starts every periodic store in `mount` and stops them on teardown, stamps `data-posture`
(`phone` < 768 ≤ `rail` < 1024 ≤ `sidebar`) and `data-social` on `#app-shell`, and hosts the
overlay, toast and lobby-notice portals.

**The shell's grid is what bounds a page, and nothing inside it bounds it again.** `Page` takes
`width`, which is two intents rather than three: `full` fills the column and is the DEFAULT, and
`narrow` is 44rem for the four pages that are a form or a reading column. The shell is already
three columns - a fixed rail or sidebar, the page, and the social panel - so a second cap inside
the middle one was the same job done twice by two numbers that knew nothing about each other, and
the wider number won on a wide monitor: at 2560 the column is 2016px and the content used the
middle 1536, leaving 240px of dead ground each side with a top bar capped to match, so its search
box floated inwards while the social panel beside it stayed flush. `shell.spec.ts` pins the
default, because "no cap" was once an implicit side effect of `padded={ false }` and lost the chat
thread its full bleed the moment those two decisions were correctly separated.

Filling the column is only half of it: a card grid that fills 2016px with four columns has 490px
cards. The people and group lists take another column instead (`@5xl`, `@6xl`, `@7xl`), which
changes nothing below 1024px of CONTAINER and is why those grids are `@container` variants rather
than viewport ones.

**A teardown cannot measure the DOM, because by then there is none.** `<Routes>` plays a leave
transition and this app always has one — `transitionFor` in `App.azeroth` returns `page-fade` or
`page-forward` and never null — so every navigation takes the animated path, which is `removeChild`,
then `destroyComponent`, then dispose. The component's teardown runs LAST, against a detached
element, and CSSOM View says an element with no box reports `scrollTop` as zero. `Page` read its
scroll position there, so it saved 0 for every page on every navigation and the restore then put
every list in the product back at the top. Anything a teardown needs to know about the rendered
element has to be captured while it is still rendered — `Page` keeps `depth` up to date from a
passive `scroll` listener and saves that.

Nothing could see it. `npm run qa` checks overflow, hit targets, a `main` landmark and a clean
console, and a page confidently scrolled to the top passes all four. **`jsdom` has no layout**, so
its `scrollTop` is an ordinary property that survives detachment — the bug is invisible to a spec
unless the spec installs the real rule itself, which is what `shell.spec.ts` does before it
navigates. That is the shape to copy for anything else that depends on layout.

This is not a framework defect and does not go in the register: the element has to stay in the
document until its leave animation finishes, so removing it before disposing is the only order that
works. The wrong assumption was ours.

**`readiness()` is not an answer until somebody has looked.** It reads this browser's keyring, and
the keyring is null until `devices.look()` runs - so before that every browser reports `absent`,
including one holding perfectly good keys. `devices.known()` is the guard, and anything acting on
`absent` without it accuses a browser of a state nobody measured: the composer would render disabled
on every cold load and enable itself a moment later.

**The shell calls `look()`, never `refresh()`, and the difference is a whole request.** `look()` reads
the keyring and asks the server nothing; `refresh()` does that AND refetches the device list. But the
list is a `createResource` keyed on the account, so it already fetches itself the moment the account
resolves - and the shell calling `refresh()` on top of that asked for the same devices twice, thirteen
milliseconds apart, on every page load. Nothing failed, which is why it survived: a duplicated GET is
invisible to every gate this project has, and it is the exact shape that took the rate limiter out
during the responsive matrix.

**Whether a message can be SENT is two questions, and they used to be one.** `sealability` is the
server's word about the members' ACCOUNTS; `readiness` is about the machine in front of the reader.
`post` refuses on the second while the composer was disabled on the first, so an account enrolled on
a laptop opened on a phone showed the padlock, enabled the box, and threw
`This browser has no device keys` into the console on Send. `sendBlockOf` decides between them in one
pure function - tampered first because it is the only state that means something is wrong, then this
browser because it is the one the reader can fix, then everybody else - and a spec pins the order.

**Enrolment is offered where somebody is stuck, not only where it lives.** The seal notice carries a
button when this browser is what is in the way, and `enrol` NEVER rejects - it reports through
`failure()` - so every outcome is read back and spoken. A second browser lands `waiting` rather than
ready, so it is offered the devices page instead of a button that would not finish the job.

**And it is offered before anybody is stuck, because both other doors need you to already be
there.** `keys-banner.component.azeroth` sits in the shell where `ConnectionBanner` does, on every
route, and says this browser cannot read your messages yet. The seal notice is above a composer
somebody with no keys cannot reach the point of using, and the devices page is a page nobody opens
unprompted - so the product's answer to "why can nobody hear me" was a screen you had to already
know about. `absent` gets the button, because enrolling is one step and it happens there; `waiting`
gets a LINK to the devices page, because confirming needs a device that already holds keys or the
recovery phrase, and a button that cannot finish the job is worse than a signpost to where it can.

**The routine behind that button lives in `enrolment.store.ts`, and it lives there because there are
now two of them.** It is a sequence of DECISIONS - a locked wallet says something different from a
refused signature, a second browser lands `waiting` and must not be told "done" - and it was written
out inside `chat.page`. The moment a second surface offered the same button, a second copy of those
decisions would have been a second chance to say the wrong one, which is the argument `policy.ts`
makes about the social rules and the same shape.

`gap()` is deliberately silent for two states. A GUEST gets nothing, because a guest has no wallet
to attest with, so a key here would unblock this browser and leave them blocked on the other half -
a button that lies about what it fixes. `unsupported` gets nothing either: there is nothing behind
the button on a browser with no secure storage, and a strip that cannot be acted on is furniture
that never goes away. Dismissal is held for the session and never written down - a key gap is not a
preference, and a flag in `localStorage` would silence it for good on the one machine where the
answer matters.

**A `<Show>`'s children are lazy and its `fallback` is NOT.** The children are written
`{ () => ... }` and only run when `when` is true; the fallback is a plain value, built eagerly, at
the moment `when` flips. So a fallback that dereferences something the surrounding guard is
responsible for throws the instant that thing goes away - and closing a table did exactly that:
`table` went null, `seated` flipped false in the same tick, the inner Show reached for its fallback,
and `table!.taken` sent the entire route tree to "The lights went out." The outer
`<Show when={ table !== null }>` was no help, because a fallback is not a child. Build the element
inside a ternary that checks first. `tests/markup.spec.ts` fails on any fallback that asserts
non-null, brace-matching past nested lazy children so a nested Show's own child can still assert.

**An error that reaches a person has already failed; throwing it away makes it fail twice.** The
boundary in `App.azeroth` named its first argument `_error` and dropped it, so a crash anywhere
under `<Routes>` produced that screen and nothing else - no console line, no stack, no clue which
page. `ErrorPage` takes the error now, logs it always, and shows it on screen in DEVELOPMENT only:
an exception's text is written for whoever wrote the code and can carry an id or a path that a
stranger reading over somebody's shoulder should not be handed.

**Stores own their timers AND their listeners.** No store schedules or subscribes to anything in its
factory; that work sits behind idempotent `start(): () => void` / `stop()`, one-shot timers are
tracked and cleared by `reset()`, and every one reads the clock through `runtime()` so tests can
drive it. `device` and `scroll` were the two that did not comply - four window listeners and one
scroll listener attached at construction, two of them through `matchMedia` objects built inline, so
no handle survived to remove them with. A browser builds one store and never noticed; a spec file
that builds a fresh store scope per render accumulated them.

**Two of them are NOT started by the app shell, and that is deliberate.** `device` starts in
`App.azeroth` because the landing page reads it too - through the tooltips and the theme controls -
and a watch beginning behind the sign-in would leave the public half of the site deaf to a resize.
`scroll` starts in `site-header.component.azeroth`, which is its only reader anywhere: it is a
landing-page concern, not an app one. Everything else starts in the shell, in the `stops` array.

**A store mutator must never read the signal it writes** while it can be called from an
`effect` — that forms a cycle and the scheduler gives up with "Reactive flush did not settle".
Use the updater form (`setX((current) => …)`, which does not subscribe) or `untrack`.

**Primitives** live in `components/ui/`. `Tooltip` wraps every `IconButton` automatically, so an
icon-only control has a visible name on a mouse and a long-press name on a finger; it portals to
`.anchor-root` and must never go through the overlay stack, whose `blocking()` drives `inert`.
`Badge` does counts, free text and dots. `Pagination` does numbered pages and load-more.
`Slider` is pointer-captured and keyboard-driven. `lib/anchor.ts` is the shared placement maths
(flip, shift, RTL) and `lib/swipe.ts` the two-axis drag with axis lock.

**A toast's countdown stops for a pointer AND for focus, and starts again however the touch ended.**
Pausing takes the time spent so far out of `remaining` and deliberately leaves `startedAt` where it
is, because that is what the subtraction was measured from — so `progress` has to read a `paused`
flag rather than adding `now - startedAt` on top, or the bar jumps forward the instant the pointer
arrives and goes on creeping while it sits still. `pause` is idempotent for the same reason: a
pointer arriving and focus landing are two different callers, and hovering a toast then tabbing to
its button took two bites out of one countdown. Resuming is idempotent too, which is what lets
`pointercancel` say it unconditionally — a cancelled touch never reaches `pointerup`, and the toast
used to sit there for good waiting for a resume that was never coming.

**The wallet address has to be readable and copyable, because the whole peer story rests on it.**
*Whose device is that?* asks a person to compare an address out of band "the way a safety number
is" — and it was rendered `truncate`d, in full, with nothing to copy it with. A comparison nobody can
perform is not a defence. It carries a tooltip with the whole value and a copy button now.

**Every icon-only control in this product is an `IconButton`, and `IconButton` wraps `Tooltip`.**
That is checkable rather than aspirational: a sweep for a bare `<button>` containing an `Icon` and no
text finds none. Adding a tooltip to a control that already says what it is would be noise, so the
rule is the narrow one — an icon with no words gets a name on hover and on long-press, and everything
else does not.

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

**The landing page's way in is a wallet chooser, and it is a dynamic import.**
`stores/connect.store.ts` is one boolean shared by the site header and the two landing CTAs;
`components/layout/connect-dialog.component.azeroth` is fetched the first time somebody asks for
it. That import MUST stay dynamic for the same reason `lib/guards.ts`'s is — see Performance.

The chooser lists MetaMask, Trust Wallet and Nura Wallet, matched against EIP-6963 announcements by
`rdns` (a prefix match, so `io.metamask.flask` is still MetaMask). A wallet that did not announce
itself is shown as missing with a link to its own download page — **except Nura Wallet, which has
no download link on purpose**: it injects its provider only inside its own in-app browser and
registers no url scheme, so there is nowhere to send a desktop browser. Its row expands into a
panel with a QR of this page and a copy button instead. A row that offered to install it, or that
called connect and waited, would be a button that lies.

`/sign-in` stays, wears the same `SiteHeader` (with `cta={ false }`, because that page IS the
connect surface) and `SiteFooter`, and remains what `lib/guards.ts` redirects to and where guest
and demo entry live.

Two ways in, and the account says which one was used through `kind`:

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

**`/sign-in` offers the chooser too, and for a while only the landing page did.** `WalletPanel`
connects to whichever provider EIP-6963 announced first, which is the right default and was the only
option: somebody holding both MetaMask and Trust Wallet had no way to say which, and somebody holding
neither was pointed at MetaMask specifically. The same `connect-dialog` the landing uses opens from
the sign-in page now — **still behind a dynamic import**, because that component reaches
`wallet.store.ts` and therefore `api.ts`, and the landing chunk must not grow by a byte for it.

**There is no demo account and no `/auth/demo`.** Three seeded personas used to be offered on the
sign-in page so somebody could look around without connecting anything - but a guest already does
that, and does it as a REAL account nobody else can sign into. What `demo` added was precisely the
shared-identity property: several people in one account, whose profile the product then rendered
exactly like a person's. `users_kind_known` names `('wallet','guest')` and nothing else, rather
than leaving the value legal with nothing writing it.

**Nothing signed in as a GUEST had ever been rendered by a gate**, and that is the same structural
blind spot the wallet fixtures exist to close, seen from the other end. `tools/qa` tours 640 cells
as `dana.w` and `seal-pass.mjs` signs in with a wallet, so every control behind
`!account.isWallet()` shipped without once being drawn. What it hid was a PRIMARY button on settings
reading "Connect a wallet", sitting directly above "Sign out" and carrying the identical handler:
there is no wallet-link route on this server - `/auth/wallet` mints a NEW user from the address and
never reads the session - and a guest handle is claimed by INSERT, so signing out of a guest account
is the end of it. The button destroyed the account while the card that steered people to it promised
"this profile, these friends and every result follow you to any device".

The copy now says what happens, and `tests/settings.spec.ts` renders both pages as a guest so the
branch has something looking at it. Building the link instead is a real project - a schema change, a
route, and a decision about whether a guest's `attested: 'server'` devices become wallet-attested -
and it is not smuggled in under a copy fix.

**The QA matrix signs in with a WALLET**, through the real challenge-sign-post round trip, as the
`dana.w` fixture. It used to POST `/auth/demo`, which meant the one sign-in path exercised on every
run was the one no real person used. It now needs `seedWalletFixtures` to have run, exactly as it
used to need the demo rows.

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

**`npm run build` fails on these now.** `tools/budgets.mjs` runs after `azeroth build`, gzips the
chunks the prerendered `index.html` actually pulls, and exits 1 over budget - so the table below is
a gate rather than a paragraph. It also asserts the four chunks that must NOT be in that initial
set: three.js, the app catalogue, `session.store` behind `lib/guards.ts`, and `connect-dialog`
behind the public shell. Each of those is one keystroke from being undone and every one of them
fails silently - the page still works, it just pays for the whole typed api client, and its
top-level await on `/api/_manifest`, on a route prerendered to a file precisely so it needs no
server.

| | budget | actual |
|---|---|---|
| initial JS, gzip | < 60 KB | 55.1 KB |
| three.js chunk | lazy | 165.3 KB gzip, after first paint |
| `/app` shell + page | lazy per route | 10.0 KB gzip shell, ≤ 6.2 KB per page |
| GLB kit + textures | < 4.5 MB | see `npm run assets` |
| game card art, 640 | < 60 KB each | 15–28 KB |
| game hero art, 1280 | < 110 KB each | 40–70 KB |
| kit triangles | — | ~190k, ~20% of it instanced figures |

The `/app` tree is kept out of the landing's initial payload by four things, all of which must
stay true: the `/app` layout route is `lazy`, the app message catalogue is registered by
`locales/app-catalogue.ts` which only the shell and sign-in import, **`lib/guards.ts` imports
`session.store.ts` dynamically**, and **`public-shell.component.azeroth` imports
`connect-dialog.component.azeroth` dynamically**.

A fourth is in the same family for a different reason: **`lib/seal-state.ts` imports
`lib/attestation.ts` dynamically**, because the curve code behind it is 14 KB gzip that most
conversations never need.

That third one is not a size optimisation. Route guards are named in `routes.ts`, so `guards.ts` is
eager; a static import there would drag `api.ts` into the landing chunk, and `api.ts` has a
TOP-LEVEL await that reads the route manifest. `mountPages` embeds that manifest in a page it
renders, but the landing is `render: 'static'` and prerendered to a file — no embed — so the client
falls back to fetching `/api/_manifest`. A page whose whole promise is that it paints with no
JavaScript and no server would have opened a request to the server on every visit. The dynamic
import moves the whole typed client behind the first guarded navigation, where the app chunk is
loading anyway. The wallet chooser is the same rule from the other end: it reaches
`wallet.store.ts` and therefore `api.ts`, so a static import in the public shell would reintroduce
the request the dynamic guard import exists to remove. `tools/qa` does not catch either of these;
the browser pass asserts the landing makes no api call at all.

**Markup cannot live in a declaration's value.** This is `.azeroth` markup, not JSX - there is no JSX
runtime here - and it is converted only in the markup region and in prop expressions there, which is
why `fallback={ <EmptyState /> }` is everywhere. A `derived` or `state` whose value contains markup is
refused by name, `azeroth/unterminated-declaration`, and says so clearly.

With ONE exception, and it is the expensive one: markup nested inside a function in that value - the
`derived x = ((): T => ... )()` idiom this file uses elsewhere - slips past that scan entirely. `npm run
check` is clean, and the markup is copied verbatim into the emitted JavaScript, where the bundler reads
`<Icon name` as a type argument list and dies with `Expected > but found Identifier` - a message about
generics, pointing into generated code, naming neither markup nor the declaration. The green gate is
what makes it cost an afternoon: nothing suggests the source is at fault. Build the element where it is
rendered. It is entry 10 in the framework register.

**A conditional class is written `class={ () => [ ... ].join(' ') }`, with the arrow.** An attribute
whose value is an array literal plus `.join()` is bound ONCE, however reactive its contents: the
compiler decides between `setProp` and `createEffect(() => setProp(...))` from the shape of the
expression, and that shape defeats every one of its four tests. The same read written bare -
`aria-pressed={ theme.theme() === name }` - is wrapped correctly, so one element ends up with a live
aria attribute and a frozen class. That is exactly how both segmented controls shipped: the theme and
language pills stayed on whichever option was selected when the control mounted, while `aria-pressed`
moved, so the accessibility tree was right and only the paint was wrong. Twelve components had the
shape. `npm run qa` cannot see it - it reads overflow, hit targets, a landmark and the console - and
an accessibility check reads the aria, which was correct. `tools/budgets.mjs` reads the emitted SSR
bundle and refuses the build on a bare `setProp(..., 'class', ...)` whose value calls anything,
because the difference exists nowhere else. It is BUG-009 in the framework register.

**A component cannot be held in a signal by plain assignment.** A setter treats a bare function
argument as an updater, so `Dialog = module.default` CALLS the component with the previous value
— null — instead of storing it, and the symptom is a component whose `props` are null at
construction rather than any kind of error. The public shell holds the loaded component in a plain
`let` and a separate boolean says when it is there.

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

## The audit, and what it found in shipped code

After PRs 11–14 landed, a 137-agent workflow audited the IMPLEMENTATION along ten dimensions —
three adversarial verifiers per finding, each prompted to refute — because everything until then had
reviewed the DESIGN. Thirty-three findings survived refutation, six of them critical, and the worst
was a complete break of the property the whole feature exists for: the epoch commitment signed who
received a key and not which key it was.

Two things about that are worth keeping.

**A design review cannot find an implementation gap.** The two design audits run before any crypto
was written caught thirty problems and were worth every token; neither could have caught this one,
because the design said "the minter signs the recipient set" and the code did exactly that. The gap
was in what the set did not include.

**Green gates said nothing.** At the moment the break existed, `npm run check` passed, 445 tests
passed, 640 QA cells passed, and the browser pass was clean. Every one of those is a real gate and
none of them is a substitute for somebody adversarial reading the code with the threat model in hand.

The findings that survived are recorded above in the sections they belong to, each beside the rule it
produced. `tools/qa/seal-pass.mjs` and the `.db.spec` suites pin the fixes; where a fix was subtle,
the test that would fail without it is named in a comment rather than left to be inferred.

## The browser passes, and the wallet in them

Three things drive a real browser here and they do different jobs. `npm run qa` is the 640-cell
matrix - overflow, 44px hit targets, a `main` landmark, a dirty console - and it is a GATE.
`tools/qa/seal-pass.mjs` is the sealing pass. `tools/qa/regression-pass.mjs` is the third, and every
check in it is one the matrix passes while the product is wrong: a page confidently scrolled to the
top, a thread that says it does not exist while it is still loading, a button that stays spinning
after the server refused, a guest offered a control that destroys their account. Both hand-run
passes need the BUILT server, because that is the one that exercises `mountPages`.

**The wallet in all three is an injected EIP-1193 provider over a hardhat key, and that is a
decision rather than a shortcut.** The signatures are real - `viem` signs, this server verifies them
the way it verifies anybody's - so the whole EIP-4361 round trip, the device attestation and the
sealing are exercised end to end. What is skipped is the extension's own UI.

**Real MetaMask under Playwright does not work here, and the reason is worth writing down so
nobody spends another afternoon on it.** MetaMask 13.x is Manifest V3: its background is a service
worker that idles out, and under automation the content script's next message reports
`Receiving end does not exist`, the inpage stream resets, the page gets
`Extension context invalidated`, and the renderer crashes - so `eth_requestAccounts` rejects and the
app renders "Failed to connect to MetaMask" as though the person had refused. Keeping the worker
warm from outside does not fix it. The obvious escape is an MV2 build, whose background page is
persistent - but Chrome 152 removed MV2 support outright, so it will not load at all. Both doors are
shut. Driving the real extension needs a MetaMask built with LavaMoat scuttling disabled, which is
what Synpress exists to do; it is not something `--load-extension` can reach.

What IS set up, outside this repository at `~/.claude/mcp-browser/`: the extension, a Chrome profile
with the hardhat phrase imported, and a `playwright-metamask` MCP server registered against them.
**All six wallet fixtures are the standard hardhat accounts in order** - `dana.w` is index 0 - so the
one phrase `test test test test test test test test test test test junk` holds every one of them.
Two notes for anyone driving that profile by hand: the recovery phrase must be TYPED rather than
filled, because `fill` sets the value without driving MetaMask's own handler and the box never
expands into word fields; and the extension tab must stay OPEN, because closing it invalidates the
content script in every other tab at once.

## Verification

`npm run check` · `npm test` · `npm run test:shuffle` · `npm run build` · `npm run qa` ·
`node tools/qa/regression-pass.mjs` · `node tools/qa/ludo-pass.mjs`, then a browser pass: every route at
390 and 1280 in both themes and both languages, console clean, and
the disposal check — repeatedly create and dispose the world and confirm no "Too many active
WebGL contexts" warning appears. That leak has happened twice already: once from an unreleased
capability-probe context, once because `renderer.dispose()` alone does not free the GL context
(`forceContextLoss()` does).

Three sizing traps this codebase has already hit, worth checking first when something overflows
or sits at the wrong width: a **grid item** defaults to `min-width: auto` and will not shrink
around `truncate` text (give the `<li>` `min-w-0`); an **`<input>`** carries an intrinsic
~20-character min-width that `flex-1` alone does not defeat (give its wrapper `min-w-0` too);
and a **`<button>` shrink-wraps to its content even at `display: flex`**, because a form control
sizes to `fit-content` rather than filling its parent the way a `<div>` does.

That third one is the nastiest, because it only shows up when one branch of a component is a
button and another is not. Every chair in the table lobby shares one class list, and the taken
seat rendered a `<div>` while each open seat rendered a `<button>` to invite somebody - so the
taken chair filled its 201px column and the open ones sat at 82px inside theirs, in a grid whose
columns were all perfectly equal. Nothing measures this: `npm run qa` fails on overflow, hit
targets, a missing landmark and a dirty console, and a row of undersized chairs is none of those.
A shared class list has to state `w-full` if any branch of it can be a control.
