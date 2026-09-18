# Hokm — حکم

**Status:** planned, not started. Blocked on `00-engine-seam.md`.

Canonical ruleset: [Pagat — Hokm](https://www.pagat.com/whist/hokm.html), 2, 3 and 4 players.
Free to play. No wagering of any kind.

---

## What the repository already claims, and where it disagrees with the spec

`seed-reference.ts:49-63` seeds Hokm as **available** today. You can open a table, seat four people
and mark ready — and Start answers 422 `"That game cannot be played here yet."`
(`match/service.ts:417`). That is the first thing to fix, whichever way: either the engine exists or
the game is `coming-soon`.

| | repo today | this spec | resolution |
|---|---|---|---|
| seats | `[4]` | 2, 3, 4 | widen to `[2, 3, 4]` |
| targets | `[7, 13]` | match to 7 | **keep both.** 13 is a real Iranian variant and the repo already offers it; the canonical default is 7 |
| partners | `true` | teams at 4 | true is correct and **nothing reads it** — `game_rules.partners` has zero functional readers server-side |
| modes | `live`, `turns` | — | `turns` (a 24-hour deadline) is questionable for a trick game but not wrong; keep it and let the sweep autoplay |

---

## Rules ambiguities — flagged, not silently resolved

The spec says *"do not invent rules"* and *"explicitly identify the discrepancy before changing
behavior."* Three things it asks for are not fully specified **by the spec itself**:

**1. The Hâkem rotation when the Hâkem's team loses.** §11, §17 and §22 each say the next Hâkem is
"determined according to the documented rotation" without documenting it. Pagat: the Hâkem passes to
the next player **anticlockwise** (the player to the old Hâkem's right, since play runs
anticlockwise). *Proposed: implement Pagat's rule and write it in the engine's docblock. Confirm
before building.*

**2. "Left" in an anticlockwise game.** §5 says all dealing and play proceed anticlockwise; §7 says
the dealer is "the player to the Hâkem's left from the opposing team". At four players with partners
opposite, both neighbours are opponents, so "left" names one specific seat unambiguously — but only
once "left" is defined against the seating model. *Proposed: seats are numbered anticlockwise in
play order, so "left" is seat − 1 and play passes to seat + 1. One definition, stated once.*

**3. Three-player 7-7-3.** §16 says the player with **fewer** tricks wins. This is genuinely
Pagat's rule and it is deliberately counter-intuitive, so it gets its own named test and its own
paragraph in the engine, or somebody will "fix" it later.

Anything else is taken exactly as the spec states it, including the three-player early-stop table
(7-4-3 continues, 7-4-4 ends, 8-3-1 continues, 8-2-2 ends).

---

## Domain

`server/src/domains/match/hokm/`, pure and import-free like `ludo/` — no `typeorm`, no `node:`, no
clock, no randomness. `ludo-purity.spec.ts` gets a sibling.

```
cards.ts     Card, Suit, Rank, deck builders (52 / 51-with-one-2-removed)
state.ts     HokmState, HokmPhase, HokmSeat, HokmTeam
deal.ts      hakem selection, the phased deal, the 2-player stock
tricks.ts    follow-suit legality, trick winner
scoring.ts   per-player-count hand scoring, early stop, match target
rotation.ts  the explicit Hakem/dealer transition
engine.ts    create / apply / legal / view / autoplay / finish / standings / tally
```

`scoring.ts` and `rotation.ts` are separate files on purpose: the spec says *"do not implement this
using scattered conditionals — create an explicit deterministic state transition."*

### Phases

`HAKEM_SELECTION → DEAL_FIRST → TRUMP → DEAL_REST → (DRAW at 2p) → TRICKS → HAND_RESULT →
NEXT_HAND | MATCH_RESULT`

One enum, one transition function, no booleans.

### The deal pause is the whole hidden-information story

Four-player: 5 cards to the Hâkem **only**, then the game stops. The Hâkem sees those five and
nobody else's. Trump is declared. Only then do the other three receive their first five, then 4+4 to
everyone.

This is exactly the case the seam's `view(state, seat)` exists for. A single shared payload leaks
the whole deal. The test that must exist: **during `TRUMP`, seat 1's view contains five cards and
seat 2's view contains zero** — asserted on the serialised bytes, not on a getter.

### Two-player draw

Keep/reject over a face-down stock, Hâkem first, a kept card forcing the next to be discarded and a
rejected card forcing the next to be kept, until 13 each. The stock is **shoe state**: never in any
view, never in a snapshot, never in an event.

---

## Server

Reuses everything: the table, seats, the advisory-lock claim, the chat thread, realtime, history,
achievements, levels, the turn sweep, the idempotency ledger, the revision precondition.

New actions on the generic route: `DECLARE_TRUMP`, `PLAY_CARD`, and at two players `KEEP` / `REJECT`.
`match_actions.kind` must widen (see the seam doc).

**Teams.** `match_players.team` (`0 | 1 | null`), and `rating.ts` scoring a team result. Elo over a
field already supports equal places, so a 4-player team win is expressible as places `[1,2,1,2]` —
but that scores partners against each other. *Proposed: rate the TEAM as one entity against the
other, then apply the same delta to both members. Confirm before building.*

**A match is a sequence.** One `matches` row = one match to 7. Hand results are ledger events.

---

## Client

`application/src/game/hokm/` — framework-free, Phaser behind a dynamic import, registered in the
scene registry the seam adds.

- **4 players:** partner top, opponents left and right, you at the bottom.
- **3 players:** three seats, no teams.
- **2 players:** head-to-head, plus the draw panel.

**Accessibility is not optional here and it is harder than Ludo.** The rule is *"every move is
takeable from a button beside it, the turn is an aria-live region, the canvas is aria-hidden"*. For
Hokm that means a real list of the cards in your hand, each a button, legal ones enabled and illegal
ones disabled-with-a-reason — not a canvas you have to point at. That list is also what the QA
matrix hit-tests, because it cannot see inside a canvas.

---

## Assets

The audit found the honest numbers:

- **52 card faces do not fit the existing atlas.** 38 more at the current 204×288 slot need
  2,232,576 px against 1,732,480 px free — **1.29× over** before any other art.
- **204×288 is under-resolved anyway.** A card at hand size on a phone is ~85 CSS px → ~255 device
  px at dpr 3, against 172 px of usable art after the 16 px gutter.
- **There is no felt.** `set-hokm.glb` is Hands, Trick, WonTricks, TeaGlass, Tea, TeaRims, SeedBowl,
  Seeds, ShellBowl, Shells, ScoreSheet, Pen — a *dressed table with no table*. The felt lives in
  `table-card.py`.

**Deliverables:**

| asset | tool | note |
|---|---|---|
| `cards-2048.webp` — 52 faces + back, own sheet | new `tools/blender/lib/cards.py` | own sheet, not the atlas. ~256×358 per face |
| `felt-card-1024.webp` — the table surface | `board.py`, parameterised | photograph `table-card.glb`'s octagon |
| suit icons | `icons/registry.ts` | Lucide has `Spade`; Heart/Diamond/Club need adding. **The house rule forbids drawing ♠♥♦♣ as text** |
| trump banner, Hâkem crown | existing `Icon` + tokens | `Crown` is already in the registry |

`board.py` must be parameterised first — it hardcodes `set-ludo.glb`, the mesh names `Board`/`Field`,
a square camera and one output filename.

---

## Testing

Everything the spec §56 lists, plus:

- **The three-player early-stop table by name**: 7-4-3 continues · 7-4-4 ends · 8-3-1 continues ·
  8-2-2 ends · **7-7-3 the player with 3 wins**.
- **Hidden state**, asserted on serialised bytes: during `TRUMP` only the Hâkem has cards; no view
  ever contains another seat's hand; the stock never appears anywhere; a spectator's delayed
  snapshot contains no hand at all.
- **Purity**: `hokm/` imports nothing, enforced as text like `ludo-purity.spec.ts`.
- `tools/qa/hokm-pass.mjs` — full matches at 2, 3 and 4 over the real API, as `ludo-pass.mjs` does.
- Browser: two and four real sessions, both languages, 390 and 1280.

---

## Order

1. `cards.ts` + `tricks.ts` + `scoring.ts` pure, with the full rules suite. **No server, no UI.**
2. `deal.ts` + `rotation.ts`, including the trump pause and the 2-player draw.
3. Engine behind the seam; server actions; `hokm-pass.mjs` green at 2/3/4.
4. **Review checkpoint** — rules, authority, hidden state, reconnect, all three player counts.
5. Assets, then the Phaser table, then the DOM hand list.
6. Achievements, statistics, history, rematch.
