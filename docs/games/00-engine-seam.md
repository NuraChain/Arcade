# Phase 0 — the engine seam

**Status:** DONE. Every Ludo gate passes with Ludo behind the seam, which was the stated gate.

| step | state |
|---|---|
| 1. Schema widening + snapshot | **done** — `7e5dc59` |
| 2. Extract `Engine`, Ludo behind it | **done** — finished as step 6; the shared path names no game |
| 3. Per-viewer `view()`, new wire | **done** — every gate green with Ludo identical |
| 4. Redact `since`, add the leak test | **done** — `Engine.log` and `redaction.db.spec.ts` |
| 5. Engine-owned outcome, standings, tallies | **done** — `player_stats.tallies` is jsonb |
| 6. One action vocabulary | **done** — one `/play` route, the engine parses it |
| 7. Client scene registry | **done** — `game/scenes.ts`, and the build gate reads it |
| 8. Teams | with Hokm, which is the game that has them |

Nothing in the three game plans can begin until this exists. It is the only work shared by all
three, and it is the only work that can break Ludo.

---

## The finding

CLAUDE.md calls `server/src/domains/match/` "the first real game engine in this product". It is —
and the layer *above* the engine was written for exactly one engine. There is a `ludo/` folder, and
everything around it names Ludo directly.

**`service.ts` is not a match service with Ludo plugged in. It is the Ludo service.**

| where | the coupling |
|---|---|
| `service.ts:12-16` | imports `apply` / `create` / `legalMoves` / `indexOfSeat` / `COLOURS` by name |
| `service.ts:140-143` | casts `matches.state` to `LudoState` with no discriminant |
| `service.ts:417-420` | `if (table.game !== 'ludo') throw` |
| `service.ts:445` | the literal `'ludo'` in the insert |
| `service.ts:554` | draws the die *itself*, before calling the engine |
| `service.ts:556-562` | builds the engine's action union by hand |
| `service.ts:232-233` | writes `die` / `piece` columns per action |
| `record.ts:28-40` | `outcomeOf` inspects `state.players[winner].pieces` |
| `record.ts:88-97` | counts `roll` / `capture` / `home` event names **in SQL** |
| `watch.ts:76,101` | casts the stored snapshot to `LudoState` |
| `services.ts:544-605` | `asMatch` turns Ludo pieces into `tokens` with 15×15 grid cells |

**And the database refuses the other three games outright.** This is the harder half, and it is a
schema change with a snapshot re-record:

| constraint | refuses |
|---|---|
| `matches_variant_known: variant in ('ludo')` | every other game, by name |
| `matches_seats_range: seats between 2 and 4` | Poker's 5–10 |
| `match_players_colour_range: colour between 0 and 3` | any seat count above four |
| `match_actions_kind_known: kind in ('roll','move','forfeit')` | bet, call, raise, play-card, double, take, drop |
| `match_actions_die_on_roll` + `die between 1 and 6` | Backgammon's dice **pair** |
| `match_actions_piece_range: piece between 0 and 3` | a card index (0–12), a point (0–25) |

**This is not a criticism of how Ludo was built.** Writing the general case before the second case
exists is how you get an abstraction nobody can use. The second, third and fourth cases now exist,
and they are different enough to say what the seam actually is.

---

## The biggest gap is not polymorphism. It is redaction.

Ludo hides nothing, so nothing in the match path was ever written to hide anything.

- `read(me, matchId)` is correctly **authorised** — a non-player gets null (`service.ts:165-190`).
- But the payload is built by one projector, `asMatch(load)` (`services.ts:544-605`), which walks
  `state.players` and emits **every seat's full contents to whoever asked.** Its only
  viewer-dependent outputs are `moves` (`:571`) and `mine` (`:580`).
- There is **no `redact(state, seat)` anywhere in the repo**, and no test asserting one seat cannot
  see another's data.
- `match_actions.state` stores the whole post-action state on every action (`service.ts:242`), and
  `watch.ts` serves it to spectators **with no seat parameter**. For Poker that snapshot is every
  hole card. The 30-second delay does not make it safe: it is still a live hand.
- `since` returns every action's `events` array to every player, unredacted (`service.ts:340-364`).

