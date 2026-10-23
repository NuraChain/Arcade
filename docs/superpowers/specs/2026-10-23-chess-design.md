# Chess, the fifth game: the design

The owner, 2026-10-23: "Now you know the rules and how this platform works animations it should
feel native sounds and etc... Now Implement Chess game full functionallty with heigh quality
animation sounds graphic design rules plan mode task mode work on it", then "Also you can add it on
landing page with blender 3D", then "Do not forget to test it with playwrigh mcp so that i can see
it".

So chess joins hokm, poker, backgammon and ludo with everything those four have: tables opened from
the form, from a chat and from a group, quick play, voice, the table's chat, watching, ratings,
achievements and leaderboards, playing for NURA, the admin's switch. It is played on the table with
the stage's motion and the sound pack, drawn in the product's own art, with its rules exact, and a 3D
set of it stands on the landing, built in Blender like the other four. Every phase is walked in the
Playwright MCP's visible browser so the owner can watch it being tested.

This file is the design: the rules engine (1), the four things the platform learns because chess is
the first game that needs them (2), the board, its motion and its sound (3), the art (4), everywhere a
game appears (5), the landing (6), and how it is proved (7). The decisions are listed last (8). The
rulebook, with the source of each rule, is `docs/games/05-chess.md`.

## What there is

A game is an engine behind `domains/match/engine.ts`: pure, injected into `createMatchService`, its
board, its log and its play three arms of `matchBoard`, `matchLog` and `matchPlay`. A match is judged
by `judge.ts` from facts the engine reports (who won, who quit, how far each seat got), rated by
`rating.ts`, paid in XP by `levels.ts`, and counted into achievement ladders by the tallies the
engine folds out of its own log. The browser draws a game on the stage (`frontend/src/game/stage/`):
a model of what the table has shown, held to the engine by a parity spec, a renderer that plays
each beat, a presenter that decides what to play and what to set down, and a board component that
holds the plates, the clock, the coach's lamp and the result.

What no game has needed until now: a match that ends in a draw, a clock that belongs to each side
rather than to the turn, a resignation that is a result rather than a walkout, and a time control
chosen with the table.

## 1. The rules engine

`backend/src/domains/match/chess/` is pure: it imports only its own files, takes the colours from
the `Draws` it is handed and reads no clock, and the purity spec walks it like the other four.

```
board.ts    squares 0 to 63 (a1 = 0, h8 = 63), the pieces as letters, FEN in and out
moves.ts    attacks, pseudo-legal moves, legality by king safety, castling, en passant, promotion
status.ts   check, checkmate, stalemate, insufficient material, repetition keys, the fifty-move count
san.ts      standard algebraic notation: disambiguation, captures, promotion, + and #
clock.ts    the time controls, the banks, the first-move window
engine.ts   create, apply, finish, standings, view, log, tally, points, turnOf, turnKey, autoplay
```

`engines/chess.ts` adapts it behind `Engine`; `services.ts` injects it; `lib/proof.ts` replays it.

**The state is small and exact.** The board is 64 characters (`.` for an empty square, `KQRBNP`
for White and `kqrbnp` for Black, a1 first), beside the side to move, the castling rights, the en
passant square, the half-move count since a capture or a pawn move, the move number, the
repetition keys of the positions since the last capture or pawn move (bounded by the fifty-move rule
to a hundred), the seat that plays White, which side has made its first move, a standing draw offer
and the clock's banks. Nothing in it is hidden: `view` and `log` are the same for every reader.

**It is proved by perft.** The number of legal move sequences to a depth from a position is known
for six standard positions, and a move generator that gets castling through check, a pinned en
passant capture or an under-promotion wrong is off by thousands. The start position to depth 4
(197,281), Kiwipete to depth 3 (97,862) and the chessprogramming wiki's positions 3 to 6 are held
in a spec, beside a spec for each article of the FIDE Laws the engine implements.

## 2. Four things the platform learns

### A draw is a result

Today a match ends `won` or `abandoned`, and `resultOf` in `judge.ts` records a seat that shares its
place with every other side as `lost`, so a stalemate would have been recorded as a loss for both
players while the rating moved as a draw. `resultOf` answers `drawn` when every side a seat is
counted against is level with it, and the match's outcome is then `drawn`. A drawn seat is rated as a
draw (the Elo already reads a shared place so), is paid the finish XP and no win bonus, and its win
streak ends. What carries the word: `matches_outcome_known` and the seat's result CHECK, the wire's
enums, `player_stats.drawn` with the record that shows it, the history rows, the achievements'
`FINISHED`, and the browser's result card, plates and profile. A paid game with no winner is already
refunded in full, so a drawn paid game refunds every stake.

### A clock that belongs to each side

