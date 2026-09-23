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

## Running it, both ways

Two shapes, and the difference is how many processes answer the browser.

**Development — two processes.** `npm run dev` is the conductor: `tsc -w` on the server, `node
--watch` on `dist`, and vite on **3100**. The browser talks to vite, which proxies `/api`, `/ws` and
`/_image` to the api on **3200**. Open `http://localhost:3100`. The api on 3200 answers no pages at
all in this mode and is not meant to: vite owns the browser, and a second process answering `/`
would be two copies of the client.

**Production — one process.**

```sh
npm run build                       # server tsc, client bundle, SSR bundle, prerender, budgets
npm run schema:sync --workspace server    # once, on a database that has no tables yet
npm start                           # serves the api AND the built client on ONE origin
```

Open `http://localhost:3200`. Nothing has to be overridden for this to work, and that is recent:
`SERVE_PAGES` used to default to false everywhere, so the documented deploy answered the api and
**404'd every page**. It defaults to ON under `NODE_ENV=production` now, and an explicit
`SERVE_PAGES=false` still wins for a deployment that puts a CDN in front of the client.

That failure is worth knowing because of how it presents: a browser tab still holding the app from
the dev server keeps working while a fresh one gets nothing, so whichever browser you open second
looks broken. It was reported as "it does not work on Firefox" and had nothing to do with Firefox.

**What production needs in `server/.env`**, beyond the database: `NODE_ENV=production`, a real
`SESSION_SECRET`, and `PUBLIC_ORIGIN` set to the origin the browser actually uses. That last one is
the SIWE `domain`, the WebSocket origin check and the cookie's site all at once - point it anywhere
else and every wallet signature is a claim about somewhere else while the realtime gate refuses
every socket.

**On a VPS it runs under systemd.** `scripts/service-install.sh` writes the unit and enables it;
`service-start|stop|restart|status|uninstall.sh` are the rest. The unit runs `dist/main.js` with
`WorkingDirectory` set to `server/`, because `main.ts` reads `.env` from the working directory and
`CLIENT_DIR`/`SSR_ENTRY` are relative to it. The install script refuses to be quiet about a missing
build, a missing `dist/`, a missing SSR bundle, an unset `PUBLIC_ORIGIN` or an empty
`SESSION_SECRET` - each of those is a restart loop or a silent misconfiguration otherwise.

**The one thing that differs from the Explorer service**: this backend COMPILES. Explorer runs
`src/main.ts` directly; here `typeorm` in `dependencies` flips the project to emitting `dist/`, and
Node's TypeScript support is strip-only and rejects decorator syntax, so there is no way to run an
`@Entity` file. `npm run build` before `npm start`, always.

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
extensions, then TypeORM's `synchronize()` from the entity metadata, then the indexes no
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
  hand-built indexes keep their real names and are asserted by name.
- `converge.db.spec.ts` proves a second sync has nothing to do beyond two wrinkles it lists by
  name, so a THIRD one appearing fails. The two: TypeORM drops the five DESC indexes it cannot
  express (and `syncSchema` rebuilds them afterwards, which is why its order matters), and
  `conversation_members.last_read_at` re-issues its default because TypeORM compares defaults as
  strings and Postgres renders `to_timestamp(0)` back as `to_timestamp((0)::double precision)`.
  It builds a throwaway database of its own, and BOTH of its hooks carry a long timeout: dropping
  that database overran vitest's 10-second default while the machine was busy with the responsive
  matrix, which read as a flaky schema failure in a suite with nothing wrong in it.
- `naming.db.spec.ts` proves the database stores every handle and slug the product accepts.

**`uuidExtension: 'pgcrypto'` is on the DataSource and is not decoration.** Without it TypeORM
generates `uuid_generate_v4()` and the schema silently acquires a dependency on `uuid-ossp`.

**The entity graph has to stay acyclic.** Relations are owning sides only - `@ManyToOne`, and
`@OneToOne` where the foreign key IS the primary key (`game_rules.game_id`,
`recovery_vaults.user_id`). There are no `@OneToMany` inverses: two entity modules importing each
other is `ReferenceError: Cannot access 'X' before initialization` at load, which is what adding
`Table.chairs` and `ConversationEpoch.keys` produced. Nothing read them, and the owning sides alone
carry every foreign key.

**Several indexes are built by hand and always will be.** `friend_requests_pending_pair` is UNIQUE over
`LEAST(from_user, to_user)`/`GREATEST(...)` where the request is unanswered - a functional index,
and the only thing stopping A asking B while B is asking A from becoming two rows for one
intention. `messages_keyset`, `notifications_keyset`, `reports_against`, `groups_public`,
`tables_open`, `matches_history`, `match_actions_feed` and `matches_finished` each order a column
DESC, which `@Index` cannot say - and `matches_finished` is partial on top of that, so the
leaderboard's window never walks a live match. `synchronize()` therefore drops every one of them each
time, and `syncSchema` recreating them afterwards is the whole reason it exists
rather than a bare call. `converge.db.spec.ts` lists them by name, so adding one without telling it
fails rather than passing quietly.

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

The game art is SVG - `tools/art/games.mjs` (`npm run art`) draws the four scenes and the icons
are hand-authored beside them; see *Design system*. `tools/blender/build.mjs` audits their size.

## The framework defect register

**`framework-bugs.md` is not in this repository.** It is a register of defects in a DEPENDENCY,
not part of this product - and now literally a published one, so a fix arrives by bumping the pin
rather than by editing a sibling checkout. It lives in the **AzerothJS checkout**, beside the
framework it describes, which is where somebody fixing one of these is already standing;
`.gitignore` holds the name so it cannot come back here by accident. The absolute path is
deliberately not written down, because this file is published with the repository and a machine path
names a machine.

It has three sections and the third earns its place: **Open**, **Resolved**, and **Not framework
bugs** - suspicions that turned out to be ours. Nothing enters the first two without a minimal
reproduction proving the framework is responsible; everything that fails that test goes in the third
with what it actually was, so the same afternoon is not spent twice. `<Show>` rebuilding its branch
while `when` stays truthy is the first entry there, and it is the one that produced the chat flicker. Nothing goes in it without a minimal reproduction proving the
framework is responsible, and a suspicion that turns out to be ours goes in its "NOT framework
bugs" table so nobody re-investigates it.

## House rules

**This repository is PUBLIC.** Everything committed is published, including the history, so nothing
private goes in the tree - ever, not even briefly, because a later commit does not unpublish it.

- **Real values live in `.env`**, which `.gitignore` refuses at every depth, and there is one per
  half: `server/.env` for the api and `.env` at the root for the browser's `VITE_*`. Neither has
  ever been committed, and `git log --diff-filter=A -- '*.env'` is how that was checked rather than
  assumed.
- **Dummy values live in `.env.example`**, which IS committed: `.env.example` at the root and
  `server/.env.example` beside it. Every variable the code reads appears there with a placeholder or
  an empty value and a sentence saying what it is for - `SESSION_SECRET` and the three VAPID keys
  are empty on purpose, with the `node -e` line that mints one written above them.
- **No absolute path naming a machine.** `application/vite.config.ts` carried
  `C:/Users/<name>/Documents/Projects/AzerothJS` while the framework was a `file:` junction, and
  this file carried the path to the framework register. Both are gone. A path under `~` is fine; a
  path under `/c/Users/<somebody>` is a person's name in a public file.
- **The `0x…` keys in the tests and in `seed-wallets.ts` are hardhat's published accounts**, which
  are in that project's own README and in a million repositories. They are development fixtures and
  the file says so; nothing else in this tree is key material, and `recovery.ts`'s constant that
  looks like one is the P-256 curve order.

**No comments in code.** Names and structure carry the meaning. This file, and the tests, are
where reasoning is written down.

**Nothing here has shipped. Build the FINAL shape, every time.**

There is no deployment, no live user and no row that predates the current entities. So there is
nothing to be compatible with, and every construct whose only purpose is compatibility is dead code
that will never once do its job: no migration path, no backfill, no compat shim, no deprecation
window, no "keep the old value working", no dual-write, no feature flag guarding an old behaviour,
no adapter from a shape this product never had.

When the schema changes, the procedure is the one written down: **drop the database, boot, and let
`syncSchema` build it from nothing.** Not an `ALTER`, not a repair script, not a note about what an
existing deployment would need to run. A development database that refuses a change is telling you
to rebuild it, and rebuilding costs a seed.

The same applies to values. A row seeded wrong is fixed by fixing the seed and rebuilding, not by
writing an update that corrects it on the way past. A column added with a default that would be
materialised into existing rows is the forbidden backfill wearing a different hat - `groups.privacy`
carries no default for exactly this reason.

This does not license deleting a rule that will matter LATER - `seed-reference.ts` still refuses to
overwrite `games.status` on conflict, because the day a real operator disables a game a deploy must
not re-enable it. The rule is about not writing code for a PAST that never happened, not about
ignoring a future that will.

**Mobile first, then responsive.** The unprefixed utilities are the PHONE layout and every variant
only adds to it for a bigger screen. Never write a wide layout and patch it down. See *Mobile first,
and what a wide-first layout hides* for the four real defects that habit produced, all of which the
680-cell matrix passed.

**Database access is TypeORM, not `DataSource.query()`.** This is a rule, not a preference, and it
applies to every line written from here on: a repository call (`find`, `findOne`, `insert`,
`update`, `delete`, `countBy`, `existsBy`) or a `QueryBuilder`. A wide select list of correlated
sub-queries is still a `QueryBuilder` - `.addSelect('(select ...)', 'alias')` takes the sub-query as
a string while the FROM, the WHERE and the parameters stay TypeORM's, which is the shape to reach
for before giving up on one.

Raw SQL is allowed only where a repository genuinely cannot say the thing, and a sentence beside it
has to say WHICH thing. The list is closed and short: `FOR UPDATE SKIP LOCKED` inside a scalar
sub-query, `pg_advisory_xact_lock`, `INSERT ... SELECT` over `generate_series`/`unnest`,
`ON CONFLICT (target) WHERE predicate` against a partial index, `ON CONFLICT DO UPDATE SET x = t.x + 1`,
`UNION ALL`, `LEFT JOIN LATERAL` with an aggregate, keyset pagination by row-value comparison, and
any predicate using `now()` - that last one because moving a security or expiry window onto the Node
clock introduces skew against the Postgres-side predicates in the same feature.

**Editing a file full of raw queries is not a licence to add another.** Matching the surrounding
style is what kept re-breaking this: the table service was converted from fourteen raw queries to
five, and the next feature written into it added two more. Convert what you touch.

Allman braces, 4-space indent, single quotes, no trailing comma, LF endings. All of it is
enforced by `eslint.config.ts` — `npm run check` will tell you.

## The framework is a dependency

`azerothjs` and all thirteen `@azerothjs/*` packages come from the registry at an EXACT `2.1.0`,
across all three manifests. They used to be consumed from a sibling `../../AzerothJS` checkout
through `file:` specs, which npm installs as Windows junctions; that is gone and three things went
with it.

**Nothing has to be built first.** A `file:` package's `exports` point at `dist/` and npm does not
run `prepare` for a linked directory, so `AzerothJS` had to be built by hand before anything here
would resolve — and re-built after every framework edit, which is a step that fails silently as a
stale `dist/`.

**`azeroth doctor` no longer warns `version skew`.** It compares raw dependency spec strings and
every `file:` link was a different string, so the warning was permanent, meaningless and could not
be fixed from this repository. The pins are one string now and it reports the family on one version.
The note that used to say "do not spend an afternoon aligning it" is deleted with the warning.

**A framework fix arrives by bumping the pin**, which is one visible edit in three manifests rather
than a rebuild in a directory this repository does not contain. That is the same reason the pin is
exact rather than `^`: an upgrade to the thing every component is written against is a decision, and
`@noble/curves` 2.x is what happens when one rides in on a caret.

What did NOT change:

- **`npm ls azerothjs` must still show exactly one node.** Two copies of the runtime means two
  independent signal graphs: effects stop firing, `onCleanup` never runs, and nothing throws. It is
  nine references deduped to one installed copy now. `vite.config.ts` keeps `resolve.dedupe` for the
  same reason.
- TypeScript is pinned to `^6.0.3`. typescript@7 ships the native CLI without the JS compiler API
  that the language server needs.
- The **editor extension** is versioned separately and `azeroth doctor` warns when it lags the
  compiler, because a stale extension keeps its old compiler in memory. That one is the editor's, not
  the repository's.

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
  stores/           locale · focus · scroll
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

## Design system — Arena Blue, one theme

Tailwind v4, CSS-first. **There is no `tailwind.config.js` and none should be created.**
Everything lives in `styles/tokens.css` (`@theme`, the one `:root` palette, `@theme inline`),
`styles/base.css` (element rules, `@custom-variant`, `@utility`) and `styles/app.css` (the
shell, overlay, tooltip and toast CSS that Tailwind cannot see as utilities). The reference is
`design.jpg` (the shell and home) and `me.jpg` (a profile); the spec that turned them into tokens
is `docs/superpowers/specs/2026-09-22-arena-blue-redesign-design.md`.

**There is one theme and nothing that could hold a second.** No `data-theme`, no theme store, no
switch, no `prefers-color-scheme` branch, no light block. The pre-paint script in `index.html`
stamps the language and direction and nothing else, and `theme-color` is `#0B1220`. A second theme
would be a feature to design, not a block to re-add.

**Five surfaces, not one grey**: `sunk #080D19 → void #0B1220 → field #111827 → raised #172133 →
lifted #1B263B`. `void` is the page AND the chrome (sidebar, top bar, right panel, bottom nav);
`field` is cards and list groups; `sunk` a well (inputs, the search pill, segmented tracks);
`raised` hover and inner tiles; `lifted` anything floating. Borders are `line #1F2937` (hairline)
and `line-strong #334155`. Depth is border-led: a card is `border border-line bg-field`, and the
glow is reserved for the primary call to action (`glow-cta`) and the active sidebar row.

**The ink rule, because one ink cannot pass on every fill.** `accent #3B82F6` is for links, "See
all", icons, dots, the focus ring, glows and the headline's accent line - never a fill with text
on it, because white on it is 3.68:1 and fails AA at the size buttons are. Text on blue sits on
`accent-fill #2563EB` (5.17:1). `accent-ink` is WHITE and sits only on `accent-fill` and
`danger-fill #DC2626`; `bright-ink` (the page navy) sits on the light fills - `live #22C55E`,
`gold #F59E0B`, `win #4ADE80`, `madder #F43F5E` - where white fails. `TONE_FILL` in `variants.ts`
encodes it, so a caller asking for a filled badge gets the right ink without knowing the rule.

`madder` is **functional**: it means a table is playing for something. It is never decoration,
and it is not the destructive colour — that is `danger`. `faint #7B8AA3` is the third text tier and
is deliberately lighter than slate-500, which is 3.73:1 on a card and fails for 11px timestamps.

**Type is Inter**, for UI and display alike (`@fontsource-variable/inter`); Persian stays Vazirmatn.
Every heading is the bold sans; Fraunces and Hanken Grotesk are gone. The scale is a scale, not
arbitrary values: `text-ui-2xs` (11) through `text-ui-4xl` (38), `text-ui-input` (16, the iOS zoom
guard, for `Input` only) and four display clamps. Do not add `text-[Npx]` or `text-[Nrem]`. A
page's title is `PageHeader` - `title text-ui-3xl`, an 8px gap to a `text-ui-md` lead, 24px below,
an optional eyebrow and actions - and nine pages used to spell that nine ways, with gaps of 4, 6 and
8px, two lead sizes and three bottom margins, including a 40px display title on the create page.
Only a hero or a profile card stands in for it. Section headings are `SectionHeading`, sentence case
at `text-ui-lg`, with the blue "See all" beside them and a 44px row whether or not they have one, so
two headings side by side line up.

**One gutter, on every side.** `--page-pad` is 16px on a phone, 24 from 640 and 32 from 1024, and
`Page` pads its top by the same amount as its sides - it was 16px at the top under 32px sides on a
desktop, so every page began closer to the top bar than to the sidebar. The social panel starts at
24px so its first heading lines up with the page title beside it. Anything that bleeds to the edge
uses `bleed bleed-pad`, which read the gutter; the settings nav hard-coded `-mx-4` and stopped 16px
short of the edge on a desktop. `tools/qa` measures none of this, so it was measured by hand: every
route at 390 and 1280, the first content's inset and the title's box.

