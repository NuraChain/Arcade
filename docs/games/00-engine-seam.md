# Phase 0 — the engine seam

**Status:** planned, not started. A hard prerequisite for Hokm, Backgammon and Poker.

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

## What this deliberately does not do

No generic "card game framework", no shared trick-taking base class, no plugin system beyond a
registry. Hokm and Poker both use a 52-card deck and that is where the resemblance ends: one is
trick-taking with a trump and hidden hands of thirteen, the other is betting rounds with two hole
cards and side pots. An abstraction over those two would be an abstraction over nothing.

What **is** shared is the `Card` value type, the deck, and the card art. Those are shared. The rules
are not.