Every game today has one deadline per turn, `now() + turnMs(mode)`, and at the deadline the sweep
plays a move for the absent player and counts a miss; three in a row forfeit. Chess is played on a
clock: each side has a bank of time, the bank runs only on its own turn, an increment is added after
each move, and a side whose bank empties loses (FIDE 6.9), unless the other side has nothing left
that could ever mate, which is a draw.

- **The seam gains `bank?(state)`**: the time the side to move has left, or null for a game with no
  bank. The service arms `deadline_at = now() + bank` when there is one, and `now() + turnMs(mode)`
  otherwise, exactly as today.
- **`apply` gains a fourth argument, the moment**: `left`, what the mover had when the move arrived,
  read in Postgres as `deadline_at - now()` under the match's row lock. The engine takes it, adds
  the increment, and the next deadline is the other side's bank. One clock, Postgres's, decides
  everything, as every window here does.
- **A move after its deadline is refused `time-up`**, because between the flag falling and the sweep
  arriving the side is already out of time.
- **At the deadline the sweep's autoplay is chess's `flag`, never a move**: a loss on time, or a draw
  against a side that cannot mate. Before a side's first move the deadline is the first-move window
  and the autoplay is `abort`: the game ends with nobody rated.
- The view carries both banks, so the plates show both clocks; `remainingMs` stays what it is, the
  live one.

A turn-based chess game has no bank: a day a move, and missing it loses on time.

### A resignation the game scores

`POST /matches/:id/resign` hands the engine `forfeit(seat, 'resign')` and writes a forfeit row, and
the judge reads a forfeit as a quitter: a rated loss, and for the other side a forfeit win that pays
the finish and no win credit (D26 of the platform). In chess a resignation is how most games end,
and a win by resignation is a win. The seam gains `concede?(seat)`: when the engine has one, the
resign route sends a play (verb `resign`) the engine scores as a normal ending, a loss and a full
win. Leaving the table in the middle of a game stays a walkout forfeit, as in every game. A
resignation before both sides have moved aborts the game, so nothing is farmed by it.

### A time control is a table option

Like blinds: `game_rules.clocks` lists what a game offers, `tables.clock` holds what was chosen
(null for a game with none and for turn-based chess), `TableConfig.clock` hands it to the engine, the
create form offers it, quick play matches it exactly when it is chosen and opens the default when it
is not (`table/quick.ts`), and the wire states it. `table/clocks.ts` imports nothing, so both halves
read the one list: the ids, their minutes and increment, their labels. A spec holds the CHECK on
`tables.clock` and that list to one set.

## 3. The board, its motion and its sound

- `game/chess-layout.ts`: a board 1000 units across with its frame, the squares, the reader's colour
  at the foot (a watcher sees White at the foot), the coordinates along the frame.
- `game/chess-felt.ts`: the model of what the table has shown. Every piece has a key for its life (a
  promoted pawn keeps its key and changes its kind), the last move, the king in check, the banks, the
  captured pieces. `beatsOf` and `step` read the log; a parity spec plays whole games through the
  engine and requires the model to equal the engine's view at every revision, for both seats and for
  a watcher.
- `game/board/chess-table.ts`: the renderer on the stage. The board is an SVG drawn from the layout,
  the pieces are nodes in a layer over it, placed in container units.
- `game/helpers/chess.ts`: the targets a piece has, what a move would do (a capture, check, mate, a
  promotion), the coach's tips, all asked of the engine's own modules.
- `components/games/chess-board.component.azeroth`, registered in `boards.ts`.

**On the table**: two rails, the other player above the board and the reader below it, each with the
face, the name, the clock, the pieces taken and the material lead. A move is made on the board (D10):
a tap on a piece and a tap on a square, or a drag (D18). The squares a piece can reach are marked (a
dot, a ring round a piece it would take) while the move hint is on, the last move is tinted, the
king's square glows while it is in check, a promotion asks at the square with the four pieces, a draw
offer is answered on the board, the coach's lamp stands at the foot, a keyboard walks the squares as
a grid and a live region says each move in the reader's language.

**Motion**: a piece slides from square to square, a knight lifts and arcs, a piece that is taken
leaves for the taker's tray, castling moves the king and then the rook, en passant lifts the passed
pawn, a promoted pawn turns into its piece, check pulses under the king and mate tips it over. The
reader's own move is answered at the press. For somebody who asked for less motion every run is a
fade and every sound still plays in its place.

**Sound**: a wood knock when a piece is set down and a heavier one on a capture, two knocks for
castling, a short chime for check, a sparkle for a promotion, the turn clock's ticks under ten
seconds, and the jingles at the end. The knocks are four more takes from Kenney's Impact Sounds
(CC0); the chime and the sparkle are synthesised in `sound.ts` as `trump` is.

**The moves played** are a Moves tab beside Chat and Players in the table's side panel, in figurine
notation (the pieces drawn, the squares in Latin letters, the same in both languages), with Copy PGN,
and once the game is over the board steps back and forward through it. Nothing is written on the
felt (D11).

