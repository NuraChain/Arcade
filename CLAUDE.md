# Nura Games — working notes for Claude Code

A social gaming platform: a cinematic 3D landing page at `/` and the signed-in product at `/app/*`
(matchmaking, tables, friends, chat, groups, search, notifications, profile, settings). Two npm
workspaces - `frontend/` (the browser) and `backend/` (the api, the database and the realtime
gateway) - plus `tools/blender/` (3D assets) and `tools/qa/` (the browser gates). If a rule here
disagrees with the code, the code is right and this file needs fixing.

## Commands

```sh
npm run dev            # tsc -w on the server, node --watch on .dist-backend, vite on 3100
npm run check          # api typecheck + server test typecheck + azeroth-tsc + eslint — the gate
npm run build          # server tsc, client bundle, SSR bundle, prerender, budgets
npm test               # every suite, both workspaces, no Postgres
npm run test:shuffle   # every suite in random order — the isolation gate
npm run qa             # the responsive Playwright matrix
npm start              # the built server: api AND client on one origin
npm run schema:sync    # build the schema from the entities
npm run assets         # rebuild the showcase GLBs (needs Blender 5.2)
npm run poster         # capture the landing's first frame from the built server on 5300
```

**Done means `check`, `test`, `test:shuffle` and `qa` all pass.** Run `npm run check`, never
`azeroth check` alone: the second half is a tsc program over `backend/tests/`, and vitest's oxc strips
types without checking them, so a spec can import a name that does not exist and still pass.

**`npm run test:db --workspace backend` is opt-in** and needs `TEST_DATABASE_URL` pointing at a
database you do not mind losing: it truncates before every test and runs `--no-file-parallelism`
because two files truncating the same tables deadlock. Every claim about the DATABASE lives there.

## Running it

**Development is two processes.** vite on `127.0.0.1:3100` owns the browser and proxies `/api`,
`/ws`, `/_image` and `/avatars` to the api on `127.0.0.1:3200`, which answers no pages. Open
`http://localhost:3100`.

**Production is one process.** `npm run build` then `npm start`: the api in `.dist-backend/`, the client
in `.dist-frontend/`, the SSR bundle in `frontend/dist-server/`. `SERVE_PAGES` defaults on under
`NODE_ENV=production`; `SERVE_PAGES=false` is for a CDN in front. There is no `npm run preview` - the
server's `mountPages` IS the preview. The backend COMPILES (`typeorm` in `dependencies` flips it to
emitting, and Node cannot run decorators), so always build before `npm start`.

**Production `.env`** needs `NODE_ENV=production`, a real `SESSION_SECRET`, and `PUBLIC_ORIGIN` set to
the origin the browser uses - it is the site in every sign-in text, the WebSocket origin check and the
cookie's site at once.

**nginx sits in front and owns TLS and every cross-origin rule.** The api listens on `127.0.0.1`
only, always, and speaks plain HTTP. It sends no CORS, `Cross-Origin-Resource-Policy` or
`Cross-Origin-Opener-Policy`: the framework's CORP default blocked every avatar (an absolute
`${PUBLIC_ORIGIN}/avatars/...` link, also published to the chain) with
`ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` on any other origin. The WebSocket origin check in
`realtime/admit.ts` is not CORS and stays. vite's dev-server CORS is off and its proxy targets
`127.0.0.1`, not `localhost`, which can resolve to `::1` where nothing listens.

**On a VPS it runs under systemd** via `scripts/service-*.sh`, with `WorkingDirectory` = `backend/`;
`main.ts` reads the root `.env` whatever the working directory. The install script refuses a missing
build, SSR bundle, `PUBLIC_ORIGIN` or `SESSION_SECRET`.

**The database** is Postgres and the ENTITIES are its only description: no migrations, `syncSchema()`
on every development boot, never TypeORM's own `synchronize: true`. A schema change is: drop the
database, boot, let `syncSchema` build it. Details, the hand-built indexes and the tests that hold the
schema are in `backend/CLAUDE.md`.

**The QA matrix** signs in for real as the `dana.w` wallet fixture, so it needs the api and a seeded
database. For a trustworthy run use the built server on its own port with the limiter raised:
`PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production npm start`
and `QA_BASE=http://localhost:5300`. Details in `tools/qa/CLAUDE.md`.

## The framework defect register

`framework-bugs.md` lives in the AzerothJS checkout, not here (`.gitignore` holds the name; its path
is not written down because this file is public). Sections: **Open**, **Resolved**, **Not framework
bugs**. Nothing enters the first two without a minimal reproduction; a suspicion that was ours goes in
the third so nobody re-investigates it.

## House rules

**This repository is PUBLIC**, history included. Nothing private goes in the tree, ever.

- Real values live in the ONE root `.env` (gitignored at every depth). The api loads it; vite reads it
  through `envDir: '..'` and exposes only `VITE_*`. `process.env.VITE_USER_NODE_ENV ??= ''` in the
  vite config stops the api's `NODE_ENV=development` turning a build into a development bundle.
- `.env.example` is committed: every variable the code reads, with a placeholder and a sentence. Only
  public values are real there (the Nurachain id, rpc and contract addresses). A personal value - an
  admin wallet included - goes in `.env` only.
