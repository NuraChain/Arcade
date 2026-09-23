# Nura Games

A social gaming platform: a cinematic 3D landing page at `/` — a night market of floating game
tables the reader travels through by scrolling — and the signed-in product at `/app/*`, where the
games are actually played.

**Ludo**, **Hokm** and **Backgammon** are playable end to end: real engines, real turn order, real
ratings. Poker has tables and art but no engine yet. Everything is free to play; there is no
wagering, no deposit and nothing to cash out.

Chat is end to end encrypted (`nura-e2ee/v1`): the server stores the bodies and cannot read them.
English and Persian, right to left throughout.

Built with AzerothJS 2.1, Three.js, Phaser, TypeORM and Postgres.

---

## What you need

| | |
|---|---|
| **Node** | 24.11 or newer (`engines` refuses older) |
| **Postgres** | 14 or newer, with permission to create extensions |
| **Blender** | 5.2 — **only** to rebuild the 3D kit. The GLBs are committed, so a normal clone never needs it |

## Setting it up

```sh
git clone <this repository>
cd Games
npm install

createdb nura_games                  # or: psql -U postgres -c "create database nura_games"

cp server/.env.example server/.env
cp application/.env.example application/.env
```

Then open `server/.env` and set two things:

- **`DATABASE_URL`** — where that database actually is.
- **`SESSION_SECRET`** — it has no default and the server refuses to boot without one. Generate it:

  ```sh
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
  ```

Everything else in both files is optional and documented in place. `application/.env` is entirely
optional: with no chain configured the app signs in on whatever network the wallet is already on.

There are no migrations to run. The schema is built from the entities.

---

## Running it, two ways

### Development — two processes

```sh
npm run dev
```

One command runs three things: `tsc -w` over the server, `node --watch` over what it emits, and
vite on 3100. **Open http://localhost:3100** — vite serves the browser and proxies `/api`, `/ws`
and `/_image` through to the api on 3200. Opening 3200 directly in development gets you the api,
which answers `/api/healthz` and 404s every page; that is correct and not a fault.

Two things happen on every development boot, so there is no setup step for either:

- **The schema is built from the entities.** `syncSchema` creates the `citext` and `pgcrypto`
  extensions, synchronises every table from the entity metadata, rebuilds the indexes no decorator
  can express, and re-applies the CHECK constraints.
- **Six real accounts are seeded** — `dana.w`, `omid.k`, `sara.k`, `reza.t`, `mina`, `leila.a` —
  with friendships, conversations and a group between them. They are the standard hardhat test
  accounts in that order, so the published hardhat mnemonic holds all six and you can sign in as
  any of them through the real wallet round trip. `dana.w` deliberately holds no device, because it
  is the one a person signs in as and a browser has to be able to enrol its own first device.

**When the schema changes, drop the database and let it rebuild.** That is the procedure, not a
last resort — nothing has shipped, there is no row anywhere that predates the current entities, and
rebuilding costs one boot.

### Production — one process

```sh
npm run build
npm run schema:sync --workspace server    # once, and again after any schema change
NODE_ENV=production npm start
```

Now **one process on 3200 answers everything**: the api, the WebSocket, and the built client
including the prerendered landing page. There is no separate static server and no `npm run preview`
— the preview path and the production path are the same code.

Two settings decide whether that works:

- **`PUBLIC_ORIGIN` must be the url people actually type.** It is the SIWE `domain`, the WebSocket
  origin check and the cookie's site. Serving on 3200 while it still says 3100 means every wallet
  signature is refused and every socket handshake is rejected. On a real deployment it is your
  https origin.
- **Leave `SERVE_PAGES` unset.** In production it defaults on. Setting it to `false` — which an
  older `.env` template did — makes this process answer the api perfectly and reply
  `{"error":{"code":"not-found","message":"Nothing is served at GET /."}}` to every page. It reads
  as a browser problem and is not one. The server now says so at boot, with the reason and the fix.

### On a VPS

`scripts/` installs it as a systemd service:

```sh
sudo ./scripts/service-install.sh      # writes the unit, checks the build and the environment
./scripts/service-start.sh
./scripts/service-status.sh            # also: -stop, -restart, -uninstall
```

The installer warns rather than guesses — a missing build, a missing SSR bundle, an unset
`SESSION_SECRET` or a `PUBLIC_ORIGIN` still pointing at localhost each get named before you find
out from a user. Run `npm run build` and `npm run schema:sync --workspace server` on the box first.

---

## The gates

All four must pass before a change is done:

```sh
npm run check          # api typecheck + server test typecheck + azeroth check + eslint
npm test               # 547 tests, both workspaces, no Postgres needed
npm run test:shuffle   # the same suites in random order - the isolation gate
npm run build          # bundles, prerenders, and fails on a blown performance budget
```

`npm run check`, never `azeroth check` on its own — the second half is a whole tsc program over
`server/tests/` that the first half never looks at.

**The database suite is opt-in**, because `npm test` promises to need no Postgres:

```sh
TEST_DATABASE_URL=postgres://postgres:root@127.0.0.1:5432/nuragames_test \
  npm run test:db --workspace server
```

It truncates before every test, so point it at a database you do not mind losing — never your
development one.

**The responsive matrix** drives a real browser over every route at twelve widths, both
orientations, both languages, and fails on horizontal overflow, a touch target under 44px, a
missing `main` landmark or a dirty console:

```sh
npm run build
PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 API_RATE_MAX=20000 NODE_ENV=production npm start
QA_BASE=http://localhost:5300 npm run qa
```

680 cells, a screenshot per failure in `tools/qa/out/matrix/`. Give it its own port: 3200 is the
development api's, and the matrix is a load generator, which is why the rate limit is raised for it.

`tools/qa/` also holds hand-run passes the matrix cannot replace — it tours routes by url and never
presses a button. `ludo-pass.mjs` and `hokm-pass.mjs` play whole games over the api;
`play-pass.mjs` and `hokm-play-pass.mjs` play them in two real browsers; `seal-pass.mjs` signs in
with a wallet, enrols a device, loses the keyring and recovers it; `chat-pass.mjs` and
`regression-pass.mjs` watch for things every green gate misses.

## Rebuilding the art

Only if you are changing it:

```sh
npm run art                                      # game art, the ludo board and pawns, the hokm table, the deck
npm run assets                                   # the whole GLB kit, and only this one needs Blender 5.2
```

The scripts in `tools/blender/` are the source of truth and the GLBs they emit are committed, so
`npm run build` and CI never need Blender.

## Where things are

```
application/     the browser: AzerothJS components, stores, the 3D world, the game renderers
server/          the api, the entities, the domains, the realtime gateway
tools/blender/   the asset pipeline - Python in, GLB and WebP out
tools/qa/        the responsive matrix and the browser passes
scripts/         systemd service management for a deployment
CLAUDE.md        why everything here is the way it is
```

`CLAUDE.md` is the long version: the architecture, the rules, and a written record of the defects
that produced each one. Read it before changing anything structural.

## Licence

MIT.
