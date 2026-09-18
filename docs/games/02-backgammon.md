# Backgammon — تخته‌نرد

**Status:** planned, not started. Blocked on `00-engine-seam.md`.

Canonical ruleset: [bkgm.com rules](https://bkgm.com/rules.html) and
[WBGF tournament rules](https://wbgf.info/tournament-rules/). Free to play; the doubling cube
multiplies **virtual match points** and nothing else.

---

## What exists today at `/app/games/backgammon`

The spec asks me to audit it first rather than assume it is empty. It is, effectively:

- The route exists and renders — it is the **generic** game page (`games/:slug`), fed by
  `seed-reference.ts:78-92`. Hero art, rules copy, a leaderboard, Quick play and Create a table all
  work, because all of that is game-agnostic.
- A table can be opened, two people can sit and ready up. **Start answers 422** —
  `match/service.ts:417` refuses every game but Ludo.
- There is **no Backgammon code anywhere**: no engine, no scene, no board plate, no move rules.
  `grep -ri backgammon server/src application/src` finds only the catalogue entry and its copy.

So there is nothing broken to fix and nothing to rewrite. The honest description is: **the shell is
real and complete, the game is absent.** `game_rules` says otherwise (`status: 'available'`), and
that is the single defect in the current state.

| | repo today | this spec | resolution |
|---|---|---|---|
| seats | `[2]` | 2 | correct |
| targets | `[1, 3, 5]` | 1/3/5/7/9/11, default 5 | widen to all six |
| hasCube | `true` | cube required | true is correct and **nothing reads it** |
| modes | `live`, `turns` | — | both fine; correspondence backgammon is a real thing |

---

## Why this one is the cheapest of the three

Backgammon is the closest to Ludo the platform already has, and the assets are further along than
either card game:

- **No hidden state at all.** Both boards are face up. The seam's `view(state, seat)` can return the
  same thing for everyone, so the whole redaction problem — the hardest part of Hokm and Poker —
  simply does not arise.
- **Two players, no teams**, so `rating.ts` works unchanged.
- **Dice**, which the server already draws for Ludo with `randomInt` from `node:crypto`.
- **`set-backgammon.py` already builds a real board**: Frame, Field, 24 Points as triangles with a
  `point_x(number)` coordinate function, Hinges, Bar, and checkers via `pieces.checker`.
- **The doubling cube faces are already drawn** — `atlas.py` has `CUBE_FACES = (2,4,8,16,32,64)`.

`point_x(number)` matters more than it looks. CLAUDE.md's rule for Ludo is *"the board is not
invented, it is read off the art"* — `layout.ts` derives its two fractions from the art's own
constants so the drawn board and the logical board cannot drift. Backgammon can do exactly the same
thing from `point_x`, and it is the reason to photograph this board rather than draw a new one.

**One trap, already identified.** `set-backgammon.py:173-174` runs `kit.bake_ao` with 30 checkers, a
cube, two dice and a cup on the board, and `bake_ao` multiplies AO into the `Col` layer *in place*.
So the Points and the Field carry the permanent baked contact shadows of pieces the client draws
itself — the identical trap Ludo hit, where the pawns' shadows showed on the plate as smudges inside
the home squares. The plate script must repaint the face before rendering, exactly as
`board.py` already does for Ludo.

---

## Domain

`server/src/domains/match/backgammon/`, pure and import-free.

```
board.ts      the 24 points, bar, off, derived from the art's point_x
state.ts      BgState, phases, cube, match score
moves.ts      move generation — the hard part
dice.ts       opening roll, doubles → four moves
scoring.ts    single / gammon / backgammon × cube; match points; Crawford
cube.ts       offer / take / drop / ownership / redouble legality
engine.ts     create / apply / legal / view / autoplay / finish / standings / tally
```

### `moves.ts` is where the difficulty actually is

Not hitting, not bearing off — **move-sequence generation**. The spec is explicit and correct:

> "Do NOT merely calculate which checkers can move. The engine must understand the complete dice
> sequence."

Three rules that fall out of that and cannot be done per-move:

- **Both dice must be used if any legal sequence uses both.** Validating each move in isolation lets
  a player play one die and strand the other when a legal pair existed.
- **If only one die can be played, and either could be played alone, the HIGHER must be.** Only
  knowable by generating both orders.
- **Intermediate points must be legal**, not just the destination — so a 5+3 with a blocked
  intermediate is illegal both ways round even though the total distance is open.

The engine therefore generates the **set of full legal sequences** for the roll, and a move is legal
iff it is a prefix of one. That is also what the client highlights from, so the UI cannot offer an
illegal continuation. Doubles give four moves, which makes the search wider but not different.

### Phases

`OPENING_ROLL → TURN_START → (CUBE_OFFER → CUBE_ANSWER) → ROLL → MOVE → TURN_END →
GAME_RESULT → NEXT_GAME | MATCH_RESULT`

### A match is a sequence

One `matches` row = one match to N points. `state` holds the match score, the cube, whether this is
the Crawford game, and the current board. Game results are ledger events. `finished_at` when
somebody reaches N.

**Crawford is state, not a conditional.** `isCrawfordGame` is a field; the cube actions are illegal
while it is true; it is set when either side reaches N−1 and cleared after that game. Post-Crawford
the cube returns.

---

## Client

`application/src/game/backgammon/` with a Phaser scene, registered in the seam's scene registry.

- Points, bar and bear-off trays derived from the same `point_x` the plate was rendered from.
- **Tap checker → tap destination**, the same validated command as any drag. One rule
  implementation, two input methods — the spec is explicit about this and it is the right call.
- Stacks show a count past five rather than rendering fifteen overlapping discs.
- **Accessibility**: the move list is real buttons ("6: 13 → 7"), the turn is an aria-live region,
  the cube state is text and not only a number in a box. Non-colour indicators throughout — "blue is
  me" is exactly what the rule forbids.

---

## Assets

| asset | tool | note |
|---|---|---|
| `backgammon-plate-1024.webp` | `board.py`, parameterised | photograph `set-backgammon.glb`, **repaint the face first** to drop the baked checker shadows |
| checkers | `pieces.checker` already exists | render two colourways, or draw in-canvas |
| doubling cube | `atlas.py` **already has** `CUBE_FACES` | reuse |
| dice | `atlas.py` already draws dice for the market | check resolution at board size |

`board.py` needs parameterising first: it hardcodes `set-ludo.glb`, the mesh names `Board`/`Field`,
a square camera and one output filename. Backgammon's board is **not square** — `.board-stage`
carries `aspect-ratio: 1` in `app.css:662`, which has to become per-game.

---

## Testing

Everything in spec §78–§88, and three that deserve naming:

- **Checker conservation**, asserted after every single move: 15 white and 15 black exist, each on a
  point, on the bar, or borne off. Never more, never fewer.
- **The forced-higher-die rule**, with a position where either die alone is legal but both are not.
- **Crawford**: cube illegal during it, legal after it, set at exactly N−1.

Plus `tools/qa/backgammon-pass.mjs` playing full matches over the real API, and two browser sessions
for a live match including a double, a take and a reconnect mid-turn.

---

## Order

1. `board.ts` + `moves.ts` pure, with the full sequence-generation suite. **This is the milestone
   that matters** — if move generation is right, the rest is bookkeeping.
2. `scoring.ts` + `cube.ts` + Crawford.
3. Engine behind the seam; `backgammon-pass.mjs` green.
4. **Review checkpoint.**
5. Plate, scene, DOM move list.
6. Achievements, statistics, history, rematch.