- No absolute path naming a machine. `~` is fine; `/c/Users/<somebody>` is a person's name.
- The `0x…` keys in tests and `seed-wallets.ts` are hardhat's published accounts; nothing else here is
  key material (`recovery.ts`'s look-alike is the P-256 curve order).

**No comments in code.** Names and structure carry the meaning; these notes and the tests hold the
reasoning.

**Nothing has shipped: build the FINAL shape.** No migration, backfill, compat shim, deprecation
window, dual-write, flag guarding an old behaviour or adapter from a shape that never existed. A seed
wrong is fixed in the seed and rebuilt. A column default that would be materialised into existing rows
is a backfill in disguise (`groups.privacy` has none for that reason). This does not license deleting
a rule for the FUTURE: `seed-reference.ts` still never overwrites `games.status`.

**Mobile first.** Unprefixed utilities are the phone layout; variants only add for bigger screens.
Prefer `@container` variants: the shell's middle column is far narrower than the viewport.

**Database access is TypeORM** - a repository call or a `QueryBuilder` (`.addSelect('(select ...)')`
for correlated sub-queries). Raw SQL only for what a repository cannot say, with a sentence naming
which: `FOR UPDATE SKIP LOCKED` in a scalar sub-query, `pg_advisory_xact_lock`, `INSERT ... SELECT`
over `generate_series`/`unnest`, `ON CONFLICT (target) WHERE predicate`, `ON CONFLICT DO UPDATE SET
x = t.x + 1`, `UNION ALL`, `LEFT JOIN LATERAL` with an aggregate, keyset pagination by row value, and
any `now()` predicate (a security or expiry window must not move onto the Node clock). Editing a file
full of raw queries is not a licence to add one: convert what you touch.

Allman braces, 4-space indent, single quotes, no trailing comma, LF. `npm run check` enforces it.

## The framework is a dependency

`azerothjs` and the thirteen `@azerothjs/*` packages are pinned EXACTLY at `2.1.0` in all three
manifests; a framework fix arrives by bumping the pin, deliberately. `npm ls azerothjs` must show ONE
node - two runtimes are two signal graphs and effects silently stop firing (`resolve.dedupe` in the
vite config is for the same reason). TypeScript stays `^6.0.3`: 7 ships no JS compiler API for the
language server. `azeroth doctor` warns when the editor extension lags the compiler.

## People are handles

The client's person id IS the handle, and the wire names people by handle everywhere. The server keys
on uuid internally; handles are the edge. A rename refetches. The one exception is `nura-e2ee/v1`,
which binds the account uuid because a signature must name something a rename cannot change.

## Rules the history taught

- **Something declared needs a caller.** A sweep, a line key, a notice and a leaderboard were each
  built, tested and wired to nothing while every gate was green. See `.claude/rules/games.md`.
- **A courtesy must not fail the thing it is a courtesy about.** Anything after a committed action (a
  result line, an invite line, a turn notice, a push) goes through `courtesy()`.
- **Green gates are not a review.** Two audits found critical defects - an epoch commitment that
  signed who got a key but not which key, and a set of table and scoring holes - with `check`, every
  suite, the matrix and the browser passes all green. Read the code adversarially with the threat model
  in hand. The write-ups are in `.claude/rules/chat-and-keys.md` and `.claude/rules/games.md`.
- **A refusal is not an oracle, and a private thing answers as a missing one** (404, never 403).
- **A public route publishes everything on it.** Send what the screen needs, not a whole person.
- **A refused fetch is not an empty list.** Render the failure, never "nobody has done this yet".

## The rules no test holds any more

`frontend/tests/markup.spec.ts` (deleted 2026-09-20) refused these shapes by reading `src/` as text.
Each once shipped with every gate green; they are still house style:

- a `lobby.quick`/`lobby.host` call inside a play url, or HOLDING one of those promises in a variable
- a `fallback` or a `when` that asserts non-null on something the surrounding guard owns
- a send path that does not ask what stands in the way
- a store mutator that writes a signal from a value it read out of that same signal
- an `effect` whose only signal read hides behind an optional call (it subscribes to nothing)
- a hand-written panel surface instead of `Panel`
- a primitive in `components/ui/` with no caller anywhere
- one element asked to both grow and be visually hidden
- a loading flag derived straight from a resource rather than gated on having nothing to show
- a block comment inside the markup region
- `madder` used for something merely wrong rather than a table playing for something
- an invisible control character anywhere in `src/`
- an element that is only a display name and lacks `dir="auto"`
- a `to`/`href` naming a path `routes.ts` never declares
- a ternary choosing between two ELEMENTS inside a control-flow branch (built once, untracked - see
  *The product shell* in `frontend/CLAUDE.md`)

## Verification

`npm run check` · `npm test` · `npm run test:shuffle` · `npm run build` · `npm run qa`, then the
hand-run passes in `tools/qa/` against the built server: `regression`, `ludo`, `hokm`, `play`,
`hokm-play`, `voice`, `backgammon`, `poker`, `backgammon-play`, `poker-play`, `realtime`, `tour`
(development server, disposable database), `latency`, and `chain` (local chain). Then a browser pass:
every route at 390, 1280 and 1440 in both languages against `design.jpg`, a clean console, and the
WebGL disposal check (no "Too many active WebGL contexts" after repeated create and dispose).

Three sizing traps: a grid item needs `min-w-0` to shrink around `truncate`; an `<input>`'s wrapper
needs `min-w-0` too; and a `<button>` shrink-wraps even at `display: flex`, so a class list shared with
a `<div>` must state `w-full`.

## Where the rest lives

Loaded only when a session touches the matching code:

- `backend/CLAUDE.md` - the server, the database and schema, the social graph, groups.
- `frontend/CLAUDE.md` - the frontend, the landing, the design system, the shell, mobile first, RTL.
- `.claude/rules/games.md` - tables, voice, the engines, the boards, records, and the second audit.
- `.claude/rules/chat-and-keys.md` - chat, `nura-e2ee/v1`, devices, sealing, recovery, franking,
  notifications, realtime, and the first audit.
- `.claude/rules/identity-and-profile.md` - signing in, the Nura Profile, NFTs, the admin.
- `tools/blender/CLAUDE.md` and `tools/qa/CLAUDE.md` - the 3D asset kit and the browser passes.
