# Backgammon — تخته‌نرد

**Status:** playable. The engine, the board and the API pass are built and `games.status` is
`available`. The achievements are not built yet.

Canonical ruleset: [bkgm.com rules](https://bkgm.com/rules.html) and
[bkgm.com match play](https://bkgm.com/rules/match.html). Free to play; the doubling cube multiplies
**virtual match points** and nothing else.

---

## Decisions

| | decision | why |
|---|---|---|
| rule set | standard (WBF/bkgm) backgammon, two players | Iranian "traditional" rules are not one rule set: the sources disagree on the opening roll, the hit-and-run ban and even scoring |
| a `matches` row is | the whole match to `table.target` points | one rating move and one history line per match; each game is an event, the way hokm treats a hand |
| targets | 1, 3 and 5; a table with target 0 plays to 1 | an 11-point match at 30-second turns runs over an hour on a phone |
| cube | on when `table.cube` and the target is above 1; dead in a 1-point match | a cube in a 1-point match changes nothing but the wait |
| Crawford | yes: no doubling in the game after a player first reaches target − 1, allowed again after it | standard match play |
| Jacoby, beavers, automatic doubles | none | match play, where Jacoby does not apply and beavers are a money-game convention |
| cube ceiling | 64, the highest face a cube has | also what bounds every number on the wire |
| rolling | the engine rolls for a player who has no cube decision, inside the action that ended the previous turn | one action per turn; the dice appear with the turn |
| no legal move | the turn passes inside the same action and a `pass` event is logged | a dance is not a decision |
| concede a single game | not built | deferred: a real feature, with a value to settle |
| hidden information | none: `view` and `log` are identical for every seat and for a spectator | a backgammon board is face up |

---

## Domain

`server/src/domains/match/backgammon/` is pure: it imports only `./` files, takes its dice from the
`Draws` it is handed, reads no clock, and `ludo-purity.spec.ts` finds it by walking the directory.

```
board.ts      constants (OFF 0, BAR 25, 15 checkers, the start), Side, Hop, pips, facing
moves.ts      the move search: canStep, step, longest, turns, settle
cube.ts       whether the cube is live, and mayDouble
scoring.ts    single / gammon / backgammon, their values, the Crawford transition
state.ts      the state, the actions, the events, the refusals
engine.ts     create, apply, legalMoves, autoplay
```

`server/src/domains/match/engines/backgammon.ts` is the adapter behind `Engine`, registered in
`ENGINES` in `service.ts`.

### Coordinates

The state keeps `checkers[seat]`, 26 counts in **that seat's own numbering**: index 0 is borne off,
1 to 24 are points counted from the seat's own home, and 25 is the bar. A checker always moves from a
higher number to a lower one. My point `p` is my opponent's point `25 − p` (`facing`), which is the
only mapping anything needs.

A hop is `{ from, to }` in the mover's numbering, the standard notation: `13/7` is `{ from: 13, to: 7 }`,
`bar/20` is `{ from: 25, to: 20 }` and `3/off` is `{ from: 3, to: 0 }`.

### The move search

The rule is about the whole turn, so no step is validated in isolation:

- use both dice whenever any legal sequence can, and all four of a double if possible;
- if only one die can be played, and the higher one can, play the higher;
- every intermediate point of a combined move must itself be open, so a 5-3 with both 8 and 10 blocked
  cannot reach 5 from 13 even though 5 is open;
- a checker on the bar enters before anything else moves;
- bearing off needs all fifteen home; an exact die bears off from its point, a higher die only from
  the highest occupied point, and nobody is obliged to bear off while another move exists.

`longest` is the most dice a position can use (memoised, stopping early once every die is used).
`settle(side, roll, hops)` validates one submitted turn by replaying its hops, trying each die that
fits each hop, and requiring exactly `longest` hops plus the higher-die rule. The play carries no
die: the engine works out which one each hop used, which is what settles an ambiguous bear-off
(`3/off` with a 5 or a 6).

`turns(side, roll)` is every distinct legal turn, one representative per final position, pruned by
(position, dice left). It is what `legal()` returns and what `autoplay` takes the first of.

`backgammon-rules.spec.ts` checks all of it against a naive enumerator written inside the spec, over
three hundred positions from seeded self-play, and pins the known count of distinct plays for every
opening roll (2-1: 15 … 6-6: 11).

### Turn flow

A match opens mid-turn. `create` throws one die per seat, re-throws a tie (at most sixteen times,
then picks the starter with one draw so a constant fixture cannot spin), and the higher starts with
those two dice. Every later game of the match opens the same way and logs an `opening` event.

After a move, a take or a roll that passes, the next player's turn begins:

1. if they may double, the engine stops in `phase: 'roll'` and waits for `roll` or `double`;
2. otherwise it rolls for them and moves to `phase: 'move'`;
3. if they have no legal move it logs `pass` and starts the other player's turn, capped at eight
   passes in one action, after which the player on turn is left in `phase: 'roll'` to roll by hand.

| verb | who, when | effect |
|---|---|---|
| `roll` | the player on turn, `phase: 'roll'` | rolls, then passes if nothing is playable |
| `double` | the player on turn, `phase: 'roll'`, and `mayDouble` | `phase: 'double'`; the opponent now holds the turn |
| `take` | the opponent, `phase: 'double'` | cube × 2, owned by the taker; the doubler is rolled for |
| `drop` | the opponent, `phase: 'double'` | the doubler wins the game at the cube's value before the double |
| `move` | the player on turn, `phase: 'move'` | the whole turn, 1 to 4 hops; bearing off the fifteenth ends the game |

`turnOf` is never null while the match is live: during a double it is the player who must answer.

### Scoring and the match

A game is a **single** (1) if the loser has borne off a checker, a **gammon** (2) if not, and a
**backgammon** (3) if the loser also has a checker on the bar or in the winner's home board. The
value is multiplied by the cube, and a dropped double scores a single at the cube's value before it
was offered. When a score reaches the target the match is over; otherwise the board is reset, the
cube is centred, the Crawford state steps (`before → now` when the winner is at target − 1,
`now → after` after the Crawford game) and the next game opens.

`mayDouble` is: the cube is live, the match is not over, this is not the Crawford game, the cube is
below 64, and the cube is centred or owned by the player asking.

### Refusals

`apply` never throws. A refusal is one of `game-over`, `not-playing`, `not-your-turn`,
`must-roll-first`, `already-rolled`, `cannot-double`, `no-double`, `double-pending` and
`illegal-move`. Every one has a status and a sentence in `REFUSALS`/`SAYS` in `service.ts` - acting
out of turn or from outside the match is 403, everything else 409 - and `engine-contract.spec.ts`
fails to compile if a reason in `BackgammonRefusal` has no words.

### Walkouts, and what counts as a win

A forfeit ends the match and names the other seat. Whether that is **won** or **abandoned** is the
new-game rule for two seats: once both seats have taken at least two actions (`acted` in the state,
counting every applied action but a forfeit), a forfeit is a rated win for the other seat; before
that it is abandoned and unrated. A match played to its target is always won.

`acted` counts what the engine was asked to apply, so a turn the sweep plays for somebody who timed
out counts as theirs. A seat that never acts is played twice by the sweep and forfeited on the
third miss, which crosses the threshold if the opponent has also acted twice.

### Autoplay

What the sweep plays for somebody whose clock ran out: `roll` in `phase: 'roll'` (never a double),
the first full legal turn in `phase: 'move'`, and `drop` when a double is waiting on them, which is
the loss that is bounded.

---

## Wire

Added to the shared unions in `schemas.ts`: `backgammonBoard` to `matchBoard`, `backgammonLog` (of
`backgammonMove` events) to `matchLog`, and `backgammonPlay` to `matchPlay`.

```
backgammonPlay  { kind: 'backgammon', verb: 'roll' | 'move' | 'double' | 'take' | 'drop',
                  hops?: [{ from: 0..25, to: 0..25 }] (1 to 4) }
```

`parse` refuses a `move` with no hops or a hop that does not go down, and any other verb that
carries hops. There is no die on the way in: `ludo-dice.spec.ts` reads the play's source.

The board is the same for everybody: `phase`, `turn`, the `dice`, per seat `{ seat, checkers (26,
own numbering), pips, score }`, `cubed`, `cube`, `owner` when the cube is not centred, `doubling`
(the player on turn may double now), `crawford` (this is the Crawford game), `target` and `round`.
Every number is bounded.

The log's events are `opening`, `roll`, `move` (with the `die` it used and whether it `hit`),
`pass`, `double`, `take`, `drop`, `game` (`how`, `points`, `cube`), `forfeit` and `finish`.

---

## Tallies and XP

`tally` keys, per seat: `games` (games won), `gammons` (gammons and backgammons won), `backgammons`,
`hits` and `borneOff`. `points(tally) = min(25, 3 × games + 3 × gammons)`, so a winning match pays
about the same as a ludo or hokm win.

---

## Tests

- `server/tests/backgammon-rules.spec.ts`: each rule above by name, the opening counts, the naive
  enumerator cross-check, checker conservation after every single hop of four hundred plies,
  scoring times the cube, the dead cube, no beavers, and the Crawford sequence played for real.
- `server/tests/backgammon-engine.spec.ts`: the opening roll and its tie, automatic rolling, the pass,
  every refusal, walkouts and the two-action threshold, autoplay, the tallies, and seeded whole
  matches at 1, 3 and 5 points, cube on and off, with every invariant checked after every action.
- `server/tests/backgammon-seam.spec.ts`: every reader gets the same board and log all match long,
  the wire round-trips through the shared unions, and `parse` refuses other games' plays.
- `server/tests/engine-contract.spec.ts` plays random 1-point matches under its 3,000-action bound.

---

## The board

`application/src/components/games/backgammon-board.component.azeroth` draws the board as one inline
SVG from `application/src/game/backgammon-layout.ts`, with the reader's home bottom right whatever
their seat. A turn is staged one hop at a time - tap a checker, then where it goes, or pick a move
from the list of buttons under the board - and `stage()` from the server's own `moves.ts` decides
which hops are left after each one. Undo takes a staged hop back; "Play the move" sends the whole
turn once it is complete. See CLAUDE.md, *Backgammon*.

`tools/qa/backgammon-pass.mjs` plays whole matches at 1, 3 and 5 points over the real api.

## Not built yet

1. The achievements (`backgammon-first-win`, `-gammon`, `-cube`, `-master`) and the rating cases.
2. A two-browser play pass that plays a match through the interface, like `play-pass.mjs` does for
   ludo.