**Shape is crisp**: `rounded-control` (8px) for buttons, chips, icon buttons and inputs,
`rounded-tile` (10px) for rows and tiles, `rounded-panel` (14px) for cards, `rounded-hero` (16px)
for hero cards (`hero-surface`), `rounded-sheet` (18px). `rounded-full` is for avatars, presence
dots, badges, status pills and the search pill.

**The kit, and the one of each that pages reuse.** Lists of rows sit on ONE card divided by
hairlines (`divide-y divide-line rounded-panel border border-line bg-field`), never as a stack of
separate tiles; a row with nothing to act on ends in a chevron. A status is `Badge dot text tone`
(the pill: the dot carries the colour, the word stays neutral). Presence dots: online `live`, away
`gold`, offline `faint`, unknown nothing. A person's header is `ProfileHeader`, used by both the
reader's own page and anybody else's. A hero is `hero-surface rounded-hero`. A count that sits in a
sentence is `<span class="tally">{ n }</span> { label }` with a count-free plural label, because
`tally` forces left-to-right and wrapping a whole phrase in it put a Persian reader's noun on the
wrong side of the number - that bug was in five places.

**The shell** (≥1024): sidebar | a column holding the top bar across the page AND the right panel,
then the banners, then `main` beside the right panel (≥1280). The sidebar lists Home, Games,
Friends, Chats, Leaderboard, Discover and Settings (`RAIL`); the design's Tournaments has no domain
and Discover takes its slot. The phone has the bottom nav (`NAV`: Home, Games, Friends, Chats,
Profile) with counts on Friends (incoming requests) and Chats (unread). The right panel is the
reader's own notifications and their online friends - nothing the server does not record.

**Game art is illustration, not a render.** `application/public/art/games/<game>.svg` (a 3:2 scene)
and `<game>-icon.svg` (the tile) are hand-built vector: sharp at any width and a few kilobytes each.
`tools/art/games.mjs` composes the scenes, because a board in perspective with pieces standing on it
is geometry; the icons are hand-authored. `npm run art` regenerates the scenes. The Blender art
script and its WebPs are gone - the user judged the renders not good enough - and the 3D market's
GLB kit, which is a live scene rather than an image, stays.

**The brand is a sparkle, because Nura means light.** `BrandLogo` draws it inline - a four-point star
and a small one on the accent tile - with flat fills and no gradient ids, because an id-referenced
gradient inside a copy of the logo that is `display: none` (the sidebar on a phone) stops painting
in every other copy on the page. `public/favicon.svg` is the same drawing, and `tools/art/raster.mjs`
renders it to the PNG sizes, draws `share.jpg` (the 1200x630 link preview) from the logo and the
four game scenes, and writes `site.webmanifest`. It needs Chrome, so it takes `QA_CHROME` the way
the matrix does. `og:image` is written absolute by the build when `VITE_PUBLIC_ORIGIN` is set in
the root `.env`, because a link preview needs one; left empty it stays relative, which is right for
localhost and wrong for a share.

**Achievements are medals and empty states are illustrations, both in CSS.** `.medal[data-tier]`
is a metal gradient per tier with the icon engraved in it, and a locked one is a sunk well - so a
row reads earned or not before the words do. `.empty-art` is two tilted cards, a dashed orbit and
the icon disc, toned by the empty state's own `tone`. Neither is an image file, so neither can 404.

The `--world-*` tokens carry the market's own palette and the WebGL layer reads them ONCE, at
`createWorld`. There is no relight path: it existed only so the market could follow a theme change.
`--world-sky` equals `--void`, so the canvas and the page share one ground and the seam disappears.
The kit itself - felt, walnut, brass, cards, dice and figures - is baked vertex colour inside the
GLBs, and the lamps are warm: the market is lamplit, and that warmth against the navy is the whole
picture.

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

## The profile the ecosystem holds

`contracts/profile` in the SmartContract project is the Nura identity primitive — one profile per
address, a global username namespace, and values addressed by `(profile, key, language)` with no
schema of its own — and it is live on Nurachain. `server/src/chain/profile.ts` is the half of this
product that talks to it, and `/app/me` is where a person sees the two agree or disagree.

**The ABI is the SERVER's, and so is the calldata.** The read path needs it anyway, and `viem` is
already a server dependency and NOT an application one — so composing `setFields` in the browser
would be a second description of one contract AND a new dependency inside the landing budget. It is
written as human-readable ABI rather than a compiled artifact: five signatures a reader can compare
against `ProfileTypes.sol` by eye, against fifty kilobytes of JSON nothing here can check. Nothing
on this server signs; `publish` answers with an UNSENT transaction the browser hands its wallet,
which is what keeps a key that could write to anybody's profile out of this process.

**Unconfigured is a state, not a failure.** `NURA_RPC_URL`, `NURA_PROFILE_ADDRESS` and
`NURA_PROFILE_LENS_ADDRESS` are needed together and default to empty, so a deployment pointed at no
chain answers `configured: false` without opening a transport and the panel renders nothing — the
shape push already has without VAPID keys. What it must never do is answer "nobody has a profile"
for a read it could not MAKE: a dropped rpc throws and the page renders the failure, which is the
rule the second audit wrote down when the leaderboard rendered a refused fetch as an empty world.

**The @handle and the on-chain username are two namespaces and stay that way.** A handle is 2..32 in
any script — Persian handles are a feature this file describes and `naming.db.spec.ts` pins — and a
registry username is 3..32 of `[a-z0-9_]`, lower-cased, never starting with `0x`. They cannot be one
identifier without one of them losing, so Games writes NO username: `createProfile` passes the empty
string, the registry name is rendered beside the handle, and claiming one is Nura Wallet's job. It
is also a claim against a global index that can be REFUSED, which is a second refusal path the
profile sheet deliberately does not have — the same argument that gives `/handle` its own route.

**Both fields go under the default language.** An account holds one bio here, not one per language.
Writing it under `en` would hide it from a Persian reader resolving `fa` with fallback, while
claiming to be the English of something nobody ever localized.

**The sync goes both ways, because the other half happens elsewhere.** Publish sends what this page
says; adopt takes what the registry says. A page that could only push would quietly lose whatever
somebody wrote in another Nura application. Only the display name and the bio are compared — a
location or a job title set elsewhere is not drift, it is a field this product has no opinion about
and must not offer to overwrite.

**A publish answers with five outcomes, not a boolean.** Declining in a wallet is not a failure, a
revert is the contract refusing, and a transaction nobody has mined yet is neither. This repository
has twice recorded a screen reporting success before the answer landed; one boolean could say none
of it, so `settled` reports three states and the store waits through `runtime().clock`.

**A guest sees nothing at all.** No wallet means no address means no profile and nothing a button
could fix, and a strip explaining an absence nobody can act on is furniture. That is the branch this
file already records as structurally unrendered by every gate, so it was checked by hand.

**`callsFor` is pure and exported because it is the half that fails SILENTLY.** A read that goes
wrong throws; a write with the wrong selector or a mistyped field key lands in storage nobody reads,
costs real gas, and the chain reports success — the registry stores any key that validates and has
nothing on its side to refuse `displayNmae` with. `tests/chain-profile.spec.ts` decodes both
branches back out with no chain in the room.

**Testing it needs a chain, and a local one is the honest bed.** Live Nurachain holds the contracts
and no profiles, and the wallet fixtures have no gas there. `npx hardhat node` in the SmartContract
project gives accounts 0–5, which ARE `dana.w` through `leila.a`; deploy the implementation, the
proxy and the lens onto it and point the three variables at those addresses. A browser provider can
then be a plain fetch proxy to `127.0.0.1:8545` — the node holds the keys, so `personal_sign` and
`eth_sendTransaction` both work unlocked, and it sets `Access-Control-Allow-Origin: *`. One catch
worth writing down: it wants the message HEX-encoded, which is the step MetaMask does for you.

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

TWO levels here, not three, and `groups_privacy_known` is a CHECK so a third cannot be added without
a WHERE clause to go with it. `tables` had the opposite problem and *Who may sit at a table* says
what happened to it.

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
eight `void`-less calls had nowhere to put. Nothing enforces that now - see *The rules no test holds
any more*.

**Every control on the table page is a `Button` with words on it.** Three of them were not, and each
failed differently. "Take a seat" - the whole point of the watching panel - was an `IconButton`,
which is icon-only with a tooltip, so the primary action of that screen was a bare chair glyph.
Closing the table and showing the chat were hand-spelled `<button>`s with their own class lists.
And the Leave button carried `text-madder` in `props.class`, which lost to the ghost variant's own
`text-muted` - two `text-*` utilities from one layer, decided by CSS source order and not by the
class attribute - so the class had never applied and the button had never been red. Leaving and
closing are both `variant="destructive"` now, which is `danger`: the same red, from the shared
variant, rather than a colour a caller appends and hopes about.

### Who may sit at a table

Four levels, and until this week only one of them was true.

| level | who sees it | in the open list |
|---|---|---|
| `public` | anybody | yes |
| `friends` | the host's friends | yes, to a friend |
| `invite` | whoever holds an invited chair | no |
| `room` | the members of the conversation it was opened in | no |

`private` was renamed to `invite` because "private" says nothing about who, and it was the level
that lied hardest: **`byId` had no privacy check at all**, so a table offered to the person opening
it as *"Only people you invite can sit down"* was joinable by anybody handed the code. `friends` was
empty in the other direction — `open()` filtered on `public` strictly, so a friends table was
invisible to friends as well as to everyone else. Both had shipped, both were in the create form,
and nothing anywhere looked at either.

**One predicate, `visibleTo`, answers all of it**, and every read that takes a table id goes through
it — the same argument the group domain's `VISIBLE_TO` makes: a rule applied to one read and
forgotten on the next holds until somebody follows a link. It is parameterised by the SPELLING of
the viewer (`$1` or `:me`) rather than hard-coded, because it serves a positional `db.query` and a
named query-builder parameter, and a predicate string-replaced at one of its call sites is one that
breaks the day somebody writes a `$10`. A refusal is 404 rather than 403, exactly as a private group
is, because a 403 confirms the table is there.

**A table you are SITTING at is always visible to you**, whatever the level says now. That is not
generosity: a group can close, a friendship can end and an invitation can be withdrawn while
somebody is in the chair, and the alternative is a player whose own game 404s underneath them
mid-hand.

**`tables.room_id` is the conversation a table was opened IN**, which is not the `kind: 'game'`
thread every table OWNS. Pointing at the conversation rather than at the group is what lets one
column serve a direct thread and a group room alike: a group's membership already moves in lockstep
with its thread's, so "the members of the room" is the answer in both cases and there is no second
guest list to keep in step with the first. It replaces a `group_id` that no query ever read.

The foreign key is `SET NULL` and `tables_room_is_private` is written to survive that — see *The
second audit* for why the obvious CASCADE destroyed every match ever played in a group that closed.

**`privacy` and `roomId` are ONE fact and the service resolves it.** A caller able to send them
apart is a caller able to send a `public` table carrying a private group's room, or a `room` table
with no room — and the second of those reaches a person as a 500 rather than as the refusal it is.
So `create` derives the privacy from whether a room came with the request, checks membership once
there, and refuses a conversation the caller is not in with a 404.

**A room table is deliberately absent from the global open list**, even for the room's own members.
That is the whole point of it: the two ways of starting a game stay separate, and the line the
server writes into the room is how the other people learn it is there. `chat.line.table` is that
line, and it renders as the invite card the table domain already had.

**The room's size is the table's ceiling.** Nobody outside the conversation can ever take a chair,
so a four-seat game opened in a thread between two people is a table that can never be ready. The
sheet does not offer it: seat counts above the head count are gone, and a game with no seat count
that fits goes with them — which is what takes four-handed hokm off the list in a direct thread.

**"Start a game" is not disabled with the rest of the composer.** That control's `disabled` means
this conversation cannot be SEALED, which is a fact about messages; a table is not sealed, and the
line announcing it is `{ key, params }` the server authored. A browser that cannot type in a thread
can still open a game in it, which matters because the machine somebody sits down at is often not
the one they enrolled.

Three defects on this path that every gate was green for, each now with a rule:

- **`openTable` in `chat.page` navigated to a url built from a PROMISE.** `lib/open-table.ts` exists
  to make that unwritable, and the rule that guarded it only looked for the call INSIDE
  the template literal — so `const tableId = lobby.host(...)` followed by `` `/app/play/${ tableId }` ``
  slipped past, and the "Start a game" button in every chat thread went to
  `/app/play/[object Promise]`. The rule now refuses HOLDING the promise in a variable, which is the
  step that makes the mistake possible. It also toasted "Invitation posted to the chat" before the
  request resolved, so a refusal read as success.
- **The chat page's thread effect fired on the way OUT with the next route's id.** `params()` is
  shared router state and the page is still mounted while its leave transition plays, so pressing
  that button asked the chat api for a conversation whose id was the table it had just navigated to.
  The group page answered the same thing by opening once in `mount`; this page cannot, because a
  notification moves from one thread straight to another and that is the same route with a different
  parameter. The guard is the pathname instead.
- **A literal 0x1F byte sat in `lib/random.ts`.** `chat/envelope.ts` and `lib/attestation.ts` both
  build their control characters with `String.fromCharCode` and say why in prose; nothing enforced
  it, and nothing does now. The rule that briefly existed was written with character codes rather
  than a regex escape because the same hazard hit the rule itself — a `\b` in a pattern became a
  literal backspace, and it passed against the exact bug it was written for until it was proved to
  fail first. Worth knowing before writing another one.

**The dock under the board is the small things somebody reaches for mid-game.** Sound, the screen,
the room's code and the chat, and every one of them was reachable before only by LEAVING the game -
the table's own cues are `settings.sound`, whose single toggle lives on the settings page under
notifications. Nothing in it is a control with nothing behind it: no music button because there is
no music, no settings gear because it would be a link out of the game wearing the clothes of a
control in it, no overflow because there is nothing left to put in one. The code is there because it
is how a table is reached when it is in no list, which is every table opened from a chat or a group.

**Matchmaking is a query.** `quick(game)` reads the open LIVE tables for that game, claims a chair
at the first one that still has one, and opens a table to wait in only when there is nothing to
join. Nobody is invented to fill it. Three things about that list were wrong for as long as there was
one game, and each put somebody at the wrong table silently:

- **A table with a game running is not open.** A player who left mid-game frees a chair, and the list
  offered it - to a newcomer who would sit in a chair with no seat in the match. `open()` excludes any
  table with an unfinished match.
- **Quick play means live.** A `turns` table is a day per move, and landing in one from a button
  called Quick play is a correspondence game nobody chose. The list takes a `mode` and quick play
  asks for `live`.
- **Fullest first, then oldest.** Newest-first scattered a burst of quick players across a burst of
  fresh tables, one each, all waiting. Filling the nearest-to-full table first is what actually starts
  games.

Quick play also sits down READY, and whoever takes the last chair presses Start - `matches_one_live`
already makes that idempotent, so two people filling the last two chairs at once still make one
match. A quick-play table waiting on somebody to press Ready is a table that never starts because
nobody was told they had to. `catalogue.defaults` opens the SMALLEST seat count of four or more, or
the largest the game plays: the largest was nine-seat poker, which a quick player would wait at all
evening.

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

### Playing more than one table

Somebody can sit at as many tables as they like, and a turn-based game is only pleasant if they
can. `GET /tables/mine` answers `yourTurn` on every seated table with a live match, and the ENGINE
answers it: `match.turnsAt` loads the live matches in one read and asks each game's `turnOf`,
because no SQL can know how hokm's trump pause or ludo's six decides whose go it is. The reader's
seat comes from `match_players`, never from the table chair: a chair can change hands mid-match,
and whoever sits in it then holds no seat in the game and has no go to be told about. A
table with no match, or a finished one, has no `yourTurn` at all rather than a `false` - there is
no go to be had there.

The play page's header lists the reader's OTHER tables as links, green where one is waiting on
them, and the Games item in every navigation counts the tables waiting. The lobby store refetches
the list on any `game` doorbell, which is how a move at one table lights up the chip on another.

