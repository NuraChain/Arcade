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
| a flag | the side whose time runs out loses (6.9), unless the other side cannot checkmate by any series of legal moves, the loser's moves included, which is a draw | see *Who could still mate*, below: what decides it is what the side with time holds AND what it would have to mate |
| resigning | a loss, and a full win for the other side (5.1.2) | a resignation is a result in chess, not a walkout |
| the first move | each side has 30 seconds (live) or the day (turn-based) for its first move, and its clock starts after it; missing it, or resigning before both sides have moved, aborts the game and nobody is rated | lichess's rule: a game nobody began is not a result |
| castling | king and rook unmoved, the squares between empty, the king not in check and not passing through or landing on an attacked square (3.8.2) | |
| en passant | only on the move straight after the double step (3.7.3.1) | |
| promotion | to a queen, rook, bishop or knight of the same colour, chosen by the player (3.7.3.3) | the board asks at the square |
| time controls | live: 3+2, 5+0, 10+0, 15+10 and 30+0 (minutes, then seconds added after each move); turn-based: a day a move | no bullet: the server's clock includes the network, and nothing compensates for it |
| hidden information | none: `view` and `log` are the same for every seat and for somebody watching | a chess board is face up |

## Who could still mate (6.9)

A flag is a loss only if the side with time left could checkmate by some series of legal moves,
the flagged side's own moves included (a helpmate counts). `canMate` in `chess/status.ts` answers
it from the material alone:

| the side with time holds | could mate when the flagged side holds | why not otherwise |
|---|---|---|
| a pawn, a rook or a queen | anything | |
| only its king | never | |
| a knight and another minor piece | anything | two knights cannot force mate, but can be helped to it |
| one knight | a pawn, a knight, a bishop or a rook | against a bare king or only queens: a queen beside a cornered king covers both squares a knight checks it from |
| bishops on both colours | anything | |
| bishops all on one colour | a pawn, a knight, or a bishop on the other colour | against rooks, queens and bishops of the same colour: a rook or a queen beside the cornered king always takes or blocks the bishop that checks, and the squares that would wall the king in are of the other colour |

A dead position (5.2.2) is one in which neither side could mate, asked through the same function,
so the two rules cannot disagree. What neither sees is a position locked by pawns that no capture
can ever open: it is played on until something else ends it, as lichess plays it.

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

### The move generator

`pseudoMoves` makes every move the side to move could make if its own king did not matter, castling
with every condition but the last (king and rook where they began, the squares between empty, the
king not in check and not crossing an attacked square); `legalMoves` keeps those that leave the
mover's own king unattacked, which is also what refuses landing on an attacked square and taking en
passant out of a pin. `play` makes a move and moves the rights on: a king that moves loses both of
its castling rights, and a rook that leaves its corner, or is taken there, loses that one.

`chess-perft.spec.ts` counts the start position to depth 4, Kiwipete to depth 3 and the
chessprogramming wiki's positions 3 to 6, and every count is the published one.

### The state

| field | what it is |
|---|---|
| `white` | the seat that plays White, drawn when the game is dealt |
| `position` | the board, the side to move, the castling rights, the en passant square, the half-move count and the move number |
| `keys` | the repetition key of every position since the last capture or pawn move, the newest last; never more than 101 |
| `moved` | by seat: whether it has made its first move |
| `offer` | the seat whose draw offer stands |
| `offered` | by seat: how many moves it had made when it last offered |
| `ply`, `last` | plies played, and the last move's two squares |
| `clock` | the time control in milliseconds and each seat's bank, or null at a day a move |
| `over` | the winner (or null) and the reason, once the game has ended |

### The actions

| action | who | what it does |
|---|---|---|
| `move` | the side to move | a legal move; a pawn reaching the last rank must name its piece (`promotion-needed`); a standing offer of the other side is declined by it |
| `offer` | either seat, any time | stands until answered or declined by a move; an offer standing from the other side makes it an acceptance; offered again only after moving (`draw-offered`) |
| `accept`, `decline` | the seat an offer was made to | a draw by agreement, or the offer gone (`no-draw-offer` when none stands) |
| `resign` | either seat | a loss once both sides have moved, otherwise an abort |
| `flag` | the side to move, played only by the sweep | an abort before that side's first move; otherwise a loss on time, or a draw when the other side cannot mate |
| `forfeit` | the platform | a walkout: the other side wins |

### How a game ends

| reason | winner | rated |
|---|---|---|
| `checkmate`, `resign`, `flag`, `forfeit` | the other side of whoever was mated, resigned, flagged or left | yes |
| `stalemate`, `repetition`, `fifty`, `material`, `agreement`, `flag-material` | none: one shared place | yes, as a draw |
| `abort` | none, and both sides unsettled | nobody |

A mate on the move that also brings the fiftieth move or a third repetition stands as a mate: the
engine asks about the mate first.

### The clock

The time control is in the state, in milliseconds, with each seat's bank. A side's first move costs
nothing and has its own window, `FIRST_MOVE_MS`, 30 seconds. After it, a move arriving with `left`
milliseconds on its side's bank leaves `left` plus the increment there, and a move arriving with
nothing left is refused `time-up`. `bankOf` is what the side to move has: the first-move window, its
bank, or null when the game keeps no bank (over, or a day a move). With no `left` handed in (a
replay, a spec) no time passes.

### What each seat did

`moves`, `captures`, `checks` (a check that is not a mate), `checkmates`, `castles`, `promotions`,
`enPassants`, and `draws` for both seats of a drawn game.
