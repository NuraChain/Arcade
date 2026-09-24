# Game helpers - design

Date: 2026-09-24. Owner request: "in-game helpers for every game (legal moves, what a move does, rules
coach), a settings switch per helper". Decisions taken here rather than asked, as the owner asked.

## Three helpers, three switches

Device preferences in `settings.store.ts`, all on by default, each switchable on the settings page
("Game helpers") and from the table menu without leaving the game:

| setting | name on screen | what it does |
|---|---|---|
| `hintMoves` | Show what you can play | the board lights up the pieces, cards and points that can move now |
| `hintOutcome` | Say what a move does | a move is described with its consequence before it is committed |
| `hintRules` | Rules coach | one short tip about the rule that matters in this position |

**Turning a helper off never removes a way to play.** The move lists beside every board are the
keyboard and screen-reader path to the same moves, so they stay whatever `hintMoves` says; what goes
is the lighting on the board. A card or piece that cannot move still refuses a tap - legality is the
server's and the client only mirrors it.

## The rules are the server's

Every helper is computed from the SERVER's own pure rules, imported the way the backgammon board
already imports `stage` from `server/src/domains/match/backgammon/moves.ts`: Ludo's board geometry,
Hokm's `trickWinner`, backgammon's `stage`, poker's evaluator. A second copy of any rule in the browser
would agree with the server right up until the position where it mattered.

Each game has one pure module, `application/src/game/helpers/<game>.ts`, which imports nothing from
AzerothJS and nothing from `lib/`, and answers two questions: what each legal move DOES, and which
`Tip` (`game/helpers/tip.ts`: a message key and its params) applies now. `coachOf` returns null when
nothing is worth saying - a tip that is always there is a tip nobody reads.

## Per game

**Ludo.** A move says whether it brings a token out, sends an opponent's token home (naming whose),
lands on a safe star, or reaches home. Tips: a full yard needs a six; a six rolls again; a third six in
a row ends the turn; stars are safe from capture; home needs the exact count.

**Hokm.** The card a player is about to play says whether it would take the trick as it stands, and
whether it is a trump. Tips: the Hakem names the suit they hold most of; you must follow the led suit
while you hold it; with none left any card goes and a trump takes it; the lead may be anything.

**Backgammon.** A hop says whether it hits a blot, enters from the bar, or bears off. Tips: a checker
on the bar comes in before anything else moves; a double plays four times; both dice must be used when
they can be, the higher when only one fits; with all fifteen home they can bear off; doubling offers the
game at twice the stake.

**Poker.** The player's best hand so far, named by its ranks ("a pair of kings", "sevens full of twos"),
and said to be the board's when the five shared cards alone make it; calling says what it costs against
the pot. Tips: nobody has bet, so checking is free; a bet can be called, raised or
folded; all in, the cards decide the rest.

## Where it shows

The tip is `CoachLine` under the board's status line. The outcome goes into the move list's own
sentences (Ludo, backgammon), onto the lifted card's play button and a caption for a hovered card
(Hokm), and a line beside the betting controls (poker). Spectators get no tips and no outcomes: they
have no moves.

## Tests

`application/tests/helpers-<game>.spec.ts` for each pure module, table-driven over real positions, and
the board specs pin that each switch turns its helper off.