**A switch between tables REMOUNTS the play page, so its teardown closes only what it still owns.**
`<Routes>` keys a segment on its route AND that route's own params, so `/app/play/A` to
`/app/play/B` builds a new page. On a phone the old one plays its 260ms leave first and is disposed
AFTER the new one has opened B, so an unconditional `lobby.close()` in its teardown left the new page
on "No such table" until a reload - and only on a phone, because with no transition the old page is
torn down before the new one is built. Each page therefore captures the id it was built for under
`untrack` and closes the lobby, the board and the watch only while the lobby still holds that id or
nothing. `chat.page` guards `closeThread` by its own conversation the same way, and `TableChat` by
the thread it last opened; `play.spec.ts` drives play-to-play and chat-to-chat with a transition
playing. The table still opens from an effect over the pathname rather than in `mount`, and the
leaving page's copy of that effect opening the NEW id is harmless.

## Voice at the table

`docs/superpowers/specs/2026-09-23-table-voice-design.md` is the design. A host turns voice on at
create (`tables.voice`, off by default); seated players join a peer-to-peer call - one
`RTCPeerConnection` per pair, Opus only, a full mesh of at most seven links per browser - and this
server does nothing but introduce them.

**The realtime socket carries the introductions and that is its first non-doorbell frame.** `voice`
joins, leaves and reports a mute; `signal` relays one offer, answer or ICE candidate to one person.
It is not a delivery path for content - an SDP says how to reach a browser, not what anybody said -
and nothing about it is stored. The rooms live in the hub's memory and empty themselves when a
socket closes; a restart drops every call and the client rejoins through `onBack`.

**Who can hear whom is the messaging policy, per PAIR.** Joining asks `social.mayMessage` both ways
between the newcomer and everybody already in the room, and the hub relays a signal only between
two people it allowed. A block, a minor's safety rule and "strangers can't reach me" therefore apply
to voice exactly as to a direct message, and the roster says "can't talk with you" rather than
showing a connection that silently never forms. This is the rule that matters most in a product
whose players include children.

**A `voice` frame is metered by a budget, never by a per-type floor.** The gateway's floors drop a
frame that arrives too soon after the last one of its kind, silently, and a leave sent just after a
mute was dropped that way - the browser believed it had left and the room went on sending it audio.
`tools/qa/voice-pass.mjs` found it on its first run. Signals are budgeted the same way, because ICE
candidates arrive in bursts.

**What the encryption claim is, precisely.** Media is DTLS-SRTP between the browsers. The DTLS
fingerprints ride inside SDP this server relays, so a server that wanted to could sit in the middle;
the chat is end-to-end because every line is signed by a device the reader verifies, and voice
introductions are not signed yet. The copy therefore says the sound goes directly between players
and is encrypted by the browser - not "end-to-end" - until each fingerprint is signed with the
device key the sealing already verifies.

**ICE comes from configuration and a TURN secret never reaches a browser.** `GET /api/voice/ice`
answers `VOICE_STUN_URLS`, and for `VOICE_TURN_URLS` a TURN REST username that expires in an hour
with its HMAC. With nothing configured the list is empty: one network works, two NATs do not, and
the roster says "could not connect".

**The microphone is asked for when somebody presses Join, never before**, and refused or missing it
joins LISTEN-ONLY rather than failing. Everybody joins muted unless they turn that off in settings.
`services/voice.rtc.ts` is framework-free (perfect negotiation, the lower handle is polite, a peer is
opened on its first signal so an offer that beats the roster cannot deadlock), and
`stores/voice.store.ts` takes it through `setVoiceCall` so a spec can observe the store without a
real `RTCPeerConnection`.

`tools/qa/voice-pass.mjs` is two real browsers on Chromium's fake microphone: join, a live remote
track in each, the tone lighting "speaking" in the OTHER browser, mute, leave. Run it by hand against
the built server with every change to this path.

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

**Every refusal has words, and the compiler checks it.** `REFUSALS` in `match/service.ts` maps each
reason an engine can give to a status and a sentence. It is a literal map rather than a
`Record<string, ...>` so `engine-contract.spec.ts` can require every engine's refusal union to be a
subset of its keys - the reasons are type unions and nothing about them exists at runtime to iterate.
An unlisted reason still answers, as "That move is not allowed.", but hokm's were unlisted for a whole
release and every one of them told a card player their TOKEN could not move there.

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

**A game is an `Engine` this server is GIVEN, and the payload is composed per viewer.**
`domains/match/engine.ts` is the seam and `engines/ludo.ts` is the first thing behind it - injected
into `createMatchService` rather than registered into a module-level map, because every other
service here takes its collaborators as arguments and a spec can then build a service around a
fixture engine. Three contracts are not negotiable and each was already true of ludo: `apply` never
throws (the sweep folds actions over a state, and a function that throws for ordinary control flow
is one nothing can fold), every state carries a top-level `rev` (`matches_rev_matches_state` reads
`(state ->> 'rev')::int`), and randomness arrives as a VALUE - there is no randomness inside an
engine to subvert, which is what makes "the client cannot choose a die" structural.

**The wire is an envelope and a board, and the split is the whole redaction story.** `matchPlayer`
is who is in a chair - seat, handle, timeouts, result, rating - and carries nothing about what they
hold. `matchView.view` is a discriminated union the ENGINE composes, and `Engine.view(state, seat |
null)` takes the viewer's seat: a hand a player must not see is never BUILT rather than filtered out
on the way past, which is the rule this product already states about `lastSeenAt`. `null` is
somebody with no chair, so `watch` - which loads a spectator with `mine: -1` - gets a board composed
for nobody through the same function.

That matters because `asMatch` used to walk `state.players` and turn ludo pieces into 15x15 grid
cells for whoever asked. Safe for ludo, where a board is face up; the single thing that would have
leaked a hokm hand the day a second engine landed. `tests/engine-seam.spec.ts` reads `services.ts`
as text and fails if it imports anything under `ludo/` or names a part of a board, and asserts by
PARSING that the envelope drops a colour - the wire being what the parser lets through rather than
what the declaration says.

**The browser mirrors the split rather than flattening it back.** `data/match.ts` is the one place
the union is narrowed (`ludoOf`) and the halves are joined (`chairsOf`), so a screen asks the
question in the same place every time - the argument `visibleTo` makes on the server. A player the
board did not mention is DROPPED, never filled in with a blank colour and no tokens: an invented
chair reads as a fact about the game rather than as a fact about the viewer, which is exactly the
confusion a hidden hand would cause. `YardBadge` takes both halves as two props for the same
reason.

**A log left open is not a redacted game.** `Engine.log(events, seat | null)` is `view`'s sibling and
exists for the same reason: `since` handed back every action's raw `events` column, and
`match_actions` is append-only - so a game writing a deal into its own log would have published every
hand to anybody asking for revision zero, permanently, whatever the board said. The engine is handed
the READER's seat rather than the seat that acted, because redacting for the actor hides a secret
from the one person who already knows it and shows it to everybody else.

**`redaction.db.spec.ts` is the test none of this could have without the seam.** Ludo hides nothing,
so every assertion about hiding over a ludo match passes whether the code redacts or not - the engine
there is a FIXTURE with one secret per seat, injected through `createMatchService`, and the assertion
is over the serialised payload rather than over named fields. Checking one field catches a leak
through the field somebody thought to check; searching the JSON for another seat's secret catches it
through any field at all, including one added later by somebody who never read the test.

**Nothing that records a result knows what was played.** `record.ts` carried `outcomeOf`, reading
ludo's board to tell a played win from an emptied room, beside a `ludoEngine.finish` that read the
same board and answered the same way - two copies of one rule, and the third game would have added a
third. The outcome and the standings come off the engine now, and so does `commit`'s idea of whether
a game is over.

**`player_stats.tallies` is jsonb because `captures`, `rolls` and `tokens_home` were ludo's words on
a table every game shares.** The row is keyed `(user_id, game)`, so a counter's name only has to
make sense within one game; `Engine.tally(events)` folds the ledger, which also moves the fold into
the engine's own tests with no Postgres near it.

