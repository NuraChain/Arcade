# Repository audit, 2026-10-14

The owner asked for a full-repository audit, cleanup, security hardening and production
readiness pass ("phase PA" of the table plan), and separately for every package to be brought to
its newest version. This is its remediation ledger: what was looked at, what was found, what was
changed, how each change was proved, and what is left on purpose. Every fix is its own commit on
`main`; nothing was pushed.

## Scope and method

Inspected: both workspaces (`frontend/`, `backend/`), `tools/` (the build gates, the QA passes, the
eslint rule, the art and Blender generators by their callers only), `scripts/` (the systemd
installer and its siblings), the root and per-area notes, `.env.example`, both lockfiles' worth of
dependencies, and the whole git history for credentials.

How: the gates first (`npm run check`, both suites, the shuffled run, the build with its budgets,
the responsive matrix and the hand-run passes), then searches that a compiler cannot do (exports
nobody imports, catalogue keys nobody reads, stylesheet classes nothing produces, variables nothing
reads, file-system writes in the server, raw SQL built from strings, every route the router reaches
by another spelling), then reading the trust boundaries by hand: the edge middleware, sign-in,
sessions, the socket handshake, uploads, the chain reads, and the installer. A suspected removal was
searched for by name across both halves, the specs, the tools and the build gates, and through the
ways a name is reached without being written (composed catalogue keys, router transition classes,
`prefix-${...}` classes) before anything went.

Not inspected line by line: the framework itself (a dependency; one gap is in its register), the
Blender and art generators (build-time tools that ship nothing executable), and the game engines'
rules, which have their own engine-parity specs and two earlier audits (`.claude/rules/games.md`,
`.claude/rules/chat-and-keys.md`).

## Ledger

Severity is for this product as deployed by `README.md`: one process on `127.0.0.1` behind nginx.

