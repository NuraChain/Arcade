# Real-time networking and state synchronization: the audit

The owner's brief (2026-10-15, task 21): audit the whole real-time path from a press to what every
connected browser shows, measure it, test it with independent browsers under bad networks, fix what
is wrong with regression tests, and report what was verified and what was not. This file is the
ledger: the map (A), what was found (B), what changed (C), what ran (D, E, F), and what is left (G,
H). Every number in it was measured on the production build unless it says otherwise.

## A. Architecture

These are turn-based board and card games with an authoritative server. There is no free movement,
no collision and no physics, so the brief's prediction, interpolation and reconciliation items map
to the move predictions the boards make at a press, the per-match event log, the revisions, and the
presenter that plays events on each board. Voice is the one continuous stream.

### Who owns what

- **The server owns every outcome.** `matches.state` is the authority; each engine
  (`backend/src/domains/match/<game>/`) is pure and is handed its randomness as a value. A play is
  one transaction that opens with `for update` on the match row. An idempotency key per
  `(match, user, key)` answers a retry with the board as it now stands (`already`), and a revision
  precondition refuses a play composed against a board that has moved (`stale`).
- **A browser owns only what it shows.** Each board keeps a model of what it has SHOWN
  (`game/<game>-felt.ts`, `ludo-felt.ts`, `backgammon-men.ts`, `poker-felt.ts`) and steps it with the
  logged events; the presenter (`game/stage/presenter.ts`) decides to play, catch up fast, or snap
  to the board. A press is predicted with what the press alone decides (a card, a pawn's walk, a
  bet) and nothing chance decides; the answer confirms it, a refusal takes it back.

### The wire

One WebSocket at `/ws` per browser (`backend/src/realtime/gateway.ts`, `hub.ts`, `frames.ts`), JSON
frames, `v: 1`. Every server frame carries `n`, a per-connection sequence number stamped when the
frame is decided, so a client can tell order; it is not a message id.

| Frame | Direction | Kind | Delivery | Notes |
|---|---|---|---|---|
| `hello` | server | session | once per connection | the server's time and the reader's own handle |
| `presence` | server | snapshot or delta | replaceable; a snapshot after every bind and edge change | `gone` names departures |
| `nudge` | server | doorbell | at most one flush a window: the hub's `TICK_MS` (150 ms), the client's `NUDGE_WINDOW_MS` (250 ms); the first change after a quiet window goes at once (N-1) | the store re-reads over HTTP; nothing is delivered |
| `typing` | server | ephemeral | lossy by design, 4 s expiry | |
| `game` | server | delivery: a match view and the events since the revision before | immediate (no tick); a gap is mended by `since` | per reader, redacted by the engine |
| `ack` / `refused` | server | answer to a `play` | under the play's idempotency key | `refused` carries the code the route would |
| `pulse` | server | delivery: live counts | replaceable; at most one in `PULSE_MS` (2 s), only when different | |
| `voice` / `signal` | server | call roster and WebRTC signalling | ordered per socket | budgets per frame kind |
| `sound` | server | carried voice | LOSSY: sent only when the socket's outbox is empty | the receiver's playout covers a late frame |
| `pong` | server | answer to `ping` | | gives round trip and clock offset |
| `sync`, `presence`, `typing` | client | | a floor per kind (`FRAME_FLOORS`: 5 s, 2 s, 3 s); the browser paces itself to it (N-3) | eleven inside the floor in a minute closes the socket 4400 |
| `play` | client | input | at most once per key: HTTP retry under the same key when no ack in `ACK_MS` (1.5 s) | |
| `voice`, `signal`, `sound`, `ping` | client | | budgeted (`FRAME_BUDGETS`: voice 30, signal 120, sound 250, play 40, ping 10 per 10 s); past it the socket closes 4429 | the browser keeps a mute to two frames a second and a check to one ping in 2 s (N-3) |

Overflow: a connection's outbox past 256 frames or 256 KB closes the socket with 4413 rather than
dropping, because a silently lossy stream defeats the gap detector.

### Timers and loops