**Achievements read tallies BY NAME, so an engine's tally keys are a contract with
`achieve/families.ts`.** A tally family names its counter - ludo's `rolls sixes captures home
enters`, hokm's `hands tricks kots trumps`, backgammon's `games gammons backgammons hits borneOff`,
poker's `hands pots showdowns knockouts` - and renaming one on either side leaves a whole ladder at
zero for everybody with nothing throwing. `ladders.spec.ts` plays every engine to the end thirty
times per seat count with random legal moves and fails if a family names a counter the engine never
produced; a fixture of literal counters would agree with the families whatever the engine calls
them. The rating never reads a tally, and XP reads one only through the engine's own `points`.

**A jsonb counter cannot be incremented the way an integer one can**, and this is the trap. Postgres
has no operator that adds two jsonb objects of numbers: `||` REPLACES a key, so two games finishing
for one person record the second and forget the first - the read-modify-write defect the second
audit closed, reintroduced by the storage changing shape. The upsert sums both key sets through
`jsonb_each_text` and re-aggregates inside the one statement the unique index serialises, and
`record.db.spec.ts` plays two matches expecting five rolls. Also: **`both` is a reserved word**
(`trim(both ...)`), so a subquery aliased that way is a syntax error only a real Postgres reports.

**XP is split where the knowledge is.** `levels.ts` keeps the finish and the win, which are facts
about a match; `Engine.points(tally)` is what a game's own doings are worth, because a capture being
worth two is ludo's opinion and would otherwise have made that file hold the scoring rules of four
games at once.

**One route carries every game's verbs.** `POST /matches/:id/play` takes a `matchPlay` discriminated
by the game's name, the way `matchBoard` and `matchLog` already are for what comes back, and
`Engine.parse(play, seat)` reads it - with the SEAT supplied rather than read off the wire, because
`match_players` is the only join between a chair and a person. A play addressed to another engine and
one that does not add up are both `null`, and both answer the same, because both mean the same to
whoever sent it. `/roll` and `/move` were ludo's verbs on a feature every game shares; three more
games would have been nine more routes over one body of identical authorisation, idempotency and
revision work.

**A play names no destination and cannot carry a die.** A move names one of the caller's own tokens
and the server computes where it lands. The die is drawn INSIDE the engine, from the `Draws` it is
handed, at the moment it applies - `service.ts` used to draw it and build the action around the
number, which put the one value a player must not choose through a layer with no reason to touch it
and into `match_actions.payload`, the column a player's REQUEST writes. The payload is what was asked
for and nothing about what happened; what the die came up is in `events`. `tests/ludo-dice.spec.ts`
reads `schemas.ts` and `api.ts` as text to keep it that way.

**`match_actions.kind` is `play` or `forfeit`, and nothing else.** It was `roll | move | forfeit`,
which is ludo's vocabulary on the ledger every game writes to. What the platform actually reads is
whether somebody STOPPED - `record.ts` tells a walkout from a timeout by asking whether a forfeit
names a person - and nothing branches on the others, so the verb lives in `payload` where an engine's
own words belong.

**`asMatch` reads no state at all.** The seats come from `match_players`, the turn from
`engine.turnOf`, and the winner from `matches.winner_seat`, which `commit` writes from the engine's
own `Ending`. `match_players.colour` went with it: its docblock said it was what the table is joined
on to draw a board, which stopped being true the moment the board became the engine's to compose, and
nothing had read it since. `tests/engine-seam.spec.ts` covers the whole shared path now -
`services.ts`, `watch.ts`, `record.ts` - and fails if any of them imports anything under `ludo/`.

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
force, because playing has two ways to end - a win and a timeout cascade - and a stored copy would
go stale the first time one of them forgot. Closing is NOT a third: `close` refuses while a match is
live, because a host who could close the table mid-game could erase a loss by leaving. Last one out
still closes it, since everybody has gone and the forfeits that follow are the honest result.

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
never `MoreThan(new Date())`, because the deadline is written by Postgres too (`commit` sets it as
`now() + make_interval(...)`) and a Node clock would disagree with it - asks the engine's
`autoplay`, and bumps `timeouts`. The third miss IN A ROW forfeits that seat: any action a person
takes puts their count back to zero, because a count that only ever grew forfeited somebody for three
misses spread across a whole match, and a Sit & Go is two hundred decisions a seat. When forfeits
leave one player standing the match ends `abandoned`. The server's own actions are written with
`user_id = null`, which is what distinguishes them in the ledger.

**The clock is the SERVER's, counted from the moment its answer arrived.** `matchView.remainingMs` is
worked out when the response is composed, and `TurnClock` counts down from the instant it lands -
never `deadline - Date.now()` on the device, which is whatever the phone's clock says and was minutes
out on real hardware. At zero it says the turn is being played for them rather than "0 s", because
the sweep takes up to five seconds to arrive and a clock frozen at zero reads as a hung game.

**A live game holds the screen awake.** `lib/wake-lock.ts` asks for a screen wake lock while a live
match is on the page, asks again when the tab comes back (hiding a tab drops it), and treats a refusal
as ordinary - battery saver refuses it. A phone that dims and locks mid-hand has made its owner miss
a turn.

**The sweep cannot stall, and that is the property worth defending.** `expireNext` is ONE match per
transaction, picked `for update skip locked` INSIDE that transaction - the only place `skip locked`
means anything; a lock taken by a bare select is released the instant the select returns - and it
ALWAYS moves the deadline. A match it cannot play (no engine, `turnOf` null, `autoplay` null, or
`apply` refusing) is pushed a turn into the future without charging anybody a miss, and so is one
whose engine throws, from a second transaction. The first version had neither guard: due matches
were ordered by oldest deadline, so one engine bug put the same match first in every tick and
stopped every turn on the deployment, silently, until somebody noticed nobody's game moved. The
unplayable ones come back to `main.ts` and are logged as `unplayable match`, because a
deadline quietly pushed forever is the same bug with better manners.

`sweepTurns` drains `expireNext` for up to four seconds and the tick is a self-rescheduling five
second `setTimeout`, so two ticks can never overlap and a dead turn is played within five seconds of
its deadline rather than fifteen. At roughly twenty milliseconds an expiry that is about forty a
second per process, against the two a second a fixed batch of thirty-two every fifteen seconds gave.

**`match_actions` is an audit trail, an idempotency ledger and a catch-up feed - and NOT a rebuild
log.** `matches.state` is the authority and nothing replays those rows to reconstruct a board. A
fixed rule would change the fold, and a finished game would stop being a fact.

**`tools/qa/ludo-pass.mjs` plays complete games over the real api**, at two, three and four players,
through the routes a browser uses. It is API-level on purpose: it proves the rules, the persistence,
the turn order, the authorisation and the wire agree end to end, over hundreds of turns, in seconds.
What it cannot prove is that any of it is visible, which is the browser pass's job.

## Hokm

The second engine, and the one the seam was built for: ludo is face up, hokm has hands.

**The rules come from `pagat.com/whist/hokm.html` and the tests quote it.** Deal and play are
anticlockwise, which is the sentence the whole file rests on - seats are numbered in play order, so
"to the right" is `+ 1` and "to the left" is `- 1`, and the dealer (`hakem - 1`) and the rotation
(keep the rank if your side won, else `+ 1`) each come out as one line at every player count.
`dealerOf(hakem + 1)` IS the old Hâkem, so *"the previous Hâkem deals"* is free and there is nothing
stored that can disagree with itself.

**A card is a NUMBER, 0 to 51.** Suit-major, rank ascending, so comparing two cards of one suit is
`>` - which is the entire body of `trickWinner`. The object form would store about twenty times the
bytes in `matches.state` AND in `match_actions.state` on every action, which is the hottest row in
the domain; ludo made the same call for its pieces. `cardOf` and `nameOf` exist so the rules suite
reads like a rule book instead of like integers.

**The deck is stripped until it divides, and every other number is derived from that.** 52 at four,
51 at three (Pagat drops *"one of the 2's"*), and 50 at two - the house rule the product implements,
two twos out and twenty-five each, rather than Pagat's keep-or-reject draw over a stock.
`trickCount` is the deck over the seats and `winningTricks` is more than half of that, so the famous
seven is a MAJORITY rather than a constant: written as a literal 7 the two-handed hand would end on
the seventh of twenty-five tricks with eighteen still in hand.

**The three-handed game keeps its own rules and they are the counter-intuitive ones.** The sweep is
a literal seven of seventeen, not a majority. A hand ends early the moment a lead cannot be EQUALLED
- Pagat's own examples, and the tests are named after them: 7-4-3 plays on, 7-4-4 ends, 8-3-1 plays
on, 8-2-2 ends. And *"if two of players take the same number of tricks then the third player wins"*,
so **7-7-3 is won by the player holding three**. That branch is reachable only last, because a tie
below the top is already settled by the unbeatable lead (9-4-4 pays the nine), and seventeen is not
divisible by three so all three cannot tie.

**The deal pauses and that pause is the hidden-information story.** Pagat asks that the Hâkem's
partner receive nothing until trump is named, so they cannot signal. This deals to the Hâkem ALONE:
during `trump` there is no other hand in the state at all, so no view, no snapshot and no event can
leak one even if somebody later writes a careless projection. A pause that left three hands lying in
the state would be a pause that depended on every reader being careful.

**Two phases, not eight.** The plan sketched a seven-state enum walking the deal round by round; what
a caller can DO is name trump or play a card, so those are the phases. Rounds of five and four are a
dealing ritual with no decision in them, and a state nobody can act in only exists to be stepped
past. There is no `deal.ts` and no `rotation.ts` for the same reason.

**A forfeit ends the MATCH, not the hand.** Four-handed hokm cannot be played three-handed, so there
is nothing to continue with; the side left standing is named so the board can stop and `finish`
reports `abandoned`, which keeps it out of the rating. Ludo's rule, for ludo's reason.

**The log needs no filtering and that is a fact about what is LOGGED.** A card is played face up, a
trump is called aloud, a trick is taken in front of the table and a hand is written on a score sheet.
The one private thing is the deal, and the deal is not an event - so nothing private ever enters an
append-only ledger that `since` replays from revision zero forever.

**`hokm-seam.spec.ts` tests information FLOW, not fields**, and the first version of it was wrong in
a way worth keeping. It serialised a seat's view and searched the bytes for another seat's card
numbers - which is worse than useless here, because a hokm payload is full of small integers (seats,
sides, trick counts, points) and the two of clubs is the number `0`, colliding with a score of nil.
It reported two leaks that did not exist. What replaced it: compute a reader's view, replace another
seat's hand with different cards OF THE SAME LENGTH, compute it again, and require the two to be
byte-identical. That proves the view cannot depend on that hand through any field, named or added
later, however encoded - and the length is kept because how many cards somebody holds is public
across a real table. Proved against four real leaks before it was trusted.

**`Engine.create` takes the table's `target`**, because `tables.target` is on the row and only the
engine knows what to do with it. A hokm engine that assumed seven would have ignored the thirteen
the create form offers and the database already stores. Ludo ignores the argument.

**The opening revision belongs to the engine.** `start` wrote the literal `0` beside the state the
engine had just built - this layer deciding a number the engine owns - and
`matches_rev_matches_state` caught it as a 500 on Start the first time an engine opened at anything
else. It writes `revOf(state)` now.

**`tools/qa/hokm-pass.mjs` plays whole matches at two, three and four over the real api**, and it
checks one thing ludo's pass structurally cannot: every seat reads `GET /matches/:id` for ITSELF
after every turn, and no answer ever carries a card that reader is not holding. `hokm-seam.spec.ts`
proves the engine composes per seat; this proves it survives the route, the projector, the
serialiser and the wire.

**`games.status` for hokm is `available` now**, which is what `table.create` joins on - so the flip
is the thing that opens the door, and it happened in the commit that made it true. `status` is never
overwritten on conflict, so it reached a database built from nothing.

## Backgammon

The third engine, and the first one somebody plays by PLACING things rather than by choosing one of a
handful: a turn is up to four checker moves whose legality depends on each other. `docs/games/02-backgammon.md`
is the rulebook - standard match play to one, three or five points, the cube dead in a one-point
match, Crawford, no Jacoby and no beavers - and `backgammon-rules.spec.ts` holds the move generator to a
naive enumerator written inside the spec, over hundreds of self-played positions.

**The board stages a turn one hop at a time, and the SERVER's rules say which hops are left.**
`moves.ts` exports `stage(side, roll, staged)`, which answers, for any prefix of hops in any order,
the hops some complete legal turn still continues with - so the board highlights only checkers that
can move, only destinations they can reach, and enables "Play the move" exactly when the turn is
whole. The browser imports it from `server/src/domains/match/backgammon/`, the way ludo's path code
imports `ludo/board.ts`: a second copy of the forced-move rules in the client would agree with the
server right up until the position where it mattered. A staged turn is local until it is sent, so
Undo costs nothing and nothing is ever half-played on the wire.

**Every move is a button as well as a tap.** The board is one inline SVG drawn from
`game/backgammon-layout.ts` and is `aria-hidden`; the hops on offer are listed beneath it as real
buttons with sentences for names, and a screen reader is given each side's stacks in words. That is
the canvas rule ludo already follows, for the same two reasons: a keyboard and a screen reader can
play, and the responsive matrix has something to hit-test. The SVG takes the tap itself and turns the
pointer into a point with `pointAt`, rather than twenty-four invisible buttons none of which could be
44px wide on a phone.

**The board is printed, so it does not mirror** - `[direction:ltr]` on its wrapper, exactly as
`.board-plate` and `.hokm-table` do - and the reader's home is always bottom right, whichever seat
the server gave them. Seat 0 plays the light checkers and seat 1 the dark, for everybody.

**The board's `turn` is the seat that must ACT.** While a double waits for an answer that is the
player it was offered to, not the one who offered it - the same seat `turnOf` names and
`matchView.turn` carries. It shipped for one commit naming the doubler, which would have offered
Take and Drop to the player who had just doubled and "waiting" to the one being asked;
`tools/qa/backgammon-pass.mjs` found it on its first run, because an API pass that answers doubles as
whoever the board names is refused with a 403. `backgammon-seam.spec.ts` now pins the equality over a
whole match with doubles in it.

**The board is capped by the viewport's height, not only by its column.** A 16:13 board as wide as a
750px column is 615px tall, which on a laptop put Roll and "Play the move" below the fold - the
board fitted and the game did not. The single column caps the board at `(100dvh - 24rem) * 1.22`;
from `@4xl` of container the controls move into a column beside it and the cap relaxes.

**`tools/qa/backgammon-pass.mjs`** plays whole matches at one, three and five points over the real
api, answering doubles both ways, and asserts at every turn that both players read the same board
(nothing is hidden), fifteen checkers a side and never two colours on one point, and that the winner
really reached the target.

## Poker

The fourth engine: No-Limit Texas Hold'em played as a Sit & Go, at 2, 6 or 9 seats, everybody on 1,500
chips, the blinds rising every ten hands from the level the table was opened at, the last player with
chips the winner. `docs/games/03-poker.md` is the rulebook and the list of decisions - the TDA rule
for short all-ins, the full big blind owed by a short one, no raise when nobody could answer it - and
`poker-rules.spec.ts`, `poker-engine.spec.ts` and `poker-seam.spec.ts` hold them.

**There is no deck in the state.** Each card is drawn from what is left when it is dealt, through the
`Draws` the engine is handed, so no snapshot anywhere holds a card nobody has seen yet - the same
structural answer hokm's deal pause gives, taken further. The ledger keeps a private `hole` event per
seat as an audit trail and `log` drops it; the seam spec forges other seats' holes in the state AND
in the events and requires every reader's view and log to be byte-identical.

**The table passes to the LEFT.** Hokm is dealt counter-clockwise and poker clockwise, so the table
places the next seat to the reader's left; `poker-board.spec.ts` pins it. See
`docs/games/03-poker.md`, *The table*, for the pot split the view shows and why a folded player is
sent no cards.

**Poker only runs live, so the matrix keeps a game going.** Its heads-up QA table is opened live and
the sweep can finish it mid-run, so before each poker cell the matrix restarts the game on the same
table - the chairs and the readiness survive a finished match, so that is one request - rather than
touring a lobby for the rest of the run.

## Drawing the board

The Ludo board and its pieces are **vector art drawn from the rules' own geometry**, all of it by
`tools/art/boards.mjs` (`npm run art`). It imports `application/src/game/layout.ts` for where the
grid sits and `server/src/domains/match/ludo/board.ts` for the ring, the home runs, the starts and the
safe squares, and writes `ludo-board.svg`, four `pawn-<colour>.svg`, `pawn-shadow.svg` and
`ludo-dice.svg` into `application/public/board/`. So a start square, a star or an arrow cannot sit
anywhere the rules do not put one, and the generator throws if the ring stops being 52 cells.

The board has been a Blender photograph, a glossy vector board, a satin render and the vector board
again, and it is now a **cartoon**: the owner asked for one that feels like childhood, "because it is
just ludo". The spec is `docs/superpowers/specs/2026-09-23-ludo-cartoon-board-design.md`. One indigo
ink line (`#2A1E5C`) on every shape, flat colours a shade brighter than the pieces, sticker shading
(a lighter band across the top, a darker lip under the bottom, never a gradient), cream card inside a
toy-wood frame, round yard houses whose four seats are recessed rings, chunky outlined stars, and a
gold star at the centre.

**The board and the pieces are ONE paint and ONE line.** `PAINT` in the generator (`fill`, `light`,
`dark`, plus `tint` and `well` for the seats) colours the board and the pawns alike, `INK` outlines
both, and `--ludo-*` in `tokens.css` and `TONE` in `ludo-board.ts` are the same four fills - kept equal
by hand. The pieces went glossy studio render, toon render, and finally flat vector, and each step
was the owner seeing that the pieces came from another box than the board: a 3D die and a 3D pawn on
a 2D cartoon board do not belong together however well either is lit.

**The pawn is a chunky 2D peg**: plinth, bell and ball head in the board's sticker shading (a light
stripe on the lit side, the dark side, a white glint) under the board's indigo line, drawn in a
256-square sprite whose foot is at 199 so it keeps the geometry the renderer places by - 170 pixels
to the square, drawn at 1.687 squares so it fills its square like a toy piece, sitting `DROP` below the
cell centre. Depth is y, as for any standing piece. The die is a flat sticker face with indigo pips,
eight slots of 256 in one sheet. Nothing is printed on a pawn's head: the letter that used to be there
was a smudge at phone size and a sticker at desktop size, and the yard, the plates and the move list's
words already say whose piece it is.

**A finished pawn stays on the board**, at 0.62 in its colour's triangle (`HOME_SLOTS`), where it used
to vanish from the view entirely. Two to four pawns on one square stand side by side (`STACKS`), and
`game.spec.ts` holds every footprint inside its tile - which is how it found that the art spec's own
two-pawn layout overhung the square.


**The grid does not fill the board, and assuming it does is a bug you look straight at.** The
fractions come from the old atlas and the generator keeps them exactly, because the canvas, the DOM
fallback and the art all place things through them:

```
RIM    = 0.016 / 0.380              the wooden frame
MARGIN = RIM + FIELD * 16 / 992     where the first cell actually starts
CELL   = FIELD * 960 / 992 / 15     one square
```

With the paper's own numbers instead, every token near an edge sits about a quarter of a cell too
far out, exact in the middle and worst in the corners. The yard wells have the same trap from the
other end: they are drawn at `NEST +/- NEST_SPREAD`, which is a POSITION, and `centreOf` adds the
half cell that turns an index into a centre - so `seatsFor` subtracts 0.5 before it hands a parked
token over.

**The house sits in the middle of its yard**: each yard's four seats sit in a disc (`NEST_RADIUS`
1.9, seats 0.8 apart, each seat 0.36 of a square) centred on the yard. It was pushed 0.7 squares
inward while the players were drawn in the yard's outer corner; once they moved beside the board the
owner asked for it back in the middle. `NEST` lives in `game/layout.ts` and both the art and
`seatsFor` read it, so a parked token cannot sit anywhere but on its own seat.

**The players sit OUTSIDE the board, at their own corner.** They were drawn inside their yards for a
while - an avatar in the corner, a name along the edge - and the owner asked for them out, which is
what Ludo King and Ludo Club do: the yard belongs to the pawns. `.ludo-frame` is a grid: on a phone a
row of plates above the board (the two top yards) and a row below (the two bottom ones), which is the
empty ground a portrait phone has anyway; on a container of 44rem or more they become compact cards
in two side columns, so a desktop board keeps its height. A plate glows in its colour on its turn and
carries the die that was rolled.

**The board is DOM, and there is no Phaser.** It was a Phaser scene - about 350 KB gzip, a WebGL
context to leak, a deferred destroy, a boot that QUEUES rather than starts - to move sixteen pictures
around a square. `game/board/ludo-board.ts` builds plain elements into the board's host and animates
them with the Web Animations API, and the whole chunk is about 5 KB. Every position is in `cqi`: the
host sits inside `.board-plate`, which is an inline-size container, so a piece at `translate: X Y` in
container units stays on its square at every size with no resize code at all, and the browser draws
the images at device resolution for free. A walk is one animation of the piece through every square
it crosses plus an arc on its lift; the idle hop of a movable pawn and the turning dashes of its ring
are CSS keyframes. `application/src/game/` stays framework-free exactly as `world/` is, and
`tools/budgets.mjs` requires every registered renderer to sit in a lazy chunk of its own under 16 KB.

**`components/games/boards.ts` decides which BOARD COMPONENT draws which game**, and the play page
and the spectator view both go through it. The page used to load `hokm-board` for hokm and
`match-board` for everything else, so a third game was drawn as an empty ludo plate with no controls
and nothing logged - and `WatchBoard` drew a ludo canvas for every game, which is why spectating a
hokm table showed an empty ludo board for as long as hokm existed. A game with no entry renders
`match.cannotDraw` with a reload, which is the state an old tab reaches the day a new game goes live.
`catalogue.playable` is `available` on the server AND an entry here, and it is what every Play button
reads, so a client can ship before the server flips a status and never offer a game it cannot draw.
The leaderboard keeps `status`, because a board of results needs no renderer.

A spectator gets the same board a player does, with no `mine`, which every board already reads as
"no controls". It has no clock either: a watcher's board is thirty seconds old, and a countdown for
the live turn beside a board from three moves ago says two different things at once.

**`game/scenes.ts` decides WHICH renderer draws which game, and it is the only place that does.**
`board-canvas` named one module, one export and one image file, so a second game's board meant
editing the component every board goes through - and the build gate asserted the lazy chunk by the
literal filename `ludo-board-`, which would have gone on passing while a second scene rode into a
route chunk unmeasured. The registry's loader is a FUNCTION returning a dynamic import, so a
renderer lands in its own chunk rather than in every route that renders a board. A game with no
scene falls through to the plain DOM tokens, which is the rule `lib/lines.ts` follows for a line key
it has never heard of. `budgets.mjs` reads that registry - one dynamic import per registered scene,
each module on disk and in a chunk of its own - so the rule is about the property rather than about
one file.

**The board is the illustration, not the interface.** Every move is takeable from a button beside
it, the turn is an `aria-live` region, and the pieces are `aria-hidden` inside a labelled host. That
is what makes the game playable by keyboard and readable by a screen reader. Pointing at a token is a
shortcut to the move list and nothing more: a tap anywhere near a token the server called legal picks
it (`pickNear`), and a tap on anything else does nothing.

**`/app/play/:id` is in the matrix now**, and was not for a long time - so the one route carrying a
board was the one route the 640-cell gate never toured. `matrix.mjs` seats a second wallet fixture,
readies both and starts a match in its setup, reusing a live one when a previous run left one
behind. It tours a ludo board AND a backgammon board now, each found by GAME: it used to reuse
whichever live match the account had, so which board the gate toured depended on what the last
hand-run pass happened to leave behind. Both are opened as `turns` tables, because a live table's
sweep forfeits two absent players within a few minutes and the rest of the run would tour a lobby.
It tours a heads-up poker table too, kept dealing as *Poker* describes. The matrix is 800 cells.