There is also **no separation between "state that is the board" and "state that is the shoe"**. The
undealt deck must never be in anything a client can reach — not the view, not the snapshot, not the
event feed. For Ludo there is no shoe, so the question never came up.

The platform already does this well elsewhere and the rule is written down: *"privacy is enforced by
what the server does not SEND — `lastSeenAt` is absent from a payload the viewer may not have it
for, not null, not flagged."* The match path is the one place that rule was never applied.

---

## What the seam has to carry

| | Ludo | Hokm | Poker | Backgammon |
|---|---|---|---|---|
| a turn begins with | a roll | nothing | nothing | a roll, or a double |
| a move names | a token | a card | an action + amount | a sequence of point pairs |
| private state | none | **hands** | **hole cards + deck** | none |
| seats | 2–4 | 2, 3, 4 | **2–10** | 2 |
| teams | no | **yes at 4** | no | no |
| a match is | one game | **hands to 7** | **a session** | **games to N** |

Three of those rows are concepts the platform does not have at all: **per-seat private state**,
**teams**, and **a match that is a sequence**.

### The interface

```
Engine<State, Action>
    id
    create(seats, config, draws)   -> State
    apply(state, action, draws)    -> { ok: true, next } | { ok: false, reason }
    legal(state, seat)             -> Action[]
    view(state, seat | null)       -> unknown        // per viewer. the whole redaction story
    turnOf(state)                  -> number | null
    autoplay(state, seat)          -> Action | null  // what the timeout sweep plays
    finish(state)                  -> { winners: number[], outcome } | null
    standings(state)               -> Placement[]    // feeds rating
    tally(events)                  -> per-seat counters   // feeds stats and XP
```

Two contracts the existing code already imposes and the seam must state explicitly:

- **`apply` never throws.** A refusal is a value over a closed union — `ludo/engine.ts` already
  does this, and it is why the timeout sweep can fold actions over a state.
- **Every state carries a top-level `rev`**, because `matches_rev_matches_state` reads
  `(state->>'rev')::int`.

`draws` is passed IN rather than taken by the engine, so the engine stays pure and import-free —
the rule `ludo-purity.spec.ts` enforces. The server owns `node:crypto`.

### The wire

`matchView` today carries a required `tokens: matchToken[]` with grid cells and a colour, plus
`die?: number` and `moves: number[]`. A Hokm hand, a Poker pot and a Backgammon dice pair have
nowhere to go, and a card game would have to send an empty `tokens` array that means nothing.

Split the envelope from the board:

- **Envelope, shared:** `id`, `tableId`, `game`, `rev`, `seats`, `turn`, `mine`, `deadline`,
  `outcome`, `winner`, `startedAt`, `finishedAt`, and players narrowed to identity + result.
- **Board, per game:** one `view` field carrying the engine's own `PublicView`.

Deliberately not a union of four shapes. The route stays generic, each game's client module owns the
parse and its own schema, and a fifth game changes no shared file.

### A match that is a sequence

`matches` needs **no new table**. One row is the whole match: `state` holds the running score and
the current hand, `finished_at` is set when somebody reaches the target, `winner_seat` is the match
winner. Hand results are entries in `match_actions`, which is already an append-only ledger.

That is also the right granularity downstream — one rating move per match, one history row per
match. A Hokm match to 7 is one line in somebody's history, not eleven.

**Poker is the exception.** A cash table has no match end. One `matches` row per **session** at that
table, `finished_at` when the table closes, each hand an event in the ledger. That matches
`tables.status = 'playing'`, gives the one history row the spec asks for, and avoids a match row per
hand making the table flicker between `ready` and `playing` all evening.

**`winner_seat` is one smallint**, which breaks for a Hokm team win and a Poker split pot. The
answer is `winners: number[]` in state and `winner_seat` kept as "the seat to name in the result
line", null where there isn't one.

---

## The change list, and the risk to Ludo