| Where | Constant | Value | What it does |
|---|---|---|---|
| hub | `TICK_MS` | 150 ms | at most one flush of doorbells, presence and edge reloads a window; the first after a quiet window at once |
| hub | `PULSE_MS` | 2 s | floor between two asks for the live counts |
| gateway | `HEARTBEAT_MS` / `PONG_TIMEOUT_MS` | 15 s / 10 s | the server's own liveness check |
| client | `NUDGE_WINDOW_MS` | 250 ms | at most one re-read a window per scope; the first doorbell after a quiet window at once |
| client | `PROBE_MS` / `PROBE_GRACE_MS` | 10 s / 4 s | a held socket is pinged after 10 s of silence, replaced 4 s after an unanswered ping |
| client | `ACK_MS` | 1.5 s | a play with no ack is sent again over HTTP under the same key |
| client | `POLL_MS` | 3 s | with no socket, an open match reads `since` |
| client | `MEND_MS` | 3 s | how long a gap's `since` read may take before the newest board is shown as a jump |
| client | `IDLE_MS` | 60 s | a hidden tab lets its socket go, unless something holds it |
| client | `LIFELINE_MS` | 8 s | with no socket, every scope is rung locally |
| match sweep | `expireNext` loop | 5 s tick | plays the turn of a seat whose clock ran out |
| table sweep | `TABLE_SWEEP_MS` | 30 s | stands up an absent player at a waiting live table, on the second sweep |

### A move, end to end

1. The reader presses a piece. The board predicts it at once (`presenter.act`) and hastens what is
   in front of it.
2. `match.store` sends a `play` frame over the socket (or over HTTP when there is none), and arms
   `ACK_MS`.
3. The gateway runs one socket's plays one after another; the service applies it in a transaction,
   writes the action row, and commits.
4. After the commit `pushMatch` composes the view for each seat and the hub publishes a `game` frame
   to each player at once; watchers are rung `WATCH_DELAY_MS` plus a second later.
5. The mover gets `ack` with the events; the other seat gets `game`. The store writes the view and
   the events in one `batch()`; a gap in revisions is mended by one `since` read.
6. Each board's presenter plays the batch (or catches up fast, or snaps), and the chips, plates and
   words read what the table has shown.

### A Ready press, end to end

1. The lobby shows the reader's chair ready at once (a guess, `lib/guess.ts`) and posts it.
2. The server writes it and calls `tableChanged`: a doorbell, sent on the next turn of the event
   loop unless another went out less than `TICK_MS` ago.
3. Every other browser at the table gets a `nudge` for `table` and reads `GET /tables/:id` again at
   once, unless it read less than `NUDGE_WINDOW_MS` ago.

### The risks this audit tests first

- A browser falling behind: a hidden tab, a slow main thread, a socket that died silently, a burst
  of moves, a gap in revisions, a reload in the middle of a scene.
- Doorbell latency: a table change reaches another browser after up to 150 + 250 ms of batching
  plus two round trips.
- Recovery: a server restart, a socket replaced mid-game, a second tab of the same account.
- Order: an ack and a push for the same move, a push that overtakes an earlier one, a `since` read
  that crosses a newer push.
- Fairness: a play replayed, a play from a stale revision, a play from a seat that is out, a
  second connection acting for the same account.

## B. Findings

Each was reproduced on the production build before it was fixed, and each fix was held by specs
that fail when it is taken out (faults put into the code one at a time; section D).

**N-1. A doorbell waited for two windows that only ever delayed it (medium).** The hub held every
change for `TICK_MS` (150 ms) and the browser every doorbell for `NUDGE_WINDOW_MS` (250 ms), both
counted from the FIRST change, so a Ready, a chair taken, a table closed or a chat list that moved
reached another browser no sooner than 400 ms plus two round trips, however quiet the line was.
Measured by the sync pass from the request to the chair turning green in the other page: p50 444
ms, p95 468 ms on loopback; 441 and 491 ms behind a phone-like line. The windows were meant to
collapse a burst into one read; a single change was paying for a burst that never came.

**N-2. Every turn re-read every table the reader sits at (medium, cost).** A `game` frame says
whose turn it is, and the lobby store answered a turn that changed hands by reading
`GET /tables/mine` again. That route loads the state of every live match the reader plays and
asks each engine `turnOf`, so a two-player game cost each player one such read per turn, and a
player at many tables paid for all of them on every move at any one. The latency pass counted
13 to 16 of them per player in 24 presses.