**A move is drawn over time, and the renderer decides only that.** A token walks the squares it
really crossed - `game/board/path.ts` asks the SERVER's own `ludo/board.ts` which ones those are,
rather than the renderer keeping a second copy of a fifty-two square ring that would agree right up
until somebody edited one - so a capture happens on the squares it happened on instead of the piece
cutting across the middle of the board. A captured token is knocked back to its yard with a spin,
because being sent home is done TO a piece and must not look like a move its owner chose: it flashes
white, arcs up and spins as it flies, and a ring bursts where it stood. A token that comes home walks
the home run, slides into its triangle and a gold ring bursts. Each step of a walk is an arc - the
pawn lifts off the square while its shadow stays on the ground - rather than the piece swelling in
place. A second update landing mid-walk cancels the first rather than queueing behind it, because the
newest state is always the one worth being on the way to.

**What happened travels with what is.** A move's reply carries `events` - the redacted log since the
revision the caller acted on - and a nudge reads `since` instead of the whole view, so the board is
told what happened as well as where things stand. The reply's events are composed by calling the
match domain's own `since` after the action, which is the same membership check and the same
per-reader redaction `redaction.db.spec.ts` already holds, rather than a second path for the log to
leak through. The store keeps the reply's match beside the fetched one and answers whichever has the
higher revision. The first thing this bought: a roll that passes the turn used to be invisible,
because by the time the view arrives the die is already spent and gone. The renderer now reads the
beats, and a roll followed by a `pass` tumbles, wobbles and dims before it fades - "deny" and a red
tint for three sixes. A batch already on screen when the board mounts is never replayed.

**The affordance ring is two strokes, white inside dark, and that is not decoration.** It began as a
glow in the token's own colour, on the reasoning that a white ring on a yellow piece against cream
paper is a ring nobody sees - which is true, and which misses that a red ring around a red piece in
the red yard is invisible exactly where every game begins. Two strokes is the trick a map legend
uses: the white carries on walnut and on red, the dark carries on cream, and neither depends on
which colour is playing. It lies on the ground as an ellipse under the foot and turns as twelve
dashes while the pawn hops; the old breathing circle was 1.17 squares across and spilled onto the
neighbours. Under reduced motion the pawn simply stands lifted inside a solid ring.

**The table's sounds: one engine per page, unlocked by a real tap.** `game/sound.ts` holds ONE
`AudioContext` for the whole page, shared by every board through counted handles: `createSound` takes
one and `dispose` gives it back, and the last one back SUSPENDS the context rather than closing it, so
switching tables never has to unlock audio again. The spec is
`docs/superpowers/specs/2026-09-23-table-motion-sound-design.md`; the rules that cost something:

- **`pointerdown` is not a gesture on an iPhone.** The context is created and resumed inside
  `pointerup`, `touchend`, `click` or `keydown`. The old engine armed on `pointerdown` and never
  called `resume()`, so every table was silent on iOS and Chrome logged "The AudioContext was not
  allowed to start" on a cold deep link - which the matrix counts as a failure.
- **The cue of the unlocking tap still plays.** `resume()` is asynchronous, so the tap that unlocks
  would otherwise lose its own sound; a `resuming` flag lets cues be scheduled while it is on its way.
  Outside that window nothing is scheduled on a context that is not running.
- **An interruption re-arms it.** A call, Siri or a screen lock puts WebKit into `interrupted`; the
  `statechange` listener puts the tap listeners back, and a context still not running 300ms after a tap
  is rebuilt, because WebKit's can get stuck there.
- **Recorded foley, synthesised interface.** Cards, dice, wood and the two jingles are CC0 recordings
  from Kenney (`tools/art/sound-src/`, with their licence), trimmed and encoded to 96 kbps mono MP3 by
  `npm run sound` and packed into ONE file, `game/sound/table.cues` - an `NCUE` header, a JSON index
  and the takes back to back - imported through `new URL(..., import.meta.url)` so it lands hashed in
  `/assets/` and is cached as immutable. One file is one request instead of seventeen, and the neutral
  extension is load-bearing: a download manager (IDM and its kind, common among Persian users)
  intercepts any `.mp3` a page fetches and hands the page an empty 204, which is how the first build of
  this was silent on the owner's own machine while curl got a perfect 200. The turn, the ticks,
  trump, trick, bonus, pass and deny are synthesised. A recording that failed to load falls back to its
  synthesised voice or to silence and never throws, which keeps "nothing can 404 halfway through a game"
  true in behaviour. `assetsInlineLimit` refuses to inline the pack, and `tools/budgets.mjs` requires
  exactly one pack in `dist/assets`, at most 160 KB, and no file there with a media extension at all.
- **Mixed like a game, not like a web page.** Three buses (foley 0.9, interface 0.45, jingles 0.6) into
  a 0.7 master and a limiter; each play varies its rate by up to 10% and its level by 1.5 dB, rotates
  through the takes, is panned by where it happens, and the same cue is not started more than three
  times at once or twice within 35ms.
- **A hidden tab hears only what is urgent** - the turn and the ticks - and the iOS audio session is
  `ambient`, so the silent switch mutes it and it mixes with the player's music.
- **Sound is on by default**, because a native game starts with sound; nothing plays before the first
  tap, and the dock and the table menu turn it off in one press.

**The board does not mirror, and `.board-plate` and `.ludo-frame` declare `direction: ltr` to say
so.** Everything else in this product is authored in logical properties precisely so it flips with
the reading direction, but a ludo board is a printed object: red is in the corner it is printed in,
and the pieces over it - and the plates beside its corners - have to agree with the print, whatever
language the page is in. The DOM fallback places its tokens with
`inset-inline-start`, which on a Persian page measured from the other edge and put every token in the
yard diagonally opposite its own. One line on the container keeps the house rule and fixes the object,
rather than spelling one child in physical properties and hoping the next one remembers.

**The two fractions are derived once.** `.board-token` carried `--rim` and `--cell` as percentage
literals beside the ones `game/layout.ts` derives from the art - two descriptions of where the grid
sits inside the plate, agreeing exactly until somebody edited one. The component sets them from
`layout.ts` now, and `application/tests/game.spec.ts` pins that the fallback's own box arithmetic
(`rim + col * cell + cell * 0.10`, `cell * 0.80` across) lands exactly where `centreOf` and
`tokenRadius` put the drawn one.

**An effect that hides its only signal read behind an optional call subscribes to NOTHING.**
`handle?.show(props.view)` short-circuits while the renderer is still being imported, so the first
pass reads nothing, registers no dependency, and the effect never runs again - and the board draws the
position it was given at mount for the rest of the match while the panel beside it updates every turn.
Nothing throws and nothing logs. `world-canvas` has always had the right shape and this is what it is
for: read the signal into a local, THEN reach through the handle. Nothing checks it now, and the
difference exists nowhere else, so it is on the reader.

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

## The messenger

**On a desktop the list stays beside the thread.** At the `sidebar` posture both chat routes are two
panes - `ChatList` in a 22rem pane, then the thread or a "pick a conversation" well - because a
desktop messenger that throws the list away to open a thread is a phone layout on a big screen. Both
routes carry `messenger` in their meta: it hides the social panel and, unlike `immersive`, does NOT
fold the sidebar, so moving from the list to a thread changes nothing but the right-hand pane. A phone
keeps the two pages it always had, pull-to-refresh and all, which is why the split is a posture and
not a container query: `Page` owns the scroll, and a list pane has to own its own.

A route with a new parameter is a NEW page here - `chats/:id` remounts on every switch - so the pane
is rebuilt each time somebody opens a conversation. The desktop has no transition, so nothing flashes;
what would be lost is the reader's place, and the pane keeps its tab and its scroll position in module
memory for exactly that. It deliberately does not keep the search text: a query over message previews
is a fragment of what was said, and module memory outlives a sign-out.

**One bubble, one grouping rule, two places.** `MessageBubble` draws the chat page AND the table's
panel, and `lib/thread.ts` decides both: a run is one sender's `text` lines no more than five minutes
apart on one day, a server line never joins a run, and a day divider leads the first line of every
day. The table panel used to lay out its own rows, which is how it came to look like a different
product from the chat page beside it. The time sits INSIDE the bubble, reserved by an invisible copy
of itself at the end of the text so the last line never runs under it - a relative "3 seconds ago"
under every line was the noisiest thing on the screen.

**A bubble's words follow their own direction and everything else follows the page.** The bubble is
`dir="auto"` so an English line on a Persian page reads left to right - which means a logical
corner class on it follows the WORDS: an English run joined its corners on the far side of a Persian
page. The joined corners are physical and chosen from the page direction and whose line it is, and
the time carries `dir={ locale.dir() }` because it is interface text, not the message ("PM 1:58"
under a Persian line on an English page otherwise). The tooltip's rule, met again.

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

## Five things that were written and never called

Each of these was built, reviewed and left wired to nothing, and every gate was green over all of
them. They are grouped because the shape repeats: something is declared, something else is supposed
to use it, and nothing ever does - which no test catches, because a test asserts what the code does
rather than noticing what it never does.

**The turn sweep had no caller.** `match.due` and `match.expire` were written, tested against a real
Postgres and driven by nothing - so a turn that ran out was never played, no seat was ever forfeited,
and a table somebody closed the tab on sat on its deadline forever while this file described the
sweep in the present tense. `main.ts` runs it now, beside the expiry sweep and cleared in the same
`beforeShutdown` - see *A turn that runs out is played* for why it is no longer a fixed interval.

**`chat.line.result` and `chat.line.invite` had no producer**, and `MessageKind` reserved a slot for
each. `lines.spec.ts` was supposed to be the rule - a key with no producer is filler copy - and it
only ever checked the `chat.line.group.*` keys, which is how two slipped past it for months. It
checks every key now, and the group keys keep a shape of their own because they are composed from a
suffix and never appear whole in the source.

`declareResult` writes the result line into the table's own thread, and it lives in its own
zero-import module because a game ends TWO ways - somebody plays the last move, or the sweep
forfeits the last player holding a turn - and both have to say it identically. A game somebody won
names them; a room that emptied does not, and must not, because the engine calls the last player
standing a winner so the board can stop.

The invite line goes in the TABLE's thread rather than into a direct message. A line in a DM would
create a conversation between two people as a side effect of an invitation, which is a thing nobody
asked for; who was invited is part of this room's history the way who joined a group is part of
that one's.

**Nothing told anybody it was their go.** `game_rules` offers ludo in `turns` mode, whose deadline is
twenty-four hours, so the product's answer to "whose go is it?" was to keep opening the page. The
`turn` notification is written only for `turns` tables - a live table gives forty-five seconds to
somebody already looking at the board, so one per turn there is noise nobody wants, and the sweep
plays the turn of anybody who walked away. Its dedupe key is the MATCH, because `table:<id>` is what
an invite to the same table already uses and one key shared by two kinds is two things collapsing
into one row that says neither.

**Nothing ranked anybody.** `player_stats` made a leaderboard possible the day it existed.
`GET /catalogue/games/:game/leaderboard` is unguarded with the rest of the catalogue and has a
five-game floor: one win from one game puts a new account at 1216 and, on an empty board, at the
top - which says nothing about anybody and makes the board a measure of who played most recently.

**A courtesy must not be able to fail the thing it is a courtesy about.** The first turn notice ever
written hit a stale CHECK and turned a perfectly good roll into a 500: the game had been played, the
row was written, and the person was told their move failed. Everything that runs after a move has
landed - the result line, the invite line, the turn notice - goes through `courtesy()`, which is the
rule `wake` already followed for push.

## A changed CHECK is not a schema change TypeORM makes

`synchronize()` creates a CHECK constraint on a new table and leaves a CHANGED one exactly as it was
on a table that already exists. `notifications_kind_known` gained a sixth kind in the entity; both
real databases went on refusing it.

**No test could have caught it, and that is the part worth keeping.** `schema.db.spec.ts`,
`converge.db.spec.ts` and the snapshot recorder all build a database FROM NOTHING, where a changed
constraint and a new one are the same thing - and the documented check after a schema change, "drop
the database, boot, and let `syncSchema` build it from nothing", passes for exactly the same reason.
Production runs the same function through `npm run schema:sync`, so a deployed database would have
kept the old rule forever.

`rewriteChecks` is the third thing `syncSchema` exists for, beside the extensions and the six
hand-built indexes. Every `@Check` the entities declare is dropped and re-added rather than compared,
because Postgres stores one normalised (`(kind)::text = ANY (ARRAY[...])`) while the entity declares
it as somebody wrote it, and any textual comparison is a guess that fails open. The cost is a
validating scan per constraint on a sync - a development boot or a deliberate `schema:sync`, never
something a request waits for. `not valid` is deliberately not used: a constraint that is not
validated is one that lets the rows it was added to stop obeying it.

## The play pass

`tools/qa/play-pass.mjs` is two real browsers playing one game through the interface, run by hand
against the built server. It seats two wallet fixtures at one table, presses Start, takes ten turns
by CLICKING the roll button and the move list, plays the rest out over the api, and then asserts in
BOTH browsers that the finished game is still on screen, says what it did to the ratings and offers
another.

It exists because of what the other gates cannot see. `ludo-pass.mjs` plays complete games over the
api in seconds and never presses a button; `npm run qa` tours the play route in 680 cells and never
presses one either. Everything this checks was found by hand, one at a time: a board that drew the
opening position for an entire match because an effect subscribed to nothing, a fallback drawn on
top of a working canvas, a resign button drawn over the one that opens the chat, a finished game
that vanished at the moment it had something to say. Every one of those is a green matrix and a
wrong product.

Two of its assertions are deliberately made in the OTHER browser, because a move only the mover can
see is the failure it exists to catch.

**`tools/qa/hokm-play-pass.mjs` is its sibling, and a separate file rather than a parameter.** The
two games are different interfaces with different failure modes: ludo's is a canvas with a dice
button beside it, and what goes wrong there is a board drawn twice or drawn once and never again;
hokm's is a hand of buttons, and what goes wrong there is a legal card that cannot be pressed, an
illegal one that can, a trump chooser offered to the wrong seat. It opens a TURN-BASED table, because
a live one sweeps a turn nobody took and a pass that pauses to read the other browser between clicks
would have its cards played for it halfway through and report a product defect.

**It checks that the table cloth and the deck really loaded**, which is the one thing no other gate
in this repository can see at all. The table's two layers and `deck.svg` can 404 leaving a
table with no felt and a hand of blank rectangles, each carrying a perfect accessible name - the
matrix reads overflow, hit targets, a landmark and the console, and a missing background image is
none of them. The only way to know is to fetch the url again from inside the page and read what came
back - every layer of it, so a table whose felt loaded and whose ornaments did not still fails; the
check answers 0 for a broken file and -1 for no such element, because a pass asking the
wrong browser at the wrong moment is a different failure from a broken build. It was asked at the
DEAL first, and at two players the deal pauses with cards in the Hâkem's hand and nowhere else - so
it passed or failed on which fixture happened to be Hâkem. It is asked after trump is called now, of
the browser that did not call it.

**`backgammon-play-pass.mjs` and `poker-play-pass.mjs` are the other two games' siblings**, and share
`tools/qa/seats.mjs` - the browser, the wallet sign-in and the recorder the first two each wrote out
for themselves. Backgammon plays eight turns by pressing Roll, Double, Take and the move list, poker
eight actions through Check, Call and a raise from the slider's presets with one browser on a phone,
and both finish over the api and assert the result in both browsers. What "the other browser saw it"
means had to be the BOARD rather than the status line: after a roll it is still the roller's turn,
so the opponent's "Dana is playing" is rightly unchanged, and the first version of the pass called
that a defect.

## The table, and the cards on it

Hokm is played on `hokm-table-wide` (16:10) or `hokm-table-tall` (5:6), chosen by the board's
container width, and dealt from `deck.svg` with `card-back.svg` for everybody else's hand.

**A table is two layers: a photograph of the object and a drawing of its ornament.** The felt, the
bevelled walnut rim, the brass inlay and the dark groove are rendered by `tools/blender/surfaces.py`
in Cycles - real geometry, so the rim casts its shadow onto the edge of the cloth - from Poly Haven's
CC0 `scuba_suede` (taken to grey and tinted baize green, with a procedural mottle and nap on top,
because a flat fill reads as plastic) and `dark_wood`. The rim is a hand-built mesh with no UV map, so
its wood is mapped in OBJECT space; mapped by UV it sampled one pixel and came out a flat orange. The
gold lines, corner flourishes and medallion stay vector in `hokm-ornaments-*.svg` from
`tools/art/boards.mjs`, laid over the render as a second background, because a thin gold line is the
one thing a photo softens and a vector keeps sharp at any size. Each render is about 25 KB, since
smooth cloth compresses well. The deck comes from `tools/art/deck.mjs`, and the suits from
`tools/art/suits.mjs`, which the game illustrations use too, so a spade on a card and a spade in the
hero art are one path.

