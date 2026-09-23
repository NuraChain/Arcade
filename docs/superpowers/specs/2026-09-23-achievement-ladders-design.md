# A thousand achievements per game, and a thousand everywhere

Date: 2026-09-23, revised 2026-09-24. Owner request: "every game has own achievement 1k
achievement also global achievement". All four games have engines now, so all four get a thousand,
and the product gets a thousand more that count across every game.

## The constraint that shapes everything

This product deletes any achievement nothing can award ("a tile somebody would spend a season
trying to earn"). So five thousand cannot be five thousand invented sentences: every one is a
threshold over something a finished match really records. That makes them LADDERS - a family of
steps over one measured counter - generated from a table rather than written one by one. A family
that could never be climbed at a game (four-player wins at backgammon, turn-based poker) is not
generated for it.

## What is measured

Per person per game, read inside the transaction that finishes a match:

| source | every game |
|---|---|
| `player_stats` | played, won, XP, peak rating, best streak, the engine's tallies (summed) |
| `match_players` + `matches` + `tables` | played and won by seat count and by pace (live / turn-based), distinct days |

Tally names are the engines' own: ludo `rolls sixes captures home enters`, hokm `hands tricks kots
trumps`, backgammon `games gammons backgammons hits borneOff`, poker `hands pots showdowns
knockouts`. `ladders.spec.ts` plays each engine and fails if a family names a counter the engine
never produces - a tally rename would otherwise leave a whole family at zero with nothing throwing.

Across every game: played, won, XP, level, distinct days, peak rating, best streak, wins at a table
of four or more, turn-based, live and two-player wins, tables hosted and played to the end, and
distinct opponents. Friends and groups are not counted: a public record carrying a friend count would
publish the social graph.

## The families

Each family is `{ id, metric, icon, title, blurb, steps }`. Steps come from a dense ladder of round
numbers (1..20 by 1, then by 5, 10, 25, 50, 100, 250, ...), optionally scaled, or a linear run for
ratings (1225, 1250, ...) and streaks (2, 3, 4, ...). Lengths are chosen so each scope sums to
exactly 1,000 and a test holds the count.

- Ludo and Hokm (2, 3 and 4 seats, live and turn-based): played, won, XP, rating, streak, won and
  played at each seat count, won and played at each pace, days, and their tallies.
- Backgammon (2 seats, live and turn-based): played, won, XP, rating, streak, days, won and played at
  each pace, and its tallies.
- Poker (2, 6 and 9 seats, live only): played, won, XP, rating, streak, days, won and played at each
  seat count, and its tallies.
- Everywhere: the thirteen cross-game facts above.

## Names, tiers, order

- An id is `<game>-<family>-<step>` (`all-` for the cross-game ones), stable while a ladder only
  grows at the end.
- A name is the family's title and the step ("Hunter 24", "شکارچی ۲۴"); a blurb is the family's
  sentence with the threshold ("Send 400 tokens back to their yard in Ludo.").
- Five tiers by position in the ladder: bronze, silver, gold, platinum, diamond. The CHECK names five
  and the medal art has five metals.
- The seventeen hand-written achievements go: every one of them is a rung now (a first win is
  `won 1`), and "sat down at a table" had nothing to count once a seat is taken and left.

## Storage and awarding

- Definitions are reference data: `seed-reference.ts` upserts the generated set in one
  `INSERT ... SELECT unnest(...)` per boot and deletes any id no longer generated.
- Awarding reads the facts for the game that finished and for everywhere, works out every rung the
  record has reached, and inserts the ones not held yet in one statement.

## Reading them

Five thousand tiles is not a page anybody can use, so the wire speaks FAMILIES:

- A person's record carries, per scope, earned and total; per family, the counter, the rungs
  earned, the last tier and the next rung with its threshold; and the twelve most recent medals.
- `GET /people/:handle/achievements/:family?game=` is one family's whole ladder, for the detail view.
- The game page shows that game's families as cards with a bar to the next rung; a card opens its
  ladder. The profile shows totals per game, the recent medals and the cross-game families.
