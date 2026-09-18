# Poker — No-Limit Texas Hold'em

**Status:** planned, not started. Blocked on `00-engine-seam.md`. **The hardest of the three.**

Free to play. Chips are virtual and have no monetary value. No deposits, no withdrawals, no
cash-out, no wagering. Nothing in this plan creates any of those.

---

## What the repository already claims, and where it disagrees

`seed-reference.ts:64-77` seeds Poker as **available**. Same as the other two: a table opens, people
sit, Start answers 422.

| | repo today | this spec | resolution |
|---|---|---|---|
| seats | `[2, 4, 6, 8]`, max 8 | **2–10, every count** | widen to `[2,3,4,5,6,7,8,9,10]`, max 10 |
| targets | `[]` | none | correct — a cash table has no target |
| stakes | `play-money` | free-to-play | correct, and the one game where it is true |
| hasBlinds | `true` | SB/BB amounts + starting stack | true, but **nothing reads it**, and `tables.blinds` is a three-level enum (`low`/`mid`/`high`) — it cannot express 5/10 or a 1000 stack |

**`matches_seats_range` is `between 2 and 4` and `match_players_colour_range` is `0..3`.** Poker is
the game that forces those open.

---

## Why this is the hardest, stated plainly

The other two are bounded rule problems. Poker breaks four platform assumptions at once:

1. **A match has no end.** A cash table plays hand after hand until people leave. Everything
   downstream — `finished_at`, `winner_seat`, one rating move per match, one history row — assumes a
   match finishes with a winner.
2. **Hidden state with a live adversary.** Hokm hides hands; Poker hides hands *and* the undealt
   deck, and a single leak through the spectator snapshot or the event feed is not a bug, it is
   cheating.
3. **There is no natural rating.** The spec says so itself, and it is right: *"do NOT automatically
   equate largest stack at table with game winner"* and *"do not invent a broken ranking
   calculation."*
4. **Money-like arithmetic.** Side pots, odd chips, uncalled bets. Chips must be conserved exactly —
   an integer division that loses one chip is a real defect, and the spec demands a test that total
   in equals total out.

### The decisions those force