**Two tables, not one stretched.** A phone column is taller than it is wide and a desktop one is the
other way round; a single image at `100% 100%` would squash the corner flourishes and the medallion
into ovals on one of them. Everything on the felt is placed in percent and `cqmin`, so the seats and
the trick follow whichever table is showing.

**The sheet's grid IS the card number.** A card is numbered suit-major with the ranks ascending, so
the column is `card % 13` and the row is `card / 13` and there is no packing for the client to know.
A sheet laid out to fit its pixels would be a second fact that has to agree with a constant in
`data/cards.ts`, which is the shape of mistake this file keeps recording.

**The edge and the corner radius are CSS, not drawn.** They are the two things that have to stay
crisp: a hairline baked into the sheet is a grey smudge by the time a card is 44px wide on a phone,
and a drawn corner cannot let the felt through. `.card-face` reads `--card-w` from its parent, so the
hand, the trick and the last-trick tile each size their cards by setting one variable.

**The fonts in the deck are system serifs.** An SVG used as a background image cannot load a web
font, so the indices ask for Georgia and fall back through Times to any serif. That is also why the
indices are large: they are what shows of a card overlapped in a hand.

**A playing card is a printed object and looks like itself in any light** - the face was once
`bg-field`, which made every card on the felt a hole.

**The layout follows the reference and the rules, not a generic card table.** Seats are placed by
their place round the table - bottom, then right, top and left at four; top-right and top-left at
three; top at two - and the trick lies between each seat and the centre. On a phone the order is
table, hand, then the tiles, so the cards you are holding are never below the fold; on a wide
container the tiles (trump, score, last trick) are a column beside the table. The hand fans with a
step that shrinks to fit, and breaks into two rows past thirteen, because twenty-five cards in one
row on a phone is a strip twelve pixels wide per card.

**Sort is the reader's, and it moves nothing on the server.** `arrangeHand` puts trump first,
alternates the colours after it and holds each suit high to low, which is how people hold cards; the
server's order is suit-major ascending and stays what `view.hand` is.

**Each board is its own chunk.** The play page loads `hokm-board` or `match-board` through a dynamic
import once it knows which game the match is, and renders it through `<Dynamic>` with a props THUNK,
so match updates flow into the loaded board the way direct markup props would. The route chunk fell
from 17.8 KB to 9.1 KB, and a Hokm player never downloads the Ludo UI.

**`table-seats.ts` puts the reader at the bottom**, whichever chair the server gave them, and it is
shared because poker and backgammon want the same table. Play passes to the RIGHT - counter-clockwise
at a real table, clockwise on a screen looking down at one - so the next seat is drawn to the reader's
right and the angle decreases. Backwards, a four-handed game still works perfectly, because partners
are opposite either way, and everybody watches the turn travel the wrong way round the table all
evening.

**A name carries `dir="auto"`.** This is the rule a chat message already follows and for the same
reason: a display name is somebody's own content and has its own direction. Without it a Latin name
inside a Persian tile is clipped at the line's end, which in an RTL line is the LEFT - so
`Bot 63848b` truncates to `...t 63848b` rather than to `Bot 638...`. Nothing overflows, nothing logs,
and the accessible name is perfect. It is fixed on the hokm board; **every other place this product
renders a display name still has it**, because nothing else passes `dir="auto"` to a name.

## The game screen gives the table everything

A game is the one screen in this product somebody looks at for twenty minutes without scrolling, so
the rule for it is the opposite of every other page: the chrome gets out of the way and the table
takes what is left. Each of these was a defect found by playing on a phone, and none of them was
visible to a gate - the matrix passes a board that needs scrolling to reach its own dice.

**The shell steps back on an `immersive` route.** At sidebar width the 15rem sidebar collapses to
the 4.5rem rail, which is 170px handed to the table; on a phone, and on ANY screen 540px tall or
less, `bareFor` drops the top bar and the nav as well. The second half matters because a phone
turned sideways is 844 wide, which is rail posture, and the top bar plus the rail took 130px of a
390px-tall screen. The keys banner is not drawn on a game route either: it is about reading
messages, and the table's chat already says the same thing where it applies.

**Everything needed to play is on the table, and most of it is on the board.** Ludo sits on a
real wooden tabletop: `ludo-table.webp` is rendered by `tools/blender/surfaces.py` in Cycles from
Poly Haven's CC0 `wood_table_001`, lit evenly from off-axis, with the specular turned down because an
orthographic camera looking straight down sees every overhead lamp as a white disc. The lamp pool and
the vignette are CSS gradients over it, because the photo is cover-cropped to a phone's tall table
and a desktop's wide one and a baked pool would sit in the wrong place on both. A felt table like
hokm's was tried here and taken back the same day: the user liked this tabletop and wanted the BOARD
on it improved, which is a different thing.
Each player is drawn INSIDE their own yard - `YardBadge`: the avatar in the
yard's outer corner, a name pill with the four home dots along its outer edge, and the die they rolled
beside the avatar - so there is no row of cards above and below the board taking height from it, and
the board is the full width of the phone. Whose turn it is is the whole yard breathing in its colour.
The badges are `pointer-events: none`, so a tap on a token in the yard goes through to the token.

The roll is a die in the MIDDLE of the board, a real `<button>` named "Roll the dice", shown only
when the reader can roll: tap it, it shakes while the request is in flight, and it is gone; the tokens
that can move then glow and a tap on one moves it. The strip on the table under the board carries the
turn, the clock, a one-line hint ("Tap the die in the middle of the board.") and the move choices,
which are the keyboard and screen-reader path to the same moves. On a 390x844 phone the roll used to be
100px below the fold; now nothing scrolls. The table bleeds almost to the screen edge on a phone
(`margin-inline` against `--page-pad`), and hokm's table does the same.

Everything on the board is placed from `game/layout.ts`: the board stage sets `--cell-cq` and
`--margin-cq` in `cqi` from `CELL` and `MARGIN`, so a badge sits in its yard at every size for the
same reason the tokens do, and scales with the board rather than with the screen.

**The dock is in the header.** Sound, full screen, give up and the chat are icon buttons at the right
of the title, and the table code is a copy chip in the subline - the same pattern a native game uses,
and it frees the bottom of the screen, which is where the thumb is. Giving up asks first
(`match.resign.*`, which had copy and no caller): it used to be a bare ghost button that ended the
game on one tap.

**A rotated phone gets a real landscape layout.** Ludo's table becomes two columns - the board sized
by the screen's HEIGHT, the strip beside it - which is also what a container of 44rem or more gets on a
desktop. Hokm uses the wide table, capped by height, with the hand overlapping its bottom rim. Both are
`@media (orientation: landscape) and (max-height: 540px) and (min-aspect-ratio: 4/3)`, the same
threshold as `bareFor`, and `device.landscape()` asks the same 4:3. "Wider than tall" alone is not
landscape: 375x360 is wider than tall, and two columns there need a 228px board, a gap and a 13rem
strip - 452px on a 375px screen, eight overflowing matrix cells. A near-square window is laid out
upright, which is also what it looks like.

**Ludo is played upright, and landscape is its safety net rather than its layout.** The board is
square, so turning a phone sideways only makes it smaller - 258px against 360px upright on the same
phone. A browser cannot stop a phone rotating, so the landscape layout stays and fits the screen, and
it says so: "Ludo plays best upright" in the strip. Full screen from a ludo table also asks
`screen.orientation.lock('portrait')`, which Android grants in full screen and everything else
refuses quietly. Hokm keeps a real landscape layout, because a card table is wide.

**The felt carries the two numbers somebody glances at.** On a table narrower than 36rem the trump,
the round and the score sit in two chips in the felt's top corners, because on a phone the tiles that
hold them are below the hand; on a wider table the side column shows them and the chips go.

**The table's chat floats, and the board keeps the width.** It used to be a full-height column docked
beside the game, and the owner called the whole thing ugly: a third of the screen for a thread that
is quiet most of a game, reading as a second app. The spec is
`docs/superpowers/specs/2026-09-23-play-screen-chat-design.md`. At sidebar width, and on any screen
turned sideways (landscape at rail width, or any landscape 540px tall or less), it is a card
anchored to the bottom-right corner, 23rem by at most 34rem, 30rem and the full height on "bigger";
closed, it is a pill in the same corner with the unread count and the last line said. It starts
closed - `settings.railOpen` keeps its old name and now means "the card is open" - and whenever it is
open the table makes room for it, so it never covers the board or the bottom-right player's plate.
Everywhere else - a phone held upright, and an upright tablet - it is the bottom sheet, half the
screen first and the whole screen on request.

The rule is about which way the SPARE ROOM runs, not about width. It used to float the card at
every width above a phone and make room only at sidebar width, so a phone turned sideways (844x390,
which is rail posture) opened a 23rem card straight over the board, and an upright tablet did the
same over the bottom of the board. A board is sized by the screen's height in landscape, which
leaves room beside it, and by its width upright, which leaves room below it - so the card goes where
the room is. `play.spec.ts` holds both shapes.

**One chat instance, never unmounted while the table is open.** The card and the sheet are the same
`TableChat` in one container whose classes change with the posture and which is `hidden` when closed.
That keeps the thread open, which is what makes the unread count, the pill's preview and the speech
bubbles work while nobody is looking at the chat, and reopening it lands where the reader left it.

**A line appears as a speech bubble over the speaker's plate** for 4.5 seconds, on every screen size -
the only way a message reaches somebody watching the board. The page keeps the bubbles in a plain
map and publishes a version stamp rather than writing `speech` from itself, which the
`self-write-in-effect` rule refuses; the first batch of a thread is recorded as heard once it has
loaded, so opening a table does not replay the history as bubbles.

**Things a finger can actually hit.** A tap on the Ludo canvas picks the nearest MOVABLE token within
1.25 squares of it (`pickNear` in `game/layout.ts`), measured to the pawn's body rather than its foot,
because a pawn on a phone is 17px across and nobody taps a sprite that exactly. On a coarse pointer a
hokm card is lifted by the first tap and played by the second, or by the "Play the ..." button that
appears - a hand of thirteen shows each card as a 26px strip, and one mistap used to throw the wrong
card. A mouse still plays on the first click, because hover already lifts the card.

**A badge says only what is unusual.** "Your go" and "Waiting" are what the breathing yard and the
strip already say, and beside four home dots they truncated to "Your...". They are `sr-only`; won,
out, lost, missed turns and last chance are still written out, because those are what somebody needs
to read at a glance.

**A page that failed while the server was away heals itself.** `onBack` in `realtime.store.ts` fires
when the socket connects after being down, and the lobby and the match re-read then. A deploy, a
restart or a dropped train connection used to leave "Couldn't load this" on screen until somebody
pressed Try again - found by restarting the built server with a game open. The play page also stopped
drawing its skeleton and its error at the same time: the error waits until nothing is loading.

## The game page splits on its container

`lg:grid-cols-[minmax(0,1fr)_22rem]` fires at 1024px of SCREEN, and that column is nothing like the
screen: with the social panel open at 1280 the grid has 660px to divide, the 22rem aside takes 352 of
it, and everything on the left was laid out in 284px - three-word rule cards and a leaderboard whose
names all ended in an ellipsis. It is `@4xl:` now, for the same reason the people and group grids are
container variants. Nothing measured it: the matrix fails on overflow, hit targets, a landmark and
the console, and a column of truncated text is none of those.

## What a game leaves behind

The profile got its numbers back, and the difference from the ones that were deleted is the whole
point: every figure now moves because a match this server arbitrated ended. `player_stats` is one
row per person per game holding the rating, the peak, played, won, abandoned, the streak and the
tallies; `user_achievements` is who has earned what. Both are written inside the transaction that
finishes the match, because a match that is over and a record that has not moved are two rows
disagreeing about the same game.

The table was called `game_ratings` while `rating` was the only thing in it. Played, won, captures
and a streak are not ratings.

**Being the last one left in an empty room is not a win, and until `record.ts` existed it paid like
one.** The engine declares a winner in two quite different situations - somebody brought four
tokens home, or everybody else walked out - and `commit` recorded both as `outcome: 'won'`. That is
a rating farm: three accounts sit down, two leave, the third is handed the win. `outcomeOf` tells
them apart by looking at the board, the second is `abandoned`, and an abandoned match moves the
counts and the streaks and nothing else. `record.db.spec.ts` owns it against a real Postgres.

**A rating is Elo over a FIELD.** Two players is ordinary Elo; three and four score every pair and
average over the opponents faced, so beating a strong field is worth more than beating a weak one
and the answer does not depend on how the seats were numbered. Ludo only ever declares a first, so
`placementsOf` reads the rest off the board - tokens home, then distance travelled - and anybody who
forfeited is last whatever their position says, or walking out while ahead would be a placement
somebody earned by leaving. K is 32 and the result is clamped to what the column takes, because a
write Postgres refuses after a match has finished strands the match rather than the rating.

**A peak is the highest rating somebody has ever HELD**, which includes the 1200 they started at.
Taking it from the new rating alone recorded a personal best of 1184 for a player who had never been
below 1200 in their life.

**Five thousand achievements, and every one of them is a threshold over something a finished match
records.** A thousand per game and a thousand across every game, because the owner asked for them -
and a thousand invented sentences would break the rule every unproduced tile here was deleted for.
So they are LADDERS: `achieve/families.ts` declares families (played, won, XP, peak rating, best
streak, distinct days, played and won at each seat count and each pace, and each engine's tallies;
across games, the same plus level, tables hosted to the end, distinct opponents, wins at four or more,
turn-based, live and two-player wins), and `ladders.ts` turns each into steps - one by one to twenty,
then by round numbers - so a scope sums to exactly 1,000 and `ladders.spec.ts` holds the count. A
family that could never be climbed at a game is not generated for it: no four-player backgammon, no
turn-based poker, and the spec compares every seat count and pace against the game's seed. Tiers
follow position in a ladder - bronze, silver, gold, platinum, diamond - and `.medal` has all five
metals. An id is `<game|all>-<family>-<step>`, stable while a ladder only grows at the end.

**The seventeen hand-written achievements are gone, and so is `first-seat`.** Each of the rest is a
rung now (a first win is `won 1`), and "sat down at a table" had nothing to count once a seat is
taken and left - and it was the only thing awarded outside a finish, so the table service no longer
knows achievements exist. Friends and groups are not counted either: a public record that published
how many friends somebody has would be a second copy of the social graph, the thing E2EE already
cannot hide.

**The definitions are GENERATED, and the table exists for the foreign key.** `seed-reference.ts`
upserts all five thousand in one `insert ... select unnest(...)` per boot and deletes any id no
longer generated, because reference content that can only be added to is how a database ends up
holding a tile nobody remembers writing. Everything a read needs - scope, family, step, need - comes
from the same generated list in memory rather than from columns that could disagree with it. Names
and blurbs are stored as text in both languages, and `achievements_translated` refuses a blank one:
a half-translated medal would put an English sentence inside a Persian page.

**Awarding re-evaluates everything and lets the primary key dedupe.** At a finish, `record` reads the
facts for the game that ended and for everywhere, works out every rung they reach, and inserts them
with `on conflict do nothing`. It answers what the record deserves rather than what has changed, so a
retried action, a replayed idempotency key and a reconnect converge on the same rows. Every fact only
grows, so what is held and what the facts reach agree between finishes, and a family's bar cannot say
full while its next rung says locked.

**Four facts are questions rather than counters.** Played and won by seat count and pace, distinct
days, distinct opponents and tables hosted to the end are asked of `match_players`, `matches` and
`tables` at the finish - once per game - through QueryBuilders; `grouping sets ((m.game), ())`
answers each game's days and everywhere's in one read. A `distinct days` column would be a number that
has to be right on every write forever; this is right by construction every time it is asked.

