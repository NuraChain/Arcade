# Hokm — حکم

**Status:** the SERVER is done and live - rules, engine, seam, api, `hokm-pass.mjs` green at 2/3/4,
`games.status` flipped to `available`. What is left is the client: assets, the Phaser table and the
DOM hand list. See CLAUDE.md's *Hokm* section for what was built and what the plan below got wrong.

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
| partners | `true` | teams at 4 | it was a boolean nothing read. It is `required` now, one of `none`, `optional` and `required`, and `table/service.ts` reads it when a table is opened |
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

`backend/src/domains/match/hokm/`, pure and import-free like `ludo/` — no `typeorm`, no `node:`, no
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

### Two-player draw (built, D20)

Pagat's game, from his own words: *"The dealer deals 5 cards at once to Hâkem and 5 to himself."*
The Hâkem names trump and puts 3 face down, then the dealer puts 2 face down. Then the Hâkem draws
first and the two alternate: the drawer looks at the offered card and either keeps it, then looks at
the next card and must put it face down (*"having looked at it"*), or puts it face down and must keep
the next. Twenty-one draws (11 to the Hâkem, 10 to the dealer) empty the 42-card stock and leave 13
each. The Hâkem leads; first to 7 tricks wins the hand, and the first 7 pay 2 to the Hâkem or 3 to
the dealer.

| | Hâkem | Dealer |
|---|---|---|
| Opening hand, then face down | 5, 3 | 5, 2 |
| Draws | 11 | 10 |
| Final hand | 13 | 13 |
| Cards seen | 27 | 25 |
| Unknown minus the other's hand, through every trick | 12 | 14 |

- **Phases** are `trump`, `discard`, `draw` and `tricks`; verbs `discard` (2 or 3 cards, ascending),
  `keep` and `reject`, which name no card. Refusals: `not-discarding`, `discard-count`, `not-drawing`,
  and `tricks-not-started` for a card before the tricks.
- **The stock lives in the stored state as an unordered set**, and each card is lifted from it with the
  injected `Draws` at the moment it is drawn, as poker does - so no snapshot says what comes next. It
  is never in a view or an event: a view carries only its COUNT (42 during trump and discard, then
  down two per draw, the lifted offer not counted).
- **There is no discard pile anywhere.** A card put face down is removed and written nowhere. The
  `discard` request's cards are in `match_actions.payload`, which only the verb is ever read back
  from (`engine-seam.spec.ts` holds it).
- **`offer`** is shown only to the drawer. **`glimpse`** - the card the drawer looked at after a keep -
  is shown only to that seat, until its next draw; the last ones stay until the first card of the
  hand is played, so the Hâkem sees the card his eleventh draw put down.
- **`discard`** on the board is the count due, for the seat on turn; **`full`** is the size of a full
  hand (13, 17 at three).
- **Events** `discard` and `draw` carry the seat only.
- **Each action is a turn of its own** at two players: the trump call, each discard, each draw and the
  opening lead each get a deadline and a miss, so an absent Hâkem is forfeited on his first draw.
- **Autoplay** picks from `legalMoves` only: `putAway` (the lowest cards, a trump counting thirteen
  higher, ascending) and `worthKeeping` (a trump or any ten or better), both in `hokm/cards.ts`.

---

## Server

Reuses everything: the table, seats, the advisory-lock claim, the chat thread, realtime, history,
achievements, levels, the turn sweep, the idempotency ledger, the revision precondition.

New actions on the generic route: `DECLARE_TRUMP`, `PLAY_CARD`, and at two players `KEEP` / `REJECT`.
`match_actions.kind` must widen (see the seam doc).

**Teams.** Built. A four-seat table is stored as two against two (`tables.teams`), forced by the
game's `partners: required`; inside the engine a partnership is still seat parity
(`sideOf(seat, 4) = seat % 2`, the product rule), reported through `Engine.sideOf`. `rating.ts` rates each SIDE as
one player at its members' mean rating and moves every member by the same amount, so partners are
never scored against each other (places `[1,2,1,2]` used to score them as a draw, HOKM-02); equal
teams move ±16 each. `standings` is competition-ranked by side - a side with a seat out is last
whatever its points, and sides level on points share a place (HOKM-03). When somebody forfeits,
`finish` reports every seat still at the table as `unsettled`, and as `trailing` each of those whose
side was behind a side still in play - fewer points, or level on points and fewer tricks in the hand
in progress (D25). The quitter takes a rated loss. The opponents win only if they and the quitter had
each played a hand's worth of cards (7 at every player count) and they were not
trailing, so a three-handed survivor who was behind the other one is `void` rather than paid for the
quitter's exit. The partner of a four-handed WALKOUT shares the team's rated loss when the team was
trailing and both of them had played a hand's worth of cards, and is `void` when it was level or
ahead or when the clock took the quitter. Three-handed survivors of a forfeit are never rated against each other. Every hokm forfeit ends the match, so a
win by one pays the rating and the 10 XP finish and nothing else (D26).

**A match is a sequence.** One `matches` row = one match to 7. Hand results are ledger events.

**What the sweep plays for an absent seat (HOKM-06).** The trump call is the suit the Hâkem holds
most of. A card is `autoCard` in `hokm/cards.ts`, chosen from the legal moves by RANK, never by suit
order: following suit, the lowest card of the suit led; void, the lowest card that is not trump (a
trump only when nothing else is left); leading, the lowest card of the longest suit that is not trump.
Ties go to the lower rank, then to suit order, so the same hand always plays the same card.

**An abandoned finish says so in the log (HOKM-09).** The action that ends a match by forfeit logs
`{ e: 'forfeit', seat, reason }` (`resign`, `left` or `timeout`) and then `finish`, to every reader
alike; a played-out match never logs a `forfeit`. `hokm-engine.spec.ts` and `hokm-seam.spec.ts` pin
both, through the wire schema.

---

## Client

`frontend/src/game/hokm/` — framework-free, Phaser behind a dynamic import, registered in the
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