**A match is a SESSION at the table**, not a hand. `finished_at` when the table closes. Each hand is
a ledger event. This gives the one history row the spec asks for ("Poker Session / Hands / Starting
Stack / Ending Stack") and keeps `tables.status = 'playing'` stable instead of flickering between
`ready` and `playing` after every hand.

**Poker gets statistics, not rating.** The existing `rating.ts` is Elo over a field with placements,
and a cash table produces no placements. Following the spec's own instruction, Poker records
`player_stats` (hands, wins, showdowns, chips, biggest pot) and **does not touch `rating`** until a
mode exists that has a real result — a Sit & Go, or heads-up match play. That is a deliberate,
documented gap, not an oversight, and it is the same judgement this codebase already made when it
deleted `game_rules.fairness`.

**XP needs care.** Both leaderboards rank on XP (`achieve/service.ts`), and `xpFor` currently pays
in Ludo nouns. A cash table that pays XP per hand would put a Poker grinder at the top of every
board by volume. *Proposed: Poker pays XP per SESSION, scaled by hands played and capped, not per
hand. Confirm before building.*

---

## Domain

`server/src/domains/match/poker/`, pure and import-free.

```
cards.ts      shared with Hokm — Card, Suit, Rank, a 52 deck
evaluator.ts  7 cards -> best 5, category, comparable score
betting.ts    legal actions, min-raise, the reopening rule
pots.ts       side pots, eligibility, odd chips
state.ts      PokerState, streets, seats, stacks, button
table.ts      button/blind positions, action order, heads-up
engine.ts     create / apply / legal / view / autoplay / finish / standings / tally
```

`evaluator.ts` and `pots.ts` are the two that must be perfect, and both are pure functions with no
excuse for being anything else.

### The three rules that are usually got wrong

**Min-raise and reopening.** A raise must be at least the size of the previous full bet or raise. An
all-in *short* of a full raise does **not** reopen betting to players who have already acted. The
spec spells this out and it is the single most common bug in amateur poker engines.

**Side pots.** Each pot carries its own eligible set. A player all-in for less may win the main pot
and cannot win a side pot they did not contribute to. A player may lose the main pot and win a side
pot. The test the spec demands is the right one: **chips in == chips out**, for every scenario.

**Heads-up is a different branch, not a special case of three-handed.** The button posts the small
blind, acts **first** pre-flop and **last** on every street after. Reusing the generic order here is
wrong and produces a subtly broken game nobody notices for weeks.

### Hidden state

This is where the seam earns its keep. Per viewer:

- your own hole cards, always
- other seats' hole cards, **never** — until showdown makes specific ones public
- the undealt deck, **never, to anyone** — it is shoe state and lives outside the view entirely
- future board cards, **never**
- folded hole cards, never unless the showdown rules make them public

And the two paths the audit flagged that would leak all of it today:

- `match_actions.state` snapshots the whole state per action, and `watch.ts` serves it to spectators
  **with no seat parameter**. A 30-second delay does not help — it is still a live hand.
- `since` returns every action's events to every player, unredacted.

Both have to go through `view()` before a single card is dealt.

### Timers

Server-authoritative, 30 s per action plus a small bank, both configuration. On timeout: **check if
legal, otherwise fold** — never call. Browser timers are display only.

---

## Client

`application/src/game/poker/`, Phaser scene in the registry.

Seats arranged for 2 through 10 from one layout function, not ten layouts. Local player at the
bottom with hole cards, stack, and the action bar.

**The betting control is the fiddly bit on a phone.** Presets (½ pot, pot, 2×, all-in) plus an
explicit amount, and every one of them is a UI shortcut over a server-validated command — a preset
can never bypass the min-raise rule.

**Accessibility**: the action bar is real buttons with the amounts in their labels ("Call 40",
"Raise to 120"), the pot and the amount-to-call are text, the active player is not indicated by
colour alone, and the whole hand is playable without pointing at the canvas.

---

## Assets

Shares the card sheet with Hokm — the single strongest reason to build Hokm first.

| asset | tool | note |
|---|---|---|
| `cards-2048.webp` | `tools/blender/lib/cards.py` | **shared with Hokm.** Build once |
| `felt-poker-1024.webp` | `board.py`, parameterised | `set-poker.glb` has Cards, Chips, Deck, DealerButton — **no felt**. The felt is in `table-poker.py` |
| chips | `atlas.py` **already draws** 5 denominations + edges | reuse; stack rendering is the client's |
| dealer button | `atlas.py` **already draws** it | reuse |

Note `set-poker.glb` is 559,468 bytes against a 600 KB per-set budget — little headroom if it is
ever re-exported with more in it.

---

## Testing

Everything in spec §70–§77. The ones that are non-negotiable:

- **Evaluator**: every category, the wheel (A-2-3-4-5 below 2-3-4-5-6), kickers, full-house
  comparison by trips first, quads by kicker, two-pair lexicographic, board-plays-the-best-hand,
  exact ties.
- **Side pots**: multiple all-ins, folded players' contributions, ties in main and side, different
  winners per pot, odd chips. **Chips in == chips out, asserted every time.**
- **Min-raise and reopening**, including the short all-in that must not reopen.
- **Heads-up order**, pre-flop and post-flop, and button rotation.
- **Hidden state on the bytes**: no view, snapshot or event ever contains another seat's hole cards
  or any undealt card.

Plus `tools/qa/poker-pass.mjs` over the real API and browser sessions at 2, 6 and a full table.

---

## Order

1. `evaluator.ts` pure, exhaustively tested. Nothing else starts until it is right.
2. `pots.ts` pure, with conservation asserted.
3. `betting.ts` + `table.ts`, including heads-up.
4. Engine behind the seam; session-as-match; `poker-pass.mjs` green.
5. **Review checkpoint** — evaluator, side pots, min-raise, heads-up, hidden state, concurrency.
6. Felt, scene, action bar, bet control.
7. Statistics, achievements, history. **No rating**, by decision.

---

## What is deliberately out of scope

Tournaments, Sit & Go, blind levels, rebuys, PLO, spectator hole-card reveal, hand replay,
leaderboards by winnings. Each is named in the spec as future work and none is built now.