**Five thousand tiles is not a page, so the wire speaks FAMILIES.** A person's record carries each
scope's earned and total, each family's counter, rungs earned, top tier and next rung, and the twelve
most recent medals; `GET /social/people/:handle/achievements/:family?game=` is one family's whole
ladder, fetched when its card is opened. The profile shows the recent medals and a chip per scope
over the family cards; a game page shows that game's families and nothing else.

**A RECORD is anybody's to read and a HISTORY is your own.** The aggregate is what a profile has
always shown. A list of the games somebody sat at, with who else was there and when, is a
description of their week - the social graph is already the thing E2EE cannot hide, and this would
be a second copy of it that anybody could read. `GET /matches/history` takes no handle at all and
pages by keyset over `(finished_at, id)`, like chat history and for the same reason.

**The live counts are counted.** `catalogue.store.ts` drifted "627 people at the tables" on a seeded
RNG, and the rule written beside it was that it goes the moment the server answers with real counts.
`GET /catalogue/live` counts SEATED PEOPLE at open public tables, LEFT JOINed from `games` so a quiet
game comes back as a zero rather than as a missing row. `waitSeconds` went with it and is not coming
back as a zero either: nothing measures how long somebody waits for a chair, because matchmaking is
a query over open tables rather than a queue with a length.

**A finished match stays on screen, and the test for that is which TABLE it belongs to.**
`tables.match_id` is the LIVE one, so it clears the instant somebody wins - and closing the board on
that dropped the winner straight back to a lobby with a Start button at the exact moment the game had
something to say. Asking "has it finished?" instead does not work either: the table's refetch and the
match's are two reads that learn about the end separately, so there is a window where the table has
dropped the id and the match view is still the one from before the final move. Belonging to this
table is true throughout. The rematch is offered from the result panel and is the table's ordinary
Start, because a finished match leaves every seat exactly where it was.

## Levels, and a board a new player can reach

`domains/match/levels.ts` is pure and import-free, like `ludo/` and for the same reasons: it runs in
the default `npm test` with no Postgres, the same numbers can later be shown in the browser without
dragging a decorator into the web program, and a level is reproducible from a total rather than
being a counter somebody incremented.

**XP is for PLAYING and a level is a trophy.** It unlocks nothing, gates nothing and buys nothing,
because this product has no inventory, no balance and nothing that grants one — a level that
promised any of those would be the same class of claim as `game_rules.fairness` and the invented win
rates, both deleted for being decoration with no mechanism behind them. The copy on the bar says so
in as many words rather than leaving it to be inferred.

Finishing is 10, winning is 25 more, a capture is 2 and a token home is 3, and every one of those is
countable from `match_actions` — which is already an append-only record of what happened, so nothing
new is written to produce them. **A walkout earns nothing at all**, not even the captures it made on
the way: otherwise leaving a game you are losing banks the good half of it, which is the hole
`outcomeOf` closes for the rating from the other side.

A level costs `100 + 50 * (n - 1)`, so the total to reach level n is a quadratic in n and `levelOf`
is its positive root floored rather than a loop — a very large total costs what a small one does.
`levels.spec.ts` walks sixty thresholds and asserts each one lands exactly, because an off-by-one in
a root shows only at the boundary.

**`match_players.xp` is what makes a WINDOW possible.** `player_stats.xp` is the running total and
answers "who has the most" perfectly well; what a running total cannot answer is "who earned the most
this month", because it has no dates in it. The per-seat column does, through `matches.finished_at`,
and it is written on every finish rather than only when a rating moved — the two shared a branch for
one commit and every abandoned match recorded nothing, which made the windowed board quietly blind to
a whole class of game.

**An account's XP is the SUM of its per-game rows and is never stored.** A stored account total is a
second copy of a derivable fact, which is the mistake `tables.status` exists to avoid; six rows
summed on a profile read is not a cost worth a second source of truth.

**Four windows — today, this month, this year, all time — because one all-time board is a board
nobody new can ever appear on.** Somebody who started this week will not out-total a year of
somebody else's play, and a product whose only ranking says so is one they stop looking at.

All four rank by XP, and the rating rides along beside it. XP is a count of what somebody did: it
only goes up, and it can be summed over a window, which is the whole reason a window means anything.
The rating is the estimate of how WELL they play and it can go down — ranking a monthly board by it
would have produced the all-time board with the inactive hidden.

Two queries rather than one with a branch, because they ask different things of different tables: all
time reads the running totals in `player_stats`, a window sums `match_players`. The all-time board
keeps the `MIN_PLAYED` floor and a windowed one has none and needs none — a floor there would keep
new people off the one board they can actually climb. The boundaries are `date_trunc` over Postgres
`now()`, never a date this process computed, for the reason every other window predicate in this
server is: `finished_at` was written by Postgres.

The windows are the SERVER's day and month, so somebody in Tehran sees a board that turns over at UTC
midnight. That is a real limitation, stated rather than hidden, and a smaller one than storing
everybody's timezone to fix.

**The person travels ON the row.** A leaderboard is the one list in this product where nearly every
row is somebody the reader has never been told about, so a payload of bare handles means the client
asks about each one - twenty rows, twenty requests, for one screen. That is the shape that took the
rate limiter out during the responsive matrix, and it is the defect `social.graph` already records
having fixed the same way. The board `remember`s them into `people.store` in an `effect` rather than
beside the read, because `remember` writes the signal `byHandle` reads and a `derived` that wrote it
would be a cycle. `lastSeenAt` is absent rather than null, which is the privacy rule: a board is read
by strangers who have no claim on when somebody was last online.

**The window labels are one word each**, and that is a layout fact rather than a style: "This month"
and "This year" in a four-way segmented control put the game page 335px wide at a 320px viewport, and
the matrix caught it. The legend above them carries the meaning.

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
| `level` | the XP bar and the level chip on `me` and `person` — **back**, counted rather than invented; see *Levels, and a board a new player can reach* |
| `achievements` | the achievements tab and its twelve tiles |
| `skill` | "people at your skill" on `discover` |
| `reliability` | a tooltipped chip on `person` |
| `favourite` | which game seven different Play buttons opened |
| `region` | a suggestion reason |
| `portrait` | an `<img>` pointing at a file that has never existed — every row was null |
| `dataset().activity` | the whole home activity feed, forty invented events |

`me` and `person` lost their tab bars with the tabs. The record and the achievements are BACK, and
measured - see *What a game leaves behind*. What has not come back is anything nothing measures:
there is still no level, no skill band, no reliability score, no favourite game, no region and no
portrait, because the match domain produces none of those. `social.service.ts` lost `planRequestReply` and `rankSuggestions`
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
nothing calls. Nothing says so now - see *The rules no test holds any more*.

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
real button, opens a thread and sends a message — at 390 and 1280, both languages,
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

## Replies, reactions, forwards and deletions

`docs/superpowers/specs/2026-09-23-chat-actions-design.md` is the design; this is what it cost to
build and the rules it left behind.

**The plaintext is a document now, and `lib/body.ts` is the only thing that writes or reads it.** A
text message seals `{"text", "reply"?, "fwd"?}` and a reaction seals `{"react", "on"}`. It was the
fourth hard cutover of what goes inside the ciphertext, taken for the same reason as the first three:
nothing has shipped. The envelope, the AAD, the signature and the franking construction did not move.
A document that does not parse opens as `tampered`, and the franking commitment covers the whole
document - so a disclosure sends `message.plain`, never the rendered words, or the server recomputes
a commitment over different bytes and every report of a reply fails verification.

**A reaction is a sealed row whose TARGET is in the clear and whose emoji is not.** The server pages
history, so a target only the client knew would mean every client downloading every reaction in the
room to draw one page. Who reacted to what is the same class of fact as who replied when. The target
column is NOT in the AAD, and that is why the sealed document repeats it as `on`: a server moving a
reaction onto another message produces a row whose `on` disagrees with its `target_id`, and
`decodeReaction` drops it. Adding the target to the AAD would have been a fifth field in a format
this file calls settled.

**A reaction is exactly one emoji**, enforced by `isEmoji` over one grapheme cluster. Without it a
reaction is a free-text channel that renders as a chip - "BUY NOW" in a pill under somebody's words.

**Deleting leaves a tombstone, not a hole.** `kind = 'deleted'` keeps the id, the sender, the epoch,
the device and the sequence number, and nulls the body and every cryptographic column. Three things
need the row: the next sequence number is the maximum the server holds, so a hole would hand the
same number out twice; a reply has to be able to say its original was deleted rather than never
loaded; and every browser holding the plaintext in its search archive evicts it when it sees the
tombstone. The thread never draws one. Reactions on a deleted message go in the same transaction.

**Unread, the list preview, notifications and push all ignore reactions and tombstones.** A reaction
that rang "new message" would be the most annoying feature in the product, and one that bumped the
list would reorder somebody's inbox because a friend pressed a thumb.

**The emoji picker is never a modal on a pointer.** One `EmojiPopover`, hosted in the shell and
opened through `useEmojiPop`, anchors itself to whatever asked - the composer bar, a message's hover
bar, the "+" chip - with `lib/anchor.ts`, the maths the tooltip uses. A coarse pointer gets the
long-press sheet or a panel docked above the composer instead, because a popover under a thumb is
one the keyboard covers. The composer's popover stays open for several picks and a reaction's closes
on the first, which is the Telegram arrangement and the one people expect.

**The picker and the actions sheet are lazy.** `play.page` sat at 15.5 KB of a 15 KB budget the
moment the table chat learned reactions; the picker's data and the sheet are only needed once
somebody asks, and the table chat itself now loads right after the route through `<Dynamic>`, the
way the boards already did. The route went to 11.6 KB.

**Emoji are the one place an OS-drawn glyph belongs** - they are what somebody typed, or chose in
place of typing. The product's own chrome still draws none; see *No glyph the OS draws*.

**Formatting is Discord's, painted as DOM nodes.** `lib/markdown.ts` parses and
`lib/markdown-dom.ts` builds elements with `textContent`; nothing touches `innerHTML`, so a message
reading `<img onerror=...>` renders as those characters. Bare http(s) links only: a masked link
whose text lies about its target is a phishing primitive. A message of one to three emoji and nothing
else renders large and without a bubble.

**A `<For>` row binding cannot be used as a shorthand property.** `{ emoji }` compiles to
`{ emoji() }`, which does not parse, while `azeroth check` stays green. Framework register #30; write
`{ emoji: emoji }`.

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
away, re-enrols as a pending device and types the phrase back in — at 390 and 1280,
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

**A `<Show>`'s `fallback` is built exactly when the guard is FALSE**, which is precisely the moment
the thing the guard protects may be gone. Closing a table did it: `table` went null, `seated` flipped
false in the same tick, the inner Show reached for its fallback, and `table!.taken` sent the entire
route tree to "The lights went out." The outer `<Show when={ table !== null }>` was no help, because
a fallback is not a child. Use an optional chain, which says the same thing and cannot throw.

This paragraph used to say the fallback is built EAGERLY, whether or not it is shown, and on 2.1.0
that is not true - checked rather than remembered. `fallback` is a lazy render factory on every
builtin (`FACTORY_ATTRS` in `azerothjs/semantics`, applied by `isFactoryProp`), so `codegen.js` emits
a bare markup value as `fallback: () => (...)` - every one of the forty-odd in this project's own
bundle is that shape - and `show.js` resolves it under `untrack` only on the branch that shows it.
The rule survives the correction and the reason for it does not: laziness never helped here, because
the fallback is shown at exactly the moment the guard is false.

**And a branch is BUILT UNTRACKED, so a ternary inside one never moves.** `renderer/show.js` builds
the active branch under `untrack` on purpose - "a signal read INSIDE the branch does not rebuild it",
which is what preserves focus, scroll position and uncontrolled input state across unrelated updates.
What re-runs the swap is `when`: for a thunk child the effect reads it every run, and for a value
callback a truthiness memo. So `{ () => signal ? <A/> : <B/> }` picks a branch once and keeps it
forever, silently - the signal really is true, and the wrong element is still on screen.

That is exactly how the landing page told somebody already signed in to connect a wallet. `returning`
was read in `mount` (it has to be: the page is prerendered and the server has no cookie), the cookie
was written, readable and correct, and the ternary sat inside `<Show when={ props.cta !== false }>`,
whose `when` never changes. A structural choice on a signal is a `<Show when={ thatSignal }>` with
the other branch as `fallback` - `when` is tracked by contract, and props reach a component as
GETTERS (`codegen.js` emits `get when() { return (returning()); }`), so the read lands inside the
swap effect rather than being snapshotted at construction.

No gate could see it. `npm run qa` builds every context signed IN, so the one page where this renders
is the one page it never reads this way, and the four things it checks - overflow, hit targets, a
landmark, a clean console - are none of them. `tools/qa/regression-pass.mjs` asserts it now, in both
languages, and presses the control rather than reading its href: with `exact: true`, because
Playwright matches an accessible name by SUBSTRING and the Persian brand mark `بازی‌های نورا`
contains `بازی`, so the brand link answered for the CTA and the check passed against an href of `/`.

**An error that reaches a person has already failed; throwing it away makes it fail twice.** The
boundary in `App.azeroth` named its first argument `_error` and dropped it, so a crash anywhere
under `<Routes>` produced that screen and nothing else - no console line, no stack, no clue which
page. `ErrorPage` takes the error now, logs it always, and shows it on screen in DEVELOPMENT only:
an exception's text is written for whoever wrote the code and can carry an id or a path that a
stranger reading over somebody's shoulder should not be handed.

**The top bar folds the sidebar, and it is the only place that does.** At sidebar width a toggle at
the far left of the top bar collapses the 15rem sidebar to the 4.5rem rail and back - the pattern
YouTube, Gmail, Slack and Linear share - and `[` does the same from the keyboard, beside `/` for
search. The choice is `settings.sidebarOpen`, a device preference like the others, so a wide monitor
and a laptop can disagree. The toggle is not drawn at rail width, where there is no sidebar to fold,
nor on a game route, which already has the rail. The top bar's primary action is "Play now", to the
games list, because starting a game is what the product is for; the sidebar and the rail already
carry the chat count, so the top bar does not repeat it.

**The 404 page waits while the router is still deciding.** On a cold load of any `/app` url the
session guard is async, and until it settles the router has no match, so `<Routes>` rendered its
fallback: every refresh of every signed-in page, and the sign-in page, opened on "There's no table
here" for 20 to 180ms before the real page replaced it. The router's own hold covers a chunk that is
still downloading and not a guard that is still thinking. `router.pending()` is true for both, so
`App.azeroth` hands it to `NotFoundPage` as `holding` and the page renders nothing until it is
false; a url nothing answers is never pending, so a real 404 is unchanged. `shell.spec.ts` holds a
guard open and fails if the page shows. Nothing else could see it: the matrix screenshots a settled
page, and a flash of the wrong screen is gone before any gate looks.

**Stores own their timers AND their listeners.** No store schedules or subscribes to anything in its
factory; that work sits behind idempotent `start(): () => void` / `stop()`, one-shot timers are
tracked and cleared by `reset()`, and every one reads the clock through `runtime()` so tests can
drive it. `device` and `scroll` were the two that did not comply - four window listeners and one
scroll listener attached at construction, two of them through `matchMedia` objects built inline, so
no handle survived to remove them with. A browser builds one store and never noticed; a spec file
that builds a fresh store scope per render accumulated them.

**Two of them are NOT started by the app shell, and that is deliberate.** `device` starts in
`App.azeroth` because the landing page reads it too - through the tooltips and the language switch -
and a watch beginning behind the sign-in would leave the public half of the site deaf to a resize.
`scroll` starts in `site-header.component.azeroth`, which is its only reader anywhere: it is a
landing-page concern, not an app one. Everything else starts in the shell, in the `stops` array.

**A store mutator must never read the signal it writes** while it can be called from an
`effect` — that forms a cycle and the scheduler gives up with "Reactive flush did not settle".
Use the updater form (`setX((current) => …)`, which does not subscribe) or `untrack`.

**Three list controls, one each.** `FilterBar` is a single-select row of chips over `Rail`, with an
optional count on each - the games page counts its categories, the search page names its scopes.
`Pagination` numbers pages from `@md` of its own width and says "4 of 12" below it, because a row of
seven 44px targets does not fit a phone; its range is a sentence, so it carries no `tally` - forced
left to right, the Persian "۱ تا ۱۰ از ۴۰" read backwards. `LoadMore` is the keyset lists' button -
notifications, match history, the leaderboard - which used to be three differently sized buttons
written three times.

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