| ID | Where | Evidence and root cause | Severity | Change | Proof | Status |
|---|---|---|---|---|---|---|
| SEC-1 | `backend/src/http/rate-limit.ts` | The router decodes each path segment before matching, so `/%61pi/...` reaches `/api/...`; the per-address ceiling chose what to meter from the raw `URL.pathname`. With a ceiling of two, `/%61pi/thing` answered 200 four times. | High | `5811078c`: decide on the routed path (`routedPath`); every spelling shares one budget | spec (4 spellings), 4 faults caught, built server at `API_RATE_MAX=5` | Fixed |
| SEC-2 | `scripts/service-install.sh` | The unit named no account and the installer runs under sudo, so the server ran as root. | High | `e3bc4e06`: run as the clone's owner, refuse a root-owned clone, `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict` | `systemd-analyze verify`; a transient service with the same settings under WSL's systemd; spec; 6 faults caught | Fixed |
| SEC-3 | `backend/src/http/origin.ts` | A write with no body (sit, start, leave, close, accept) from a page on a sibling subdomain carried the `SameSite=Lax` cookie. | Medium | `6725f2d8`: any method but GET, HEAD, OPTIONS from another site or origin is refused 403 | specs; forged and sibling requests refused on the built server; 356 real writes of a play pass, none refused | Fixed |
| SEC-4 | `backend/src/env.ts` | Production started with a short `SESSION_SECRET` (which keys message franking) or an http `PUBLIC_ORIGIN`. | Medium | `6725f2d8`: refuses to start and names each problem, never printing the secret | spec; an unsafe instance refused | Fixed |
| SEC-5 | sign-in routes | A caller not signed in could store 600 challenge rows a minute (kept a day past expiry) and make 300 accounts a minute from one address. | Medium | `981b7078`: the two routes share a twentieth of `API_RATE_MAX`, never under ten | spec, 11 faults caught, built server: refused, said in both languages, and signing in again after the minute | Fixed |
| SEC-6 | `backend/src/http/headers.ts` | No HSTS. | Low | `6725f2d8`: half a year, only on answers the proxy says went out over https | spec; header present only with `X-Forwarded-Proto: https` | Fixed |
| SEC-7 | `tools/qa/db.mjs` | A password for a local development database (listening on this machine only) was written into the file and so published with the history. | Low | `1f111aeb`: the account, host, port and password come from `DATABASE_URL` | the helper connects with no password of its own | Fixed; the value stays in history, so a database that used it should not keep it |
| SEC-8 | `source-map-js` | A denial-of-service advisory (high), in a build-time dependency only. | Low here | `ecbcffe6`: the fixed release | `npm audit`: 0 | Fixed |
| DEP-1 | manifests | `@azerothjs/cron`, `@azerothjs/logger` and `@types/pg` had no importer. | Hygiene | `ecbcffe6`: removed | gates, build | Fixed |
| DEP-2 | manifests | The owner asked for every package at its newest version. | Hygiene | `61eab64e`: all updated; TypeScript held at 6 and `@types/node` at 24 (below) | gates, build, passes on the result | Fixed |
| DEAD-1 | 21 files | Eighteen exports and one component with no caller anywhere (`TONE_TEXT`, `TONE_BAR`, `BoardFactory`, `SCENE_GAMES`, `recall`, `slugify`, `groupFor`, `isLocalizedText`, `addressHue`, `detents`, `Divider`, `isOver`, `MatchService`, `WatchService`, `PartyEnded`, `yardCells`, `YARD_CORNER`, `secretsMatch`). | Hygiene | `1eb2d277` | typechecks, suites, build | Fixed |
| DEAD-2 | catalogues | 26 keys in each language that nothing reads (the guest sign-in form's words, Ludo's colour names, an old watch line and others). | Hygiene | `e4a720c9`, and `7fc44cb4` for two blank lines it left | typecheck (a key that is named fails it), suites, `npm run check` | Fixed |
| DEAD-3 | stylesheets | The `glass` and `sheen` utilities, the colour, animation and keyframes only they used, and `.table-top`, whose last user went with the backgammon rails. | Hygiene | `7a003829` | suites (the stylesheet specs), build | Fixed |
| DEAD-4 | `.gitignore` | `tools/qa/out/` listed three times; a comment said the defect register was on the desktop. | Hygiene | `1f111aeb` | `git check-ignore` | Fixed |
| DEAD-5 | `frontend/vite.config.ts` | The development server sent `/_image` to the api, which mounts no image route (`main.ts` never passes `images` to `mountPages`) and nothing asks for one; three notes said it did. | Hygiene | removed in OPS-4's commit | build | Fixed |
| OPS-1 | `README.md` | Nothing said to back up the database, the one thing a server cannot build again. | Medium | `a59793e3`: back up with `pg_dump`, how to restore, and keep the `.env` with the dumps | read | Fixed |
| OPS-2 | `README.md`, `backend/src/db/schema.ts` | `npm run schema:sync`, which the update steps ran every time, is TypeORM's `synchronize()`: a column an entity no longer has is dropped with its data, and there are no migrations to roll back with. | Medium | `aab678e1`: the steps take a `pg_dump` before it, and say why | read | Fixed in the steps; nothing refuses a sync without a dump |
| OPS-3 | voice | A call between two networks needed STUN or TURN, which the server warned about at every boot. | Medium | `313e039c`: a call two players cannot connect directly is carried by the server | relay checks across Chromium and Firefox, the voice pass | Fixed |
| OPS-4 | `.env`, `backend/src/env.ts`, `env-file.ts`, `frontend/vite.config.ts`, `data/chain.ts` | Thirty-five names had to be written, most of which the code could work out (the owner: "we have a lot of useless things on env that can handle automaticly"). And `NODE_ENV` was read from the file, so a server started outside the systemd unit with a `.env` from a laptop ran as development, where the wallet fixtures, whose keys are public, are seeded. | Medium | `5450fe59`: three needed names; the mode from the command and never the file; the rest derived from the mode or the server's place, constants, or optional | loader spec, 11 faults caught, a copy of the build booted from a three-line `.env` | Fixed |
| UX-1 | wallet sign-in | A 429 at sign-in told the person the server could not be reached. | Low | `981b7078`: "Too many sign-ins from this network. Try again in a minute." | specs, faults, built server | Fixed |
| UX-2 | the sheet handle | A drag let go short of closing closed the sheet with a mouse. | Low | `fa165b08` | spec, faults, a mouse and a touch on the built server | Fixed |
| QA-1 | `tools/qa/matrix.mjs` | The matrix restarted a live poker game for the tour account before each poker cell and left it running, so its turn toasts landed on whatever page it measured next; one cell failed on a toast over a backgammon plate. | Hygiene | `6ad7dca9`: the game is resigned once its cell is measured | the matrix, 960 of 960 | Fixed |
| FW-1 | framework | A wrapper above the router cannot see the path the router matches. | (dependency) | register entry 42, with a minimal reproduction; SEC-1 lives with it | reproduction run on 2.1.0 | Open in the framework |

## Looked at and found sound