**N-3. The browser broke the gateway's own rules, and lost its socket for good (high).** The
gateway closes a socket that sends a frame kind more often than it takes it: eleven `presence`,
`sync` or `typing` frames inside their floors in a minute is 4400, and past a ten-second budget
(`voice` 30, `ping` 10, ...) is 4429. The browser treats both as terminal and never reconnects.
And the browser sent a `presence` frame and a `ping` on EVERY change of the tab's visibility, and a
`voice` frame on every press of mute or deafen. Reproduced: twelve flicks between tabs in five
seconds closed the socket with 4400, and every move after that reached the page only through the
three-second poll ("arrives: none" for six moves). Anybody who switches tabs quickly, or mashes
mute, was cut off from pushes until a reload.

**N-4. A client that plays faster than a person is closed (not a defect).** The first load pass
sent plays as fast as its sockets could and lost two plays a table to 4429 ("Too many play
frames"). That is the gateway's anti-flood rule working; the pass now plays no faster than one
play in 300 ms a socket.

**Looked for and not found.** No reordering or loss on a healthy socket (every table's revisions
only ever went forward, in every scenario); no duplicate application (a play sent twice under
one key answered `already`; the same move sent at the same moment over the socket and over http
under two keys applied once, the other answered `stale`); no stale overwrite (a play against an
older revision answered `stale` and changed nothing); no browser left behind after a hidden tab, a
six-times slower processor, a frozen page, a cut socket, a reload, a second tab, a server restart
or a burst of forty moves. Every frame a game sends is about 900 bytes.

## C. Changes

- **Doorbells are heard at once** (`backend/src/realtime/hub.ts`, `frontend/src/stores/
  realtime.store.ts`). Both windows are a ceiling on the RATE now, not a delay: a change after a
  quiet window goes out on the next turn of the event loop, and whatever comes inside the window
  after a flush waits for the window's end and goes out together (`flushedAt` on both sides). A
  wait is never longer than one window, so a clock that jumps cannot hold one back. Specs:
  `realtime.spec.ts` (*hears a doorbell after a quiet window at once*), `realtime-hub.spec.ts`
  (*a doorbell in time*).
- **Whose turn it is comes from the game frame** (`frontend/src/stores/lobby.store.ts`,
  `cues.store.ts`). The frame's turn is laid over the reader's list of tables (`turnsSeen`), so
  `seated()` and `waiting()` show it the moment the frame lands; the list is read again only for
  a game the lobby has not heard of or one that ended, and a read asked for after a frame takes
  over from it (a frame missed while the socket was down is told only by a read). The cues store
  asks the list as the server last answered it (`listed()`), or the turn the frame had just told
  would look as though the reader already had it and "Your turn at Ludo" would never be said.
  Specs: `tables.spec.ts` (*whose turn it is at the reader's tables, told by the game itself*),
  `cues.spec.ts` (*is said when the lobby has heard the frame first*).
- **The browser keeps to the gateway's floors and budgets, which are written once**
  (`backend/src/realtime/frames.ts`: `FRAME_FLOORS`, `FRAME_BUDGETS`, `BUDGET_WINDOW_MS`, read by
  `gateway.ts` and by the browser). A floored frame goes at once after a quiet floor and otherwise
  once at the floor's end with the latest of what was asked (`paced`, half a second over the floor
  for a line that bunches frames); a connection check pings at most once in two seconds
  (`CHECK_FLOOR_MS`); the call tells the room about a mute at most twice a second, the last of it
  last (`ANNOUNCE_MS` in `voice.store.ts`). Specs: `realtime.spec.ts` (*what the socket is asked to
  say, kept to what the server takes*), `voice.spec.ts` (*tells the room about a mute no more than
  twice a second*).
- **Two passes** (`tools/qa/sync-pass.mjs`, `tools/qa/load-pass.mjs`), described in
  `tools/qa/CLAUDE.md` (*The networking passes*).

## D. Test results

Everything here was run on 2026-10-15 against the tree that is committed with this ledger.

- **The gates.** `npm run check` clean (both typechecks, both lints, the server test typecheck);
  `npm test`: the server 1,382 passed (the 511 database specs need `TEST_DATABASE_URL` and were
  skipped), the browser 3,367 passed; `npm run build` within every budget (the app shell 11.9 of
  12 KB).
- **Faults.** Each fix had its faults put into the code one at a time and the specs run against
  each: the doorbell five (three in the browser, two in the hub), the turn seven and the pacing
  eleven. All were caught. Two survived on the first run and each got the spec it was missing: a
  held-back frame that said the first of what was asked instead of the last, and the cues store
  reading the lobby's overlay instead of the list (it only shows when the lobby hears the frame
  first, as it does in the app).