## 4. The art

`tools/art/chess.mjs` draws the twelve pieces (Staunton silhouettes in ivory and ebony, the
product's ink line, a soft light from above; our own drawing, so no third-party licence), the board
(the backgammon table's walnut frame with brass coordinates, maple and walnut squares), and the
waiting room's small board. `games.mjs` gains `chess()`, the card's illustration.

## 5. Everywhere a game appears

The seed's row, `coming-soon` until the board can be played and then `available`; `data/games.ts`
(the id, a board game, two players, the anchor); both catalogues, the Persian in everyday words
(شطرنج، شاه، وزیر، رخ، فیل، اسب، سرباز، کیش، مات، پات، قلعه رفتن، آن‌پاسان، مساوی); the game page's hero
and its rule cards; the create form's time controls; the quick play sheet; the waiting room drawn as
a chess board; a table row and the header saying the time control; achievements (chess's families
summing to a thousand, so the landing's count becomes 6,000); the leaderboard; the proof page; the
paid pass's formats; the matrix and the fit pass.

## 6. The landing, in Blender

`tools/blender/vignettes/chess.py`, built like the four: a walnut board on its plinth, lathed
Staunton pieces instanced in a middle game, a knight settling onto its square, three baked decals.
The five sets stand 1.6 m apart (from -3.2 to 3.2), `FOCUS.chess` frames it, the overview shot is
framed again for five, the "compete" beat moves to the chess set, the games grid is laid out for five
cards, and every sentence that counts the games says five, in both languages.

## 7. How it is proved

- Unit: perft and every rule; the model's parity with the engine; the renderer and the board on a
  manual clock; the judge's draws; quick play's clocks; `table-clocks.spec.ts`.
- Database, on a disposable Postgres: a game started, played, flagged and aborted from a deadline
  written by hand, a resignation scored as a result, every kind of draw rated and recorded.
- Passes on the built server: `chess-pass.mjs` (whole games over the api: every mate the rules
  name, stalemate, repetition, insufficient material, castling both ways, en passant, every
  promotion, a flag, an abort), `chess-play-pass.mjs` (two browsers playing by clicks),
  `chess-motion-pass.mjs` (the motion judge), the fit pass, the matrix, the garbage pass, quick play.
- `npm run check`, both suites and a shuffled run, the build within its budgets, `inspect.mjs` on
  the GLBs, and every phase walked in the Playwright MCP's visible browser at 1280 in English and
  390 in Persian.

## 8. The decisions

| | Decision | Default | Not chosen |
|---|---|---|---|
| CS-D1 | Rules | FIDE Laws of Chess, standard chess | Chess960 and other variants |
| CS-D2 | Draws | ended automatically on stalemate, threefold repetition, the fifty-move rule, insufficient material, and a flag against a side that cannot mate; by agreement through an offer | a claim, as over the board |
| CS-D3 | A draw | `drawn`, rated as a draw, the finish XP, ends a win streak, counted beside won and lost | recorded as a loss for both |
| CS-D4 | Colours | drawn by the server for every game, like a die | the host chooses; colours swap on a rematch |
| CS-D5 | Time | live 3+2, 5+0, 10+0 (default), 15+10, 30+0; turn-based a day a move; running out loses | bullet, which needs lag compensation |
| CS-D6 | The first move | 30 s (live) or the day (turn-based) for each side's first move, the clock starting after it; missing it, or resigning before both have moved, aborts and nobody is rated | the clock running from the start |
| CS-D7 | Resigning | a loss, and a full win for the other side | a forfeit win paying the finish only |
| CS-D8 | Moving | tap then tap, or drag; the reachable squares marked while the move hint is on | premoves |
| CS-D9 | Promotion | a chooser at the square; a device setting to always take a queen, off | a queen by default |
| CS-D10 | A draw offer | from the dock and the table menu, answered on the board; a move declines it; offered again only after the offerer has moved | |
| CS-D11 | The look | the backgammon table's walnut and brass, maple and walnut squares, vector Staunton pieces; the board never mirrors | a green and cream board; a licensed piece set |
| CS-D12 | The moves played | a Moves tab, figurine notation, Copy PGN, stepping through after the game | a list beside the board |
| CS-D13 | The landing | five vignettes, "compete" on the chess set; the phone GLB keeps 1.0 MiB if instancing and a lighter phone cut fit, otherwise the budget rises to the measured size and a tenth, stated | a separate chess page on the landing |
| CS-D14 | Paid tables | chess plays for NURA at live tables through the generic path; a draw refunds every stake | chess free only |
| CS-D15 | Not in this work | variants, premoves, takebacks, bots and analysis, puzzles, an opening book, PGN import, board themes, lag compensation | |