| # | change | risk |
|---|---|---|
| 1 | Schema: widen the six CHECKs; add `match_players.team`; re-record the snapshot | medium |
| 2 | Extract `Engine`; register Ludo behind it; `service.ts` stops importing `LudoState` | **high** |
| 3 | `view(state, seat)` per viewer; `matchView.view` replaces `tokens`/`die`/`moves` | **high** |
| 4 | Redact `watch.ts` and `since` through the same `view()` | **high** |
| 5 | `record.ts` takes `outcomeOf`/`standings`/`tally` from the engine | medium |
| 6 | `player_stats` Ludo tallies become a per-game `tallies jsonb`; `xpFor` takes engine points | medium |
| 7 | Teams in `rating.ts` | medium |
| 8 | Client: scene registry; `board-canvas` stops hardcoding module, export and plate | medium |
| 9 | `budgets.mjs` stops gating on the Ludo filename and measures every scene chunk | low |

Risk is measured against Ludo, which currently passes 46 API checks, 23 browser checks and 680 QA
cells.

**The gate for Phase 0 is that every one of those still passes with Ludo behind the new seam,
before a second engine is written.** Plus one new test that does not exist today and should:
*a seat cannot see another seat's private state*, asserted over the view, the snapshot and the
event feed.

---

## Order

1. Schema widening + snapshot. Ludo unaffected. Gates green.
2. Extract the interface; Ludo behind it, unchanged. Gates green.
3. Per-viewer `view()`; new wire; Ludo's client reads it. Gates green.
4. Redact `watch` and `since`. Add the leak test.
5. Teams, tallies, XP generalisation.
6. Client scene registry; Ludo's scene registered. Gates green.

Only then does a second engine begin.

---

## What step 3 actually changed, and what it did not

The wire split in two. `matchPlayer` is who is in a chair - seat, handle, timeouts, result, rating -
and carries nothing about what they hold; `matchView.view` is a discriminated union the ENGINE
composes for one viewer, with `ludoBoard` its only member today. `Engine.view(state, seat | null)`
is where a seat goes in and what that seat may know comes out, and `asMatch` - which used to walk
`state.players` and turn ludo pieces into 15x15 grid cells for whoever asked - now calls it and
opens the state for nothing else.

**`watch` came along for free and that is worth stating**, because it was listed as step 4 work. It
builds its payload through `asMatch` with `load.mine` at `-1`, which is exactly the `null` the
engine reads as "a spectator", so the delayed board is already composed by the engine rather than
filtered on the way past. What is left of step 4 is `since`, which still returns every action's
`events` array to every player unredacted, and the leak test - which needs a fixture engine that
actually hides something, because a leak test over ludo asserts nothing at all.

**The client mirrors the split rather than flattening it back.** `data/match.ts` is the one place
the union is narrowed (`ludoOf`) and the two halves are joined (`chairsOf`), and a player the board
did not mention is DROPPED rather than filled in with a blank colour - an invented chair would read
as a fact about the game instead of a fact about the viewer. `PlayerCard` takes both halves as two
props for the same reason.

## What step 4 changed

`since` handed every action's raw `events` column to every player, and `match_actions` is
append-only - so a game that wrote a deal into its own log would have published every hand to
anybody who asked for revision zero, permanently, whatever the board said. A board composed
carefully and a log left open is not a redacted game.

`Engine.log(events, seat | null)` is the board's sibling: raw events in, wire shape out, per viewer.
`matchEvent.events` became `matchEvent.log`, a `matchLog` union discriminated on the action rather
than on each event - repeating the game's name beside every capture would be noise - and `ludoMove`
is what `matchMove` was. Ludo's `log` returns everything to everybody and says so in as many words,
because a roll is called out and a capture is watched; the comment is there so the next engine's
author does not read an identity function as the pattern.

One subtlety worth the sentence: the engine is handed the READER's seat, not `row.seat`. Redacting
for whoever acted hides a secret from the one person who already knows it, and shows it to everyone
else. That is one of the four defects `redaction.db.spec.ts` was proved to catch before it was
trusted.

**`redaction.db.spec.ts` is the test that could not be written before the seam.** Ludo hides
nothing, so every assertion about hiding over a ludo match passes whether the code redacts or not.
The engine here is a fixture with one secret per seat, INJECTED - which is the whole reason
`createMatchService` takes its engines as an argument - and the assertion is over the SERIALISED
payload rather than named fields: checking `view.seats[1].home` catches a leak through the field
somebody thought to check, and searching the JSON for the other seat's secret catches it through any
field at all, including one added later by somebody who never read the file.