- **The sync pass**, two independent Chromium contexts (`dana.w`, `mina`), one live Ludo game, the
  built server on 5300. The full run, every part and the restart: 75 checks, 73 passed. The two
  that failed were the pass's own: *silent* silenced nothing, because the page had caught up over
  HTTP before its socket opened through the proxy, and *soak* failed an element count that went
  DOWN. Both were mended in the pass and run again (ready, silent, soak in three rounds of 100):
  clean, 21 checks. Behind a phone-like line for the second browser (`QA_JITTER=mobile`: ready,
  ping, steady, burst, cut, silent): clean, 22 checks.
- **The latency pass**, two browsers at a turn-based Ludo table, 24 presses on each of three
  lines (loopback, 150 ms and 400 ms round trips): clean, 6 checks.
- **The load pass**, Node clients with real sockets, two a table, at 10, 50, 100 and 200 tables
  (20 to 400 sockets) for 20 seconds each: clean at every level, 9 checks, every play answered.
  The first run of the pass in this shape died at 100 tables on its own fault: its setup took a
  refused start for a game, and it read the match over http before every play, which spent the
  api's per-minute ceiling. Both were mended in the pass (`tools/qa/CLAUDE.md`, *The networking
  passes*) and the run was made again.

## E. Performance results

Before is the build of `feb50182` (the tree before these fixes), after is this one, same machine,
same passes. Times are p50 / p95 unless they say otherwise.

| Measure | Before | After |
|---|---|---|
| A Ready reaches the other page, pressed on its own (loopback) | 444 / 468 ms | 18 ms; the worst of 12, 278 ms |
| The same, pressed straight after another | 444 / 468 ms | 43 / 267 ms |
| The same, one page behind a phone-like line | 441 / 491 ms | on its own 23 ms; the worst, 75 ms |
| Round trip on the socket, loopback | 1 / 1 ms | 1 / 1 ms |
| Round trip on the socket, phone-like line | 92 / 395 ms | 93 / 355 ms (p99 401) |
| A move's frame reaches the other browser (loopback) | 8 / 11 ms | 8 / 10 ms |
| Press to own and to opponent's board: loopback, 4G, 3G | 10, 173, 425 ms | 8, 174, 423 ms |
| `GET /tables/mine` per player in 24 presses | 16 | 0 |
| `GET /notifications` per player in 24 presses (a turn-based table) | 15 to 16 | 17 to 18 |
| All api requests during 24 presses, loopback / 4G / 3G | 63 / 52 / 52 | 35 / 20 / 22 |
| A hidden tab back at the server's board after it is shown | 2,495 ms | 2,340 ms |
| Twelve tab flicks in five seconds | socket closed 4400, no move pushed after | socket kept, 6 frames for 6 moves |
| A cut socket: the moves made meanwhile reach the page | 346 / 1,643 ms | 329 / 1,605 ms |
| A page frozen for 12 s while ten moves are made, back at the board | not measured | 2.0 s after it wakes |
| A socket gone quiet with no close, found dead and the page back | not measured | 14.7 s after it went quiet |
| The server restarted: both pages on a socket again | not measured | 2.4 s after it went |
| A move, CPU six times slower: the frame handled | 113 / 163 ms | 158 / 201 ms |
| A game frame | 899 B | 906 B |
| A long session (277 actions): heap, elements on the table | not measured | 6.8, 7.5, 7.7, 8.0 MB; 192, 181, 182, 169 |
| Load, 10 tables: plays a second; ack p50 / p95 / p99 | 50; 8 / 14 / 20 ms | 50; 10 / 14 / 20 ms |
| Load, 50 tables | 253; 10 / 35 / 60 ms | 253; 18 / 51 / 67 ms |
| Load, 100 tables (200 sockets) | 427; 94 / 142 / 193 ms; a health check's p99 352 ms | 504; 22 / 79 / 108 ms; 7 ms |
| Load, 200 tables (400 sockets) | not run | 697; 260 / 311 / 344 ms; 62 ms |
| The server's memory through a level | 300 MB, flat | 285 MB flat to 100 tables; 287 to 328 MB at 200 |

