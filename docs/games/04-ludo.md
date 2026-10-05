# Ludo — منچ

**Status:** playable. The engine, the board, the API pass (`tools/qa/ludo-pass.mjs`) and the browser
pass (`tools/qa/play-pass.mjs`) are built, `games.status` is `available`, and the achievements are
live. Teams (2v2) are not built; see *Teams (planned)*.

Ruleset: **Variant B, the common Iranian rules** (the owner's decision). It is the Ludo cross with
one die, played the way منچ is played in Iran: any yard token comes out on any six, eight squares are
safe, a token coming out captures on its own start square, two tokens of one colour make a block,
and the first player home ends the game. Free to play. No wagering of any kind.

Every rule below is either **cited** (a source and the words it uses) or labelled **house rule**
(no accepted source says it, or the sources disagree and the product chose). Rules the owner settled
after the first draft carry their decision number (D27 onward) and date. One clause is still an
**open choice**; it is at the end of the matrix.

---

## Sources

Read on 2026-10-04. The keys in square brackets are used through the rest of this file.

| key | source | how it was read |
|---|---|---|
| [WP] | en.wikipedia, [*Ludo*](https://en.wikipedia.org/wiki/Ludo): *Rules* (Overview, Gameplay) and *Variants* (Differences, African, Indian) | raw wikitext |
| [MoG] | Masters of Games (James Masters), [*Rules of Ludo*](https://www.mastersofgames.com/rules/ludo-rules-instructions-guide.htm) | the site refuses direct fetches (403); read from the Wayback Machine snapshot of 2025-06-26 |
| [Schmidt] | Schmidt Spiele, [*Die große Spielesammlung, Premium-Edition* (49125)](https://www.schmidtspiele.de/files/Produkte/4/49125%20-%20Die%20gro%C3%9Fe%20Spielesammlung/49125_Die_grosse_Spielesammlung_Premium-Edition-D.pdf), *Mensch ärgere Dich nicht*, pp. 1-2. Schmidt publishes the original | the PDF from schmidtspiele.de |
| [setare] | ستاره, [«نحوه بازی و قوانین بازی منچ + تاریخچه این بازی صفحه ای»](https://setare.com/fa/news/39255/) | direct |
| [fekravaran] | فکرآوران, [«آموزش کامل بازی منچ»](https://fekravaran.com/read/learn-mench-game) | direct |
| [faWP] | fa.wikipedia, [منچ](https://fa.wikipedia.org/wiki/%D9%85%D9%86%DA%86) | raw wikitext |

[Schmidt] is *Mensch ärgere Dich nicht*, the game منچ is named after. It is played on a different
board (40 track squares and four goal fields) and has no safe squares, so it is cited for the rules
of play and never for geometry. [setare], [fekravaran] and [faWP] are the Iranian sources. None of the
six is a governing body: Ludo has none, and every source calls its own rules one way among several.

---

## Rules matrix

### Setup

| # | rule | basis |
|---|---|---|
| S1 | Two, three or four players, each on their own. | cited: [WP] "Two, three, or four can play, without partnerships."; [faWP] «این بازی می‌تواند توسط ۲، ۳، یا ۴ بازیکن انجام شود» ("2, 3 or 4 players can play it") |
| S2 | Four tokens each, all four in the yard at the start. | cited: [WP] "To enter a token into play from its yard to its starting square, a player must roll a six."; [MoG] each player "places the 4 pieces of that colour in the corresponding starting circle". Against: [Schmidt] starts one token on the start square ("Einen Stein stellt er auf das Feld A seiner Farbe") |
| S3 | The board is the Ludo cross on a 15x15 grid: a 52-square ring, then a five-cell home lane per colour and the centre triangle. | house rule: read off the board art (`ludo/board.ts`, held to the art by `ludo-board.spec.ts`). [fekravaran] counts the same board's 72 cells («صفحه بازی منچ شامل 72 خانه است»), which is 52 + 4 × 5 |
| S4 | Colours by seat count: two players are red and yellow (opposite corners, 26 squares apart), three are red, green and yellow, four are all four. | house rule: so two players never start one behind the other |
| S5 | Eight safe squares: each colour's start square and one starred square in each quadrant. | cited: start squares safe, [faWP] «نقطه شروع جز نقطه‌های امن محسوب می‌شود» ("the starting point counts among the safe points"); a star per quadrant, [WP] *Indian*: "a safe square in each quadrant ... usually marked with a star." [MoG] and base [WP] have no safe ring squares; [WP] *Differences* (Denmark) has eight globes |
| S6 | The first player is drawn by the server at random. | house rule. [MoG] "highest throw of the die starts"; [Schmidt] "wer die höchste Zahl würfelt, beginnt". A server draw is the same fair choice without a roll-off nobody decides anything in |

### Turn rules

| # | rule | basis |
|---|---|---|
| T1 | One die. A turn is a roll, then (if anything can move) one move with that die. | cited: [MoG] "A single die is thrown to determine movement."; [faWP] «تعداد تاس ۱ عدد می‌باشد» ("there is one die") |
| T2 | Play passes clockwise round the board: red, green, yellow, blue. | cited: [MoG] "Players take turns in a clockwise order"; [Schmidt] "reihum im Uhrzeigersinn" |
| T3 | A six earns another roll after its move. | cited: [WP] "If the bonus roll results in a six again, the player earns again an additional bonus roll."; [setare] «تاس ۶ جایزه دارد!»; [fekravaran] «هر بار شش بیاورید یک نوبت اضافه می‌گیرید» ("every six earns an extra turn"); [MoG] "A throw of 6 gives another turn." |
| T4 | **Only** a six earns a roll. A capture or a token reaching home on one to five passes the turn; on a six it keeps the six's roll. | cited: no accepted source gives a bonus for anything but a six ([setare], [fekravaran], [faWP], [MoG], [Schmidt] all name only the six). Against: [WP] *African* ("If a player captures the piece of another player, they are awarded a bonus roll.") |
| T5 | A six with no legal move still earns the roll, and a roll whose only moves a block stops (M5) has no legal move. Only a one-to-five with nothing to move passes the turn (`pass`, `no-move`). | cited, by reading: [setare], [fekravaran] and [faWP] make the six's prize unconditional («جایزه شش»). Against, by reading: [MoG] "If no piece can legally move according to the number thrown, play passes to the next player." |
| T6 | Three sixes in a row end the turn. The third six is not moved and earns no roll (`pass`, `three-sixes`); the count starts again for the next player. | cited: [WP] "If the third roll is also a six, the player may not move and the turn immediately passes to the next player." Against: [faWP] keeps throwing until a non-six («تا عدد غیر ۶»); [Schmidt] the same ("darf er erneut nach dem Ziehen würfeln"); [fekravaran] says some versions send a piece home instead and to agree first («پیش از شروع، درباره این قانون توافق کنید») |
| T7 | No "three tries to find a six": a full yard rolling one to five passes at once. | cited, by absence: [WP], [MoG], [setare], [fekravaran], [faWP] have no such rule. Against: [Schmidt] "Wer keine Figur mehr im Spiel hat ... kann dreimal würfeln" (that clause is in its team variant) |
| T8 | A player with a legal move must make one. There is no voluntary pass. | cited: [MoG] passes play only "If no piece can legally move". The turn clock plays an expired turn (see *Turn order*) |

### Moves

| # | rule | basis |
|---|---|---|
| M1 | A token leaves the yard only on a six, onto its own start square. | cited: [WP] (S2's quote); [MoG] "A player must throw a 6 to move a piece from the starting circle onto the first square on the track."; [setare] «هر بازیکنی که تاس ۶ بیاورد، مجوز دارد که یک مهره‌اش را وارد بازی کند» |
| M2 | Entering is a choice: on a six the player may bring out any yard token or move a token already out. | cited: [setare] «روش دیگری که در ایران بیشتر بازی می‌شود این محدودیت را ندارد، یعنی بازیکن می‌تواند با هر تاس ۶، یکی از چهار مهره خود را وارد بازی کند» ("the way more played in Iran has no such limit: with any six the player may bring in any of their four pieces"); [MoG] "Each throw, the player decides which piece to move." Against: [Schmidt] base rules make entering compulsory ("Bei einer „6” muss man einen neuen Stein ins Spiel bringen") |
| M3 | Yard tokens are interchangeable. A move naming any yard token brings out the first one in the yard, and the move list offers the entry once. | house rule (engineering; LUDO-11) |
| M4 | A token moves exactly the die, clockwise, and may pass over any single token, its own or an opponent's. | cited: [Schmidt] "Eigene und fremde Steine können übersprungen werden"; [WP] and [MoG] stop a token only at a block (M5) |
| M5 | **Two tokens of one colour on a ring square are a block** (D28, the owner's decision of 2026-10-05). No token of another colour may land on it or pass it, so a block is never captured by a landing. A move that would is not offered. | cited: [WP] "If a token advances onto a space occupied by a token of the same colour, it is stacked on top to form a "block"." and, under *Differences*, "A block of two or more pieces cannot be taken by an opponent's single piece." and "Some variations permit doubled blocks to be passed" (so the rule is that they are not); [MoG] "If a piece lands upon a piece of the same colour, this forms a block. This block cannot be passed or landed on by any opposing piece." [WP]'s base rule sends a token that lands on a block back home instead; the product follows [MoG] and does not offer the move. Against: [Schmidt] base "auf jedem Feld immer nur ein Spielstein"; [fekravaran] «مهره‌ها نمی‌توانند روی مهره‌های هم‌رنگ خود حرکت یا توقف کنند» |
| M5a | A block's owner may pass it, and may break it by moving either token. | cited: [MoG] blocks only "any opposing piece"; [WP] lists blocking the owner's own trailing pieces as a variation ("A doubled block also blocks trailing pieces of the player who created the block", *African*). Against: [Schmidt] team variant "nicht überspringen – auch nicht mit eigenen Figuren!" |
| M5b | A block may stand on any ring square, a star or another colour's start square included, and blocks there too. | cited: [WP] and [MoG] form a block wherever two tokens of one colour meet, with no exception; [Schmidt] team variant builds walls on an opponent's start square ("Mauert man auf dem Anfangskreis (A) eines Spielers der Gegenpartei"). Nobody forbids it |
| M5c | No third token joins a block: a move landing on two of the mover's own tokens is not offered. | cited: [Schmidt] team variant "Drei Figuren können nie auf einem Kreis stehen." The only accepted source that addresses it; [WP] lists "Three pieces together are weak" as a variation |
| M5d | A start square holds one token of its own colour: no token comes out while one of its own stands there. | cited: [setare] «تا زمانیکه مهره دوم را از این نقطه شروع پیش نبرید نمی‌توانید مهره سومی را وارد بازی کنید» ("until you move the second piece off the start point you cannot bring in a third"); [faWP] «نمی‌تواند چند مهره در نقطه شروع بر روی هم قرار دهد» ("cannot stack pieces on the start point"); [Schmidt] "Ist dieses Feld noch von einer anderen eigenen Spielfigur besetzt, muss dieser Stein erst mit der „6” weitergezogen werden." |
| M5e | The home lane has no blocks: no other colour can enter it, so its owner may gather any number there. | house rule: blocks exist to stop opponents, and C5 already keeps them out |
| M6 | A token walks 50 squares past its start square (51 of the 52) and its next step enters its own home lane. It never laps the board again. | cited: [WP] home column; [faWP] (for team play) «نمی‌تواند دوباره یک دور دیگر برود» ("cannot go round again") |
| M7 | The home lane and the triangle need an exact count. An overshoot is not offered as a move. | cited: [WP] "In the home column, a player must roll the exact number needed to get each token onto the home triangle."; [MoG] "only ... by an exact throw"; [fekravaran] «بازیکن باید عدد دقیق ... را بیاورد»; [Schmidt] "Auch die Zielfelder werden beim Vorrücken einzeln gezählt" |
| M8 | Nothing forces a capture. Any legal move may be chosen. | cited: [Schmidt] "Es herrscht aber kein Schlagzwang." |

### Captures

| # | rule | basis |
|---|---|---|
| C1 | A token that lands exactly on an opponent sends it back to its yard, where it needs a six like any other. | cited: [WP] "the opposing token is returned to its respective home point"; [MoG] "the piece jumped upon is returned to its starting circle"; [setare] «مهره سبز دوباره باید به بیرون از صفحه بازی بروند و با تاس ۶ بعدی به بازی بیاورید» |
| C2 | Capture is on the exact landing square only, never by passing over. | cited: [Schmidt] "Wer mit dem letzten Punkt seiner Augenzahl auf ein Feld trifft ... schlägt diese Figur"; [fekravaran] «اگر مهره شما دقیقاً روی خانه‌ای بیفتد...» |
| C3 | A block is never captured by an ordinary move, because no ordinary move may land on it (M5). The one exception is C7. | cited: M5's sources. This replaces Variant B's first-draft "an attacker captures the whole stack", which D28 retired |
| C4 | No ordinary move captures on any of the eight safe squares. A token landing on one shares it with whoever is there, unless a block of another colour stands there (M5b). The one exception is C7. | cited: S5's sources |
| C5 | The home lane is private: no other colour can enter it, so nothing there can be captured. | cited: [WP] "A player's home column squares are always "safe", since no opponent may enter them."; [fekravaran] «مهره‌ای که وارد خانه پایانی شود ... قابل زدن نیست» |
| C6 | Own tokens are never captured. | cited: [Schmidt] "Eigene Steine können nicht geschlagen werden" |
| C7 | **A token coming out of the yard captures on its own start square** (D27, the owner's decision of 2026-10-05): every opponent token standing there goes home, whatever its colour, a block included. A token arriving on any start square by an ordinary move still captures nobody, so a start square stays safe for tokens passing through. | cited: [Schmidt] "Steht dagegen eine fremde Figur auf dem Feld A, wird sie geschlagen." (an opponent on your start square is captured); [WP] *Differences* (Denmark): "If the entry space is occupied by another player's piece, that piece is captured."; [fekravaran] «اگر بازیکن دیگری روی خانه امن شما قرار بگیرد، می‌توانید مهره او را بزنید» ("if another player stands on your safe square, you can hit their piece"). For a block: [Schmidt] team variant "Mauert man auf dem Anfangskreis (A) eines Spielers der Gegenpartei, ist dies Hausfriedensbruch! Wenn deshalb der blockierte Spieler eine 6 würfelt, fliegen die beiden Maurer raus!" (a wall on an opponent's start square is trespass, and that player's six sends both builders out). Against: [faWP] counts the start square among the safe points with no exception. See *Decided choices* |

### End

| # | rule | basis |
|---|---|---|
| E1 | The first player with all four tokens home wins. | cited: [WP] "The first player to bring all their tokens to the finish wins the game."; [faWP] «برندهٔ بازی فردیست که زودتر از دیگر بازیکنان موفق به تمام کردن مهره‌های خود بشود»; [setare]; [MoG] "The first person to move all 4 pieces into the home triangle wins." |
| E2 | The game ends there. Nobody plays on for second place. | house rule. Against: [WP] "The others often continue to play to determine second-, third-, and fourth-place finishers."; [Schmidt] "Die anderen spielen weiter um die nächsten Plätze." |
| E3 | A seat that forfeits (resigns, leaves, or misses three turns in a row) is out: its tokens go back to the yard and it is skipped. When one seat is left playing, that seat wins. | house rule (the platform's forfeit rule, the same at every game) |

### Scoring

| # | rule | basis |
|---|---|---|
| R1 | Places after the winner come from the board: tokens home, then total distance travelled. A seat that forfeited is below every seat still playing. | house rule (`ludo/standings.ts`, `placementsOf`), because the game stops at E2 |
| R2 | The rating, the result and XP are the judge's (`judge.ts`), from those places and the ledger, as for every game. A seat counts as engaged after six rolls of its own. | house rule (platform); see `.claude/rules/games.md`, *What a game leaves behind* |
| R3 | XP inside a game: a capture is 2, a token home is 3 (`Engine.points`), on top of the platform's finish and win. | house rule |
| R4 | Tallies for achievements: `rolls`, `sixes`, `enters`, `captures`, `home`, credited to the seat that acted. | house rule; the names are a contract with `achieve/families.ts` |

### Special rules

| # | rule | basis |
|---|---|---|
| X1 | The die is drawn by the server, inside the transaction that applies the roll. A play cannot carry a die. | house rule (platform); `ludo-dice.spec.ts` |
| X2 | Turns are 30 seconds live, 24 hours turn-based. A roll and its move share one deadline. An expired turn is played for the seat (roll, then the first legal move, folding up to eight steps) and counts as one miss; three misses in a row forfeit. | house rule (platform: `turns.ts`, `FOLD_MAX`, `MISSES_ALLOWED`) |
| X3 | Nothing is hidden. Every seat and every spectator gets the same board and the same log. | house rule; a ludo board is face up |

---

## Decided choices

**D27 (2026-10-05, the owner): a token coming out of the yard captures on its own start square.**
This was open choice O1 in the first draft, where the engine treated a start square like every other
safe square and an entering token simply shared it. The sources split:

| captures on entry | start square safe for everybody | silent |
|---|---|---|
| [Schmidt] "Steht dagegen eine fremde Figur auf dem Feld A, wird sie geschlagen." | [faWP] «نقطه شروع جز نقطه‌های امن محسوب می‌شود» (no owner qualifier) | [setare] protects the OWNER's token only («اگر مهره شما روی آن باشد، مهره رنگ دیگری نمی‌تواند مهره شما را بزند», "while YOUR piece is on it, no other colour can hit it") and says nothing about a visitor |
| [WP] *Differences* (Denmark): "If the entry space is occupied by another player's piece, that piece is captured." | | [MoG] and base [WP]: no safe start squares at all |
| [fekravaran] «اگر بازیکن دیگری روی خانه امن شما قرار بگیرد، می‌توانید مهره او را بزنید» | | |

Your own tokens reach your start square only by coming out, so "capture on entry" and
[fekravaran]'s "you can hit a visitor on your safe square" are one rule. `capturesAt` in
`ludo/board.ts` is the single statement of it, read by the engine's `captureAt`, the move helper
`outcomeOf` and the coach. `ludo-rules.spec.ts` pins it in *a token coming out of the yard captures on
its own start square*. A block of another colour on your start square goes the same way (D28 and
[Schmidt]'s *Hausfriedensbruch*, under C7).

**D28 (2026-10-05, the owner): two tokens of one colour block.** This replaces the first draft's
"own tokens share a square and never block" and "an attacker captures the whole stack", which no
accepted source supported. The owner set the core - no other colour lands on or passes a block, and a
block cannot be captured - and asked for the edges to follow the most widely cited answer:

| question | answer | sources |
|---|---|---|
| may the owner pass its own block? | yes (M5a) | [MoG], [WP] (blocking your own is a listed variation); against: [Schmidt] team variant |
| may a block stand on a safe or start square? | yes, anywhere on the ring (M5b); but a start square holds one token of its own colour (M5d) | [WP], [MoG], [Schmidt] team variant; for the own start square [setare], [faWP], [Schmidt] base |
| may a third token join? | no (M5c) | [Schmidt] team variant, the only source that answers |
| what does a block on your start square do when you come out? | it is captured (C7) | [Schmidt] team variant, *Hausfriedensbruch* |

`obstacle` in `ludo/board.ts` is the single statement of all four, read by the engine's `legalMoves`
and by the coach, which names the reason (`helpers.ludo.tip.blocked`, `helpers.ludo.tip.start`) when a
token cannot move, and after a pass or a wasted six that a block caused. The board draws a block as
one pawn standing on the other (`BLOCK` in `game/layout.ts`). `ludo-rules.spec.ts` pins it in *two
tokens of one colour form a block* and *a start square holds one token of its own colour*.

---

## Open choices

One behaviour the engine has and the tests pin that no settled rule decides. It stays as it is until
the owner chooses.

**O2. Does a six with nothing to move count toward the three sixes?** The engine says **yes**: the
count goes up when the six is rolled, before the engine asks whether anything can move, so three
unusable sixes end the turn just as three used ones do. No source addresses it. [WP], the only
accepted source with a three-sixes rule, counts throws ("If the third roll is also a six"), which
reads as counting every six thrown. [faWP], [Schmidt] and [MoG] have no limit to count against;
[fekravaran]'s penalty variant does not say. Pinned by *three sixes in a row end the turn* → *counts
sixes that had nothing to move toward the three*. To change it: count a six in `move` instead of in
`roll`, and the turn-clock fold bound needs re-checking, because unlimited unusable sixes would make a
turn unbounded.

---

## State model

`backend/src/domains/match/ludo/`, pure and import-free (`ludo-purity.spec.ts` reads the directory as
text and refuses `node:`, `typeorm`, `Math.random` and `Date.now`).

```
board.ts      the grid, the ring, the entries, the safe squares, the home lanes, ringIndex, cellAt,
              capturesAt (D27) and obstacle (D28), shared with the browser
state.ts      LudoState, EngineAction, GameEvent, RefusalReason
engine.ts     create, legalMoves, apply (never throws)
standings.ts  placementsOf
```

`engines/ludo.ts` is the adapter behind the seam (`docs/games/00-engine-seam.md`): it draws the die,
composes the view and the log, and answers turn, autoplay, finish, standings, engagement and tally.

```ts
interface LudoState
{
    v: 1;
    game: 'ludo';
    players: { seat: number; colour: LudoColour; pieces: number[]; out: boolean }[];
    turn: number;
    die: number | null;
    sixes: number;
    rev: number;
    winner: number | null;
}
```

- `players` is ordered by seat. `turn` and `winner` are indexes into it, never seat numbers.
- A piece is one integer, its progress from its own start square: `-1` is the yard, `0..50` the
  ring (the ring square is `(ENTRY[colour] + progress) % 52`), `51..55` the five home-lane cells and
  `56` (`FINISHED`) the triangle.
- `die` is the roll waiting to be moved, `null` when the next action is a roll.
- `sixes` counts the sixes rolled in the current turn.

**Actions** (`EngineAction`): `roll` (the adapter fills the die from the server's draw), `move` naming
one of the mover's own tokens 0-3 (never a destination), and `forfeit` (`timeout`, `resign`, `left`).

**Events** (`GameEvent`, the ledger): `roll { seat, die }`, `enter { seat, piece }`,
`step { seat, piece, from, to }`, `capture { seat, piece, victim, victimPiece }` (one per captured
token: `piece` is the mover's token, `victim` the captured token's seat, `victimPiece` its token),
`home { seat, piece }`, `pass { seat, why: 'no-move' | 'three-sixes' }`, `forfeit { seat, reason }`,
`finish { winner }`.

**Refusals** (`RefusalReason`, each with words in `REFUSALS`): `not-your-turn`, `already-rolled`,
`must-roll-first`, `illegal-move`, `not-playing`, `game-over`.

---

## Turn order

1. `create` sorts the seats, deals the colours (S4) and starts at the drawn seat (S6).
2. The seat on turn **rolls**. On a six, `sixes` goes up; the third six passes the turn at once (T6).
3. If the roll has a legal move (overshoots and blocks taken out), `die` stays and the seat must **move** (T8). If it has none, a six
   clears `die` for another roll (T5) and a one-to-five passes the turn.
4. After a move: all four home ends the game (E1). Otherwise a six (below three) clears `die` for
   another roll (T3) and anything else passes the turn (T4).
5. Passing moves `turn` to the next seat clockwise that is not `out`, and resets `die` and `sixes`.

`turnOf` is the seat at `turn` while nobody has won; `turnKey` is `turn`, so a roll and the moves that
follow it on the same seat are one turn with one deadline.

---

## Lifecycle

1. **Table.** A two-, three- or four-seat table, `live` or `turns`; no target.
2. **Start.** Every chair taken and ready; `POST /tables/:id/start` creates the match with
   `create(seats, first)`.
3. **Play.** `POST /matches/:id/play` (or the socket's `play` frame) carries `{ kind: 'ludo', verb:
   'roll' | 'move', piece? }`, applied in one transaction under the match row's lock, with the
   idempotency key and the revision precondition.
4. **Timeouts.** The sweep plays an expired turn (X2), one miss per turn.
5. **Finish.** A win (E1) or the last opponent's forfeit (E3) sets `winner`. `finish` reports the
   winner; `standings` reports the places (R1); the judge rates and pays (R2).
6. **After.** The board stays on screen; readiness is spent, and Play again asks every chair again.

---

## Invariants

The rules suite (`ludo-rules.spec.ts`) and the specs named below hold these; the one-colour square
is a consequence of M5 and C1 rather than a test of its own.

- `apply` never throws, never mutates its input, and moves `rev` by exactly one on every accepted
  action and never otherwise.
- Every player has exactly four pieces, each in `-1..56`.
- `die !== null` only when the seat on turn has a legal move: a roll with none clears it or passes.
- `sixes` is 0, 1 or 2 between actions.
- On a ring square that is not safe, the tokens all belong to one colour: a landing captures the
  single opponent there (C1), and no move may land on a block (M5).
- No ring square holds three tokens of one colour (M5c), and no start square holds two of its own
  colour (M5d).
- A token in the home lane or the triangle is never moved by anybody else.
- An `out` player has every piece in the yard and is never on turn while anybody else is playing.
- Once `winner` is set, `die` is null and every action is refused with `game-over`.
- The engine imports nothing (`ludo-purity.spec.ts`); the wire cannot carry a die
  (`ludo-dice.spec.ts`); the board matches the art (`ludo-board.spec.ts`); every prediction the
  browser makes matches the engine over self-played games (`helpers-ludo.spec.ts`).

---

## Known limitations

- **Teams are not built.** See below.
- **The rules are fixed.** There is one ruleset (`matches.variant` is always `standard`) and no
  per-table house rules: no capture bonus, no three-sixes penalty, no compulsory entry.
- **Places after the winner are read off the board**, not played out (E2, R1).
- **The first player is a server draw**, not a roll-off (S6).
- **Autoplay is not a strategy.** An expired turn moves the first legal token, which is fair but
  weak.
- **The server rolls and nothing proves it rolled fairly.** No commit-reveal exists, so the product
  claims only that the server rolls (`.claude/rules/games.md`, *The die is `randomInt`*).

---

## Teams (planned)

**Not built.** A 2v2 mode was researched on 2026-10-04 against the sources above and a wider set
(Schmidt's team variant *Einigkeit macht stark*, Masters of Games' *Pachisi* and *Uckers*, Parchís
tournament rules, پنکو's منچ گروهی). The research proposes the smallest change to Variant B; the clause
numbers are its own. It was written against the first draft, so T7 and T8 (partners never block, a
mixed stack falls whole) predate D28 and must be decided again: [Schmidt]'s team variant, the one
source with both blocks and partners, lets a partner join a wall and keeps every wall standing.

| # | clause | basis |
|---|---|---|
| T1 | Four-seat tables only. | house rule |
| T2 | Partners sit opposite: red and yellow against green and blue. | cited: [Schmidt] team variant "die beiden diagonal gegenüberliegenden Farben als Partner"; [faWP] «یاران باید روبروی هم بنشینند»; Pachisi, Uckers, Parchís |
| T3 | The rotation is unchanged, so the turns alternate between the sides. | cited: Pachisi, Parchís |
| T4 | You move only your own tokens until all four are home. | cited: Parchís, Uckers, پنکو |
| T5 | Then you stay in the rotation and move your partner's tokens with your own rolls. | cited: Parchís, پنکو, Pegs and Jokers |
| T5a | That starts at once, including the roll a six earns. | house rule (open) |
| T6 | Partners never capture each other. | cited: [Schmidt] team variant "Partner können sich nicht hinauswerfen!", پنکو (open: Parchís lets partners capture) |
| T7 | Partner tokens share a square and never block, like your own (M5 widened to the side). | house rule |
| T8 | An opponent landing on a mixed partner stack sends every token there home (C3, per side). | cited: Uckers ("mixed blob"), Pachisi |
| T9-T11 | Safe squares, home lanes, exact counts and every die rule unchanged, judged over the tokens the roller controls. | house rule |
| T12 | The side with all eight tokens home wins; one player's four no longer ends the game. | cited: [Schmidt] team variant "Gewinner ist das Partner-Paar, dessen acht Figuren zuerst ... stehen", Pachisi, Uckers, پنکو |
| T13 | Standings by side: the pair shares a place. | house rule (hokm's shape) |
| T14 | A forfeit ends the match; the quitter's partner comes out `void`. | house rule (open; hokm's precedent) |
| T15 | Partners may talk; nothing is hidden. | cited: Parchís tournament rules |

**Choices before building:** T6 (partner capture), T5a (helping starts at once) and T14 (forfeits).
**What the engine needs:** `Engine.sideOf(seat, seats)` cannot tell a four-seat free-for-all from a
2v2 without a variant; `legalMoves`, `move` and `captureAt` act on the controlled player and skip the
mover's side; `winner` becomes a side and `finish` names both seats; the events name the token's
owner as well as the actor; the browser's helpers (`outcomeOf`, `standingOn`, `pieceFor`) learn
about sides.
