# Chess — شطرنج

**Status:** being built (`docs/superpowers/specs/2026-10-23-chess-design.md`). The row is
`coming-soon` until a table can be played to its end.

Canonical ruleset: the [FIDE Laws of Chess](https://handbook.fide.com/chapter/E012023) (in force
from 1 January 2023), articles 1 to 6 and 9, as an online game plays them: what over the board needs
a claim or an arbiter, the server ends by itself. Free to play; a table may also be played for NURA.

---

## Decisions

| | decision | why |
|---|---|---|
| rule set | standard chess, two players | FIDE's Laws; Chess960 and the other variants are not in this work |
| colours | the server draws which seat plays White for every game, like a die (from the fair seed at a paid table) | fair over many games, and nothing for either player to choose or argue |
| checkmate | wins (5.1.1) | |
| stalemate | a draw (5.2.1) | |
| a dead position | a draw, ended at once (5.2.2): king against king, king and bishop against king, king and knight against king, and kings with bishops all on squares of one colour | a dead position cannot be won by any series of legal moves; these four are the ones that arise |
| threefold repetition | a draw, ended at once when a position stands for the third time (9.2) | over the board it is claimed; online the server ends it, as lichess and chess.com do |
| fifty moves | a draw, ended at once after fifty moves by each side with no capture and no pawn move (9.3) | as above |
| the same position | the same pieces on the same squares, the same side to move, the same castling rights, and the same en passant capture possible (9.2.2) | an en passant square nobody can capture on does not make a position different |
| agreement | a draw (5.2.3), through an offer the other side accepts | |
| a flag | the side whose time runs out loses (6.9), unless the other side cannot checkmate by any series of legal moves, which is a draw | a bare king, or a king and one minor piece against a bare king, or bishops all on one colour |
| resigning | a loss, and a full win for the other side (5.1.2) | a resignation is a result in chess, not a walkout |
| the first move | each side has 30 seconds (live) or the day (turn-based) for its first move, and its clock starts after it; missing it, or resigning before both sides have moved, aborts the game and nobody is rated | lichess's rule: a game nobody began is not a result |
| castling | king and rook unmoved, the squares between empty, the king not in check and not passing through or landing on an attacked square (3.8.2) | |
| en passant | only on the move straight after the double step (3.7.3.1) | |
| promotion | to a queen, rook, bishop or knight of the same colour, chosen by the player (3.7.3.3) | the board asks at the square |
| time controls | live: 3+2, 5+0, 10+0, 15+10 and 30+0 (minutes, then seconds added after each move); turn-based: a day a move | no bullet: the server's clock includes the network, and nothing compensates for it |
| hidden information | none: `view` and `log` are the same for every seat and for somebody watching | a chess board is face up |

---

## Domain

`backend/src/domains/match/chess/` is pure: it imports only its own files, takes the colours from the
`Draws` it is handed, reads no clock, and the purity spec finds it by walking the directory.

```
board.ts    squares 0 to 63 (a1 = 0, h8 = 63), the pieces as letters, FEN in and out
moves.ts    attacks, pseudo-legal moves, legality by king safety, castling, en passant, promotion
status.ts   check, checkmate, stalemate, a dead position, repetition keys, the fifty-move count
san.ts      standard algebraic notation: disambiguation, captures, promotion, + and #
clock.ts    the time controls, the banks, the first-move window
engine.ts   create, apply, finish, standings, view, log, tally, points, turnOf, turnKey, autoplay
```

`backend/src/domains/match/engines/chess.ts` is the adapter behind `Engine`.

### Coordinates

A square is a number from 0 to 63: `a1` is 0, `h1` is 7, `a2` is 8 and `h8` is 63, so the file is
`square % 8` and the rank `square >> 3`. A piece is a letter, upper case for White (`K Q R B N P`) and
lower case for Black. The board is 64 such characters with `.` for an empty square, a1 first.

The rest of this file (the state, the actions, the events, the clock and the wire) is written with the
engine.