The load rows are not like for like: the pass before read the match over http before every play
and the pass after does not, as no browser does. Run the old way on the new build, 10 and 50 tables
answered in 10 / 19 / 24 and 16 / 38 / 77 ms, within run-to-run variation of the old numbers, which
is what it should be: nothing in this audit changed the server's path for a play.

## F. Synchronization verification

Two browsers were called in sync only when each one's board, read pawn by pawn off the page, was
the server's view of the same match read as that player (`GET /matches/:id`), and its table had
come to rest at the server's revision. Every part of the sync pass asks that of both browsers,
and also that the revisions each table showed only ever went up. That held after an action every
600 ms and forty as fast as the api answers, with a tab hidden and shown, flicked twelve times,
slowed six times, frozen, cut, churned through five tabs and three cuts, gone quiet without a
close, reloaded, joined by a second tab of the same account, through a server restart, a race of
two copies of one move, a duplicate and a stale play, and nearly three hundred more actions; and again
with the second browser behind a phone-like line. The latency pass asks the same of two browsers
at every press on three lines. The boards are moved by the events they are told, so a board that
agrees with the server at rest has also played every move in order (the presenter's own rules
are held by the board specs).

Under a rate faster than the animations the boards are behind by design and catch up by design:
at an action every 600 ms both came to rest 1.1 s after the last answer, and after forty actions
as fast as the api answers, 5.0 s after it (double speed past 1.5 s behind; the board alone past
the game's limit). A press is never held by it: the reader's own move is played at once and
hastens what is in front of it.

## G. Remaining issues

- **One process.** Presence, every doorbell and push, voice rooms and parties are memory in the
  one server process (the hub names `publish` and the inbound handler as its whole multi-process
  seam). Two processes against one database do not see each other's sockets, and each one's
  sweep stands up players it cannot see. The side worktree's server on the shared development
  database is such a second process today. The owner's next task (quick play and player
  discovery) takes this up.
- **A silently dead socket costs up to 14 s.** It is found by the probe (`PROBE_MS` 10 s of
  silence, then `PROBE_GRACE_MS` 4 s for the answer), or at once when the tab is shown, the
  network comes back or a play's answer is late. Measured: 14.7 s. A shorter probe trades pings
  for that time; it was left as it is.
- **A turn-based table re-reads the notifications list on every turn**, because the turn notice
  moves from one player to the other; that is the notice working, and a live table writes none.
- **Terminal closes stay terminal**: 4400, 4401, 4413 and 4429 are never retried. A person can no
  longer trip 4400 or 4429 by pressing; a script still can.
- **The heap grew about 0.25 MB per 100 actions after the first round** of the long session, some
  of it the pass's own record of every frame; the elements on the table did not grow. Not shown to
  be a leak; a soak across several games was not run.
- **Not tested**: real mobile networks and a real sleep (stood in for by the jitter proxy, CDP's
  freeze and the proxy's silence), loss on the wire (WebSocket is TCP, and the brief asks not to
  fake it by deleting messages), Firefox and Safari in the sync pass (Chromium only), more than
  400 sockets, and why the load bends where it does (the event loop, the pool of ten database
  connections and the database sharing the machine were not told apart).

## H. Final assessment

Verified for what was tested, on one server process: independent browsers converge on the
server's board after every scenario in section F, nothing is applied twice, nothing stale is
applied, nobody falls behind for good, and the three defects found are fixed with specs and
measured. Partially verified for scale: on one machine with the database beside it, 400 sockets
at 200 tables answered every play at 697 plays a second, the ack's p50 rising from 22 ms at 100
tables to 260 ms at 200, so the knee is between them. Not supported: more than one server
process, which the next task settles.