**A tooltip belongs to a KEYBOARD focus, not to every focus.** `onFocusIn` fires for a programmatic
`.focus()` too, and every sheet moves focus to its close button as it opens - so each one opened with
the word "Close" floating over its own first paragraph, which on the table sheet covered the sentence
saying who can sit down. It asks `:focus-visible`, which is the browser's own answer to "did a person
tab here": a keyboard user gets the name, focus the page moved itself does not. Not checkable in the
test environment, which matches any real focus - the browser pass is what proves it.

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
| game art, SVG scene | < 32 KB each | 13–22 KB |
| game icon, SVG | < 32 KB each | 4–5 KB |
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

## Mobile first, and what a wide-first layout hides

**The unprefixed utilities ARE the phone layout.** `sm:`/`md:`/`lg:`/`@3xl:` only ever ADD to it for
bigger screens; a layout written wide and then patched down with overrides is the defect. The shape
to copy is `.ludo-frame`, where the player plates in a row above and below the board are the DEFAULT
and the plates as cards beside it are what a `@container (min-width: 44rem)` earns. The frame is
`direction: ltr` because the board is a printed object that never mirrors, and a name inside a plate
carries `dir="auto"` so it still reads in its own script.

Prefer a `@container` variant over a viewport one wherever the column is narrower than the screen,
which in this shell is most places: a rail or sidebar takes up to 16rem on the left and the social
panel takes `--social-w` on the right, so at a 1280 VIEWPORT the middle column is nearer 660px and
an `lg:` firing at 1024 of screen is firing at about 400px of column.

A 50-agent sweep audited the client against that rule, two refuters per finding. Nine survived and
**the matrix passed every one of them**, which is the point: it fails on horizontal overflow, a
sub-44px target, a missing landmark and a dirty console, and a layout can be wrong at 390 without
being any of those.

Four were real defects rather than merely wide-first, and each is worth keeping.

**`justify-end` on a scrolling flex column destroys the scroll range.** The chat thread used it to
sit a short conversation at the bottom of a tall desktop column - the wide case - and
`justify-content: flex-end` puts the overflow in the unreachable START region: `scrollHeight`
collapses to `clientHeight` and the maximum `scrollTop` is zero. Measured in Chrome, twelve 86px
children in a 200px box give a scrollHeight of 1032 at `flex-start` and 200 at `flex-end`. The
newest messages are the ones on screen so nothing LOOKS wrong, which is why it survived; what a
person finds is that the conversation cannot be scrolled up at all, "Show 40 earlier" appears to do
nothing, and `attachStick` never sees a scroll event. It bit hardest on a phone, where a 600px box
holds about eight bubbles. `mt-auto` on the first in-flow child says the same thing and is
scroll-safe at every height, which is what the table chat next door had always done.

**A keyword in a `min()` invalidates the whole declaration.** The landscape rule set
`--board-max: none`, which reads as "no cap" and is not a `<calc-sum>`: substituted into
`min(100%, var(--board-max), calc(100dvh - var(--board-chrome)))` the function fails to parse, the
declaration is invalid at computed-value time, and `inline-size` falls back to `auto` - losing the
height term that is the entire point of the rule. Measured at 844x390: the stage came out 700px wide
in a 700px parent, and `aspect-ratio: 1` made it 700px tall inside a 390px-tall window. With
`--board-max: 100%` it is 358px, which is `100dvh - 2rem` exactly. Nothing overflows HORIZONTALLY in
either case, so the matrix tours landscape and passes it.

**Padding that reserves space for something already in flow.** `.page` carried `phone:pb-nav`, which
is `calc(var(--nav-h) + env(safe-area-inset-bottom) + 1rem)` - a hold-over from a fixed tab bar.
`BottomNav` is the last child of the shell's `flex h-dvh flex-col` column and `main` is `flex-1
overflow-hidden` above it, so the page already ends exactly where the nav begins. Every scrollable
page ended 76px early, 110px on a notched phone because the nav applies `safe-b` itself and the
inset was counted twice - and worst on `/app/play/:id`, which is `immersive` and renders no nav at
all, so the one screen that should be biggest gave up 92px to a bar that was not there.

**A control the matrix structurally cannot see.** Every interactive primitive in `components/ui/`
grows on a coarse pointer - `coarse:h-11` on Button, IconButton, Chip, Segmented, TextArea - except
the clear button inside `Input`, which stayed at 32px. The matrix cannot catch it: the button is
behind `<Show when={ clearable && value !== '' }>`, and the matrix tours routes by url and never
types, so the element does not exist in any cell it hit-tests. That is the general shape to watch
for - a control that only exists after an interaction is a control no gate here measures.

The rest were the plain wide-first pattern, and the fix is the same each time: a phone must get a
layout designed for it rather than a desktop with pieces hidden. **Muting was removed from the chat
header on a phone**, which left a group thread with no actions at all, because the only other header
control is the profile shortcut a group has no use for. **Decline was removed from a friend request
in the notification list on a phone**, leaving Accept as the only answer, on a row whose button
pair used half the width. **The tab strip has always scrolled** - `overflow-x-auto` with the
scrollbar hidden - which is exactly why nothing said it did: five tabs at 390 put the last two past
the edge with no scrollbar and no fade, so a page opened on its fifth tab showed a strip whose
selected item was off screen. `Tabs` reveals the selected one now, with `nearest` so a tab already
in view is left alone. And **`Slider`'s thumb mixed a logical inset with a physical translate**
(`inset-inline-start` with `-translate-x-1/2`), so in Persian it sat a full thumb-width off the
track; a logical `-ms-2.5` centres it in both directions.

## RTL

English and Persian. **Logical properties only** — `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
`border-s`/`border-e`. Every number wears `tally` so a range cannot reverse inside a mirrored
line. The 3D world does not mirror; the UI over it does. Anything that flips with the reading
direction — a chevron, an arrow, a send icon — takes `icon-flip`.

Both catalogues are split by area under `locales/{en,fa}/` and typed
`Pick<Dictionary, keyof typeof reference>`, so a key missing from Persian is a build error and a
key that is *identical* in both languages fails `tests/data.spec.ts`. Interpolation-only strings
therefore do not belong in the catalogue.

**A MEASURED coordinate is physical, and so is the property that applies it.** The tooltip placed
itself with `inset-inline-start: var(--x)` while `place()` hands back a `left` read off
`getBoundingClientRect` - which worked only by accident. The bubble carries `dir="auto"` so a Latin
label reads the right way round, and that makes `inline-start` follow the LABEL: every Persian
tooltip measured its `--x` from the right edge and drew in the mirror image of where it belonged,
the ⋯ button's name floating at the far side of the header. The logical-properties rule is about
layout that should flip; a number that came from the layout engine already has a side, and applying
it logically flips it a second time. `.tooltip` and its arrow use `left`/`top` for exactly that
reason.

Locale is switched client-side and remembered in storage, not carried in the url, because
AzerothJS prefix routing is recorded as broken in the framework's own `framework-bugs.md`.

## No glyph the OS draws

Icons are Lucide shapes re-exported through `icons/registry.ts` as `[tag, attrs]` tuples and
rendered as inline SVG with `currentColor`. **Nothing renders an emoji, a dingbat or a symbol
character as content** — group identity is a crest (`components/social/group-crest.component
.azeroth`) drawn from the registry over a hue-tinted tile, and a separator dot is a 4px
`rounded-full` span, not a `·`. `·` and `–` inside translated sentences are punctuation and stay.
The one exception is an emoji a PERSON put there - typed, picked from the picker, or reacted with -
which is their content rather than the product's chrome.

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

## The second audit, and the rules it produced

An 80-agent workflow audited the room/privacy work and the XP/level work along five dimensions -
authorisation, SQL, scoring, client reactivity and schema - with three independent refuters per
finding, each told to default to refuted. Twenty-five findings were raised, eighteen survived, and
four were dismissed outright.

**Every gate was green when it ran**, exactly as they were for the epoch-commitment break: `check`,
529 tests, 205 database tests, 680 QA cells, and three hand-run browser passes. That is the second
time on this codebase; it is not a coincidence and it is not fixable by adding gates. What it says
is that a gate asserts what the code does, and these were all things the code did not do.

Six of them were serious enough to be worth stating as rules.

**An invitation cannot reach past the level the table is at.** `invite` checked that the CALLER
could see the table and that the messaging policy allowed the approach, and never asked whether the
invitee could ever sit down. On a `room` table that wrote a chair nothing could free: `claimSeat`
skips a chair held for somebody else, the invitee's own claim 404s before it reaches one, and no
route anywhere clears `invited_id`. One misdirected invitation made a table permanently
un-startable, and told a non-member a table existed that every read of it denies. `create` had the
same hole through its `invitees` list. The rule: on every level but `invite`, the invitee must
already pass `visibleTo` - and on `invite` there is nothing to check, because the invitation is what
grants the visibility. `canSee` is `visibleTo` asked about a third party, which it could always
answer and was never asked.

**The room's head count is the table's ceiling, and the SERVER says so.** The sheet refuses to offer
a seat count the room cannot fill; that was the only place it was enforced, so the group page's
"Play together" - which composed its own config from the game's LARGEST seat count - opened a
four-seat table for a group of three. Nobody outside the room can take the fourth chair, so `ready`
never arrives and the table can never be started: a dead table from the primary button on the page.
This is the same argument `create` already makes about seats, modes and targets. A courtesy in a
form is not a rule.

**A room table outlives its room, and the CHECK is written to allow that.** `tables.room_id`
cascaded from `conversations` for one commit, which looked right - a `privacy = 'room'` row with no
room is one `tables_room_is_private` refused. What that missed is downstream: `conversations.group_id`
cascades from `groups` and `matches.table_id` cascades from `tables`, so the last member leaving a
group destroyed every match ever played in it, taking the history, the ratings' evidence and every
windowed leaderboard row. The constraint gave up the half it could afford - `room_id is null or
privacy = 'room'` still makes a public table carrying a private group's room unrepresentable - and
the delete rule became `SET NULL`. Such a table falls back to being visible only to the people
already sitting at it, which `visibleTo` gives for nothing.

**A refusal must not be an oracle.** `POST /tables/:id/start` read the table by id and never asked
`visibleTo`, so the ORDER it refused things in told a stranger holding an id whether the table was
open, closed, or of a game with no engine - and the 403 that finally stopped them confirmed it was
there. Being seated is asked first now and a no is a 404, which needs no visibility check of its
own: sitting at a table is the strongest form of being able to see one. `/matches/:id/watch` had the
same shape written as an optimisation - `found.live && ...` - so a FINISHED match skipped the table
check entirely and any signed-in caller holding a match id could read the final board of a game
played at a private room table. A game being over does not make the room it was played in public.

**A timeout is not a walkout, and a survivor of an abandoned match is not a winner.** `levels.ts`
says a walkout earns nothing and a timed-out seat keeps what it earned, and `record.ts` implemented
neither: `match_players.result` says `abandoned` for both, so a dropped connection was charged what
a quitter is charged. The ledger already knew - the sweep writes its forfeits with `user_id = null`,
because the server took that action rather than a person - so the question is asked of
`match_actions` rather than of the result column. And the survivor of a room that emptied was being
paid the finish and the tokens they happened to get home, which is the alt-account farm `outcomeOf`
exists to close, reopened at a slower rate. A game only pays when a game was played.

**Counters are added by the database, never by the process.** `player_stats` was a read-modify-write
over rows read once before the loop, and nothing serialises two matches finishing for the same
person: each holds `for update` on its OWN match row, and the timeout sweep can finish several due
matches in one tick. Two games ending together recorded one. `on conflict do update set played =
player_stats.played + 1` is arithmetic the row does to itself under the unique index. The three that
are not counters stay absolute - a rating is a position, a peak is a maximum, a streak is a run.

**A public route publishes everything on it.** The leaderboard is unguarded with the rest of the
catalogue, which is right - a board nobody can see until they sign in cannot say what the place is
like - and it shipped for one commit carrying a whole `personSummary` per row, which includes a bio
and `isMinor`. Every other route that says who somebody is sits behind a session. It carries a
handle, a display name and a hue now, which is what an avatar reads; `Avatar` was widened to ask for
those two fields rather than a whole person, because a type demanding a child-safety flag to draw a
coloured circle is the type asking for data the screen has no business holding.

And two smaller ones worth keeping. **A window is truncated in UTC explicitly**, because bare
`date_trunc` over a `timestamptz` uses the connection's `TimeZone` - a server setting rather than a
decision, so the same deployment answers a different board on a different machine. **A refused fetch
is not an empty list**: the leaderboard and the match history both rendered a dropped connection as
"nobody has done this yet", which is a confident statement about the world made from having failed
to ask it.

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
**All six wallet fixtures are the standard hardhat accounts in order**, so the one phrase
`test test test test test test test test test test test junk` holds every one of them. The order
matters and guessing it wastes a pass - a check that signs in as four of them and reads a privacy
boundary reported a correct result under three wrong names:

| # | handle | address |
|---|---|---|
| 0 | `dana.w` | `0xf39Fd6e5…b92266` |
| 1 | `omid.k` | `0x70997970…dc79c8` |
| 2 | `sara.k` | `0x3C44CdDd…4293bc` |
| 3 | `reza.t` | `0x90F79bf6…93b906` |
| 4 | `mina` | `0x15d34AAf…2c6a65` |
| 5 | `leila.a` | `0x9965507d…b0a4dc` |
Two notes for anyone driving that profile by hand: the recovery phrase must be TYPED rather than
filled, because `fill` sets the value without driving MetaMask's own handler and the box never
expands into word fields; and the extension tab must stay OPEN, because closing it invalidates the
content script in every other tab at once.

## The rules no test holds any more

`application/tests/markup.spec.ts` was deleted on 2026-09-20. It read every file under `src/` as
TEXT and refused sixteen shapes that no type can hold - the technique `lines.spec.ts` still uses
against `services.ts`. Every one of them was written because the real thing shipped with all gates
green, so the shapes are worth keeping here even though nothing checks them now.

What it refused, and each is still house style:

- a `lobby.quick`/`lobby.host` call inside a play url, and HOLDING one of those promises in a
  variable - the step that makes `/app/play/[object Promise]` possible
- a `fallback` or a `when` that asserts non-null on something the surrounding guard owns
- a send path that does not ask what stands in the way
- a store mutator that writes a signal from a value it read out of that same signal
- an `effect` whose only signal read hides behind an optional call, which subscribes to nothing
- a hand-written panel surface instead of `Panel`
- a primitive in `components/ui/` with no caller anywhere
- one element asked to both grow and be visually hidden
- a loading flag derived straight from a resource rather than gated on having nothing to show
- a block comment inside the markup region
- `madder` used for something merely wrong rather than for a table playing for something
- an invisible control character anywhere in `src/`
- an element that is nothing but a display name and does not carry `dir="auto"`
- a `to`/`href` naming a path `routes.ts` never declares

A seventeenth was added the same day and went with it: a ternary choosing between two ELEMENTS
inside a control-flow branch, which is chosen once because a branch is built under `untrack`. That
one is written up in full under *The product shell*, because it is the only one whose mechanism is
not obvious from the rule.

The two hand-run browser passes are what is left looking at this class of defect, and they only
cover what they walk through.

## Verification

`npm run check` · `npm test` · `npm run test:shuffle` · `npm run build` · `npm run qa` ·
`node tools/qa/regression-pass.mjs` · `node tools/qa/ludo-pass.mjs` · `node tools/qa/hokm-pass.mjs` ·
`node tools/qa/play-pass.mjs` · `node tools/qa/hokm-play-pass.mjs` · `node tools/qa/voice-pass.mjs` ·
`node tools/qa/backgammon-pass.mjs` · `node tools/qa/poker-pass.mjs` · `node tools/qa/backgammon-play-pass.mjs` ·
`node tools/qa/poker-play-pass.mjs`,
then a browser pass: every route at
390, 1280 and 1440 in both languages, a screenshot of every screen judged against
`design.jpg`, console clean, and
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