Proved against four defects before being trusted: `since` returning the raw column, `since`
redacting for the actor, the board composed for a fixed seat, and a spectator treated as a player.

---

## What step 5 changed

`record.ts` carried `outcomeOf`, which read ludo's board to tell a played win from an emptied room -
beside `ludoEngine.finish`, which read the same board and gave the same answer. Two copies of one
rule, and the third game would have had to remember to add a third copy. It is gone; `finish` and
`standings` come off the engine, so nothing in the file that records every game's result knows what
was played. `commit` takes the engine too, rather than reading `next.winner` out of ludo's state.

**The tallies were three integer columns on a table every game shares.** `captures`, `rolls` and
`tokens_home`, counted by `count(*) filter (where e ->> 'e' = 'capture')` - ludo's event names, in
SQL. Hokm would have wanted `tricks`, poker `showdowns`, and every game would have stored zero in
the others' columns forever. `player_stats.tallies` is jsonb now and `Engine.tally(events)` folds
the ledger, which also puts the fold inside the engine's own tests with no Postgres near it.

**A jsonb counter cannot be incremented the way an integer one can**, and that is the sharp edge of
the change. Postgres has no operator that adds two jsonb objects of numbers - `||` REPLACES a key -
so two games finishing for one person would have recorded the second and forgotten the first, which
is the read-modify-write defect the second audit closed, reintroduced by the storage changing shape.
The upsert sums both key sets through `jsonb_each_text` and re-aggregates, inside the one statement
the unique index serialises. `record.db.spec.ts` plays two matches and expects five rolls, and it was
proved to fail against a `||` merge before it was trusted.

Two smaller things fell out of it. **`both` is a reserved word in Postgres** (from `trim(both ...)`),
so a subquery aliased that way is a syntax error - found by the database suite, which is the only
thing that could have. And **XP split in two**: `levels.ts` keeps the finish and the win, which are
facts about a match, and `Engine.points(tally)` is what a game's own doings are worth, because a
capture being worth two is ludo's opinion and would otherwise have made `levels.ts` a file holding
the scoring rules of four games.

**The client shows the counters and decides nothing by them.** No achievement, rating or level reads
one - which is what makes an open record safe on the wire. `record-strip` holds a label per counter
it knows and renders an unknown one as NOTHING rather than as its own key, the rule `lib/lines.ts`
already follows for a line key an old client has never heard of.

---

## What step 6 changed, and why it came before teams

The plan put teams here. Teams block Hokm-at-four; the ACTION VOCABULARY blocked every second
engine, so it went first - a reorder worth stating rather than doing quietly. Teams move to where
Hokm needs them, because a team rating designed without the game that has teams is the abstraction
this document already warns about.

`/matches/:id/roll` and `/matches/:id/move` were ludo's verbs on a feature every game shares. Hokm
plays a card and calls a trump, backgammon doubles and takes, poker raises - nine more routes over
one body of shared work, where the authorisation, the idempotency key and the revision check are
identical every time. There is one `/play` now, carrying a `matchPlay` discriminated by the game's
name, exactly as `matchBoard` and `matchLog` already are for what comes back.

**`Engine.parse(play, seat)` reads it, and the seat is supplied rather than read off the wire.**
Null is a refusal covering two things a route cannot tell apart without knowing the game: a play
addressed to another engine, and one addressed to this one that does not add up. Both answer the
same, because both mean the same to whoever sent it.

**The die moved INSIDE the engine.** `service.ts` used to call `rollDie()` and build the engine's
action around the number, so the one value a player must not choose passed through a layer with no
reason to touch it - and got written into `match_actions.payload`, the column a player's REQUEST
writes. `apply` takes it from the `Draws` it is handed, at the moment it applies, and the payload is
now what was asked for and nothing about what happened. What the die came up is in `events`, where
the engine put it.

**The sweep calls `autoplay`, which was written for it and never called.** It built a roll or the
lowest legal token by hand out of ludo's vocabulary, beside an engine method that already said it -
the same shape as every other entry in *Five things that were written and never called*.

Two schema changes fell out, both re-recorded as part of this:

- `match_actions_kind_known` was `roll | move | forfeit`. What the platform actually reads is
  whether somebody STOPPED - `record.ts` tells a walkout from a timeout by asking whether a forfeit
  names a person - and nothing branches on the others, so it is `play | forfeit` and the verb lives
  in `payload` where the engine's own words belong.
- **`match_players.colour` is gone.** Its own docblock said it was what `match_players` is joined on
  to draw a board; that stopped being true at step 3, when the board became the engine's to compose,
  and nothing had read it since. A column nothing writes and nothing reads is the dead weight this
  file deletes everywhere else.

**`asMatch` stopped reading the state at all.** The seats come from `match_players`, the turn from
`engine.turnOf`, and the winner from `matches.winner_seat` - which `commit` already writes from the
engine's own `Ending`. It was walking an engine's internal player array to find a handle.

`engine-seam.spec.ts` now covers the whole shared path - `services.ts`, `watch.ts`, `record.ts` -
and fails if any of them imports anything under `ludo/`. `service.ts` is deliberately absent: it
names `ludoEngine` once, as the default engine list, which is composition rather than coupling.

## What step 7 changed

`board-canvas` named one module, one export and one image file, so a second game's board meant
editing the component every board goes through. `game/scenes.ts` is the registry and the only place
that decides which renderer draws which game; the loader is a function returning a dynamic import,
because a static one would put Phaser's 350 KB into the component's chunk and from there into every
route that renders a board. The PLATE belongs to the scene rather than to the caller - it is the
photograph of the object that game is played on, which is a fact about the game and not a prop a
component should be trusted to pass correctly.

**A game with no scene is a state, not a throw.** An old client meeting a newer server falls through
to the same DOM board a browser with no WebGL gets, which is the rule `lib/lines.ts` follows for a
line key it has never heard of.

**`tools/budgets.mjs` reads the registry now rather than a filename.** It looked for
`game/board/ludo-board.ts` and asserted a chunk called `ludo-board-*`, so a second scene would have
ridden into a route chunk with the rule still passing - it was measuring one file rather than the
property. It now derives the games from `scenes.ts`, requires one dynamic import per scene and checks
each module is on disk. All three were proved to fail against their own defect: no scene registered,
a module that is not there, and a scene loading two.

**What is still ludo's on the client, and deliberately.** `BoardView` and `BoardToken` in
`game/bridge.ts` describe tokens on a fifty-two square ring, and the DOM fallback draws them. That is
the contract a second scene will bring its own shape to, and generalising it now - before the second
renderer exists - is the abstraction this document opens by warning about. `match.store.ts`'s
`canRoll`/`moves` are the same: ludo's questions, asked through `ludoOf` so a game with no die
answers false without a special case.

---

## Teams, and where they went

The plan listed teams as step 6. They block Hokm-at-four and nothing else, while the action
vocabulary blocked every second engine - so the vocabulary went first and teams moved to Hokm, which
is the game that has them. A team rating designed without the game it is for is the abstraction this
document opens by warning about, and `match_players.team` is one column to add on the day something
writes it.

---

**Three things were deliberately still Ludo's after step 5**, and two of them are now gone: the
service no longer imports `apply`/`create`/`legalMoves`, and the action vocabulary is per-game.
`match.store.ts` still exposes `canRoll`/`moves`, which read through `ludoOf` so a game with no die
answers false without anybody writing a special case.

**Two source-text rules hold the seam**, both proved to fail against the defect they exist for
before being trusted. `server/tests/engine-seam.spec.ts` fails if `services.ts` imports anything
under `ludo/` or names a part of a board, and asserts by PARSING that the shared envelope drops a
colour and that `matchView` has no `die`, `moves` or `tokens` - the wire being what the parser lets
through rather than what the declaration says.

---

## What this deliberately does not do

No generic "card game framework", no shared trick-taking base class, no plugin system beyond a
registry. Hokm and Poker both use a 52-card deck and that is where the resemblance ends: one is
trick-taking with a trump and hidden hands of thirteen, the other is betting rounds with two hole
cards and side pots. An abstraction over those two would be an abstraction over nothing.

What **is** shared is the `Card` value type, the deck, and the card art. Those are shared. The rules
are not.