- **Secrets.** Every tracked file and the whole history: no session secret, push key, TURN secret
  or private key was ever committed (the `0x...` keys in tests are hardhat's published accounts). The
  local password of SEC-7 was the one value.
- **SQL.** Every query that interpolates a string interpolates a constant of the module (column
  lists, a visibility predicate, a letter-folding expression); user input is always a parameter,
  and LIKE wildcards in a search are escaped.
- **Files.** The only files the server serves from disk go through the framework's
  `containedFile`, which refused every traversal tried (dot segments, escaped dots, absolute paths, a
  NUL). Avatars are stored in the database, sniffed by their bytes, never SVG, 64 KB at most.
- **Requests.** JSON bodies only, 1 MiB at most; a body that is not well formed is a 4xx and never
  a 5xx (the garbage pass); list sizes are clamped on the server.
- **Sessions.** An HttpOnly, `__Host-`, `Secure`, `SameSite=Lax` cookie addressing a row; a new
  token at every sign-in; revoked on the server at sign-out; 30 days.
- **Redirects.** `?next=` after sign-in is followed only for a path under `/app`, never `//`.
- **Links.** Every link that opens a new tab carries `noopener`; a link in a message carries
  `nofollow ugc` as well and only `http`/`https`.
- **Errors.** The app is built with no development flag, so no stack or internal message reaches
  a response; logs redact cookies, tokens, signatures and keys.
- **Outbound fetches.** NFT pictures and metadata go through the SSRF-guarded fetch (public
  addresses only, `https`, three redirects, one deadline); chain reads are bounded.
- **The client address.** Behind the proxy, the rightmost `X-Forwarded-For` entry, which nginx
  writes and a client cannot.
- **Sockets.** `/ws` only, exactly spelled; origin checked; frames bounded in size and in rate.

## Kept on purpose

- **No script Content-Security-Policy.** Wallets put their provider into the page (an extension's
  content script, Nura Wallet's in-app browser), and a script policy breaks sign-in.
  `backend/CLAUDE.md` says why.
- **TypeScript 6.0.3.** TypeScript 7 has no JavaScript compiler API, which the editor's language
  server needs.
- **`@types/node` 24.** The engines field is Node 24.11 or newer.
- **`lib/one-at-a-time.ts`.** TypeORM 1.1.2 still reads tables in parallel while it syncs.
- **The recovery `checkValue` column**, written and never compared: the server's verdict on the
  phrase's signature already tells a wrong phrase from a corrupt archive. Removing it is a column
  drop on a development database another working tree shares, which is not a change to make
  without the owner. The comment that called it "the whole reason" for that difference is
  corrected.
- **`tokenRadius`**, read only by a spec as a reference value.
- **`.table-grid`'s template**, which names areas every game's grid replaces; changing it is layout
  work with nothing to gain.

## Left open, and why

- **Per-account budgets.** Messages and searches are bounded per address and per socket frame,
  not per account.
- **Many addresses.** The sign-in budget is per address. Account creation from many addresses at
  once is for the edge (nginx `limit_req`, or a challenge) and is not in this repository.
- **No CI.** Nothing in the repository runs the gates on a push; they run by hand.
- **Fresh releases.** `lucide` 1.57.0 and `viem` 2.57.6 were published on the day they were taken,
  and `motion` 14.2.0 the day before. None runs an install script and the lockfile pins them; a
  cautious deploy can let them age a week first.
- **The chain.** This machine's `.env` points the chain's reads at a node that is not running, so
  those routes answer `503 chain-unreachable` here. On a server with a reachable node they read
  normally. The browser's chain constants keep the decimal id `.env.example` had (`1020`), and
  `chainIsConfigured` asks for hex, so the app requests no network switch: how it behaved before,
  left for whoever works on the chain, because the owner asked for no time on web3 now.
- **Rotating `SESSION_SECRET`** makes every message sent before it impossible to report
  (`backend/src/domains/chat/franking.ts`); the README says to keep the `.env` with the backups.

## Verification

On the final tree, in the order run:

- `npm run check`: clean, both halves and the server's test typecheck.
- `npm test`: server 1,381 passed (511 database specs skipped: they need a disposable Postgres),
  browser 3,231 passed.
- `npm run test:shuffle`: the same, with seeds 1791997435521 and 1791997467123.
- `npm run build`: within every budget.
- A copy of the build booted from a `.env` holding only the three needed names: production, and
  the pages, the app shell, the api and the assets served; refused by name without a secret and
  without an origin; `NODE_ENV` written in the file ignored. 14 of 14.
- `tools/qa/regression-pass.mjs` on the built server, started as the notes now say
  (`PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 API_RATE_MAX=20000 npm start`): 65 of 65.

On the tree before the `.env` change (`6ad7dca9`), which differs from the final one only in how
the server reads its settings:

- `npm run qa`: 960 cells, no findings. The run before it failed one cell, on a toast from the
  matrix's own poker game (QA-1).
- `tools/qa/regression-pass.mjs`: 65 of 65.
- `tools/qa/garbage-pass.mjs`: 99 of 102. The three are the `/api/chain/*` routes, which answer
  `503 chain-unreachable` on this machine because its chain node is not running; not judged here.

Each fix's own proof is in its row: the faults put into its code that its spec caught, and what
was seen on the built server. `npm audit`: 0 vulnerabilities.

Not run, and why: the database specs (`npm run test:db`), because no query changed in this phase.
A last full matrix on the final tree, stopped after seven minutes at the owner's word that it was
taking too long: the change can move no page, and the run on `6ad7dca9` stands for the pages. The
other hand-run passes, because nothing they hold changed beyond what the matrix and the regression
pass cover. The chain pass, because the owner asked for no time on web3.
