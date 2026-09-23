# Poker — No-Limit Texas Hold'em, played as a Sit & Go

**Status:** playable. The engine, the table, `tools/qa/poker-pass.mjs` and the matrix route are
built, and `games.status` is `available`.

Free to play. Chips are virtual and have no monetary value. No deposits, no withdrawals, no
cash-out, no wagering. Nothing here creates any of those.

---

## The format, and why it is a Sit & Go

A cash table plays hand after hand until people leave, so it has no end, no winner and no
placements — everything the platform records (`finished_at`, `winner_seat`, one rating move per
match, one history row) assumes a match finishes. A **Sit & Go** does finish, and it produces a real
result: the last player with chips wins and everybody else is placed in the order they went out. So
a match is one Sit & Go, the hands are events in the ledger, and poker gets a rating like every
other game.

| | |
|---|---|
| seats | 2, 6 or 9 (`game_rules.seats`, `Engine.seats`) |
| stack | 1,500 each, no antes, no rebuys |
| blinds | rise every 10 hands: 10/20, 15/30, 25/50, 50/100, 75/150, 100/200, 150/300, 200/400, 300/600, 400/800, 600/1200, 800/1600, 1000/2000, then doubling (capped at 1,000,000 so every number stays inside the wire's bounds) |
| opening level | `tables.blinds`: `low` 10/20, `mid` 25/50, `high` 50/100 |
| modes | `live` only; `targets` is empty |
| end | the last player with chips wins |
| placement | elimination order; two players busted in one hand are placed by the stack they started that hand with, and an exact tie shares a place |

## Domain

`server/src/domains/match/poker/`, pure: it imports only itself and `../cards/`, with no clock and
no randomness except the `Die` it is handed. `ludo-purity.spec.ts` reads every directory under
`match/` and allows exactly those two import prefixes.

```
cards/cards.ts   shared with hokm: a card is a number 0..51, suit-major, rank ascending
evaluator.ts     best five of seven, a category and one comparable integer score
pots.ts          the uncalled-bet refund, side-pot layers, the odd-chip split
betting.ts       who must act, what they owe, whether they may raise
state.ts         PokerState, the blind schedule, events, the closed PokerRefusal union
engine.ts        create / apply / legalMoves / autoplay / standings
engines/poker.ts the adapter behind the Engine seam: parse, view, log, tally, finish
```

### Dealing

**There is no deck in the state.** Each card is drawn at the moment it is dealt, uniformly from the
52 minus every card already dealt this hand, through `draws.die(remaining.length)`. No state ever
holds a future board card, so no snapshot, spectator view or ledger row can leak one — the same
argument hokm's trump pause makes, taken one step further. The hole cards live in the state because
they have to, and `view` never builds another seat's.

Hole cards go out two rounds, starting left of the button. The first button is drawn from `draws`.

### Betting

- **Minimum raise** is the last full raise; a bet is at least the big blind.
- **A short all-in does not reopen the betting** to a player who has already acted. The test is the
  TDA's: a seat may raise again only if what it faces now, over what it last matched, is at least a
  full raise — so two short all-ins that add up to a full raise DO reopen it. `faced[seat]` is the
  bet level the seat matched when it last acted, and it is the whole mechanism.
- **Heads-up is its own branch**: the button posts the small blind and acts first preflop, last on
  every later street.
- **The big blind is owed in full** even when the player in the big blind is all-in for less; the
  excess comes back as an uncalled bet.
- **Nobody may raise into a table that cannot answer.** With every other player all-in, the choices
  are fold or call.
- **An uncalled bet is returned** to the player who made it, and never to somebody who folded: a
  player who resigns after raising leaves those chips in the pot.
- **Side pots** are layered by the contenders' commitment levels; dead chips from folded players
  above the top live level join the last pot. `tests/poker-rules.spec.ts` asserts chips in equal
  chips out after every action of random games at every table size.
- **The odd chip** goes to the first winner left of the button.
- **An all-in runout resolves inside one `apply`**, and when a hand ends the next is dealt inside
  the same `apply`. A client never sees a state waiting on nobody.

### Showdown

A hand that reaches showdown shows every hand still contesting it; a folded hand is never shown.
The evaluator covers every category, the wheel (A-2-3-4-5, below 6-high), kickers, full houses by
trips first, quads by kicker, two pair high-then-low-then-kicker, and a board that plays for
everybody.

### Walkouts, and what counts as a win

A forfeit busts only that seat: it folds, it is placed below everybody still alive, and its stack
leaves the table with it (`gone`, which the conservation check counts). The game continues while two
or more players have chips.

| | outcome |
|---|---|
| heads-up, busted by chips | `won` |
| heads-up, a forfeit after both seats took at least two actions | `won` for the other |
| heads-up, a forfeit before that | `abandoned` |
| three or more, any opponent out by chips, by resigning or by leaving | `won` |
| three or more, every opponent out by a timeout forfeit | `abandoned` |

The platform's third forfeit reason, `left`, counts with `resign`: it is somebody choosing to go.

### The clock

`autoplay` checks if it can and folds otherwise. It never calls.

## Hidden state

- `view(state, seat)`: the reader's own hole cards only. Others' cards appear only in `last`, and
  only for a hand that reached showdown. `view(state, null)` shows no hole cards at all.
- `log(events, seat)`: no hole card outside a `show` event — not even the reader's own, which the
  view already gives them. The ledger keeps a `hole` event per seat as an audit trail; `log` drops it.
- `tests/poker-seam.spec.ts` uses hokm's FORGERY technique on both: replace another seat's hole
  cards with different cards of the same length, in the state for `view` and in the events for
  `log`, and require the output to be byte-identical — for every reader and for `null`, after
  every few actions of whole matches at 2, 6 and 9 seats. It also proves the forgery catches a
  deliberate leak, so it cannot pass by comparing nothing.

## The wire

`pokerBoard`, `pokerLog` and `pokerPlay` in `schemas.ts`, every number bounded (chips 0..1,000,000,
cards 0..51, seats 0..8).

A board carries `street`, `hand`, `button`, `turn` (absent when nobody is to act), `board`, `pot`,
`pots` with their eligible seats, `seats: [{ seat, stack, bet, folded, allIn, out }]`,
`blinds: { small, big, level, next }` (`next` is hands until the level rises), the reader's `hole`,
`last`, and `winner` once there is one. `toCall`, `minRaiseTo` and `maxRaiseTo` are present only for
the reader whose turn it is, and the raise pair only when that reader may raise — their absence is
the answer to "can I raise".

A play is `{ kind: 'poker', verb: 'fold' | 'check' | 'call' | 'raise' | 'allin', amount? }`, with
`amount` required on a raise (the raise-TO total) and refused anywhere else.

## Refusals

`game-over`, `not-playing` and `not-your-turn` are shared with the other games; poker adds
`cannot-check`, `nothing-to-call`, `cannot-raise`, `raise-too-small` and `raise-too-large`, each a
409 with its own sentence in `SAYS`.

## What a game leaves behind

`tally` counts `hands` (dealt in and finished), `pots` (won, including split shares and side pots),
`showdowns` and `knockouts` (credited to the winners of the last pot a busted player was in).
`points(tally) = min(25, pots + 3 * knockouts)`.

## Tests

- `poker-rules.spec.ts` — every category and the wheel, ties and kickers, the pot maths, side pots
  with conservation after every action, the short all-in (alone, behind a full raise, and summed),
  heads-up order, the odd chip, the blind schedule, and placements.
- `poker-engine.spec.ts` — the catalogue, parsing and wire bounds, every refusal, autoplay, the next
  hand dealt inside `apply`, the all-in runout, walkouts, the outcome table, tally and points.
- `poker-seam.spec.ts` — the forgery on `view` and `log`, spectators, folded hands never shown.
- `engine-contract.spec.ts` plays random matches at 2, 6 and 9 inside its 20,000-action bound.

## The table

`application/src/components/games/poker-board.component.azeroth`: an oval felt with the seats placed
round it from the reader's chair, clockwise - the next player to act after the reader sits to their
LEFT, which is the opposite of hokm's rotation and the direction a real poker table deals. Each bet is
drawn between its seat and the pot, the button is a "D" on its seat, and the community cards and the
pot sit in the middle. The action bar offers only what the engine accepts: Check when there is nothing
to call, otherwise Fold and "Call 40"; a raise is a slider over the server's `minRaiseTo`..`maxRaiseTo`
with Min, Half pot and Pot presets and a button that says "Raise to 120" ("Bet" when nobody has bet
this street, "All in" at the top). A spectator gets the table and nothing to press.

**The view names a side pot only at an all-in.** The engine settles pots with `layers`, which splits
at every distinct contribution - right at showdown, when every live player has matched, and wrong in
the middle of a street, where the blinds alone made "main pot 20 and side pot 10" before the flop.
`standing` splits only at an all-in player's total, and `poker-rules.spec.ts` pins that it agrees
with `layers` once the betting is complete.

**A player who folds stops being sent their cards.** `hole` is empty for a folded or busted reader:
they gave the cards up, and a server that sends what the reader no longer holds is the pattern this
product refuses everywhere else. `poker-pass.mjs` found it.

`tools/qa/poker-pass.mjs` plays whole Sit & Gos at 2, 6 and 9 over the real api and checks, at every
turn, that every chip is accounted for, that no card is ever in two places at once, and that nobody
holds a card after folding or busting.

## What is left

Cash tables, rebuys, PLO, hand replay and a dead-button rule are not built. A two-browser play pass
through the interface, like `play-pass.mjs` for ludo, is not written yet; the moves were played by
hand in the browser at 390 (Persian and English), 844x390 and 1280.
