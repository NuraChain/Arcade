---
paths:
  - "backend/src/domains/match/**"
  - "backend/src/domains/table/**"
  - "backend/src/domains/achieve/**"
  - "backend/src/realtime/**"
  - "frontend/src/game/**"
  - "frontend/src/components/games/**"
  - "frontend/src/pages/app/play.page.azeroth"
  - "frontend/src/pages/app/game.page.azeroth"
  - "frontend/src/pages/app/games.page.azeroth"
  - "frontend/src/pages/app/watch.page.azeroth"
  - "frontend/src/pages/app/create-game.page.azeroth"
  - "frontend/src/pages/app/leaderboard.page.azeroth"
  - "frontend/src/stores/lobby.store.ts"
  - "frontend/src/stores/match.store.ts"
  - "frontend/src/stores/watch.store.ts"
  - "frontend/src/stores/voice.store.ts"
  - "frontend/src/stores/record.store.ts"
  - "frontend/src/stores/cues.store.ts"
  - "frontend/src/services/voice.rtc.ts"
  - "tools/art/**"
  - "tools/qa/*pass*.mjs"
---

# Tables, games and voice

## Tables

A table is a SEAT CONTAINER. It opens, people sit down, and it stops there — there is no game
engine behind it and nothing in the domain pretends there is. Whatever plays the hand plugs in
here and reads the seats.

**Seats are rows, created empty with the table.** That is what turns "claim a seat" from a read
followed by a write into a single UPDATE the database arbitrates:

```sql
update table_seats set user_id = $2, joined_at = now()
 where table_id = $1
   and seat = (select s.seat from table_seats s
                where s.table_id = $1 and s.user_id is null
                  and (s.invited_id is null or s.invited_id = $2)
                order by (s.invited_id = $2) desc nulls last, s.seat
                limit 1 for update skip locked)
   and user_id is null
returning seat
```

`skip locked` is the whole trick: two people arriving in the same instant lock DIFFERENT rows, so
both succeed while two chairs are free and exactly one succeeds when one is. The outer
`user_id is null` is the belt — a row taken between the lock and the write matches nothing.
`tests/seat-race.spec.ts` fires ten claimers at three chairs and expects three seated and seven
told no, with no two in the same chair.

**One person racing themselves is a different problem, and it took three attempts to see it.**
Two requests from one account both find the table empty of them, and then either the partial
unique index `table_seats_one_per_person` refuses the second (23505) or — worse — the second
finds every free chair momentarily LOCKED by the first and concludes the table is full. Neither
is true, and a double tap must answer with the chair they are sitting in. The fix is
`pg_advisory_xact_lock(hashtext(tableId), hashtext(userId))` as the first statement in the claim:
two requests from ONE person serialise, different people never contend, and the lock releases with
the transaction whichever way it ends. Five consecutive clean runs of the race suite is what
"fixed" meant here; two out of three was not.

**A seat claim answers 200 with no seat, never an error.** Two people reaching for the last chair
is ordinary. A 409 would make the loser's client show a failure for something that simply
happened, and the client says "somebody took the last chair first" instead.

**`status` is derived where it is read**, not written beside the seat:

```sql
case when t.status = 'closed' then 'closed'
     when (count of occupied chairs) >= t.seats then 'ready'
     else 'open' end
```

`closed` is a decision somebody made and lives in the column; open-versus-ready is a fact about
how many chairs are full, and a stored copy of a derivable fact is a copy that goes stale the
first time a seat moves down a path that forgot to update it. It did, in the browser pass.

**`ready` means every chair is taken. It does not mean playing.** The furthest a table gets is
full, and the page says so in as many words: *"Every chair is taken. The game itself is still
being built — until it is, the table holds your seats and the chat stays open."*

**The server decides what a table may BE, and for a while it did not.** `isValidTable` lives in the
browser and is a courtesy to the person filling the form; `create` believed whatever it was handed,
so a caller could open a three-seat hokm table or a `turns` table for a game that only runs live.
That is worse than it sounds, because `status` is derived from occupied chairs against `t.seats`: a
table with a seat count its game does not play is one nothing downstream can question. `create` now
reads `game_rules` and refuses the seat count, the mode and the target; `cube` and `blinds` are
NORMALIZED rather than refused, because the form sends both on every table - they are fields on one
config object, not claims about the game.

It caught a live bug the moment it existed: `lobby.quick()`'s fallback config was a literal four
seats, so quick-matching backgammon - which plays two - had always asked for a four-seat table.
Quick play sends no seat count at all now: the server opens what `seatsByDefault` makes of the
game's rules, and `catalogue.defaults` asks the same function (*Matchmaking is one request*).

**Whether a table is two against two is a third thing `create` normalizes, and the game's row is
what says it may be.** `tables.teams` is a boolean with no default, and `tables_teams_four` is its
structural half: a team table has four chairs. The other half - does this game have partners - is in
`game_rules`, which a CHECK cannot reach, so `create` asks it. `game_rules.partners` was a boolean
that could only say "hokm"; it is `none`, `optional` or `required` now (`game_rules_partners_known`),
because "forced at four seats" would otherwise be a game's name in `table/service.ts`, a domain that
knows no game. Hokm is `required`, ludo is `optional`, and the rest are `none`. Ludo was `none` until
the commit that put its team game at a table (*Ludo two against two reached a table*, under *Playing
a game*), the way `games.status` opened hokm: the engine played two against two before that, and the
catalogue said so only once a board could show it.

The answer is one pure function, `teamsOf(partners, seats, asked)` in `table/teams.ts`: four seats,
and either the game forces it or the game allows it and the opener asked. It imports nothing, so the
browser asks the same one, and it is NORMALIZED rather than refused for the reason the cube is:
`teams` is a field on a config its callers start from `catalogue.defaults(game)`. A caller that then
changes `seats` and nothing else, as the sheet that opens a table in a chat and the group page both
did, turns a hokm default into a table for two carrying a stale `true`, and a refusal would have
turned that table away for its own default. `asInput` in the lobby store resolves it from the seats
the table finally has, the summary echoes what was STORED, and `table-teams.db.spec.ts` asks the
row. The create form builds its own config, and built it with
no `teams` at all behind an `as TableConfig`: harmless while every game is `none` or `required`,
and an `undefined` the wire refuses the day one is `optional`. It names the field and is held by
`satisfies` now, so the next required field fails the typecheck there, and `tables.spec.ts` submits
the form for a game whose published rules leave the choice open.

`matches.variant` is the RULES a game is played under, never the game's name - it once read
`variant in ('ludo')`, a game id in a column that exists to say which ruleset of that game is on.
It allows `teams` beside `standard` (`matches_variant_known`), only at four seats
(`matches_teams_four`), and has no default any more: every insert says which. A start says it from
the table, `variantOf(table.teams)`, and asks the engine whether it plays that at this many seats:
*An engine plays formats*, under *Playing a game*, is the whole of it.

**At a team table the first chair dealt is the opener's partner's.** The create-time deal walked
the chairs in order, so the first friend picked sat beside the host. `guestChairs(seats, teams)`
gives the order - 2, 1, 3 at a team table, in order anywhere else - and the raw insert pairs each
guest with a chair through a second `unnest` array instead of a `row_number()` with no order to
stand on. Somebody named twice is one guest: the list is made unique once, at the top of `create`,
and the count, the policy checks and the deal all read that one list. A name sent twice used to be
dealt two chairs, one of which nobody could ever take. Somebody who sits down later still takes the lowest free chair, and their partner is
whoever is opposite.

**A truthy string is not a yes.** `game-hero` drew its "Partners at four" chip with
`<Show when={ rules.partners }>`. `Show` takes any value, so the day that field became a word every
game's page said it, `none` included, with `check` green. It asks for the word it means,
`=== 'required'`, and `tables.spec.ts` renders the hero for all four games and for one that only
allows partners. The same trap is waiting in every `when` over a boolean that becomes a word.

A sync cannot add a NOT NULL column with no default to a table that holds rows, and that goes for
the disposable test database as much as the dev one: after this commit both were dropped and built
from nothing, as the house rule says.

**A table of two sides shows them wherever it is drawn.** A team table was a boolean on a row and
nothing on a screen. The form offered "4 players" for a game that only plays four in pairs, the
lobby drew four chairs in a row with the partners two apart, and the board gave no sign of who
played with whom until the score moved.

- **The form offers formats, not seat counts.** `formatsOf(rules)` in `data/tables.ts` asks `teamsOf`
  both ways for each seat count and keeps what comes back: one chip a count, and two at four where
  the game leaves the choice open. Hokm reads "2 players", "3 players", "2 v 2"; a game whose
  partners are `optional` reads "4 players" and "2 v 2" side by side, and opens the one that was
  chosen. `isValidTable(config, rules)` holds a config to those formats, and takes the rules it is
  held to: it read the browser's own copy of them while the form drew its chips from the published
  ones, so the two could disagree about one table. Under the chips the form says what two against
  two means at this game; above the friends list it says that the first friend picked is the
  partner, because `guestChairs` deals that chair first.
- **So does a table opened in a conversation, and a group has no second way to open one.** The
  sheet that opens a table in a chat offered bare seat counts and sent `teams` as the game's default
  had it, so once a game left the choice open four friends could open it two against two from the
  games page and never from their own chat. It offers `formatsWithin(rules, heads)` now, the same
  formats held to the room's head count: "2", "3", "4" and "2 v 2" at ludo in a room of four or
  more, with the sentence the form says under them. Nothing chosen is the largest count the room
  fills, in the plain game where the game leaves it open, which is what `catalogue.defaults` opens.
  A group's "Play together" composed a config of its own, the largest seat count and the default's
  `teams`, a second copy of what fits in a room that had already been wrong once (*The second
  audit*). It opens that sheet on the group's room, with the game the group plays chosen and the
  group's own head count (`heads`, because the chat list is a page and may not hold the room).
  `open-here.spec.ts` holds both doors, and reads the catalogue again under the open sheet to hold
  the seat control to the node it was: its branch asks a `derived` boolean, where it asked the
  length of an array that is new on every read.
- **The lobby seats each side together.** `sideOf` in `match/sides.ts`, the function a start deals
  by, sorts the chairs into two groups: "Your team" for the reader's own, "Team 1" and "Team 2"
  for the other and for somebody not sitting. One under the other on a phone, side by side from a
  36rem container. The groups are a keyed list of keyed lists, so a chair that fills is the same
  card with somebody in it, and `lobby-panel.spec.ts` reads the table again to hold that.
- **A row in a list and the play header say "2 v 2"** where they said a head count.
- **A plate wears its side.** `TablePlate` takes `team`: a pip on the avatar in the side's colour
  and, for a screen reader, "Partner", "Opponent", or "Team 2" for somebody watching. The reader's
  own plate has the pip and no word. The hokm board takes each seat's side from the board it was
  sent and marks nobody at two and three, where every seat is a side.
- **The result is read by side**, the winners first: "Your team" and "Opponents", or the two
  numbers for somebody watching. A game where every seat stands alone is one list, as it was.
- **The hero says "Partners at four" only where the game requires them.** It said it for anything
  but `none`, which the day a game merely allows partners would claim it is played in them. Where
  the game leaves it to whoever opens the table the hero says "2 v 2 at four", from the published
  rules, and the game's page has a fourth card that says how such a game is won. Both sentences
  were in the catalogue with nothing reading them on the day ludo's seed opened the door: the page
  built its cards from a literal `[1, 2, 3]` and a cast, which no key can fail. It lists each
  game's cards by key now (`RULE_CARDS`), so a card with no sentence fails `check`, and
  `tables.spec.ts` holds the chip to the published rules in both languages and counts the cards.

`fit-pass.mjs` wants every plate at a table of two sides to show its mark on the felt, clear of
every other plate, and at a ludo table, whose plates sit beside the board, to show it inside the
screen (`ludo-4-teams`). `tables.spec.ts`, `lobby-panel.spec.ts`, `table-row.spec.ts`,
`table-plate.spec.ts`, `hokm-board.spec.ts`, `match-result.spec.ts`, `play.spec.ts` and
`open-here.spec.ts` hold the rest.

**A wire field that reaches a bounded column says so in `schemas.ts`.** `crest` is `varchar(24)`,
`hue` is `smallint`, `blinds` is one of three levels - and none of that was stated, so an over-long
crest or an out-of-range hue reached Postgres and came back as 22001 or 22003, which is a 500. Any
signed-in caller could produce one. That is the same defect class as the 22P02 `membership()` fixes
by checking a uuid's shape before comparing it, and the fix belongs in the same place the wire shape
is already decided once.

**Nothing builds a url out of a promise.** `lobby.quick` and `lobby.host` answer with a PROMISE of a
table id, and a template literal will happily call `toString` on one - so
`navigate(\`/app/play/${ lobby.quick(game) }\`)` compiles, lints, and sends somebody to
`/app/play/[object%20Promise]`. Eight call sites did exactly that, which was every Play and
Quick-play button in the product outside the home page. `npm run qa` tours routes by url and never
presses a button, so no gate could see it. `lib/open-table.ts` takes the promise as an argument -
the caller never holds the id, so the broken form cannot be written - and owns the refusal, which
eight `void`-less calls had nowhere to put. Nothing enforces that now - see *The rules no test holds
any more* in `frontend/CLAUDE.md`.

**A table refusal is a word, and it has one spelling.** `table/refusals.ts` imports nothing and lists
each with its status - `seated-max`, `playing`, `table-closed`, `chairs-empty` and `not-ready` at 409,
`no-invitee` at 404, `quick-game` and `quick-options` at 422 - and `tableRefusal(word, sentence)` in
`table/service.ts` is the only way the
table service, the start, the walkout and the invite port throw one: the word is checked where it is
thrown and the status is read off the list. `seated-max` and `playing` used to be three free literals
each - the server's, the browser's predicate and the fake server's - with nothing binding them, so a
rename on either side compiled and fell back to the generic sentence without a word. The browser reads
the list too. `whyRefused(error, otherwise, playing)` in `lib/open-table.ts` is what a table that would not
open, a chair, a start, an invitation, a leave, a close and a voice switch each ask when they fail, and
a listed word gives `tables.refused.<word>`, a template literal over the list with no cast, so a word
with no English or Persian sentence fails `check`. Two words keep the keys they had, because they are
said in the words of where they happened: `seated-max` is `play.seatedMax`, and `playing` is whatever
its caller says - `play.table.playing` for a chair, `play.leave.started` for a leave,
`play.close.refused` for a close, the caller's own fallback anywhere else. A framework code, a match
word and a request that never arrived are the fallback as well. A table that would not open keeps fewer of those answers than anybody: `openTable`
says the four sentences that are about what was asked - too many chairs, nobody to invite, a game
that cannot be played, a table the game does not make - and "That table would not open" for every
other word. Quick play used to reach it with the rest, from a table the browser tried and the reader
never chose; the server picks the table now and never answers with one of those.
`table-refusals.spec.ts` on each side holds it: on the server every word's status and code, no word
shared with a refused play or with a code the framework answers on its own, no code spelled by hand in
the three files that throw, and somebody throwing every word; in the browser a sentence for every
word, none for a word the table does not have, a fake server that answers with the list's own words
and statuses, and a refused quick search saying its own sentence in both languages.

**A refused start says why, and so does a closed table.** `POST /tables/:id/start` answered each of its
refusals as a bare 409 and the play page said "If this keeps happening, check your connection." for
all of them, so a table where somebody had just stopped being ready read as a broken network. It
answers `table-closed`, `chairs-empty` or `not-ready` now - the race its insert loses is `not-ready`
too - and the page says that sentence; a start that never arrived still says to check the connection.
The words reach only somebody in a chair: being seated is still asked first, and a no is the 404 a
table that is not there gets, whatever stands in the way. A chair or a voice switch at a closed table
is `table-closed` as well. Closing under a live game is `playing`, and the page says "A game is still
being played here" for that alone: it used to say it for every failed close, a dropped connection
included.

`table-refusals.db.spec.ts` loses the start's race on purpose. Every other `not-ready` it asserts stops
at the start's own read of the chairs, so the insert's own refusal thrown as a bare 409 again passed
every gate. The test holds a SHARE lock on `matches`, which lets the start's reads through and stops
its insert; once a backend is waiting, the other chair says it is not ready and the lock lets go. A
statement takes its snapshot only once it holds its table locks, so the insert sees that chair, writes
nothing, and the start answers `not-ready` with no match behind it. The start waits there holding the
table's lock, and `setReady` takes none, so neither can be waiting on the other.

**A start reads its chairs under the table's lock, and so does whatever empties one.** `start` read
its table and its chairs before its transaction and dealt `match_players` from that read, while the
insert's guard only COUNTED occupied chairs, in a snapshot that cannot see a chair nobody has committed
yet. So a leave that was still in flight was dealt in: its walkout had found no game to forfeit, and
its chair went back a moment later. A leave and a claim that sat down ready, both between the read and
the insert, swapped who sat there without moving the count, so the game dealt in somebody who had
left - whose turns the sweep then plays into a rated loss - beside somebody in a chair with no seat in
it. A close had the same window from the other side and left a game running on a closed table.

`lockTable(tx, tableId)` in `table/service.ts` is `pg_advisory_xact_lock(hashtext($1::uuid::text))` -
raw, because no repository can say it - and it is the first statement of the transaction in `start`,
in `leave` before the walkout, and in `close`. A quick search takes it as well, at each table it
tries, for the table that is emptied or closed as it sits down (*Matchmaking is one request*), and so
does the sweep that stands an absent player up (*A waiting chair belongs to somebody who is there*).
It is the one-key form, a lock space of its own, so the claim's two-key lock on a table and a person
never meets it. Under it the start reads the table and the chairs again and asks every question of THAT
read - still in a chair, a game already on, closed, an engine, every chair taken, everybody ready -
and deals the players from it. The key is the id as Postgres spells it: hashing the text a caller
sent would give `/tables/<ID IN CAPITALS>/start` a lock of its own, and the route hands the start
the id as it arrived.

Being seated is still asked BEFORE the transaction, so somebody with no chair is answered 404 without
holding the table or waiting for it; and it is asked again under the lock, so somebody whose own leave
got there first is answered that 404 rather than `chairs-empty`, a word meant for people in chairs. A
claim and an invitation only FILL an empty chair, which cannot hurt a start that has read every chair
taken, so they take no table lock. Nor does `setReady`, which is why the insert keeps its WHERE clause:
somebody can still stop being ready between the read and the deal, and that is the race the paragraph
above loses. The count and `matches_one_live` stay as belts. Two starts no longer both reach the
insert - the second finds the first one's game in its own read - and a 23505 there is still read as
"somebody else started it".

**The order is the table's lock, then the match row, then chair rows, and a finish never takes the
table's lock.** A leave holds the table and waits for the match row; a finish holds the match row and
then clears every chair's readiness. A finish that reached for the table's lock would wait on that
leave while the leave waited on it. It is also why row locks could not have fixed the start: a leave
would have to lock its chair before the match, and a finish locks the match before the chairs.

`start-race.db.spec.ts` holds all of it, with two instances of each service and a gate: a lock on
`matches` that parks every arrival at the statement where its race is - the start at its insert, a
leave at the walkout's `for update` - and lets go once `pg_stat_activity` shows everybody has gone as
far as they can. Twenty rounds each: a leave against a start, whichever reaches the table first; the
swap; a close; and a leave, a finish and a start together in three orders of arrival, where no answer
may be a 40P01. With the start's lock line deleted the first three fail in every round, with the
leave's the first two, with the close's the third. The last cannot fail that way - no lock, no
deadlock - and fails when the order is broken instead: a finish that takes the table's lock, or a
leave that frees its chair before it walks out. Three single tests hold the rest: an id in capitals,
somebody with no chair answered while the table is held, and somebody whose own leave got there first.

**A leave says whether it may forfeit.** `POST /tables/:id/leave` took no body, so what leaving cost
was whatever the server found when the request arrived. Somebody waiting at a table read "Your chair
goes back", pressed Leave as the last chair filled, and walked out of the game that began in between:
a rated loss nobody agreed to. The request carries `forfeit` now, a boolean the route refuses to go
without, and it is the sentence the reader was shown: the sheet sends `true` only when it said
`play.leave.forfeit`. The lobby's Leave hands the sheet no game at all, so it cannot say that sentence
and never sends `true`; the dock's hands it the game on the board.

The answer is the walkout's, because only the match knows what leaving would cost. `match.walkOut`
takes the flag and asks it once it holds the live match and has found the leaver's seat: a seat still
in the game, from somebody who did not agree, is 409 `playing`, thrown inside the leave's transaction,
so nothing is written - no forfeit row, the chair, the thread and the table as they were, and nothing
rung. It is asked of the SEAT, not of the table. Somebody with nothing to forfeit leaves whatever they
said: no game, a finished one, a seat that already has a result, a chair the game never dealt. The
sheet tells a player who resigned from a game still going "The game goes on without you", which is not
the forfeit sentence, so they send `false`; refusing every leave under a live game would have held them
at the table until it ended, under a toast saying their game had just started. Nor is it an oracle: the
word reaches only somebody playing in that game, and anybody else is answered as they always were.
`standUp(tx, tableId, userId)` in `table/service.ts` is the one place a chair goes back: it frees the
chair, takes the person out of the table's thread and closes the table behind the last one out.

The play page says "Your game has just started" (`play.leave.started`, through `whyRefused`), stays
where it is and reads the table again at once: the table's own ring is still on its way through two
coalescing windows when the refusal lands, and without the read the page says it over a lobby. A leave
that never arrived says `common.actionFailed`, and used to be an unhandled rejection.

`start-race.db.spec.ts` holds three more on the same gate (*a leave that did not agree to forfeit*):
against a start, whichever reaches the table first - the start first keeps the leaver in the chair and
the game and answers `playing`, the leave first frees the chair and the start is `chairs-empty` - the
swap, where the newcomer never sits, and beside a finish and a start in three orders of arrival; none
may leave a `left` row behind. `match.db.spec.ts` holds the refusal with nothing written and the three
who leave anyway, `table-refusals.db.spec.ts` holds it through the port with nothing rung, and
`app.spec.ts` holds the route to a flag it will not go without and hands on as it came. `play.spec.ts`
presses Leave in the lobby, on the board and as a seat that gave up a six-handed game still going, and
reads the sentence and what was sent each time. The browser specs' server asks the seat as the real one
does: `server.outOfGame` names who already has a result in a game, and `table-refusals.spec.ts` holds
the fake to letting that seat go and nobody else. Refusing every leave under a live game there would
have held a resigned player at the table in every browser spec while production let them go. The passes
that clear their accounts' tables before they begin (`clearTables`, fit, latency, play, hokm-play) send
`true`, which is what they always meant.

**An invitation is refused in one sentence, whoever it could not reach.** `create`'s invitees and
`invite` answered a block with "You cannot reach that account." and a closed door or a minor with
"They are not taking invitations from people they have not added.", both 403: a refusal that said
which, about somebody else's settings. Both answer 404 `no-invitee`, "No one by that name can be
invited.", now, and the bytes are the same for the inviter's own name, a block in either direction,
strangers turned off and a minor on either side - and, from `invite`, for a name nobody holds and a
suspended account, which `create` still drops as it always did. `table-refusals.db.spec.ts` compares
the bodies the route would send, and that no chair is held, no table opened and no notice written. The
invite sheet and the create form say `tables.refused.no-invitee`; the sheet still goes through
`attempt`, which takes the reader of the refusal as its third argument. What the 404 cannot hide is
what the profile already says: `GET /social/people/:handle` answers 404 for a missing handle and
carries `refusal` for one that exists, on purpose, so a closed compose box can say why. This route
discloses nothing more than that, and claims nothing more.

**Every control on the table page is a `Button` with words on it.** Three of them were not, and each
failed differently. "Take a seat" - the whole point of the watching panel - was an `IconButton`,
which is icon-only with a tooltip, so the primary action of that screen was a bare chair glyph.
Closing the table and showing the chat were hand-spelled `<button>`s with their own class lists.
And the Leave button carried `text-madder` in `props.class`, which lost to the ghost variant's own
`text-muted` - two `text-*` utilities from one layer, decided by CSS source order and not by the
class attribute - so the class had never applied and the button had never been red. Leaving and
closing are both `variant="destructive"` now, which is `danger`: the same red, from the shared
variant, rather than a colour a caller appends and hopes about.

### Who may sit at a table

Four levels, and until this week only one of them was true.

| level | who sees it | in the open list |
|---|---|---|
| `public` | anybody | yes |
| `friends` | the host's friends | yes, to a friend |
| `invite` | whoever holds an invited chair | no |
| `room` | the members of the conversation it was opened in | no |

`private` was renamed to `invite` because "private" says nothing about who, and it was the level
that lied hardest: **`byId` had no privacy check at all**, so a table offered to the person opening
it as *"Only people you invite can sit down"* was joinable by anybody handed the code. `friends` was
empty in the other direction — `open()` filtered on `public` strictly, so a friends table was
invisible to friends as well as to everyone else. Both had shipped, both were in the create form,
and nothing anywhere looked at either.

**One predicate, `visibleTo`, answers all of it**, and every read that takes a table id goes through
it — the same argument the group domain's `VISIBLE_TO` makes: a rule applied to one read and
forgotten on the next holds until somebody follows a link. It is parameterised by the SPELLING of
the viewer (`$1` or `:me`) rather than hard-coded, because it serves a positional `db.query` and a
named query-builder parameter, and a predicate string-replaced at one of its call sites is one that
breaks the day somebody writes a `$10`. A refusal is 404 rather than 403, exactly as a private group
is, because a 403 confirms the table is there.

**A table you are SITTING at is always visible to you**, whatever the level says now. That is not
generosity: a group can close, a friendship can end and an invitation can be withdrawn while
somebody is in the chair, and the alternative is a player whose own game 404s underneath them
mid-hand.

**`tables.room_id` is the conversation a table was opened IN**, which is not the `kind: 'game'`
thread every table OWNS. Pointing at the conversation rather than at the group is what lets one
column serve a direct thread and a group room alike: a group's membership already moves in lockstep
with its thread's, so "the members of the room" is the answer in both cases and there is no second
guest list to keep in step with the first. It replaces a `group_id` that no query ever read.

The foreign key is `SET NULL` and `tables_room_is_private` is written to survive that — see *The
second audit* for why the obvious CASCADE destroyed every match ever played in a group that closed.

**`privacy` and `roomId` are ONE fact and the service resolves it.** A caller able to send them
apart is a caller able to send a `public` table carrying a private group's room, or a `room` table
with no room — and the second of those reaches a person as a 500 rather than as the refusal it is.
So `create` derives the privacy from whether a room came with the request, checks membership once
there, and refuses a conversation the caller is not in with a 404.

**A room table is deliberately absent from the global open list**, even for the room's own members.
That is the whole point of it: the two ways of starting a game stay separate, and the line the
server writes into the room is how the other people learn it is there. `chat.line.table` is that
line, and it renders as the invite card the table domain already had.

**The room's size is the table's ceiling.** Nobody outside the conversation can ever take a chair,
so a four-seat game opened in a thread between two people is a table that can never be ready. The
sheet does not offer it: seat counts above the head count are gone, and a game with no seat count
that fits goes with them — which is what takes four-handed hokm off the list in a direct thread.

**"Start a game" is not disabled with the rest of the composer.** That control's `disabled` means
this conversation cannot be SEALED, which is a fact about messages; a table is not sealed, and the
line announcing it is `{ key, params }` the server authored. A browser that cannot type in a thread
can still open a game in it, which matters because the machine somebody sits down at is often not
the one they enrolled.

Three defects on this path that every gate was green for, each now with a rule:

- **`openTable` in `chat.page` navigated to a url built from a PROMISE.** `lib/open-table.ts` exists
  to make that unwritable, and the rule that guarded it only looked for the call INSIDE
  the template literal — so `const tableId = lobby.host(...)` followed by `` `/app/play/${ tableId }` ``
  slipped past, and the "Start a game" button in every chat thread went to
  `/app/play/[object Promise]`. The rule now refuses HOLDING the promise in a variable, which is the
  step that makes the mistake possible. It also toasted "Invitation posted to the chat" before the
  request resolved, so a refusal read as success.
- **The chat page's thread effect fired on the way OUT with the next route's id.** `params()` is
  shared router state and the page is still mounted while its leave transition plays, so pressing
  that button asked the chat api for a conversation whose id was the table it had just navigated to.
  The group page answered the same thing by opening once in `mount`; this page cannot, because a
  notification moves from one thread straight to another and that is the same route with a different
  parameter. The guard is the pathname instead.
- **A literal 0x1F byte sat in `lib/random.ts`.** `chat/envelope.ts` and `lib/attestation.ts` both
  build their control characters with `String.fromCharCode` and say why in prose; nothing enforced
  it, and nothing does now. The rule that briefly existed was written with character codes rather
  than a regex escape because the same hazard hit the rule itself — a `\b` in a pattern became a
  literal backspace, and it passed against the exact bug it was written for until it was proved to
  fail first. Worth knowing before writing another one.

**The dock under the board is the small things somebody reaches for mid-game.** Sound, the screen,
the room's code and the chat, and every one of them was reachable before only by LEAVING the game -
the table's own cues are `settings.sound`, whose single toggle lives on the settings page under
notifications. Nothing in it is a control with nothing behind it: no music button because there is
no music, no settings gear because it would be a link out of the game wearing the clothes of a
control in it, no overflow because there is nothing left to put in one. The code is there because it
is how a table is reached when it is in no list, which is every table opened from a chat or a group.

**Matchmaking is one request.** `POST /tables/quick` takes the game and who the call is for, finds the
searcher a chair or opens a table to wait at, and answers with that table. Nobody is invented to
fill it. The browser used to do this itself: read a list of open tables, claim a chair at each in
turn, say ready, and press Start if it had taken the last chair - up to twenty-eight requests a
press. Two people pressing together both found nothing and both opened a table, which no browser
can prevent; only the game and the pace narrowed the list, so a table of the wrong size was as good
as any; a table whose host closed the tab hours ago was offered first; only the HOST was checked for
a block; and the game started only if the browser that filled the last chair lived long enough to
say so. `GET /tables`, its port and `table.open()` are gone with their one caller.

**What may be asked, and what is opened when nothing fits, is one pure module.** `table/quick.ts`
imports nothing, so the browser reads it too. `quickOf(rules, ask)` answers a FILTER and a table to
MAKE, or refuses, and never throws. Seats, target, blinds, cube and sides are each exact when chosen
and "any" when not. The pace is the exception: absent means `live`, never either, because a `turns`
table is a day a move and nobody pressing Quick play chose a correspondence game. The cube is
matched as the table stores it, so `cube: true` only ever means a match long enough to have one.
Sides are forced where the game's partners are `required` and the search names four seats, and a
search that names neither finds both kinds at a game that leaves it open and opens the plain game.
What it makes is what `create` would store unchanged - `quick-options.spec.ts` asks the real
`cubeLive` and `teamsOf` about every table it makes over a grid of asks, because `quick.ts` restates
both rules to stay free of imports - and it is a table the same search would then find, or the next
searcher would open a second one beside it. `seatsByDefault` is the smallest seat count of four or
more, or the largest the game plays (the largest was nine-seat poker, which a quick player would
wait at all evening); `catalogue.defaults` asks it too, so the rule is written once. The browser's
copy of a game's rules is a `QuickRules` now: `TableRules` carries `hasCube` and `hasBlinds`,
`reference-parity.spec.ts` holds both to the seed and asks `quickOf` the same question of both
copies, and the create form asks them where it asked for a game by name.

**Every search for one game takes one lock, because the row it would lock does not exist yet.** Two
searchers who both find nothing both insert a table; that is a phantom, and no row lock stops it.
Skipping locked tables would make it worse: concurrent searchers would pass over each other's
candidates and each open a table, the scatter "fullest first" exists to prevent. So the first
statement of the search is `pg_advisory_xact_lock(hashtext('quick'), hashtext(game))` - raw, because
no repository can say it - keyed by the GAME and not by the options, because "any" crosses options:
a searcher who chose four seats and one who chose nothing must each see the table the other opens.
It is the two-key form the seat claim uses, and the two could only meet if a table's id hashed like
`quick` and a person's like the game; the table's own lock is the one-key form and never meets
either. Waiting for it must not hold a connection, or ten presses for one game would park the whole
pool, so `lib/keyed-queue.ts` takes one search a game at a time inside the process and the lock is
what holds across processes.

Under the lock, in order:

- **Already waiting.** A table that fits the search where the searcher sits READY is the answer, and
  nothing is written. That is what makes a second press, a reload during the first and a request
  sent twice one chair. Ready is part of it on purpose: a finish clears every chair's readiness, so
  somebody still sitting where their last game ended is not waiting for one, and is found a table
  where everybody is here rather than sent back to that one. It is asked before the fifty-table
  limit, or the second of two presses would be refused by the chair the first one took.
- **Candidates.** Open, of that game and pace, public or opened for the host's friends when the
  searcher is one, with no game on, a chair the searcher may take, and no chair of theirs already.
  Never one where the searcher and the host or ANYBODY sitting have blocked each other, either way:
  the host alone was checked before, and a block means two people do not share a table, a chat and a
  call. Never one where the searcher and somebody sitting are an adult and a minor who are not
  friends (D30): the table's thread has no per-pair messaging policy, and server-side quick play would
  have made a stranger landing beside a child routine. Two minors still meet, friends still meet, and
  sitting down by a link is unchanged. Fullest first, then fewest chairs not ready, then oldest, and
  thirty-two of them.
- **Presence, for live tables only.** A candidate is passed over if anybody sitting at it is not
  here. `hub.present(ids)` answers for every account with a socket open or lingering, away included,
  with none of the privacy `presenceOf` applies, because the answer is never sent to anybody: all a
  searcher can learn from it is which table they were put at. It reaches the service as a
  `PresenceReader`, the fourth argument of `buildPorts`, and with no hub everybody counts as here. A
  `turns` table skips it, since its players are told when the game starts. It is applied in Node
  over the thirty-two because presence is memory in one process, the limit the hub already states.
  The SEARCHER is never asked about: the request is proof enough that their browser is alive, and a
  socket that binds a moment after a cold page load would otherwise open a table of its own beside
  the one it should have filled. So an account with no socket at all - a browser behind a proxy
  that refuses WebSockets, a script that only posts - is seated like anybody else, and from then on
  that table is passed over by every later search, for the people already waiting there as much as
  for the newcomer, until it leaves or the sweep stands it up (*A waiting chair belongs to somebody
  who is there*).
- **A chair.** The search takes the table's lock first - `lockTable`, the one a start, a leave and
  a close take - and the UPDATE that takes the chair asks that the table is still open. A join only
  fills a chair, which cannot hurt a start; what it could hurt is a table being emptied. The last
  one out closes the table on a count of chairs that cannot see one nobody has committed, so a
  searcher was seated, ready, at a table that closed under it, and a host's close had the same
  window. Whoever holds the lock first decides: the search, and the leaver counts its chair and the
  table stays open; the leave or the close, and the search finds the table closed and goes on to the
  next candidate. Nothing that holds a table's lock waits for the lock a game's searches take, and a
  search waits for no chair, so no cycle follows. The free chairs the searcher may take are then
  read `for update skip locked`, so a chair somebody is taking by hand is looked past rather than
  waited for, and `chairFor` picks: one held for the searcher first, then at a table of two sides
  the one opposite somebody already sitting, then the lowest. Filling a side first is what leaves
  the other side whole for two friends who come together, and sitting down by a link keeps the
  lowest chair. The search holds every free chair of that table until it commits, a few statements
  later, so a claim by hand in that moment is told there was no chair, as it always was when every
  free one was taken that instant. The chair is taken READY, by an UPDATE that still refuses a table
  with a game on, and the thread gains its member in the same transaction.
- **Or a table.** `openRow`, the body `create` shares: public, chat on, the call the request asked
  for, the searcher in the first chair and ready.

A unique violation - a table code already in use, or the same person's own claim by hand landing
first - rolls the transaction back and the search runs again. It refuses three ways and never names
a table: `quick-game` for a game nobody has heard of or one that is not open (422, the same bytes
for both), `quick-options` for a table the game does not make (422), and `seated-max`. There is no
refusal for finding nothing, and a block or an absence changes only which table somebody gets.

**The server starts the game, and that is a courtesy.** The port reads the table back, and if every
chair is taken and ready with no game on it calls the same `startPushed` the Start button reaches.
The chair is the fact: a start that fails is logged and the answer is still the table, full and
ready, with Start on every seat's page. Two searchers taking the last two chairs together both ask,
and `matches_one_live` and the table's lock make it one game. A press that changed nothing rings
nobody. At a `turns` table the start is followed by the `turn` notice for whoever goes first, unless
that is the searcher: nobody else there has to be here, so nothing else would tell them. The Start
button still writes none.

**The browser sends one request and shows that it is out.** `lobby.quick(game)` posts the game and
the device's voice preference and answers with the table's id. A second press while the first is
out is handed the SAME promise, so a double tap is one request, and `lobby.finding()` names the
games being searched for: the card, the game's hero, the bar a phone keeps at the foot of the game
page and the home hero spin on it, and a `role="status"` line says "Finding you a seat" to a screen
reader, because a button that is busy hides its own words. A refused search clears it and says the
refusal's sentence through `openTable`.

**A search is out until its table is on screen, not until it is answered.** It ended with the
answer, one microtask before `openTable` navigated, and the play route is a lazy chunk: on a phone
that had not loaded it yet the button stopped spinning, nothing moved, and a second tap sent a
second request. When the first press had taken the last chair its game was already on - at a table
for two that is every join - so the server found nobody waiting, opened a second table and the
browser went there, while the game the first press had started ran its clock at the other one. The
store keeps the search, its promise and its place in `finding()` until the play page opens that
table (`lobby.open`, which only that page calls), or for `ARRIVAL_MS`, ten seconds, if no page
ever does. A press in between is handed the table it was already given and asks the server nothing.

**Somebody waiting at a live table keeps their socket.** A hidden tab lets its socket go after a
minute, and a seat whose socket is gone is not here: the table is passed over by every search until
they come back. The lobby store holds the socket for as long as the reader sits READY at a live table
that has not closed, or has a live game on at one, WHATEVER PAGE THEY ARE ON: every read of the
reader's own tables decides it again, and only the newest read is believed. The play page held it
first, and only while it was open - so a search made from a game's page and left for Home lost its
socket to a hidden tab, was passed over by every search and was stood up without a word, where the
table's own page would have kept the chair. Ready is the whole of the difference. A
chair quick play took is ready, and so is one that pressed Play again; a chair a finished game left
un-ready is waiting for nothing, and held, its hidden tab would be here for as long as it lived. The
first chair freed there would then make it the fullest table with everybody here, and the next
searcher would be seated ready beside people who are not looking. A seat that is not here does not
keep its chair for long either way: *A waiting chair belongs to somebody who is there*.

**Somebody who has left the page is told when the game starts.** The server starts a quick table the
moment its last chair fills, and nobody sitting there has to be looking at it. Anybody seated who is
somewhere else in the product is told "Your Ludo game has started", with the way to the table: *A
game that starts while the reader is elsewhere says so* in `frontend/CLAUDE.md` is the whole of it,
and `cues.spec.ts` holds it. Before it the clock played the opening turns of people who did not know
they had a game, thirty seconds at a time.

`quick.db.spec.ts` holds the server half against Postgres, and every race in it runs through
separate instances of the service so the queue is out of the way and the database's lock is what is
proven: ten searchers at once make tables of four, four and two with two games started, two presses
from one person are one chair, and two searchers on the last two chairs start one game. With the
lock line deleted all three fail. Three more park a leave, a close and a search at a gate, so that
which of them reached the table first is known: the last one there getting up after the search has
taken its chair, getting up before it, and a host closing the table before it. With the table's
lock deleted from `sit` all three fail, and with the UPDATE's question about the table the last
two. It also holds the ordering, each option, the pace, the tables it never joins, the blocks, the
minors, presence, the chairs, the tables it opens, the limit and the refusals.
`quick-options.spec.ts` and `quick-chairs.spec.ts` hold the pure half with no Postgres,
`realtime-hub.spec.ts` who is here, `app.spec.ts` the route and the list that is gone, and
`tables.spec.ts`, `table-refusals.spec.ts`, `home.spec.ts` and `play.spec.ts` the browser's:
`tables.spec.ts` presses twice around a game the first press started, and `play.spec.ts` hides the
tab of a seat that is ready, of one that is not and of one a finish left un-ready.
`tour-pass.mjs` presses the button on the built server and counts the requests.

Two limits, stated. A search sent again from where the store cannot see it - another tab, or a
press after a request the browser gave up on while the server went on to seat it - can find the
first one's game already started, which is no longer waiting, and be seated a second time
elsewhere. Answering it with the game that seat is in would close that, and would also send a
poker seat that is out of chips back to the table it is out at for as long as the others play on,
so it is not done. And sitting down by a link still asks whether the table has closed before its
own transaction, and can land in one that closed in that instant.

**A waiting chair belongs to somebody who is there.** An absent player used to keep their chair for
as long as they liked. The table was passed over by every search, so the people sitting beside a
closed tab were never found a fourth, and nothing but that player's own Leave gave the chair back.
A chair at a waiting table whose occupant is not here on two sweeps in a row is stood up now.
Waiting is the row saying `open` with no game on, so a full table nobody started and one a finished
game left behind are both waiting; and it is only a `live` table that is `public` or `friends`, the
ones a quick search can put somebody at. A `turns` table is correspondence, and nobody at one has to
be here. An invite table and a table opened in a conversation are reached by a chair held for
somebody or by a card in a chat, and emptying one would leave that card pointing at nothing.

**Two sweeps, because one absence is ordinary.** Here is `hub.present`, which already forgives
fifteen seconds: the hub forgets somebody fifteen to forty-five seconds after their last socket
goes, its own sweep being every thirty. One strike on top of that would stand up a phone that
locked for half a minute, and everybody whose socket had not come back when the first sweep ran
after a restart, since a hub that has just started knows nobody. `main.ts` runs the sweep every
thirty seconds (`TABLE_SWEEP_MS`) on a `setTimeout` that is set again only when a sweep has
finished, the turn sweep's shape, so two never overlap; a chair goes back between forty-five and
about a hundred and five seconds after its socket did. The arithmetic is `strikes(previous,
absentNow)` in `table/sweep.ts`, which imports nothing: away now and struck before is stood up, away
now for the first time is the next set, and everything else is forgotten - somebody who came back, a
chair that emptied by itself, a table that started or closed. A strike is spent when it is used, so
a chair that would not come free is suspected afresh and tried again two sweeps later. The key is
the table and the person: a strike earned at one table says nothing about the same person at
another.

**The strikes are memory, because what they are about is.** The set is a variable inside
`buildPorts`, for the reason presence is applied in Node: who is here is one process's memory, and
a strike written to the database would outlive the hub it was a statement about - after a restart
it would stand people up on the word of a process that no longer exists. A restart forgets every
strike instead, and the first sweep is thirty seconds after boot. With no hub everybody counts as
here, so nothing is ever struck. A server on its way down has no hub either: `hub.closeAll` empties
it, and asked after that it would say nobody is here, to a sweep that was already out when the
signal landed as much as to a new one. So `beforeShutdown` clears the timer and sets `goingDown`,
both BEFORE `hub.closeAll`, and the reader `main.ts` hands `buildPorts` stops asking the hub from
that moment and counts everybody as here. A sweep still out stands nobody else up, and a quick
search answered in those last milliseconds is seated beside the people who were there until the
server itself let them go.

**`vacate` takes the table's lock first and reads again under it.** `jobs.sweepTables()` reads
`table.waitingSeats(500)` - a QueryBuilder over the chairs in scope, longest sat first, so that two
sweeps in a row look at the same ones - asks `present`, applies the strikes, and calls
`table.vacate(tableId, userId, present)` for each chair that is owed one. That read is as stale as
any read, so vacate is one transaction that takes `lockTable` FIRST, in the order every other writer
keeps: the table's lock, then the match row, then chair rows, and nothing that holds a table's lock
waits for the lock a game's searches take. Under it the same predicate is asked of that one chair -
still waiting, still that person's - and anything else answers null and writes nothing. Who is here
is asked again there too, of the reader the sweep hands it, as a quick search is handed one. The
sweep asked once, before a loop that can be five hundred chairs long and can wait at any of them for
a table's lock until the statement times out, and somebody whose phone woke up in the meantime is
here: they keep the chair and the thread, nothing is rung, and the strike that brought the sweep to
them is spent. Otherwise it goes through `standUp`, so the rule about a chair going back still
exists once: the chair is freed, the person leaves the table's thread, and the table closes behind
the last one out.

**It is not a forfeit and it never touches a match.** A table with a game on is out of scope by
construction, and the read under the lock is what makes that true when a start races the sweep: the
start first, and vacate finds its game and leaves the chair alone; vacate first, and the start reads
an empty chair and answers `chairs-empty`. Vacate locks no row of a match either: under the table's
lock no game can begin, and one that is ending is still a game on, so its chairs wait for a later
sweep.

It then rings what a leave rings, through `courtesy()`: the table for everybody still sitting or
invited there, whoever is looking at it and whoever was stood up, and the table's thread with
whoever was stood up named, so that their chat list drops it. Nobody is notified. Whoever was stood
up is away by definition, and when they come back `/tables/mine` no longer lists the table. A table
that will not let go of its chair - its lock held until the statement times out - comes back in the
sweep's `failed`, is logged as `chair not freed`, and the sweep goes on to the next one; a sweep
that fails altogether is logged and the timer is set again.

`table-sweep.spec.ts` holds the arithmetic with no Postgres, and reads `main.ts` for the caller - a
sweep is the first of the *Five things that were written and never called* - and for the reader
that stops asking the hub before the hub is emptied. `table-sweep.db.spec.ts` holds the rest against
Postgres, with a presence the test owns: the first sweep and the second, somebody back in between,
the table closed behind the last one out, no hub, the turn-based, invite, room and closed tables
that keep their absent, a game on and the same table once it is over, the order and the bound of
the read, a chair that has moved on, somebody who came back while the sweep waited for their
table's lock (asked before the lock, they are stood up and that test fails), the rings and nobody
notified, a ring that fails, and a table whose lock is held, through a second DataSource with a
lock timeout. Two more race a start, ten rounds each, at a gate that holds `matches` in share mode
and the absent player's row in the thread: the start parks at its insert, vacate at the first
statement after it freed the chair, and which of them reached the table first is known. With
`lockTable` deleted from `vacate` both fail in every round, the same way: a game dealt to a chair
with nobody in it.

`quick-pass.mjs` is the pass, over the api of the built server, every guest with a real socket:
eight press quick play for ludo together and are two started tables of four; a guest who closes its
socket at a public live table is stood up on the second sweep and not the first, the one whose
socket stayed open keeps the chair and is rung, and a turn-based table keeps its absent player.

The second sweep is told from the first by the hub's own word, because a time counted from the
close tells them apart badly. On a server started for the pass the table sweep runs just behind the
hub's, and the hub forgets somebody fifteen to forty-five seconds after their socket goes: the first
sweep to find them away comes fifteen to forty-five seconds after the close and the second
forty-five to seventy-five, and a pass that reads the table every five seconds cannot put a line
between the two. So the guest who stays keeps the moment it is sent the `presence` frame that says
the other has gone. Standing up on the first absence would free the chair with that frame, the
second sweep is thirty seconds behind it, and the pass wants twenty-five between the frame and the
first read that shows the chair free. On a server up long enough for the two sweeps to drift twenty
seconds apart the pass can no longer tell, and the db spec is what holds the two strikes. The ring
is waited for, up to two seconds: it leaves the hub a tick after the chair is free, and a read of
the table can land in between.

Four things it costs, stated. The socket hold is for a chair that is READY, so somebody who opens a
public table, does not say ready and hides the tab is away a minute later and stood up within two
more, and the table closes behind them if they were alone. An account with no socket at all cannot
wait at a live table: quick play still seats it, and the second sweep stands it up unless the game
has started by then. That goes for a browser behind a proxy, for one turned away because
`WS_MAX_CONNECTIONS` is spent, and for a script: an API pass must not park its accounts at a waiting
live table, and the matrix sits its partner down again before it restarts poker (*Poker*). A host
stood up from a table for their friends can no longer see it, because nobody is their own friend,
which was already true of a host who left. And five hundred chairs is all one sweep looks at: with
more than that waiting at once, the newest wait for an older one to go.

**The table's chat is the chat domain.** A table owns a `kind: 'game'` conversation, one per
table by partial unique index, and membership moves with the seats inside the same transaction —
sit down and you are in the thread, stand up and you are out. The version this replaces kept a
private list of invented lines in the lobby store, which was a second message system with its own
membership rules, its own watermark and its own future sealing problem.

It follows the thread the same way the chat page does, through `lib/stick.ts`, and for the same
reason: it used to read `chat.messages()` for the subscription and then scroll unconditionally, so
every change yanked the panel to the bottom - including a revalidation, which is what a realtime
nudge causes. Scrolling up to re-read a line while a table was talking was impossible. An empty
table chat also says `chat.empty` rather than showing a void, which is the state every table is in
until somebody speaks.

**What was deleted, and why it had to be.** The lobby store was a simulation: it invented
opponents on a timer (`planCandidates`), typed their small talk from a script (`planChatter`),
rolled dice nobody threw (`RollEntry`), and declared a winner nobody beat (`planFinish`). With
it went `lib/matchmaking.ts`'s seven-phase reducer, `MatchmakingPanel`, `ResultPanel`,
`RollLog`, `TablePlaceholder`, `LobbyNotices`, and thirty-seven catalogue keys. Six of the seven
phases described things that do not happen; the seventh — people in chairs — is the whole product
now.

**The provably-fair claim is gone, column and all.** `game_rules.fairness` said `dice` or
`deal`, and the UI turned that into two sentences: every roll committed before it is shown and
logged for every seat, every deal shuffled from a seed both sides can check. Neither was true and
neither was designed — the cryptography this product has specified is `nura-e2ee/v1`, which is
about messages. A claim about fairness is what a player leans on when they lose, and shipping it
ahead of the mechanism teaches people that the product's assurances are marketing.
The column is gone from the entity; `tests/lib.spec.ts` now asserts the key is ABSENT,
so it cannot come back without the mechanism. `stakes: 'play-money'` stays: that is a fact about
a table, not a promise about a random number.

### Playing more than one table

Somebody can sit at as many tables as they like, and a turn-based game is only pleasant if they
can. `GET /tables/mine` answers `yourTurn` on every seated table with a live match, and the ENGINE
answers it: `match.turnsAt` loads the live matches in one read and asks each game's `turnOf`,
because no SQL can know how hokm's trump pause or ludo's six decides whose go it is. The reader's
seat comes from `match_players`, never from the table chair: a chair no longer changes hands
mid-match, but a chair and a seat are still two rows, and somebody in a chair the match never dealt
them holds no seat in the game and has no go to be told about. A
table with no match, or a finished one, has no `yourTurn` at all rather than a `false` - there is
no go to be had there.

The play page's header lists the reader's OTHER tables as links, green where one is waiting on
them, and the Games item in every navigation counts the tables waiting. The lobby store refetches
the list on any `game` doorbell, which is how a move at one table lights up the chip on another.

**A switch between tables REMOUNTS the play page, so its teardown closes only what it still owns.**
`<Routes>` keys a segment on its route AND that route's own params, so `/app/play/A` to
`/app/play/B` builds a new page. On a phone the old one plays its 260ms leave first and is disposed
AFTER the new one has opened B, so an unconditional `lobby.close()` in its teardown left the new page
on "No such table" until a reload - and only on a phone, because with no transition the old page is
torn down before the new one is built. Each page therefore captures the id it was built for under
`untrack` and closes the lobby, the board and the watch only while the lobby still holds that id or
nothing. `chat.page` guards `closeThread` by its own conversation the same way, and `TableChat` by
the thread it last opened; `play.spec.ts` drives play-to-play and chat-to-chat with a transition
playing. The table still opens from an effect over the pathname rather than in `mount`, and the
leaving page's copy of that effect opening the NEW id is harmless.

## Voice at the table

`docs/superpowers/specs/2026-09-23-table-voice-design.md` is the design. A host turns voice on at
create (`tables.voice`, off by default); seated players join a peer-to-peer call - one
`RTCPeerConnection` per pair, Opus only, a full mesh of at most seven links per browser - and this
server does nothing but introduce them.

**A table's voice is a word from a list, not a switch.** `tables.voice` was a boolean, and the owner
asked for a call that can be for the whole table or for a player's own side. The column and the wire
take that shape first, with today's two answers and no change in what anybody hears, so that quick
play and parties are never written against the boolean: `VOICE_SCOPES` in `table/voices.ts` is `off`
and `table`, the module imports nothing so the browser reads the same list, `tables_voice_known`
holds the column to it, the wire's `voiceScope` is `enumOf` that list, and the host's switch posts
`{ voice }` where it posted `{ on }`. `team` joins the list only in the commit that teaches the hub
to keep two sides apart: a word nothing can enforce is a promise the product would be making.
`table-voices.spec.ts` holds the CHECK, the wire and the list to one set, and refuses a yes or a no
at the door.

Two things here had no test and would have passed every gate while broken. `voiceAllowed`'s
predicate is SQL in a string - `t.voice = true` - that no compiler reads, and no spec had ever run
that query: left as it was against a varchar column, every join and every recheck would have failed
into `deps.report` with nobody let in and nobody taken out. It asks `t.voice <> 'off'`, and
`table-voice.db.spec.ts` runs it on real rows: seated at a table with a call, at one without, a
watcher, a chair that was left, a closed table, the host's switch both ways. And the truthy-string
trap again, twice: `play-header` and `table-row` drew their voice mark with
`<Show when={ props.table.voice }>`, which compiles with a word in it and is true for `off`, so
every table would have said it had a call. Both read `!== 'off'`; `play.spec.ts` mounts the header
for each word and `tables.spec.ts` the row.

**The realtime socket carries the introductions and that is its first non-doorbell frame.** `voice`
joins, leaves and reports a mute; `signal` relays one offer, answer or ICE candidate to one person.
It is not a delivery path for content - an SDP says how to reach a browser, not what anybody said -
and nothing about it is stored. The rooms live in the hub's memory and empty themselves when a
socket closes; a restart drops every call and the browser asks to be let back in when its socket
next connects. It asks on EVERY connection while it holds a call, the first one included: a Join
pressed while the socket was still connecting - a reload with "join voice automatically" on, most
often - sent its frame into a socket that could not take it, and the helper that re-announced only
after a DROP never fired, so the page showed Leave voice and an open microphone in a room the server
had never let it into. The specs' socket took frames before its handshake and so could not see it;
it refuses them now, as the real one does.

**Who can hear whom is the messaging policy, per PAIR.** Joining asks `social.mayMessage` both ways
between the newcomer and everybody already in the room, and the hub relays a signal only between
two people it allowed. A block, a minor's safety rule and "strangers can't reach me" therefore apply
to voice exactly as to a direct message, and the roster says "can't talk with you" rather than
showing a connection that silently never forms. This is the rule that matters most in a product
whose players include children.

**A `voice` frame is metered by a budget, never by a per-type floor.** The gateway's floors drop a
frame that arrives too soon after the last one of its kind, silently, and a leave sent just after a
mute was dropped that way - the browser believed it had left and the room went on sending it audio.
`tools/qa/voice-pass.mjs` found it on its first run. Signals are budgeted the same way, because ICE
candidates arrive in bursts.

**What the encryption claim is, precisely.** Media is DTLS-SRTP between the browsers. The DTLS
fingerprints ride inside SDP this server relays, so a server that wanted to could sit in the middle;
the chat is end-to-end because every line is signed by a device the reader verifies, and voice
introductions are not signed yet. The copy therefore says the sound goes directly between players
and is encrypted by the browser - not "end-to-end" - until each fingerprint is signed with the
device key the sealing already verifies.

**ICE comes from configuration and a TURN secret never reaches a browser.** `GET /api/voice/ice`
answers `VOICE_STUN_URLS`, and for `VOICE_TURN_URLS` a TURN REST username that expires in an hour
with its HMAC. With nothing configured the list is empty: one network works, two NATs do not, and
the roster says "could not connect".

**The microphone is asked for when somebody presses Join, never before**, and refused or missing it
joins LISTEN-ONLY rather than failing. Everybody joins muted unless they turn that off in settings.
`services/voice.rtc.ts` is framework-free, and `stores/voice.store.ts` takes it through
`setVoiceCall` so a spec can observe the store without a real `RTCPeerConnection`.

**One side places the call.** Of two players the one whose JOINING sorts first adds the audio line
and offers; the other opens a connection with nothing on it, and answers ON the line it was offered,
turned to `sendrecv` with its own microphone on the sender. One offer, one answer, one line each.
Both ends read the same two names off the roster, so nothing a player can change - a handle least of
all - moves who calls. Only the side that called restarts ICE when a connection fails, so the two
ends never offer at once; the crossing rule (perfect negotiation, the side that waits is the polite
one) stays as the net under that.

**An offer cannot beat the roster that names its sender, and the call layer counts on it.** The hub
seats a joining and sends the roster in one synchronous step, into an outbox that is first in, first
out for each socket, and only a seated joining can signal. So a signal from a joining the roster has
not named is let fall rather than answered. `realtime-hub.spec.ts` pins the order on one wire: a
change that coalesced rosters the way nudges are coalesced would strand every call it touched with
every other gate green.

**Both sides used to offer, on every call, and two times in five it never connected.** Each built
its own line on the roster frame, so every setup was a glare: the polite side rolled its offer back,
answered `recvonly`, then offered its own line as a second one. Two things broke in that, and either
alone was enough:

- On Chromium a connection whose FIRST offer is rolled back before it has gathered a candidate can
  stop gathering for good. The descriptions finish crossing, both ends read `stable`, the gathering
  state says `gathering` and no candidate ever comes, so ICE sits at `new` while the roster says
  "Connecting". It is the browser's and not this code's: two bare pages with one connection each and
  nothing of the app showed it once in ten early rollbacks and never in ten late ones (Chromium 151),
  and at the app's own timing it was three calls in eight. How early the other offer arrives depends
  on the caller's round trip to the server, not on two browsers sharing a machine.
- The second offer left the polite side a few milliseconds behind its answer, so it could arrive
  while the answer was still being applied. `signalingState` still read `have-local-offer`, the
  asking side called that a collision and dropped it, and the other player's microphone was never
  negotiated. `settling` is the WebRTC specification's own repair (its `isSettingRemoteAnswerPending`):
  an offer that arrives during an answer is taken, because the connection is stable by the time it runs.

`voice-rtc.spec.ts` holds it on a fake connection: who brings the line, the answer on the offered
one, a microphone granted later, the offer that lands mid-answer, and the two halves of a real
collision.

**A joining has a name, and a signal travels from one joining to one.** The hub names every entry
into a room - `join`, on each roster entry, and `mine` to tell each reader which one is its own -
keeps the name through a mute, and gives a new one to somebody who comes back, whether their socket
dropped, another tab of theirs took the call or the server restarted. The names are random and say
nothing: the first version counted up from the server's start, which handed every player a clock
and a count of every voice join on the deployment. The call layer holds one connection per JOINING,
not per handle: a roster that names a new one hangs up the old connection and opens another, so the
side that calls calls again, and a roster that changes its own reader's joining hangs up on
everybody. A handle is only the label on a joining. Somebody who changes theirs mid-call keeps the
joining and the line, the link is said again under the new name, and nobody finds themselves on a
roster by a handle: the first version keyed the connection by handle and decided who calls from
handles, so a rename made one end hang up and call a connection the other end had kept, or left
both ends waiting for the other to ring.
A signal says which joining it is for, and the hub drops one meant for a joining that is over;
relayed, it says which joining sent it, and the receiver lets one from a joining it has hung up on
fall. A browser whose socket comes back hangs up on everybody BEFORE it asks to be let in again: its
old joining ended with the socket, and anything its old connections sent now would go out under the
new name.

**Before that a peer was a handle, and coming back was luck.** A player whose socket blipped
returned to a room where the other end had hung up and built a new connection while their own
browser still held the old one. When the returning player was the one who calls, nobody offered:
the call sat silent for nineteen seconds, until the dead connection failed and its ICE restart
happened to be answered. When it was the other, the new offer landed on the old connection and
worked only because Chromium rebuilds DTLS for a changed fingerprint. Both take about two seconds
now, measured by closing the socket from the page in two browsers. `realtime-hub.spec.ts` holds the
names and the relay, `voice-rtc.spec.ts` the hanging up and calling again, `voice.spec.ts` the
hanging up before a rejoin, and `voice-pass` cuts each player's socket in turn and wants a new line
at both ends with packets both ways. A cut is seen by the server at once, so the other end hangs up
because a roster left the player out: the roster in which a joining changes IN PLACE is another tab
of the same player taking the call, and the pass does that as well.

**The room takes one arrival at a time.** Every `voice` frame for a table - a join, a leave, a mute -
runs through `lib/keyed-queue.ts`, keyed by the table, in the order it arrived, and the room is read
again after the last question rather than held across it. Letting somebody in asks the database
twice (may they, and may they talk with each person already there), and frames that overlapped in
that gap went wrong three ways. Two players who joined in the same moment each asked about the people
already in the room and never about each other, so the two of them read "can't talk with you" for
the whole call. Two who opened the call in the same moment each built the room and the second one's
replaced the first: one player was told they were in and was not. And a leave sent while its join
was still being checked found nobody to take out, after which the join put them in for good.
`realtime-hub.spec.ts` has a test for each and each fails with the queue taken out. Four real
browsers pressing Join together did not show it in six rounds without the queue: the window is one
policy query wide, which is the kind of fault that waits for a busy database.

`tools/qa/voice-pass.mjs` is two real browsers on Chromium's fake microphone: join, a live remote
track in each, the tone lighting "speaking" in the OTHER browser, mute, leave. Run it by hand against
the built server with every change to this path. **A live remote track is not a connection**: the
browser hands one over when a description is applied, before a packet has moved, so that check
passed on calls that carried nothing and the pass failed further down, on a label. It reads each
page's own `RTCPeerConnection` now - connected, one line, packets counted out and in - and has both
players leave and join together three more times, because a fault that shows two times in five passes
a single try more often than not.

### Voice while the game plays

**The host switches voice, and the switch is a table ring.** `POST /tables/:id/voice` is host-only and
refuses a closed table; turning it off needs no new hub verb, because every table ring re-asks
`voiceAllowed` for the whole room and `voiceAllowed` reads `tables.voice`. The dock carries the
switch at a wide container and the table menu on a narrow one. Turning it back on rings the others'
lobby, so their page offers the call - a toast with Join, once per table per visit, and again after
the host switches it off and on - without a reload.

**"Join voice automatically" joins ONCE for each time the table offers a call**, the same rule as the
toast. The effect used to join whenever the page found itself out of a call it could be in, and it
could not tell why it was out. So Leave voice did nothing for a player with that setting on - the
page walked straight back in - and two tabs of one account took the call from each other without
end, each lap a new joining that made every other player hang up and call again, until one tab had
spent its thirty voice frames and its socket was closed for good. `play.spec.ts` holds both, and the
host's off and on, which still lets the page in again.

**Nothing about holding the talk key reaches the server.** Push to talk is a GATE on the local track:
the server hears `muted: false` once, when the call is joined, and the key or the hold button opens
and closes the track in the browser. A frame per press would spend the voice-frame budget on every
sentence and would flicker a mute icon on every plate at the table. The key is the player's choice -
`voiceTalkKey`, a `KeyboardEvent.code`, V unless somebody records another in settings - and it is
ignored while focus is in a field, so typing a V in the chat does not open the microphone. Escape,
Tab, Enter, `/` and `[` cannot be bound: the first three are how a keyboard leaves things and the
last two are the product's own shortcuts.

**Deafen is Discord's**: nobody is heard and the microphone closes with it, and the room is told
you are muted, because somebody who cannot hear the answer should not be asking the question.
Unmuting while deafened undeafens. Undeafening restores whichever mute state came before.

**A volume per person, and zero is the silence.** `volumes` replaced the silenced set, so "mute
this person for me" is a volume of nought and the slider in the players list is the same fact.
The heard volume is master times personal, times nought while deafened, applied on every link as it
connects.

**The microphone and the speaker are CHOICES, never requirements.** The mic is asked for with
`deviceId: { ideal }`, so a headset that has been unplugged falls back to the default instead of
failing the join; the speaker is `setSinkId` on every peer's audio element, offered only where the
browser has it. Device names appear only after the microphone has been allowed once, and the
settings page says so rather than listing "Device 1".

**Every plate says who is in the call.** `voice.mark(who)` is speaking, live or muted, and the plate
draws it as a small badge on the avatar; nobody in the call draws nothing. `voiceTables` opens a
person's own tables with voice on, quick play included - joining the call stays each player's
decision, and the microphone is still asked for only on the press.

**Whoever is heard wears a ring on every screen, and the meter behind it has to be woken.** The ring
is on a lobby chair, on the whole plate on the felt (`.table-plate[data-speaking]`: round the picture
alone it sat under the turn clock, so the player whose turn it was showed nothing) and in the Players
list. Each browser measures it for itself, from its own microphone and from every line it receives,
through analysers on ONE `AudioContext` that `join` makes before it asks for the microphone. A
browser starts such a context suspended unless the page has been pressed or is already capturing, and
nothing resumed it: a call joined with no press - "join automatically", which is every reload -
measured silence for ever, and nobody was seen to speak. The store resumes it once the microphone is
given (a page that is capturing may play) and at each press and key while it still sleeps, and the
call layer starts a voice the browser held back at the next press. That last is the listen-only
reader: no microphone and no press means neither sound nor ring until the first one, and nothing a
page can do about it. The ring is held for `SPEAKING_HOLD_MS` after the last sound, or it goes out
at every breath. `voice.spec.ts` hands the store a sleeping context, `voice-rtc.spec.ts` a refused
`play()`, `table-plate.spec.ts` the ring on a plate that is kept. `voice-pass` ran Chromium with
autoplay allowed for every page, which is what hid all of it; it does not now, and it runs on
Firefox with `QA_BROWSER=firefox`. **Playwright's `evaluate` is a press as far as Chromium is
concerned** (it runs with a user gesture), so a check of a page nobody has pressed asks that page
nothing until the moment it judges it.

**A call that cannot be made says so in words, and goes on saying it while it tries.** A line that
has not connected for `UNREACHED_MS` is not reached: the Players list reads "Could not connect" for
as long as that lasts, and the page says once who it is and that it is the network between the two,
not the microphone. The wait is counted on NOT CONNECTED, never on `failed`: the side that called
restarts ICE the moment a connection fails, so a line that will never work reads failed for an
instant and connecting for the next half minute, for ever - the "Connecting" that never ended.
Connecting takes the words back, and so does the person leaving. The server says at boot when it has
neither a STUN nor a TURN server, because two players on two networks then cannot connect at all and
nothing else would say why.

**A `<Show>` with a thunk child rebuilds whenever its `when` re-evaluates, so a control inside one
that reads a roster loses its focus.** The per-person volume slider sat in a `when` that read the
voice roster, which changes on every speaking level, and the keyboard lost the slider after the first
key. It is a value-bound `<Show when let>` now, which swaps only when the value's truthiness does -
the voice pass is what found it, as "turning them back up" failing after "turning one down" passed.

The two controls beside that slider had the same fault and kept it for longer: the mark that says
somebody is in the call, and the button that silences them for the reader. Both sat under a condition
that read the roster, so somebody who had tabbed to "Mute Sara for you" was put back on the page body
every time anybody at the table spoke. Both take their person through `let` now. The notice above
the composer that says a chat cannot be sealed was drawn again whenever the room was asked about
again, which every chat doorbell does, and its "Give this browser keys" button with it: the notice
owns that button now (its two callers each built the same one and handed it over, a ternary between
two elements that was only right while the branch around it was rebuilt), and it is offered only when
keys are what is missing, under a `derived` boolean: written as plain markup under a condition that
read the block, it was still drawn again each time (*Markup written straight inside a `<Show>`* in
`frontend/CLAUDE.md`). `table-chat.spec.ts` holds the players' two controls through a roster that
changes and the notice through a room that is read again, and `seal-state.spec.ts` the button.

## Playing a game

`backend/src/domains/match/` is the first real game engine in this product, and it is what the table
domain always said it was stopping short of. A table is still a seat container; a **match** is one
game played at one, and the two are joined by `matches.table_id` with a partial unique index over
`(table_id) where finished_at is null` - one live game per table, enforced rather than assumed.

**The board is not invented, it is read off the art.** `tools/blender/lib/atlas.py` has drawn the
Ludo field since long before any of this, and `tools/blender/assets/set-ludo.py` builds the GLB from
the same 15x15 grid: 72 painted track cells, minus the four five-cell home columns, is the standard
52-square ring; `starts` gives each colour its entry; eight cells carry a star and are safe.
`ludo/board.ts` derives all of it by walking segments and `tests/ludo-board.spec.ts` re-derives the
art's own literals to compare, so the squares a token walks and the squares underneath it cannot
drift apart.

One trap, recorded because it costs nothing to avoid and an afternoon to find: `set-ludo.py` ALSO
carries `track_spots`, and those are not the entry squares - they are where the 3D model parks its
loose tokens for the market scene, two cells off. Taking the wrong dictionary would put every
token's entry beside the star it is drawn on, and nothing anywhere would fail.

**The engine is pure, and that is enforced rather than intended.** `ludo/` imports nothing but
itself: no `typeorm`, no `node:`, no clock, no randomness. `tests/ludo-purity.spec.ts` reads the
directory as text and fails on any of those tokens, which is the same technique
`realtime.socket.spec.ts` uses for "nothing in onConnection may await" - a deterministic test beats
an atmospheric one. Three things follow, and each is the reason: the rules run in the default
`npm test` with no Postgres, the same function can later run in the browser for move highlighting
without dragging a decorator into the web program, and a game is replayable because the same state
and the same die always give the same result.

**`apply` never throws.** A refusal is a value - `{ ok: false, reason }` over a closed union - so the
service maps reasons onto statuses in one place and the timeout sweep can fold actions over a state.
A pure function that throws for ordinary control flow is one nothing can fold.

**Every refusal has words, and the compiler checks it.** `REFUSALS` in `match/refusals.ts` maps each
reason an engine can give to a status, and `SAYS` in `match/service.ts` gives each one its English
sentence. `REFUSALS` is a literal map rather than a `Record<string, ...>` so `engine-contract.spec.ts`
can require every engine's refusal union to be a subset of its keys - the reasons are type unions and
nothing about them exists at runtime to iterate. An unlisted reason still answers, as `illegal-move`
and "That move is not allowed.", but hokm's were unlisted for a whole release and every one of them
told a card player their TOKEN could not move there.

**The word is the code, and the browser says it in the reader's language.** `refuse` used to throw a
bare 403 or 409, so the framework filled in `forbidden` or `conflict`, the gateway forwarded a status
and an English sentence, and the browser said the same "That did not go through" in an error toast
whichever rule had been broken: a hokm player who threw off suit was never told to follow suit, and a
raise below the minimum was never told why. The word is the answer's `code` now, on both paths - the
HTTP envelope, and the socket's `refused` frame, which carries `code` beside `status` and `message`
because the gateway's `refusalOf` forwards whatever an error meant to be read holds. A play the gateway
cannot read is `validation-failed`, the code the route's own 422 carries, and an error not meant to be
read is `internal` and says nothing more.

`match/refusals.ts` imports nothing, so the browser reads the same list. `lib/refusal.ts` takes the
word off an `ApiError` and `act` in the match store toasts `match.refused.<word>` as a `warning` - the
game said no and nothing broke, which is what every table refusal already is. Everything else keeps
`match.actionFailed` as an `error`: the framework's own `conflict` and `not-found`, a word a newer
server has and this client does not, a request that never arrived. The key is a template literal over
`RefusalWord` with no cast, so a word with no English or Persian sentence fails `check`, and
`refusals.spec.ts` holds the rest on each side: on the server every word's status and code, and no
word shared with a code the framework answers on its own; in the browser a sentence for every word and
none for a word the server does not have. The bare `match.refused` had copy and no caller, and is gone.
`SAYS` stays as the envelope's `message`, for logs and the API passes, and is never shown on a page.

Both sides ask `isRefusal`, which is `Object.hasOwn`. `refuse` asked `in`, so a reason named `toString`
counted as listed and was answered with a function for a sentence - unreachable while the engines'
unions hold, and exactly the prototype defect `realtime/frames.ts` records. The browser's half is
reachable: the code arrives off the wire, and `constructor` must not become a catalogue key. And a word
is not an oracle: `act` answers anybody with no seat in the match 404 before it can refuse - a finished
game included, so `game-over` never tells a stranger that an id is real - and `match.db.spec.ts` holds
that.

**The engine never sees a uuid.** It is handed a seat number and answers with one. `match_players` is
the only join between a seat and a person, which turns "you cannot move somebody else's token" into
a lookup rather than a rule somebody remembers to write.

**One engine plays two, three and four.** The seat count chooses which of the four colours are in
play and nothing else; the rotation is over the players array, so the board never knows how many
there are. Two players take opposite quadrants - twenty-six squares apart, so neither starts a walk
behind the other. `game_rules.seats` for ludo is `[2, 3, 4]`, and `reference-parity.spec.ts` is what
stops the client's fallback disagreeing.

**The ruleset is written down, and four of its clauses are where a generic Ludo goes wrong.** It is
Variant B - the common Iranian rules, written out clause by clause with a source or a "house rule"
label for each in `docs/games/04-ludo.md`, which also lists what is still open - and the clauses
below were each wrong in the first engine or changed by the owner since:

- **Two tokens of one colour make a block** (owner, 2026-10-05, D28, replacing Variant B's "stacks
  never block"). No other colour may land on it or pass it, it cannot be captured, and no third token
  joins it; its owner may pass it and break it up. One `obstacle` in `ludo/board.ts` says what stops a
  move, and the engine and the browser's helpers both read it.
- **Your start square holds one of your own tokens at a time** (D28, kept by the owner): no token
  comes out while one of yours stands there. Coming out still captures an opponent - or an opponent
  block - standing on your start (D27).
- **A six with no legal move still earns the extra roll.** Only a non-six with nothing to do ends the
  turn.
- **There is no "three tries to find a six".** A full yard rolling one to five simply passes. That
  rule belongs to other variants and was invented here.
- **Entering is a choice**, not an obligation: any yard token may come out on any six while your
  start square is free of your own tokens, with no requirement to finish a previous one first.

The rest is the ordinary game and is worth stating because each half is a test: capture happens on
exact landing only and never by passing over; the eight starred squares send nobody home, except
that a token coming out of the yard onto its OWN start square sends home whoever stands there (D27,
one rule in `capturesAt`); the five
home cells need an exact count, and an overshoot is simply absent from the legal set rather than
refused after the fact; three consecutive sixes end the turn and the third grants no roll; a capture
or a finish on a six still earns the roll.

**Ludo is also played two against two, and it is the free-for-all's rules with "colour" read as
"side".** `LudoPlayer.side` is who a player plays with, and the engine is HANDED its sides:
`create(seats, first, sides)` takes them from the adapter, which asks `sideOf` in `match/sides.ts`,
because `ludo/` may import nothing and the pairing rule must not have a second copy in there. With
nobody playing together every seat is a side of its own, so each rule below is the old rule exactly,
and `ludo-board.spec.ts` holds `obstacle` to the old count by colour over two thousand random
positions. The rules are T1 to T15 under *Teams* in `docs/games/04-ludo.md`, each cited or labelled a
house rule, and four of them are code:

- **The seat on turn moves the tokens it controls**: its own until its four are home, its partner's
  after (`controlled`). `legalMoves`, `move` and the entry of a yard token all ask it, so the roll
  earned by the six that brought the fourth home already moves the partner's tokens with no rule
  written for it, and a seat whose four are home is not `out` and keeps its turn. A play still names
  a token 0 to 3 and never a colour: whose token that is, is the state's to say.
- **A pair is counted by side** (D29, the owner, 2026-10-05, replacing D24's "partners never block").
  One of your tokens and one of your partner's block like two of one colour, both partners pass and
  break their side's pairs, and no third token of the side joins one - not even coming out, where two
  of a partner's on your start square leave no room. `obstacle` is still the one statement of what
  stops a move, D28 and D29 together. The start square stays a rule about COLOUR: one of your own
  there holds your yard back, a partner's beside it does not.
- **Nothing is sent home by its own side.** `captureAt` skips the mover's side where it skipped the
  mover, and still asks `capturesAt` with the colour that moved, so a helper bringing out a partner's
  token sends home the opponents on the PARTNER's start square, and a partner standing there stays
  and makes a block with it.
- **The winner is a side.** `state.winner` was an index into the players and is a side now. A move
  ends the game when every token of the mover's side is home, eight in a team game, and the `finish`
  event is `{ side, seats }`, the pair hokm's `hand` carries. A token event says `owner`, whose token
  moved, beside `seat`, who moved it. `tally` keys on `seat`, so the roller is credited with what
  they do with a partner's tokens and can bring eight home in one game; "four of these is a win" was
  a comment on the XP constant and is gone.

`ludo-rules.spec.ts` (*two against two*) holds every clause. `ludo-purity.spec.ts` plays forty team
games and asks after every action that no ring square holds three tokens of one side, that no unsafe
square holds two sides, that nothing was sent home by its own side, and that a seat moved somebody
else's token only with its own four home. It asks the first two of the games at two, three and four
seats as well, where the rulebook called them a consequence and nothing tested them.

**A forfeit that ENDS a ludo game leaves the board as it stood, in both formats.** `apply` sent the
quitter's tokens to the yard and then asked whether anybody was left. In a team game any forfeit ends
the match - two against one is no game, hokm's precedent - and `finish` reports what hokm's does:
everybody still at the table as `unsettled`, and those whose side was BEHIND as `trailing` (D25).
Behind is read off the board, `trailingOf` in `ludo/standings.ts`, in the standings' own order:
tokens home, then distance, added up over the side. A board with the quitter's tokens already swept
off it would put the quitter's partner behind every time, and D25 charges a partner the rated loss
only where the side really trailed. So the seat is marked out, `finish` is asked first, and the
tokens go to the yard only when the game goes on, which is three and four seats on their own. What a
free-for-all player sees of it is the last opponent's tokens staying on the finished board instead of
vanishing, and nothing else. No place moves. Everybody who left used to share the last place because
every one of them had been swept to the yard, and the last to leave is not swept any more, so
`placementsOf` says it outright: two sides that are `out` are level whatever their boards say, the
board of somebody who walked away being a picture and not a placement they earned. It is 1, 2, 2, 2
at four seats as it was, `ludo-rules.spec.ts` holds it there and at three, and the result panel,
which sorts its rows by the engine's places, lists the people who left in the order it always did.
Among them the judge still orders by when they left (`placed` in `judge.ts`), so every result and
every rating is what it was. The adapter's `finish` now reports the last seat standing as
`unsettled` as well, and that changes no result either: every other side holds a quitter, and the
judge asks about quitters before it asks about unsettled seats.

Standings are by side for the same reason they are by seat: Ludo only ever declares a first, and a
rating needs an order over the whole field. `placementsOf` ranks each side by its tokens home and
then its distance, both partners added up, gives the pair one place, and puts a side with a seat out
last, level with any other side that is out. Two sides that got exactly as far share a place, which
the rating reads as a draw between them: nobody is separated by a seat number. Every row still carries its own seat's tokens home and
distance. With a side each it is the old answer row for row; the docblock that said so in
`standings.ts` opened with "Ludo ends the moment somebody brings their fourth token home", which a
team game made false, and is gone. `rating.spec.ts` holds the free-for-all, `ludo-rules.spec.ts` the
sides, and `judge.spec.ts` (*ludo two against two*) takes its facts from the engine itself: a side
that brings eight home moves both partners by one amount, a walkout's partner shares the loss when
the board had them behind, and is `void` when it had them ahead - on the quitter's own tokens
included - or when the clock took the quitter.

**Ludo two against two reached a table in the commit that could draw it.** The engine played it
first, behind a seed that kept ludo's `partners` at `none`: no table could be opened for it, the
board was not told a seat's side or whose tokens the seat on turn was moving, and the browser's
helpers read every other seat as an opponent. The seed says `optional` now, so `create` stores a
team table when its opener asks, and `engine-contract.spec.ts` asks its question both ways: every
format the catalogue can open is one the engine plays, and every format an engine plays is one some
table can be opened as. It asked only the first half while the team game waited, and an engine that
plays a game nothing can reach fails there from here on. `table-teams.db.spec.ts` asks the row
`create` stores for ludo at four, asked and not asked, and `match.db.spec.ts` (*starting*) starts the
table that asked and reads partners opposite off the envelope and off the board of every reader.

The board carries the two facts every reader was missing, and both are the state's own.
`ludoBoard.seats[].side` is who plays with whom. `controls` is the seat whose tokens the seat on
turn is moving, `state.players[controlled(state)].seat`: that seat, or its partner once its own four
are home. Both are required on the wire and the same for every reader, and a token named in `moves`
is always one of `controls`' four, so the browser never works a hand-over out for the seat on turn.
On a finished board `controls` still names a seat, as a hokm or backgammon board still carries its
`turn`; every reader asks `finishedAt` first. `engine-seam.spec.ts` plays whole games in both
formats, reads the board as every seat and as nobody, and refuses a board that leaves either out.

What reads them:

- **The helpers act on `controls`.** `movedTo`, `outcomeOf` and `pieceFor` in `game/helpers/ludo.ts`
  lost their seat argument: the board says whose tokens move. `standingOn` leaves out the mover's
  SIDE, so a partner is never named a victim, and a token coming out counts the opponents on the
  start square of the colour that moves. `walkersOf` hands `obstacle` every seat's own side, so the
  coach explains a pair as the engine judged it, in the words for sides at a team table
  (`tip.blockedTeams`). It says that landing on a partner makes a block (`tip.partner`), and once,
  when the reader's own fourth token comes home, that their rolls move their partner's tokens from
  now on (`tip.helping`): on the roll a six earned, or as the turn passes. `ends` asks the side, so a
  six that brings a fourth home is still told it rolls again and the one that brings the eighth is
  not.
- **One rule has a second reading in the browser, and a spec holds it to the first.** Once a turn
  has passed, `controls` is about the next seat, and explaining a pass that a block caused needs
  whose tokens the READER moves. `handOf(board, seat)` answers from the board: its partner's, once
  the seat's own four are home. `helpers-ludo.spec.ts` asks it of the seat on turn at every state of
  whole team games and requires the board's `controls`.
- **`seatsFor` lights the tokens of `controls`**, for a reader who has a seat, and `pick` takes a
  tap only from the seat on turn and only on a token of `controls`. It asks whether the reader has a
  seat before it compares that seat with the turn, for the reason *A finished match names nobody on
  turn* gives. The server offers `moves` to the seat on turn alone, so nothing lights for the
  partner whose tokens are being moved, and two assertions that said so handed the board no moves
  and would have held under any code. `ludo-table.spec.ts` hands that partner a board that does
  offer one, which only a server gone wrong would send, taps a token and wants no play sent: the
  turn in `pick` is all that stands between such a board and a play the server would refuse.
- **The plates wear their side.** `YardBadge` hands `TablePlate` the mark every table of two sides
  wears. The tag says "Partner" on the reader's partner and "Helping" on the seat on turn while
  `controls` is not that seat. A result or a missed turn still takes the tag, and then the mark says
  "Partner" to a screen reader instead, so it is said once either way. Who the reader's partner is,
  is `partnerOf(seat, format)`: it lands in `match/sides.ts` beside `sideOf`, with the board as its
  first caller.
- **At a ludo table the mark is the side's own two colours.** The pip every table shares is blue
  for one side and amber for the other, and here a colour is a player: red and yellow wore the blue
  player's colour, and green and blue one that reads as yellow, in the only mark somebody watching
  can see for who plays with whom. The board hands each `YardBadge` the colours that play for its
  seat's side, as the board it was sent has them, and `.yard-badge` paints the pip half and half
  from them (`--team-a`, `--team-b`), so red's plate and yellow's wear one disc and no second copy
  of the pairing lives in a stylesheet. Hokm keeps the shared pip.
- **The strip says whose tokens are moving.** "Your four are home: move {name}'s tokens." stands
  where "Your turn." stood, and the move list is headed "{name}'s tokens". Everybody else reads
  "{name} is moving {partner}'s tokens.", and the partner reads "{name} is moving your tokens.": a
  third sentence, because the second names a reader to themselves in the third person.
- **The renderer draws a block by side** (`BoardToken.side`), so a pair of partners stands one pawn
  on the other like any block and two opponents on a star stand side by side. `BoardView.winner` is
  `winners`, the colour of every seat whose result is `won`: a side's win throws confetti in both
  colours, and a game nobody won throws none.

Two sentences a helper made false were reworded rather than doubled. The entry label said "the token
on your start" and the tip "Your start square holds one of your own tokens"; a reader moving their
partner's tokens has neither, so both name the start square of the token that moves.

One thing it costs, stated. A quick search that names no sides matches both kinds of ludo table of
four (*Matchmaking is one request*), so somebody pressing Quick play can be seated at a table of two
sides. The lobby, the header and the plates say which it is, and the search still opens the plain
game when it finds neither.

`helpers-ludo.spec.ts` (*two against two*) plays whole team games and compares every prediction with
the engine, `ludo-table.spec.ts` (*the ludo table, two against two*) holds the plates, the strip, the
heading, the tap and the confetti, and `game.spec.ts` the pieces.

The wire's `ludoMove` gained `owner`, `side` and `seats` with the engine, because the ledger wrote
them from then, and lost `winner`, which nothing ever read: a board's winner is the envelope's.
`engine-seam.spec.ts` parses a log to hold both, and plays whole team games through the adapter, in
which a seat moves its partner's tokens. `v` stays 1. Nothing has shipped, so a ludo match left live
in a development database from before this has no sides in its state and is dropped, never migrated.
It cannot be played out instead: read as it is, every seat is on the one side, so nothing in it is
sent home, no pair blocks, and no forfeit can end it. With every seat gone it still has no winner,
its table stays `playing`, which `close` refuses, and the sweep postpones it at every deadline as a
match it cannot play. `matrix.mjs` reuses a live `turns` ludo match it finds by game, so the database
behind a QA run is where one is most likely to be waiting.

**The logical board is the authority and the renderer only draws it.** Collisions compare logical
positions, never pixels, and an animation may interpolate but the final logical state always wins.
That is the same split `ludo/` already enforces by importing nothing at all.

**A game is an `Engine` this server is GIVEN, and the payload is composed per viewer.**
`domains/match/engine.ts` is the seam and `engines/ludo.ts` is the first thing behind it - injected
into `createMatchService` rather than registered into a module-level map, because every other
service here takes its collaborators as arguments and a spec can then build a service around a
fixture engine. Three contracts are not negotiable and each was already true of ludo: `apply` never
throws (the sweep folds actions over a state, and a function that throws for ordinary control flow
is one nothing can fold), every state carries a top-level `rev` (`matches_rev_matches_state` reads
`(state ->> 'rev')::int`), and randomness arrives as a VALUE - there is no randomness inside an
engine to subvert, which is what makes "the client cannot choose a die" structural.

**An engine plays formats, and a seat count alone is not one.** `Engine.seats` was a list of
numbers, and `sideOf(seat, seats)` and `engagement(seats)` were asked with a number, so four chairs
could only ever be one game: hokm made them two teams by counting to four, and ludo could not have a
team game beside its free-for-all at the same four chairs. A `Format` is `{ seats, variant }`, and
`match/sides.ts` holds it with `Variant`, `variantOf(teams)` and the shared `sideOf(seat, format)`:
partners opposite in a team game, a side each anywhere else. It imports nothing, like `turns.ts`, so
the browser can ask the same one. `Engine.formats` replaces `Engine.seats`, `sideOf` and `engagement`
take the format, and `TableConfig` carries the variant into `create`. `standings(state)` is handed
nothing new: an engine that plays teams must hold its sides in its state to apply a move at all, and
a second copy passed in beside the state is one that can disagree with it.

One fact goes down one path. `tables.teams` becomes `matches.variant` at the start, the same word is
handed to the engine's `create`, and after that the recorder and the envelope take the format off the
MATCH row, never off how many `match_players` rows they happened to read. `start` asks the engine
before it deals: a table whose seat count and variant are not one of `engine.formats` is answered
422, "That game cannot be played here yet.", straight after the check that an engine exists and for
the same reason. `create` normalizes `teams`, so only a row somebody wrote by hand gets that far, and
the thing that would have to play it is the thing to ask. Hokm plays `2/standard`, `3/standard` and
`4/teams`, and no free-for-all at four. It still pairs its seats by counting, inside `hokm/`, where
the purity spec allows no import of `sides.ts`; the adapter derives its formats from that count, and
the contract spec holds every engine's `sideOf` to the shared one at every format, so hokm's copy
cannot drift from it. Ludo, backgammon and poker answer with the shared one.

`engine-contract.spec.ts` and `ladders.spec.ts` run over formats. The contract spec requires every
format the catalogue can open - `teamsOf` over the seed's seats and its `partners`, asked both ways -
to be one the engine plays, and every format an engine plays to be one the catalogue can open, and
keeps its bound on a game's length per variant. `ladders.spec.ts`
asks a counter of the GAME as a whole, and again of each team format by itself. Not of every format:
the thirty three-handed hokm matches it plays take no kot, so that check fails on a format with
nothing wrong in it. A team game is where an engine's events change shape, though - a hand names a
side's seats - and a counter it alone stopped producing would hide behind the free-for-all formats
beside it, with every partner's ladder at zero.
`match.db.spec.ts` starts hokm at four as `teams` and every other table as `standard`, reading the
row and what the engine was handed, and is refused a four-seat hokm table whose row says it is not
teams and a team table for an engine that plays none, with no match written. `record.db.spec.ts` finishes a ludo game under each variant: under `teams` an ending that engine
makes, both partners home and both named by its `finish`, and the pair moves together; under
`standard` each seat stands alone. Either board read under the other variant is rated differently, so
each half still holds the recorder to the variant on the match row.

**The wire is an envelope and a board, and the split is the whole redaction story.** `matchPlayer`
is who is in a chair - seat, handle, timeouts, result, rating - and carries nothing about what they
hold. `matchView.view` is a discriminated union the ENGINE composes, and `Engine.view(state, seat |
null)` takes the viewer's seat: a hand a player must not see is never BUILT rather than filtered out
on the way past, which is the rule this product already states about `lastSeenAt`. `null` is
somebody with no chair, so `watch` - which loads a spectator with `mine: -1` - gets a board composed
for nobody through the same function.

That matters because `asMatch` used to walk `state.players` and turn ludo pieces into 15x15 grid
cells for whoever asked. Safe for ludo, where a board is face up; the single thing that would have
leaked a hokm hand the day a second engine landed. `tests/engine-seam.spec.ts` reads `services.ts`
as text and fails if it imports anything under `ludo/` or names a part of a board, and asserts by
PARSING that the envelope drops a colour - the wire being what the parser lets through rather than
what the declaration says.

**A seat's side is on the envelope from the opening; its place is there only at the end.**
`matchPlayer.side` and `place` arrived in one commit and were both sent for a finished match alone.
Who plays with whom is seating - public, the same for every reader, and what a plate has to draw
while the game is on. Where somebody came is a result. `envelopeOf` sends `side` whenever an engine
is known, to a watcher as well, and `place` only once the match has finished; `envelope.spec.ts`
holds both halves, and that the side comes from the format it was handed. Which format the service
hands it is `match.db.spec.ts`'s to hold (*starting*): a four-seat ludo match reads a side each, the
row's variant is written to `teams` by hand, and the same call reads partners opposite. A constant
in that caller passed every other suite, and no engine could show it: hokm's adapter answers from
the seat count alone and the rest list only `standard`, so it would have waited for ludo's team game
and sent every reader four sides.

**The browser mirrors the split rather than flattening it back.** `data/match.ts` is the one place
the union is narrowed (`ludoOf`) and the halves are joined (`chairsOf`), so a screen asks the
question in the same place every time - the argument `visibleTo` makes on the server. A player the
board did not mention is DROPPED, never filled in with a blank colour and no tokens: an invented
chair reads as a fact about the game rather than as a fact about the viewer, which is exactly the
confusion a hidden hand would cause. `YardBadge` takes both halves as two props for the same
reason.

**A log left open is not a redacted game.** `Engine.log(events, seat | null)` is `view`'s sibling and
exists for the same reason: `since` handed back every action's raw `events` column, and
`match_actions` is append-only - so a game writing a deal into its own log would have published every
hand to anybody asking for revision zero, permanently, whatever the board said. The engine is handed
the READER's seat rather than the seat that acted, because redacting for the actor hides a secret
from the one person who already knows it and shows it to everybody else.

**`redaction.db.spec.ts` is the test none of this could have without the seam.** Ludo hides nothing,
so every assertion about hiding over a ludo match passes whether the code redacts or not - the engine
there is a FIXTURE with one secret per seat, injected through `createMatchService`, and the assertion
is over the serialised payload rather than over named fields. Checking one field catches a leak
through the field somebody thought to check; searching the JSON for another seat's secret catches it
through any field at all, including one added later by somebody who never read the test.

**Nothing that records a result knows what was played, and no engine decides what a result is
worth.** `record.ts` carried `outcomeOf`, reading ludo's board to tell a played win from an emptied
room, beside a `ludoEngine.finish` that read the same board and answered the same way - two copies of
one rule. That moved into the engines for a while, and then each engine had its own idea of when a
forfeit was rated (`RATED_AFTER` in two of them, every resignation at a poker table of three, never in
ludo). Engines report FACTS now - `finish` is `{ winners, unsettled }`, `standings` is competition-
ranked, `sideOf` says who plays together and `engagement` names the verbs that count as a decision -
and the one pure `judge.ts` decides every game's results from those facts and the ledger. See *What a
game leaves behind*.

**`player_stats.tallies` is jsonb because `captures`, `rolls` and `tokens_home` were ludo's words on
a table every game shares.** The row is keyed `(user_id, game)`, so a counter's name only has to
make sense within one game; `Engine.tally(events)` folds the ledger, which also moves the fold into
the engine's own tests with no Postgres near it.

**Achievements read tallies BY NAME, so an engine's tally keys are a contract with
`achieve/families.ts`.** A tally family names its counter - ludo's `rolls sixes captures home
enters`, hokm's `hands tricks kots trumps`, backgammon's `games gammons backgammons hits borneOff`,
poker's `hands pots showdowns knockouts` - and renaming one on either side leaves a whole ladder at
zero for everybody with nothing throwing. `ladders.spec.ts` plays every engine to the end thirty
times per format with random legal moves and fails if a family names a counter the engine never
produced; a fixture of literal counters would agree with the families whatever the engine calls
them. The rating never reads a tally, and XP reads one only through the engine's own `points`.

**A jsonb counter cannot be incremented the way an integer one can**, and this is the trap. Postgres
has no operator that adds two jsonb objects of numbers: `||` REPLACES a key, so two games finishing
for one person record the second and forget the first - the read-modify-write defect the second
audit closed, reintroduced by the storage changing shape. The update sums every key of
`tallies || new` with `jsonb_object_agg` inside one statement, on a row the finish already holds
`for update`, and `record.db.spec.ts` plays two matches expecting five rolls. Also: **`both` is a
reserved word** (`trim(both ...)`), so a subquery aliased that way is a syntax error only a real
Postgres reports.

**XP is split where the knowledge is.** `levels.ts` keeps the finish and the win, which are facts
about a match; `Engine.points(tally)` is what a game's own doings are worth, because a capture being
worth two is ludo's opinion and would otherwise have made that file hold the scoring rules of four
games at once.

**One route carries every game's verbs.** `POST /matches/:id/play` takes a `matchPlay` discriminated
by the game's name, the way `matchBoard` and `matchLog` already are for what comes back, and
`Engine.parse(play, seat)` reads it - with the SEAT supplied rather than read off the wire, because
`match_players` is the only join between a chair and a person. A play addressed to another engine and
one that does not add up are both `null`, and both answer the same, because both mean the same to
whoever sent it. `/roll` and `/move` were ludo's verbs on a feature every game shares; three more
games would have been nine more routes over one body of identical authorisation, idempotency and
revision work.

**A play names no destination and cannot carry a die.** A move names one of the caller's own tokens
and the server computes where it lands. The die is drawn INSIDE the engine, from the `Draws` it is
handed, at the moment it applies - `service.ts` used to draw it and build the action around the
number, which put the one value a player must not choose through a layer with no reason to touch it
and into `match_actions.payload`, the column a player's REQUEST writes. The payload is what was asked
for and nothing about what happened; what the die came up is in `events`. `tests/ludo-dice.spec.ts`
reads `schemas.ts` and `api.ts` as text to keep it that way.

**`match_actions.kind` is `play`, `forfeit` or `open`, and nothing else.** It was `roll | move |
forfeit`, which is ludo's vocabulary on the ledger every game writes to. What the platform actually
reads is whether somebody STOPPED - `record.ts` tells a walkout from a timeout by asking whether a
forfeit names a person - and how many decisions a seat made itself, which it counts from
`payload ->> 'verb'` on the rows that name a person, so the verb lives in `payload` where an engine's
own words belong.

**The opening is the first row of every ledger (PK-08).** `Engine.create` returns `{ state, events }`,
and `start` writes those events as an `open` row at the opening revision - seat -1, no person, no
key - in the transaction that inserts the match. Every engine opens at revision 1, so the ledger is
gapless from 1 and `since?rev=0` reads the whole game, opening included: poker's first deal and blinds
(the `hole` events stay in the row and `log` drops them, exactly as for every later hand), hokm's
first `deal`, backgammon's opening roll; ludo's opening has nothing to say and its row is empty.
`start` pushes from the revision before it, so every seat is handed the opening through the same
`game` frame as a move. It used to be thrown away: hand one began mid-hand in the feed, and a board's
beats had no deal to draw.

**That row is the only place the board a game began with is kept.** `matches.opening` was a second
copy of it: `start` wrote the state there beside the `open` row, `commit` wrote it again whenever it
found the column null, and the sweep's fold carried `opening ?? state` from one step to the next - two
fallbacks for a column `start` always filled, so neither could run. Its one reader was the watch, for
a game with no row old enough to show, and the watch takes the `open` row for that now (*A watcher is
shown one revision*). The column is gone and both fallbacks with it. `match.db.spec.ts` (*the
opening*) holds the `open` row to the state the game was dealt, read after a move has changed the
match's own, and the match to having no column for it.

**`asMatch` reads no state at all.** The seats come from `match_players`, the turn from
`engine.turnOf`, and the winner from `matches.winner_seat`, which the recorder writes from the judge's
plan. `match_players.colour` went with it: its docblock said it was what the table is joined
on to draw a board, which stopped being true the moment the board became the engine's to compose, and
nothing had read it since. `tests/engine-seam.spec.ts` covers the whole shared path now -
`services.ts`, `watch.ts`, `record.ts`, `judge.ts` - and fails if any of them imports anything under
`ludo/`; `judge.ts` may import `rating.ts` and nothing else, and `rating.ts` nothing at all.

**A finished match names nobody on turn.** Every engine's `turnOf` answers null once its game is
over, and `asMatch` sent that null as `turn: 0`: seat 0 on turn in every finished game - in the
answer to the play that ended it, in every read after, in the last `game` push and on a watcher's
board - a fact the server made up. `matchView.turn` is optional now and absent then, the way `mine`
is absent for somebody with no chair and `yourTurn` for a table with no go to be had. Nothing on
screen ever showed the zero, which is how it lasted: every reader asks `finishedAt` first, and the
ludo canvas, which was handed seat 0's colour, only tints a die a finished board does not have. What
a reader must not do is compare `mine` with `turn` before asking whether `mine` is there: somebody
watching a finished game has neither, and the two would be equal. This is the ENVELOPE's turn - a
board's own `turn` is the engine's field, absent in poker when nobody is to act and still on a
finished hokm or backgammon board, which those boards read only while the match is live.
`engine-seam.spec.ts` holds the wire and the projector, `match-view.db.spec.ts` a real finish through
the ports - every answer, the watch and the push to each seat - and `ludo-table.spec.ts` draws the
board from a finished match the wire's own parser let through.

**The die is `randomInt` from `node:crypto`, and the product says only that the server rolls it.**
Not `randomBytes(1) % 6`, which quietly favours the low faces. What cannot be claimed is fairness: a
player cannot check that the server did not draw twice and keep the one it liked, because the process
that draws is the process that records. That is exactly the claim `game_rules.fairness` was deleted
for, so `ludo-dice.spec.ts` also fails on the words *provable* and *verifiable* anywhere near this
domain. Commit-reveal is a mechanism to build before any copy changes, not a sentence to add.

**Every action is one transaction that opens with `for update` on the match row.** Deliberately NOT
the `skip locked` the seat claim uses, and the contrast is the whole point: skipping is right when a
held chair is one the claimer should look past, and wrong here, where one of four people acting at
once must win and the others must queue rather than be told nothing happened. `skip locked` returns
in the timeout sweep, where passing over a match another tick already holds IS correct.

**Two guards make a retry safe and neither subsumes the other.** The idempotency key is unique per
`(match, user, key)` and answers a repeated request with the state as it now stands - without it two
identical rolls both apply, because after a six the turn has not passed and the second is perfectly
legal. The revision precondition refuses an action composed against a board that has since moved -
without it a stale "move token 2" is still legal at the new revision, for a different reason, on a
different board. Neither is an error: `applied` is `now`, `already` or `stale`, because a retried tap
and a tap that crossed a realtime frame are both ordinary. Two values could not say which happened.

**Starting is a table verb, and it reads the table under the table's lock.** `POST /tables/:id/start`
takes the lock a leave and a close take, reads the table and its chairs under it and deals from that
read - *A start reads its chairs under the table's lock*, under *Tables*, is the whole of it. Its
insert still carries `not exists`, a seat count and a readiness check in one statement. That used to
be the whole defence, on the claim that it left no window between reading a ready table and writing a
match against it, and the claim was wrong: the players were dealt from a read made before the
transaction, and a WHERE clause cannot see a chair somebody has not committed. The readiness check is
still what refuses a start somebody stops being ready under; the other two are belts, and a 23505 from
`matches_one_live` is still read as "somebody else started it", which answers with their match. Any
seated player may press it: the precondition is unanimous, so host-only would be ceremony that
strands a table whose host closed the tab.

**Readiness is consent to the NEXT game, and a finish spends it.** The precondition is unanimous
only because `commit` clears `table_seats.ready` for the table inside the transaction that finishes
the match - a win, a resignation and the sweep's last forfeit alike. It used to survive the finish,
which made "unanimous" a fact about the game before: one player pressing Play again started a match
for everybody still in a chair, including somebody who had closed the tab, whose turns the sweep then
played and whose seat it forfeited. `match.db.spec.ts` holds both halves - every chair is unready
after a finish however it ended, and one player's start after it is refused until the other says so.

**A table says `playing` and it is DERIVED, never stored.** `TABLE_COLUMNS` reads it from whether an
unfinished match exists, for the same reason `ready` is read from occupied chairs - and with more
force, because playing has two ways to end - a win and a timeout cascade - and a stored copy would
go stale the first time one of them forgot. Closing is NOT a third: `close` refuses while a match is
live, because a host who could close the table mid-game could erase a loss by leaving. Last one out
still closes it, since everybody has gone and each of them has already forfeited.

**A match ends `won` or `abandoned`, and the database knows no third way.** `matches.outcome` allowed
`closed` as well: in the entity's type, in `matches_outcome_known` and on the wire, on a match view and
on a history row. Nothing could write it. `close` refuses while a match is live, and the column has
one writer, the recorder, which writes what the judge decided - `won` if any seat won, `abandoned` if
none did. The only `closed` ever written was a line of test SQL. It is gone from all of them, and
`reference-parity.spec.ts` holds the judge's type, the entity's type, the CHECK and the wire enum to
one set, so an ending cannot be declared again without something that produces it; `match.db.spec.ts`
asks the constraint itself, with the row written by hand.

**Leaving a live match is a forfeit with reason `left`.** It used to free the chair and nothing else,
so the leaver stayed in the match while the sweep played their turns and forfeited them three misses
later as a TIMEOUT - which the judge pays when the seat had played its share, so walking out of a lost
game banked the finish. `table.leave` now takes a forfeit callback and calls it straight after the
table's lock; `services.ts` passes `match.walkOut`, which locks the live match, and only then is the
chair freed: the table, the match, then the seats, the last two in the order a finish takes them.
The forfeit row names the leaver (`user_id`, `payload.verb = 'left'`), so the judge reads a walkout: a
rated loss, no XP, and the survivors `void` unless they and the leaver were both engaged. Somebody whose
seat already has a result - they resigned, or the clock took them - leaves without a second forfeit.
The push, the turn notice and the result line follow through `courtesy()`, exactly as after a move.
The leave sheet says so mid-match ("leaving forfeits it as a loss"), and keeps "your chair goes back"
for everybody else. `match.db.spec.ts` holds the walkout, the chair that stays empty until the end,
and the resignation that leaves no second row.

**A game is played OVER the socket, and a move is delivered rather than rung.** For chat the socket is a
doorbell; for a game it is the delivery, and the cost that forced it is measured: as a doorbell, a move
reached the other seat after a 500 ms hub window, a 250 ms client window and two re-reads, which was
about 800 ms on loopback and 1.6 s on 3G before anybody saw anything. So a `play` frame carries the same
body `POST /matches/:id/play` takes and is answered by an `ack` or a `refused` under the same
idempotency key - a `refused` with the status, the code and the sentence the route would have answered
with - and after every committed action each seat is PUSHED a `game` frame, composed for that
seat by the same `asMatch` and `Engine.view`/`Engine.log` the routes use and passed through `matchView`
so nothing undeclared can reach a wire. The redaction story is therefore unchanged: one composition per
reader, never one payload filtered. Nothing waits for a window: a push leaves the moment the
transaction commits.

The HTTP routes stay, and not as a shim: the browser sends a play over HTTP, under the SAME key, when
the socket is not connected or no ack came within three seconds, and the idempotency ledger makes the
second copy answer `already`. The API passes play hundreds of turns through them. A browser whose socket
keeps failing polls `since` every three seconds while a match is open, so a table does not freeze behind
a proxy that refuses WebSockets. A spectator is never pushed a board - the delay is the point of watching -
but is RUNG once a move is old enough to show them (`WATCH_DELAY_MS` and a second, `gameWatched` in the
hub, players excluded), and re-reads through the watch route; its poll is a thirty-second safety net
rather than the only way a watcher's board moved.

**Every board answers the press before the server does, and only with what the press decides.** A
hokm card leaves the hand and flies to the felt at once, and the server's echo of that same card is
taken out of the batch rather than flown twice; a ludo token walks to `movedTo`'s square, computed from
the server's own `ludo/board.ts`; a poker call, raise, all-in or fold is drawn in front of the reader
by `predicted`; a backgammon turn stays staged on the board until the revision moves. Nothing that
chance or another player decides is ever guessed - no die, no card dealt, no capture, no pot, no
street, no turn - so the prediction can only be wrong when the server refuses, and `board.play`
answers `stale` or `failed` for exactly that and the board takes it back. A prediction is keyed to the
revision it was made against, so the first newer board replaces it whether the ack or the push lands
first. `helpers-ludo.spec.ts` and `helpers-poker.spec.ts` compare every prediction with what the real
engine did over self-played games.

The gateway checks a play twice: the frame shape strictly, then `matchPlayInput` with a comparison that
refuses any key the schema would have stripped, so a `die` inside a play is refused rather than quietly
dropped. One socket's plays run one after another, so a socket never holds two match transactions. Every
frame kind that costs something is metered by one ten-second budget (`voice` 30, `signal` 120, `play`
40, `ping` 10), and past it the socket is closed 4429.

**There is no catch-up verb on the socket.** The realtime store rings every scope once whenever a
connection opens, and the match store answers that `game` ring by reading `since` from the revision
it holds - the read it also polls while the socket is down. A `resume` frame was declared, budgeted
and tested for the same job and no browser ever sent it. It is gone, so every `refused` frame answers
a play and carries that play's key.

**A turn that runs out is played, not punished.** The sweep finds due matches by Postgres `now()` -
never `MoreThan(new Date())`, because the deadline is written by Postgres too (`commit` sets it as
`now() + make_interval(...)`) and a Node clock would disagree with it - asks the engine's
`autoplay`, and bumps `timeouts`. The third missed TURN IN A ROW (`MISSES_ALLOWED`, asked through
`nextMissForfeits`) forfeits that seat: any action a person takes puts their count back to zero,
because a count that only ever grew forfeited somebody for three misses spread across a whole match,
and a Sit & Go is two hundred decisions a seat. A timeout forfeit is a rated loss for that seat like
any other forfeit, and the match is `won` or `abandoned` by the judge's rule (see *What a game leaves
behind*). The server's own actions are written with `user_id = null`, which is what distinguishes
them in the ledger, and is why no turn the sweep played ever counts towards a seat's engagement.

**One deadline and one miss per TURN, not per action.** A turn is `sameTurn` in `service.ts`: the
same `turnOf` AND the same `turnKey`, which each engine derives from its own state (ludo's turn index,
backgammon's turn counter, hokm's round and tricks taken - and at two players the phase and the stock
size, so each discard and draw is its own turn - poker's hand and actions taken). `commit`
re-arms the deadline only when the game goes on and the action ended the turn, so a ludo roll and its
move, a backgammon roll and its move, and the hokm Hâkem's trump and opening lead each share ONE
deadline (LUDO-01, BG-07): a roll no longer buys a fresh clock for the move after it. An action from a seat that is not on turn (a resignation at three or more) changes neither half, so it
never moves anybody's clock (PK-10). The sweep FOLDS: it plays `autoplay` until the turn changes or
the game ends, at most `FOLD_MAX` (8) steps, each its own action row so revisions stay gapless, and
charges ONE miss for the lot. It used to play one action and charge one miss per sweep, so the
backgammon cube holder's expired roll and move were two misses and two deadlines, and a ludo player
on sixes was forfeited inside a single turn. `engine-contract.spec.ts` holds every engine's turns to
the bound and every out-of-turn forfeit to leaving the turn alone.

**The clock is the SERVER's, counted from the moment its answer arrived.** `matchView.remainingMs` is
worked out when the response is composed, and `TurnClock` counts down from the instant it lands -
never `deadline - Date.now()` on the device, which is whatever the phone's clock says and was minutes
out on real hardware. At zero it says the turn is being played for them rather than "0 s", because
the sweep takes up to five seconds to arrive and a clock frozen at zero reads as a hung game.

**A live game holds the screen awake.** `lib/wake-lock.ts` asks for a screen wake lock while a live
match is on the page, asks again when the tab comes back (hiding a tab drops it), and treats a refusal
as ordinary - battery saver refuses it. A phone that dims and locks mid-hand has made its owner miss
a turn.

**The sweep cannot stall, and that is the property worth defending.** `expireNext` is ONE match per
transaction, picked `for update skip locked` INSIDE that transaction - the only place `skip locked`
means anything; a lock taken by a bare select is released the instant the select returns - and it
ALWAYS moves the deadline. A match it cannot play (no engine, `turnOf` null, `autoplay` null, or
`apply` refusing) is pushed a turn into the future without charging anybody a miss, and so is one
whose engine throws, from a second transaction. And since `commit` no longer re-arms on an action
inside a turn, a fold that is still on the same turn when it stops - the bound reached, or a later
step with nothing to play - calls `postpone` itself; without that the match would stay due and the
next tick would charge the same seat a second miss for the same turn. The first version had neither guard: due matches
were ordered by oldest deadline, so one engine bug put the same match first in every tick and
stopped every turn on the deployment, silently, until somebody noticed nobody's game moved. The
unplayable ones come back to `main.ts` and are logged as `unplayable match`, because a
deadline quietly pushed forever is the same bug with better manners.

`sweepTurns` drains `expireNext` for up to four seconds and the tick is a self-rescheduling five
second `setTimeout`, so two ticks can never overlap and a dead turn is played within five seconds of
its deadline rather than fifteen. At roughly twenty milliseconds an expiry that is about forty a
second per process, against the two a second a fixed batch of thirty-two every fifteen seconds gave.

**`match_actions` is an audit trail, an idempotency ledger and a catch-up feed - and NOT a rebuild
log.** `matches.state` is the authority and nothing replays those rows to reconstruct a board. A
fixed rule would change the fold, and a finished game would stop being a fact.

**A watcher is shown one revision, and the seats beside the board are that revision's too.** The
delay exists to stop coaching, and it only works because the SERVER holds the board back: a client
handed the live position and told to wait is not delayed, it is asking nicely, and the request is
right there in the network tab. So `watch.ts` never sends the current state of a live game. It picks
R - the newest `match_actions` row older than `WATCH_DELAY_MS`, or the `open` row every ledger begins
with, so a game younger than the delay is shown its opening rather than nothing - in one query on
Postgres `now()`, and `behind` is the age of that row on the same clock. It was the Node clock
against the match's start for a young game. The delay matters in ludo though ludo hides nothing: a
spectator with a live board can say which token to move, and coaching is cheating in a rated game
whether or not the board is secret. A finished game has no delay, because nothing is left to leak,
and that is also what makes watching a game back possible.

The board was always R's and the seats were not (LUDO-14). `match_players` was read as it stands NOW,
and two of its columns move while a game goes on. `result` becomes `abandoned` the moment a forfeit
commits, though ludo plays on at three and four seats and poker at three or more, so for thirty
seconds a watcher read "Left the game" on a plate whose tokens were still on the ring. The sweep bumps
`timeouts` the moment it plays a turn, so "missed a turn" told a coach that somebody had gone quiet
thirty seconds before the board showed the turn played. And a finish could commit between the read of
the match and the read of its seats, which put the final results and the rating swing beside a board
still called live.

For a live game, then, nothing is read off `match_players` but who sits where. A seat is `abandoned`
only if the ledger holds a forfeit for it at or before R - the ledger is append-only, so that answer
is the same however the reads interleave - a rating is never sent, and neither is `timeouts`:
`matchPlayer.timeouts` is optional and absent for a watcher of a live game, the rule `remainingMs`
already follows, because a count of misses is what the live clock did rather than what the board
shows. The match copy that carries R's state carries no deadline, winner or outcome, so `asMatch` has
nothing to send and the port stopped deleting a field on the way out. `plateTag` and `YardBadge` read
a missing count as none; the ludo badge compared it with zero, so every plate of a watched game would
have worn "Waiting" or "Their go" as its tag. A finished game is sent whole, counts included.

`/matches/:id/watch` is its own route rather than `view` with a flag: `view` answers a player and
refuses anybody without a seat, and one route serving both would be one place to get the delay wrong.
A match that is not there, an id that is no id at all and a table the reader may not watch are one
answer, 404, in the same words: the port answers each with nothing, and the route has one sentence
for nothing. `delayed` asks whether the id is a uuid before it asks Postgres, as `read`, `start` and
`act` do; it was the one match read a route parameter reaches that did not, so a mistyped link was a
22P02 and a 500. `match.db.spec.ts` (*watching*) holds this through the port a watcher is answered
by: a three-seat resignation that shows nothing until its row is thirty-one seconds old, a swept turn
whose count never arrives while the game is live and is there once it is over, a finish forged onto
`match_players` under a live match, a young game shown its opening and told it is as far behind as
that row is old, no clock, winner or outcome while live, and nothing to watch at an id nobody holds,
at one that is no uuid, or at a table that stopped being public under its game - live and finished
alike, while somebody in a chair there is still shown it. `envelope.spec.ts` holds the missing count
with no Postgres, and `table-plate.spec.ts` and `ludo-table.spec.ts` hold the plates.

Two things still reach somebody early, and neither is this route's. The play page closes the watch
the moment the table drops its `matchId`, which is the LIVE finish, so a watcher learns a game ended
thirty seconds before their board would have shown it and never sees the last board. And a seat that
quit a game still being played keeps its `match_players` row, so it is still pushed the live board.

The play page also still says a thing this route no longer means. A refused watch is drawn as
`watch.waiting`, "The game has just started. There is nothing old enough to show yet.", the sentence
for a game too young to have a board to show - and a young game is shown its opening, so the only
404 left is not there, or not for this reader. Somebody on either side of a block with the host
reads it for as long as they stay: `byId` still shows them the table, because `visibleTo` has no
block clause, and `watchableTable` refuses the game on it. The watch store's `waiting` and `missing`
are that state with no reader, and `fit-pass.mjs` still waits forty-five seconds for a watch that is
ready at once.

**`tools/qa/ludo-pass.mjs` plays complete games over the real api**, at two, three and four players,
through the routes a browser uses. It is API-level on purpose: it proves the rules, the persistence,
the turn order, the authorisation and the wire agree end to end, over hundreds of turns, in seconds.
What it cannot prove is that any of it is visible, which is the browser pass's job.

Its fourth game is two against two, opened as a table that asked for it. It reads the sides off the
board and off the envelope, and it plays to build pairs and keep them: a move that lands on one
token of the mover's side comes first, a token standing in a pair moves only when nothing else can,
and otherwise the token furthest back goes, one in the yard before any on the ring. It used to take
the first legal token unless a move happened to land on its own side, so each seat ran one token at
a time round the ring: in 295 of 300 games against the engine no token ever had a pair of the other
side within its roll. And all it asked was whether a pair had been moved by the other side, which
sees a pair sent home and never one walked past.

It asks the board, not the move it chose. On every roll with a move to make, no token on offer may
have a pair of the other side on a square the roll would cross or land on, which is `obstacle`'s
question asked of the wire; and after every action no ring square holds three tokens of one side
and no square without a star holds both sides, the two things `ludo-purity.spec.ts` asks of the
engine. Neither may pass on nothing. A pair has to have stood while the other side had a roll to
play, and somewhere in the run a token has to have been held back by nothing but a pair of two
colours, with no pair of one colour in its way as well and room where it would land: a server
whose partners did not block would have offered that token. Two thousand team games against the
engine with the pass's own way of choosing a move: a pair stood in every one, at 240 rolls a game,
74 tokens a game were held back, and 171 games had none held back by partners alone. Run against
an engine whose `obstacle` counts a pair by colour again, the pass failed forty times in forty.

At the end both partners have won and the other two lost, the finish in the log names the side and
both seats, nothing was sent home by its own side, and every token a partner moved has its owner in
the log. A seat whose four are home has to have moved its partner's tokens, and 104 of those two
thousand games ended without that: the second partner comes home on their own rolls. So it plays up
to four team games and stops once both have happened, and a run in which one of them never does is
about one in sixteen thousand. It imports `ludo/board.ts` and `match/sides.ts` for the ring and the
pairing rather than restating either.

## Hokm

The second engine, and the one the seam was built for: ludo is face up, hokm has hands.

**The rules come from `pagat.com/whist/hokm.html` and the tests quote it.** Deal and play are
anticlockwise, which is the sentence the whole file rests on - seats are numbered in play order, so
"to the right" is `+ 1` and "to the left" is `- 1`, and the dealer (`hakem - 1`) and the rotation
(keep the rank if your side won, else `+ 1`) each come out as one line at every player count.
`dealerOf(hakem + 1)` IS the old Hâkem, so *"the previous Hâkem deals"* is free and there is nothing
stored that can disagree with itself.

**A card is a NUMBER, 0 to 51.** Suit-major, rank ascending, so comparing two cards of one suit is
`>` - which is the entire body of `trickWinner`. The object form would store about twenty times the
bytes in `matches.state` AND in `match_actions.state` on every action, which is the hottest row in
the domain; ludo made the same call for its pieces. `cardOf` and `nameOf` exist so the rules suite
reads like a rule book instead of like integers.

**The deck is stripped until it divides at three and four, and every other number is derived from
that.** 52 at four and 51 at three (Pagat drops *"one of the 2's"*); `trickCount` is the deck over the
seats and `winningTricks` is more than half of that, so the famous seven is a MAJORITY rather than a
constant. Two players use all 52, because half of them go face down in the draw (below), and
`trickCount(2)` is Pagat's *"each player should have 13 cards in hand"* - so the same majority reads
seven there too.

**The three-handed game keeps its own rules and they are the counter-intuitive ones.** The sweep is
a literal seven of seventeen, not a majority. A hand ends early the moment a lead cannot be EQUALLED
- Pagat's own examples, and the tests are named after them: 7-4-3 plays on, 7-4-4 ends, 8-3-1 plays
on, 8-2-2 ends. And *"if two of players take the same number of tricks then the third player wins"*,
so **7-7-3 is won by the player holding three**. That branch is reachable only last, because a tie
below the top is already settled by the unbeatable lead (9-4-4 pays the nine), and seventeen is not
divisible by three so all three cannot tie.

**The deal pauses and that pause is the hidden-information story.** Pagat asks that the Hâkem's
partner receive nothing until trump is named, so they cannot signal. This deals to the Hâkem ALONE:
during `trump` there is no other hand in the state at all, so no view, no snapshot and no event can
leak one even if somebody later writes a careless projection. A pause that left three hands lying in
the state would be a pause that depended on every reader being careful. At two there is no partner to
signal to, and Pagat deals the dealer five at once, so both hands are in the state during `trump`.

**A phase is a decision somebody makes, so there are four, not eight.** The plan sketched a
seven-state enum walking the deal round by round; what a caller can DO is name trump, put cards face
down, keep or pass a drawn card, or play a card, so those are the phases (`trump`, `discard`, `draw`,
`tricks`), and the middle two exist only at two players. Rounds of five and four are a dealing ritual
with no decision in them, and a state nobody can act in only exists to be stepped past. There is no
`deal.ts` and no `rotation.ts` for the same reason.

**Two players play Pagat's draw game (D20).** Five each; the Hâkem names trump and puts three face
down, the dealer two; then the Hâkem draws first and the two alternate. A drawer looks at the offered
card and either keeps it, then looks at the next and must put it face down (*"having looked at it"*),
or puts it face down and must keep the next. Twenty-one draws - eleven to the Hâkem - empty the
42-card stock and leave thirteen each, and the Hâkem leads. The Hâkem sees 27 cards and the dealer 25,
so through every trick the Hâkem cannot place twelve cards and the dealer fourteen; `hokm-seam.spec.ts`
holds both numbers at every action. The stock is an unordered set in the stored state and each card is
lifted from it with the injected `Draws` at the moment it is drawn, as poker does, so no snapshot says
what comes next; a view carries only its COUNT. **There is no discard pile anywhere**: a card put face
down is removed and written nowhere, and the `discard` request's cards sit in `match_actions.payload`,
which nothing reads back but the verb (`engine-seam.spec.ts`). `offer` reaches only the drawer, and
`glimpse` - the card the drawer looked at after a keep - only that seat, until its next draw; the last
ones stay until the first card of the hand is played, or the Hâkem would never see the card his
eleventh draw put down. Every 2P action is a turn of its own (`turnKey` adds the phase and the stock
size there), so an absent Hâkem is forfeited on his first draw. Autoplay chooses from `legalMoves` only
- `putAway` (the lowest cards, a trump counting thirteen higher) and `worthKeeping` (a trump or a ten
or better), both exported from `hokm/cards.ts` so the coach gives the sweep's advice. The refusals are
`not-discarding`, `discard-count`, `not-drawing` and `tricks-not-started`.

**A forfeit ends the MATCH, not the hand.** Four-handed hokm cannot be played three-handed, so there
is nothing to continue with; the side left standing is named so the board can stop, and `finish`
reports every seat still at the table as `unsettled`, because the game stopped before it decided
their order. The judge never rates two unsettled sides against each other: the three-handed survivors
are not rated against one another. The quitter takes a rated loss, team against team; the opponents
win only if they and the quitter had each played a hand's worth of cards (`engagement`: 7 cards at
every player count). `standings` puts a side with a seat out LAST whatever its points and lets sides
level on points share a place (HOKM-03: a 3P tie used to be broken by seat number).

**The score at the forfeit decides who gains by it (D25).** `finish` also reports `trailing`: every
seat still at the table whose side was BEHIND a side still in play - fewer points, or level on points
and fewer tricks in the hand in progress. Without it a forfeit was a rating farm two ways. At three, a
trailing player's partner in crime walked out and the trailing player banked a win over them while
losing the game they were actually in; a trailing survivor is now `void` against the quitter, and the
leader still wins. At four, a losing team's alt walked out and the main account's loss became a
`void`; the partner of a WALKOUT now shares the team's rated loss when the team was trailing and both
the partner and the walkout had played their share (`engagement`) - an early walkout is the quitter's
loss alone, or a griefer could sink a stranger's rating by quitting on the first trick. The
partner stays `void` when the team was level or ahead - neither punished for a teammate's exit nor
paid for a win the side did not have - and when the exit was a TIMEOUT, because a dropped connection
is not a decision anybody at the table made. The engine reports the fact; the judge applies it.

**The log needs no filtering and that is a fact about what is LOGGED.** A card is played face up, a
trump is called aloud, a trick is taken in front of the table and a hand is written on a score sheet.
The private things are the deal, the draw and the cards put face down, and none of them is an event -
a `deal` names only the Hâkem, a `discard` or a `draw` only the seat - so nothing private ever enters
an append-only ledger that `since` replays from revision zero forever.

**`hokm-seam.spec.ts` tests information FLOW, not fields**, and the first version of it was wrong in
a way worth keeping. It serialised a seat's view and searched the bytes for another seat's card
numbers - which is worse than useless here, because a hokm payload is full of small integers (seats,
sides, trick counts, points) and the two of clubs is the number `0`, colliding with a score of nil.
It reported two leaks that did not exist. What replaced it: compute a reader's view, replace another
seat's hand with different cards OF THE SAME LENGTH, compute it again, and require the two to be
byte-identical. That proves the view cannot depend on that hand through any field, named or added
later, however encoded - and the length is kept because how many cards somebody holds is public
across a real table. Proved against four real leaks before it was trusted.

**`Engine.create` takes the table's `target`**, because `tables.target` is on the row and only the
engine knows what to do with it. A hokm engine that assumed seven would have ignored the thirteen
the create form offers and the database already stores. Ludo ignores the argument.

**The opening revision belongs to the engine.** `start` wrote the literal `0` beside the state the
engine had just built - this layer deciding a number the engine owns - and
`matches_rev_matches_state` caught it as a 500 on Start the first time an engine opened at anything
else. It writes `revOf(state)` now, which is 1 for every engine: the opening is the first thing that
happened, and it has a ledger row like everything after it.

**A board names the tricks that take a hand only where a count decides one (HOKM-12).** `needed` is
`winningTricks` - seven - at two and four players, and at three it is ABSENT, because no count takes
a three-handed hand: a sweep of the first seven does, or a lead nobody can equal, or the odd player
out after seventeen. It used to send `trickCount(3)`, seventeen, under a docblock calling it the
tricks that win a hand, and no reader existed at any player count to notice. The wire takes seven or
nothing now; `hokm-seam.spec.ts` refuses the seventeen and plays whole matches at two and four,
requiring every hand to end on the trick that brings a side to the number its board named. The reader
is the caption in the middle of the felt, which shows while nothing lies on it: "7 tricks take the
hand" as a `tally` and a count-free plural, or at three "A lead nobody can catch takes the hand" with
no number in it, and the `.hokm-side` summary says the same to a screen reader.

**The dealer has a mark, and the browser keeps no copy of who deals.** `dealer` was on every board
and nothing read it, while `hokm-beats.ts` carried a `dealerOf` of its own to throw the deal from the
right seat. The beats import the server's from `hokm/scoring.ts` now - they cannot read
`view.dealer`, because a batch can span a hand change and each `deal` event names its own Hâkem - and
the plate reads the view: the crown on the Hâkem, a hand in a disc on the dealer, never both on one
plate, and the word "Dealer" in the facts a screen reader gets. At two players that is the seat that
puts two cards down and draws second, and the mark stays there through the trump call, both discards
and all twenty-one draws.

**`tools/qa/hokm-pass.mjs` plays whole matches at two, three and four over the real api**, and it
checks one thing ludo's pass structurally cannot: every seat reads `GET /matches/:id` for ITSELF
after every turn, and no answer ever carries a card that reader is not holding. At two players it also
checks that the offer reaches the drawer and nobody else, that at every first lead the Hâkem cannot
place twelve cards and the dealer fourteen, and that no `discard` or `draw` in the replay names a card.
`hokm-seam.spec.ts` proves the engine composes per seat; this proves it survives the route, the
projector, the serialiser and the wire.

**`games.status` for hokm is `available` now**, which is what `table.create` joins on - so the flip
is the thing that opens the door, and it happened in the commit that made it true. `status` is never
overwritten on conflict, so it reached a database built from nothing.

## Backgammon

The third engine, and the first one somebody plays by PLACING things rather than by choosing one of a
handful: a turn is up to four checker moves whose legality depends on each other. `docs/games/02-backgammon.md`
is the rulebook - standard match play to one, three or five points, the cube dead in a one-point
match and for any player the current cube would already carry to the target (USBGF's dead cube),
Crawford, no Jacoby and no beavers - and `backgammon-rules.spec.ts` holds the move generator to a
naive enumerator written inside the spec, over hundreds of self-played positions.

**The board stages a turn one hop at a time, and the SERVER's rules say which hops are left.**
`moves.ts` exports `stage(side, roll, staged)`, which answers, for any prefix of hops in any order,
the hops some complete legal turn still continues with - so the board highlights only checkers that
can move, only destinations they can reach, and enables "Play the move" exactly when the turn is
whole. The browser imports it from `backend/src/domains/match/backgammon/`, the way ludo's path code
imports `ludo/board.ts`: a second copy of the forced-move rules in the client would agree with the
server right up until the position where it mattered. The rules coach asks the same module's
`forcedDie` which die a one-die turn must play; it kept its own "play the higher" rule until that was
found. A staged turn is local until it is sent, so
Undo costs nothing and nothing is ever half-played on the wire.

**Every move is a button as well as a tap.** The board is one inline SVG drawn from
`game/backgammon-layout.ts` and is `aria-hidden`; the hops on offer are listed beneath it as real
buttons with sentences for names, and a screen reader is given each side's stacks in words. That is
the canvas rule ludo already follows, for the same two reasons: a keyboard and a screen reader can
play, and the responsive matrix has something to hit-test. The SVG takes the tap itself and turns the
pointer into a point with `pointAt`, rather than twenty-four invisible buttons none of which could be
44px wide on a phone.

**The board is printed, so it does not mirror** - `[direction:ltr]` on its wrapper, exactly as
`.board-plate` and `.hokm-table` do - and the reader's home is always bottom right, whichever seat
the server gave them. Seat 0 plays the light checkers and seat 1 the dark, for everybody.

**The board's `turn` is the seat that must ACT.** While a double waits for an answer that is the
player it was offered to, not the one who offered it - the same seat `turnOf` names and
`matchView.turn` carries. It shipped for one commit naming the doubler, which would have offered
Take and Drop to the player who had just doubled and "waiting" to the one being asked;
`tools/qa/backgammon-pass.mjs` found it on its first run, because an API pass that answers doubles as
whoever the board names is refused with a 403. `backgammon-seam.spec.ts` now pins the equality over a
whole match with doubles in it.

**The board is sized from both axes of the stage, never from the viewport.** A 16:13 board as wide as
a 750px column was 615px tall, which on a laptop put Roll and "Play the move" below the fold. It is a
`.table-surface` in the fit cell now - see *One stage, never a scroll* - with the two plates hugging
it above and below on an upright screen and moving into the side column beside the bar on a wide or
sideways one. The plates are rendered in both places and CSS shows one set, because the two positions
are in different grid cells and a size container is a containing block nothing can escape.

**`tools/qa/backgammon-pass.mjs`** plays whole matches at one, three and five points over the real
api, answering doubles both ways, and asserts at every turn that both players read the same board
(nothing is hidden), fifteen checkers a side and never two colours on one point, and that the winner
really reached the target.

## Poker

The fourth engine: No-Limit Texas Hold'em played as a Sit & Go, at 2, 6 or 9 seats, everybody on 1,500
chips, the blinds rising every ten hands from the level the table was opened at, the last player with
chips the winner. `docs/games/03-poker.md` is the rulebook and the list of decisions - the TDA rule
for short all-ins, the full big blind owed by a short one, no raise when nobody could answer it - and
`poker-rules.spec.ts`, `poker-engine.spec.ts` and `poker-seam.spec.ts` hold them.

**There is no deck in the state.** Each card is drawn from what is left when it is dealt, through the
`Draws` the engine is handed, so no snapshot anywhere holds a card nobody has seen yet - the same
structural answer hokm's deal pause gives, taken further. The ledger keeps a private `hole` event per
seat as an audit trail and `log` drops it; the seam spec forges other seats' holes in the state AND
in the events and requires every reader's view and log to be byte-identical.

**The table passes to the LEFT.** Hokm is dealt counter-clockwise and poker clockwise, so the table
places the next seat to the reader's left; `poker-board.spec.ts` pins it. See
`docs/games/03-poker.md`, *The table*, for the pot split the view shows and why a folded player is
sent no cards.

**Poker only runs live, so the matrix keeps a game going.** Its heads-up QA table is opened live and
the sweep can finish it mid-run, so before each poker cell the matrix restarts the game on the same
table rather than touring a lobby for the rest of the run. A finish clears readiness, and the
partner is a session with no socket, which the sweep of the waiting tables stands up from a finished
one (*A waiting chair belongs to somebody who is there*). So that is four requests: the partner's
chair again, the partner's ready (the matrix keeps the partner's session for the whole run), the
tour account's ready, then the start. `fit-pass.mjs` readies every player before it restarts a
finished table for the same reason, and looks before every cell, which is sooner than a second sweep
can come round.

## Drawing the board

The Ludo board and its pieces are **vector art drawn from the rules' own geometry**, all of it by
`tools/art/boards.mjs` (`npm run art`). It imports `frontend/src/game/layout.ts` for where the
grid sits and `backend/src/domains/match/ludo/board.ts` for the ring, the home runs, the starts and the
safe squares, and writes `ludo-board.svg`, four `pawn-<colour>.svg`, `pawn-shadow.svg` and
`ludo-dice.svg` into `frontend/public/board/`. So a start square, a star or an arrow cannot sit
anywhere the rules do not put one, and the generator throws if the ring stops being 52 cells.

The board has been a Blender photograph, a glossy vector board, a satin render and the vector board
again, and it is now a **cartoon**: the owner asked for one that feels like childhood, "because it is
just ludo". The spec is `docs/superpowers/specs/2026-09-23-ludo-cartoon-board-design.md`. One indigo
ink line (`#2A1E5C`) on every shape, flat colours a shade brighter than the pieces, sticker shading
(a lighter band across the top, a darker lip under the bottom, never a gradient), cream card inside a
toy-wood frame, round yard houses whose four seats are recessed rings, chunky outlined stars, and a
gold star at the centre.

**The board and the pieces are ONE paint and ONE line.** `PAINT` in the generator (`fill`, `light`,
`dark`, plus `tint` and `well` for the seats) colours the board and the pawns alike, `INK` outlines
both, and `--ludo-*` in `tokens.css` and `TONE` in `ludo-board.ts` are the same four fills - kept equal
by hand. The pieces went glossy studio render, toon render, and finally flat vector, and each step
was the owner seeing that the pieces came from another box than the board: a 3D die and a 3D pawn on
a 2D cartoon board do not belong together however well either is lit.

**The pawn is a chunky 2D peg**: plinth, bell and ball head in the board's sticker shading (a light
stripe on the lit side, the dark side, a white glint) under the board's indigo line, drawn in a
256-square sprite whose foot is at 199 so it keeps the geometry the renderer places by - 170 pixels
to the square, drawn at 1.687 squares so it fills its square like a toy piece, sitting `DROP` below the
cell centre. Depth is y, as for any standing piece. The die is a flat sticker face with indigo pips,
eight slots of 256 in one sheet. Nothing is printed on a pawn's head: the letter that used to be there
was a smudge at phone size and a sticker at desktop size, and the yard, the plates and the move list's
words already say whose piece it is.

**A finished pawn stays on the board**, at 0.62 in its colour's triangle (`HOME_SLOTS`), where it used
to vanish from the view entirely. Two pawns of one colour on a ring square are a block and are drawn
one on the other; pawns that share a square otherwise stand side by side (`STACKS`), and
`game.spec.ts` holds every footprint inside its tile - which is how it found that the art spec's own
two-pawn layout overhung the square.


**The grid does not fill the board, and assuming it does is a bug you look straight at.** The
fractions come from the old atlas and the generator keeps them exactly, because the canvas, the DOM
fallback and the art all place things through them:

```
RIM    = 0.016 / 0.380              the wooden frame
MARGIN = RIM + FIELD * 16 / 992     where the first cell actually starts
CELL   = FIELD * 960 / 992 / 15     one square
```

With the paper's own numbers instead, every token near an edge sits about a quarter of a cell too
far out, exact in the middle and worst in the corners. The yard wells have the same trap from the
other end: they are drawn at `NEST +/- NEST_SPREAD`, which is a POSITION, and `centreOf` adds the
half cell that turns an index into a centre - so `seatsFor` subtracts 0.5 before it hands a parked
token over.

**The house sits in the middle of its yard**: each yard's four seats sit in a disc (`NEST_RADIUS`
1.9, seats 0.8 apart, each seat 0.36 of a square) centred on the yard. It was pushed 0.7 squares
inward while the players were drawn in the yard's outer corner; once they moved beside the board the
owner asked for it back in the middle. `NEST` lives in `game/layout.ts` and both the art and
`seatsFor` read it, so a parked token cannot sit anywhere but on its own seat.

**The players sit OUTSIDE the board, at their own corner.** They were drawn inside their yards for a
while - an avatar in the corner, a name along the edge - and the owner asked for them out, which is
what Ludo King and Ludo Club do: the yard belongs to the pawns. `.ludo-frame` is a grid: on a phone a
row of plates above the board (the two top yards) and a row below (the two bottom ones), which is the
empty ground a portrait phone has anyway; on a container of 44rem or more they become compact cards
in two side columns, so a desktop board keeps its height. A plate glows in its colour on its turn and
carries the die that was rolled.

**The board is DOM, and there is no Phaser.** It was a Phaser scene - about 350 KB gzip, a WebGL
context to leak, a deferred destroy, a boot that QUEUES rather than starts - to move sixteen pictures
around a square. `game/board/ludo-board.ts` builds plain elements into the board's host and animates
them with the Web Animations API, and the whole chunk is about 5 KB. Every position is in `cqi`: the
host sits inside `.board-plate`, which is an inline-size container, so a piece at `translate: X Y` in
container units stays on its square at every size with no resize code at all, and the browser draws
the images at device resolution for free. A walk is one animation of the piece through every square
it crosses plus an arc on its lift; the idle hop of a movable pawn and the turning dashes of its ring
are CSS keyframes. `frontend/src/game/` stays framework-free exactly as `world/` is, and
`tools/budgets.mjs` requires every registered renderer to sit in a lazy chunk of its own under 16 KB.

**`components/games/boards.ts` decides which BOARD COMPONENT draws which game**, and the play page
and the spectator view both go through it. The page used to load `hokm-board` for hokm and
`match-board` for everything else, so a third game was drawn as an empty ludo plate with no controls
and nothing logged - and `WatchBoard` drew a ludo canvas for every game, which is why spectating a
hokm table showed an empty ludo board for as long as hokm existed. A game with no entry renders
`match.cannotDraw` with a reload, which is the state an old tab reaches the day a new game goes live.
`catalogue.playable` is `available` on the server AND an entry here, and it is what every Play button
reads, so a client can ship before the server flips a status and never offer a game it cannot draw.
The leaderboard keeps `status`, because a board of results needs no renderer.

A spectator gets the same board a player does, with no `mine`, which every board already reads as
"no controls". It has no clock either: a watcher's board is thirty seconds old, and a countdown for
the live turn beside a board from three moves ago says two different things at once.

**`game/scenes.ts` decides WHICH renderer draws which game, and it is the only place that does.**
`board-canvas` named one module, one export and one image file, so a second game's board meant
editing the component every board goes through - and the build gate asserted the lazy chunk by the
literal filename `ludo-board-`, which would have gone on passing while a second scene rode into a
route chunk unmeasured. The registry's loader is a FUNCTION returning a dynamic import, so a
renderer lands in its own chunk rather than in every route that renders a board. A game with no
scene falls through to the plain DOM tokens, which is the rule `lib/lines.ts` follows for a line key
it has never heard of. `budgets.mjs` reads that registry - one dynamic import per registered scene,
each module on disk and in a chunk of its own - so the rule is about the property rather than about
one file.

**The board is the illustration, not the interface.** Every move is takeable from a button beside
it, the turn is an `aria-live` region, and the pieces are `aria-hidden` inside a labelled host. That
is what makes the game playable by keyboard and readable by a screen reader. Pointing at a token is a
shortcut to the move list and nothing more: a tap anywhere near a token the server called legal picks
it (`pickNear`), and a tap on anything else does nothing. On a six every token still in the yard is
playable, because they are interchangeable: `pieceFor` turns a tap on any of them into the one entry
the move list offers, and the engine accepts any yard token for it (D12).

**`/app/play/:id` is in the matrix now**, and was not for a long time - so the one route carrying a
board was the one route the 640-cell gate never toured. `matrix.mjs` seats a second wallet fixture,
readies both and starts a match in its setup, reusing a live one when a previous run left one
behind. It tours a ludo board AND a backgammon board now, each found by GAME: it used to reuse
whichever live match the account had, so which board the gate toured depended on what the last
hand-run pass happened to leave behind. Both are opened as `turns` tables, because a live table's
sweep forfeits two absent players within a few minutes and the rest of the run would tour a lobby.
It tours a heads-up poker table too, kept dealing as *Poker* describes. The matrix is 800 cells.

**A move is drawn over time, and the renderer decides only that.** A token walks the squares it
really crossed - `game/board/path.ts` asks the SERVER's own `ludo/board.ts` which ones those are,
rather than the renderer keeping a second copy of a fifty-two square ring that would agree right up
until somebody edited one - so a capture happens on the squares it happened on instead of the piece
cutting across the middle of the board. A captured token is knocked back to its yard with a spin,
because being sent home is done TO a piece and must not look like a move its owner chose: it flashes
white, arcs up and spins as it flies, and a ring bursts where it stood. A token that comes home walks
the home run, slides into its triangle and a gold ring bursts. Each step of a walk is an arc - the
pawn lifts off the square while its shadow stays on the ground - rather than the piece swelling in
place. A second update landing mid-walk cancels the first rather than queueing behind it, because the
newest state is always the one worth being on the way to.

**What happened travels with what is.** A move's reply carries `events` - the redacted log since the
revision the caller acted on - and a nudge reads `since` instead of the whole view, so the board is
told what happened as well as where things stand. The reply's events are composed by calling the
match domain's own `since` after the action, which is the same membership check and the same
per-reader redaction `redaction.db.spec.ts` already holds, rather than a second path for the log to
leak through. The store keeps the reply's match beside the fetched one and answers whichever has the
higher revision. The first thing this bought: a roll that passes the turn used to be invisible,
because by the time the view arrives the die is already spent and gone. The renderer now reads the
beats, and a roll followed by a `pass` tumbles, wobbles and dims before it fades - "deny" and a red
tint for three sixes. A batch already on screen when the board mounts is never replayed.

**The affordance ring is two strokes, white inside dark, and that is not decoration.** It began as a
glow in the token's own colour, on the reasoning that a white ring on a yellow piece against cream
paper is a ring nobody sees - which is true, and which misses that a red ring around a red piece in
the red yard is invisible exactly where every game begins. Two strokes is the trick a map legend
uses: the white carries on walnut and on red, the dark carries on cream, and neither depends on
which colour is playing. It lies on the ground as an ellipse under the foot and turns as twelve
dashes while the pawn hops; the old breathing circle was 1.17 squares across and spilled onto the
neighbours. Under reduced motion the pawn simply stands lifted inside a solid ring.

**The table's sounds: one engine per page, unlocked by a real tap.** `game/sound.ts` holds ONE
`AudioContext` for the whole page, shared by every board through counted handles: `createSound` takes
one and `dispose` gives it back, and the last one back SUSPENDS the context rather than closing it, so
switching tables never has to unlock audio again. The spec is
`docs/superpowers/specs/2026-09-23-table-motion-sound-design.md`; the rules that cost something:

- **`pointerdown` is not a gesture on an iPhone.** The context is created and resumed inside
  `pointerup`, `touchend`, `click` or `keydown`. The old engine armed on `pointerdown` and never
  called `resume()`, so every table was silent on iOS and Chrome logged "The AudioContext was not
  allowed to start" on a cold deep link - which the matrix counts as a failure.
- **The cue of the unlocking tap still plays.** `resume()` is asynchronous, so the tap that unlocks
  would otherwise lose its own sound; a `resuming` flag lets cues be scheduled while it is on its way.
  Outside that window nothing is scheduled on a context that is not running.
- **An interruption re-arms it.** A call, Siri or a screen lock puts WebKit into `interrupted`; the
  `statechange` listener puts the tap listeners back, and a context still not running 300ms after a tap
  is rebuilt, because WebKit's can get stuck there.
- **Recorded foley, synthesised interface.** Cards, dice, wood and the two jingles are CC0 recordings
  from Kenney (`tools/art/sound-src/`, with their licence), trimmed and encoded to 96 kbps mono MP3 by
  `npm run sound` and packed into ONE file, `game/sound/table.cues` - an `NCUE` header, a JSON index
  and the takes back to back - imported through `new URL(..., import.meta.url)` so it lands hashed in
  `/assets/` and is cached as immutable. One file is one request instead of seventeen, and the neutral
  extension is load-bearing: a download manager (IDM and its kind, common among Persian users)
  intercepts any `.mp3` a page fetches and hands the page an empty 204, which is how the first build of
  this was silent on the owner's own machine while curl got a perfect 200. The turn, the ticks,
  trump, trick, bonus, pass and deny are synthesised. A recording that failed to load falls back to its
  synthesised voice or to silence and never throws, which keeps "nothing can 404 halfway through a game"
  true in behaviour. `assetsInlineLimit` refuses to inline the pack, and `tools/budgets.mjs` requires
  exactly one pack in `.dist-frontend/assets`, at most 160 KB, and no file there with a media extension at all.
- **Mixed like a game, not like a web page.** Three buses (foley 0.9, interface 0.45, jingles 0.6) into
  a 0.7 master and a limiter; each play varies its rate by up to 10% and its level by 1.5 dB, rotates
  through the takes, is panned by where it happens, and the same cue is not started more than three
  times at once or twice within 35ms.
- **A hidden tab hears only what is urgent** - the turn and the ticks - and the iOS audio session is
  `ambient`, so the silent switch mutes it and it mixes with the player's music.
- **Sound is on by default**, because a native game starts with sound; nothing plays before the first
  tap, and the dock and the table menu turn it off in one press.
- **Every table sounds like its own pieces, from the server's log.** Hokm has its own queue (below);
  backgammon and poker go through `components/games/table-cues.ts`, which maps a batch of their
  events to timed cues and haptics and plays nothing for a batch that was on screen at mount, that
  has a gap in it, or that arrives in a hidden tab. Poker's chips are two more Kenney recordings,
  `chip-lay` for a bet and `chips-stack` for a pot, which is why the pack is 20 takes of 14 cues.
  `TurnClock` takes `yours` and ticks at five, four and three seconds and higher at two and one, for
  every game, with one `warn` buzz at five.

**Hokm is played in motion, and the table runs a little behind the server on purpose.** The spec is
`docs/superpowers/specs/2026-09-23-table-motion-sound-design.md` §3.2. A card flies from the seat that
played it - from the exact spot in the reader's own hand, recorded before the request - and the real
card on the felt stays hidden (`data-landing`) until its copy lands; a finished trick is held 900ms
(450 when the next lead is already queued), the winning card glows, and the four are gathered to the
winner's plate; a hand ends on a "+n" banner or a kot; the deal throws backs from the dealer.
`game/hokm-beats.ts` turns log events into that timeline and is pure, so every timing is a test in
`hokm-beats.spec.ts`; `game/motion.ts` flies copies with the Web Animations API in a clipped
`.board-flight` layer, so nothing in flight can widen a page the matrix measures.

- **The felt reads the queue; everything else reads the view.** While beats are playing, `laid` comes
  from `shown`, which the queue owns; the controls, the live region, the hand and the turn read the
  current view, so nobody waits for an animation to be allowed to act. When the queue drains, `shown`
  goes back to null and the felt follows the view again, which is also what reconciles it.
- **A finished trick no longer sits on the felt until the next lead.** It is gathered, and the
  last-trick tile keeps it readable. A table opened mid-hand shows only the trick in progress.
- **Pacing is the clock's, never an animation's `finished`**, so a throttled tab cannot strand the
  queue. More than 1.5s behind plays at double speed - flights included, or the real card lands
  while its copy is only halfway - and more than 3s behind, a gap in the log, a hidden tab, or a
  catch-up of more than twelve actions or more than one hand jumps straight to the board, because a
  reconnect replaying half a hand at full pace is a table showing the past beside controls showing
  the present. Under reduced motion every flight is a 140ms fade at its destination, the real card
  shows after the fade rather than after the flight it no longer has, and the sound and the haptics
  stay - the gather and the deal play their foley with no copies flying.
- **A trick that ends a batch is HELD, not scheduled away.** The timeline leaves it on the felt and
  the board gathers it after 900ms itself; a next lead arriving in a later batch cancels that and
  gathers after 450ms counted from when the trick was taken. Scheduled up front, the gather sat in
  the queue and every lead waited the full hold behind it.
- **The watermark belongs to a MATCH.** A rematch at the same table can reuse the board instance,
  so the board resets its revision, its felt and its event cursor when `props.match.id` changes, and
  `table-cues` resets the same way - otherwise every event of the new match sits below the old one's
  last revision and the whole rematch plays in silence. `hokm-board.spec.ts` fails without it.
- **The Hâkem is the one ACTING during the trump call**, so they get the turn chime and the
  countdown ticks then; `acting` is that, and `myTurn` stays what decides which cards can be played.
- **The two-handed draw is drawn on the felt and rings once.** A stock pile with its count sits at the
  felt's edge; a draw flies one card back from it to the drawer (`draw` beat) and a discard is a sound
  with nothing flying. The drawer alone gets a panel shaped like the trump chooser - the card, Keep and
  Take the next card - and the seat putting cards down toggles them in the hand, with a confirm that
  enables only at the exact count and a "5/13" chip beside the clock. Nothing on screen describes the
  cards put face down beyond the drawer's own "The 9 of hearts went face down". The turn alternates on
  every draw, so the turn chime rings on a seat's FIRST draw of the hand and the draw's card-slide is
  the cue after that.
- **`mount` runs in a microtask**, so a spec that renders a component and advances the manual clock
  in the same tick advances it before the component's timers exist. `turn-clock.spec.ts` awaits one.

**The board does not mirror, and `.board-plate` and `.ludo-frame` declare `direction: ltr` to say
so.** Everything else in this product is authored in logical properties precisely so it flips with
the reading direction, but a ludo board is a printed object: red is in the corner it is printed in,
and the pieces over it - and the plates beside its corners - have to agree with the print, whatever
language the page is in. The DOM fallback places its tokens with
`inset-inline-start`, which on a Persian page measured from the other edge and put every token in the
yard diagonally opposite its own. One line on the container keeps the house rule and fixes the object,
rather than spelling one child in physical properties and hoping the next one remembers.

**The two fractions are derived once.** `.board-token` carried `--rim` and `--cell` as percentage
literals beside the ones `game/layout.ts` derives from the art - two descriptions of where the grid
sits inside the plate, agreeing exactly until somebody edited one. The component sets them from
`layout.ts` now, and `frontend/tests/game.spec.ts` pins that the fallback's own box arithmetic
(`rim + col * cell + cell * 0.10`, `cell * 0.80` across) lands exactly where `centreOf` and
`tokenRadius` put the drawn one.

**An effect that hides its only signal read behind an optional call subscribes to NOTHING.**
`handle?.show(props.view)` short-circuits while the renderer is still being imported, so the first
pass reads nothing, registers no dependency, and the effect never runs again - and the board draws the
position it was given at mount for the rest of the match while the panel beside it updates every turn.
Nothing throws and nothing logs. `world-canvas` has always had the right shape and this is what it is
for: read the signal into a local, THEN reach through the handle. Nothing checks it now, and the
difference exists nowhere else, so it is on the reader.

## The play pass

`tools/qa/play-pass.mjs` is two real browsers playing one game through the interface, run by hand
against the built server. It seats two wallet fixtures at one table, presses Start, takes ten turns
by CLICKING the roll button and the move list, plays the rest out over the api, and then asserts in
BOTH browsers that the finished game is still on screen, says what it did to the ratings and offers
another.

It exists because of what the other gates cannot see. `ludo-pass.mjs` plays complete games over the
api in seconds and never presses a button; `npm run qa` tours the play route in 680 cells and never
presses one either. Everything this checks was found by hand, one at a time: a board that drew the
opening position for an entire match because an effect subscribed to nothing, a fallback drawn on
top of a working canvas, a resign button drawn over the one that opens the chat, a finished game
that vanished at the moment it had something to say. Every one of those is a green matrix and a
wrong product.

Two of its assertions are deliberately made in the OTHER browser, because a move only the mover can
see is the failure it exists to catch.

**`tools/qa/hokm-play-pass.mjs` is its sibling, and a separate file rather than a parameter.** The
two games are different interfaces with different failure modes: ludo's is a canvas with a dice
button beside it, and what goes wrong there is a board drawn twice or drawn once and never again;
hokm's is a hand of buttons, and what goes wrong there is a legal card that cannot be pressed, an
illegal one that can, a trump chooser offered to the wrong seat. It opens a TURN-BASED table, because
a live one sweeps a turn nobody took and a pass that pauses to read the other browser between clicks
would have its cards played for it halfway through and report a product defect.

**It checks that the table cloth and the deck really loaded**, which is the one thing no other gate
in this repository can see at all. The table's two layers and `deck.svg` can 404 leaving a
table with no felt and a hand of blank rectangles, each carrying a perfect accessible name - the
matrix reads overflow, hit targets, a landmark and the console, and a missing background image is
none of them. The only way to know is to fetch the url again from inside the page and read what came
back - every layer of it, so a table whose felt loaded and whose ornaments did not still fails; the
check answers 0 for a broken file and -1 for no such element, because a pass asking the
wrong browser at the wrong moment is a different failure from a broken build. It is asked after trump
is called, of the browser that did not call it. The pass then puts the cards face down by pressing them
(the confirm only enables at the exact count), presses Keep and Take the next card for four draws with
the offer present in the drawer's browser and absent from the other, and finishes the draw over the api
before it clicks cards.

**`backgammon-play-pass.mjs` and `poker-play-pass.mjs` are the other two games' siblings**, and share
`tools/qa/seats.mjs` - the browser, the wallet sign-in and the recorder the first two each wrote out
for themselves. Backgammon plays eight turns by pressing Roll, Double, Take and the move list, poker
eight actions through Check, Call and a raise from the slider's presets with one browser on a phone,
and both finish over the api and assert the result in both browsers. What "the other browser saw it"
means had to be the BOARD rather than the status line: after a roll it is still the roller's turn,
so the opponent's "Dana is playing" is rightly unchanged, and the first version of the pass called
that a defect.

## The table, and the cards on it

Hokm is played on `hokm-table-wide` (16:10) or `hokm-table-tall` (5:6), chosen by the SHAPE of the
fit cell (`@container fit (min-aspect-ratio: 15 / 13)`, where the wide table starts to be the larger
of the two), and dealt from `deck.svg` with `card-back.svg` for everybody else's hand.

**A table is two layers: a photograph of the object and a drawing of its ornament.** The felt, the
bevelled walnut rim, the brass inlay and the dark groove are rendered by `tools/blender/surfaces.py`
in Cycles - real geometry, so the rim casts its shadow onto the edge of the cloth - from Poly Haven's
CC0 `scuba_suede` (taken to grey and tinted baize green, with a procedural mottle and nap on top,
because a flat fill reads as plastic) and `dark_wood`. The rim is a hand-built mesh with no UV map, so
its wood is mapped in OBJECT space; mapped by UV it sampled one pixel and came out a flat orange. The
gold lines, corner flourishes and medallion stay vector in `hokm-ornaments-*.svg` from
`tools/art/boards.mjs`, laid over the render as a second background, because a thin gold line is the
one thing a photo softens and a vector keeps sharp at any size. Each render is about 25 KB, since
smooth cloth compresses well.

**Poker has a table of its own at the same standard**, because the owner asked for one: a stadium with
a padded black leather rail (Poly Haven's CC0 `brown_leather` normals under a near-black tint), a
walnut racetrack with a brass inlay and a deep emerald felt, rendered by `tools/blender/poker-table.py`
into `poker-table-{wide,tall}.webp` (1600x1000 and 1000x1250), with the betting line and a faint
four-suit medallion as vector in `poker-ornaments-*.svg` from `tools/art/poker.mjs`. It is a separate
script on purpose: `surfaces.py` renders the hokm and ludo tables, the owner does not want those
re-rendered, and the helpers both use moved to `tools/blender/lib/tables.py` unchanged. Run it with
`blender -b --factory-startup --python tools/blender/poker-table.py` (`NURA_SURFACE` picks one,
`NURA_SAMPLES` sets quality); the two numbers the SVG needs - rail, track and groove as fractions of the
short side - are written in both files and have to agree. The deck comes from `tools/art/deck.mjs`, and the suits from
`tools/art/suits.mjs`, which the game illustrations use too, so a spade on a card and a spade in the
hero art are one path.

**Two tables, not one stretched.** A phone column is taller than it is wide and a desktop one is the
other way round; a single image at `100% 100%` would squash the corner flourishes and the medallion
into ovals on one of them. Everything on the felt is placed in percent and `cqmin`, so the seats and
the trick follow whichever table is showing.

**The sheet's grid IS the card number.** A card is numbered suit-major with the ranks ascending, so
the column is `card % 13` and the row is `card / 13` and there is no packing for the client to know.
A sheet laid out to fit its pixels would be a second fact that has to agree with a constant in
`data/cards.ts`, which is the shape of mistake this file keeps recording.

**The edge and the corner radius are CSS, not drawn.** They are the two things that have to stay
crisp: a hairline baked into the sheet is a grey smudge by the time a card is 44px wide on a phone,
and a drawn corner cannot let the felt through. `.card-face` reads `--card-w` from its parent, so the
hand, the trick and the last-trick tile each size their cards by setting one variable.

**The fonts in the deck are system serifs.** An SVG used as a background image cannot load a web
font, so the indices ask for Georgia and fall back through Times to any serif. That is also why the
indices are large: they are what shows of a card overlapped in a hand.

**A playing card is a printed object and looks like itself in any light** - the face was once
`bg-field`, which made every card on the felt a hole.

**The layout follows the reference and the rules, not a generic card table.** Seats are placed by
their place round the table - bottom, then right, top and left at four; top-right and top-left at
three; top at two - and the trick lies between each seat and the centre. On a phone the order is
table, hand, then the tiles, so the cards you are holding are never below the fold; on a wide
container the tiles (trump, score, last trick) are a column beside the table. The hand fans with a
step that shrinks to fit, and breaks into two rows past thirteen, because the seventeen cards of the
three-handed game in one row on a phone is a strip too narrow to read.

**Sort is the reader's, and it moves nothing on the server.** `arrangeHand` puts trump first,
alternates the colours after it and holds each suit high to low, which is how people hold cards; the
server's order is suit-major ascending and stays what `view.hand` is.

**Each board is its own chunk.** The play page loads `hokm-board` or `match-board` through a dynamic
import once it knows which game the match is, and renders it through `<Dynamic>` with a props THUNK,
so match updates flow into the loaded board the way direct markup props would. The route chunk fell
from 17.8 KB to 9.1 KB, and a Hokm player never downloads the Ludo UI.

**And the page carries only what everybody at a table needs.** The sheet that invites a friend is
fetched when a host presses an empty chair, and the watcher's board when somebody is watching. Both
sat in the route chunk, which every player downloads to see a lobby or a board, and that chunk stood
at 14.9 of its 15 KB with a team game, a party and a second kind of call still to draw on the same
page. A sheet that could not be fetched says "That did not go through"; a board that could not is
the failure a watch already draws, and its Try again fetches the board before it asks the server
again. `play.spec.ts` opens the page as somebody watching, which no spec did - the specs' server had
no answer for a watch at all, so that page had only ever been drawn failing - and presses an empty
chair as the host.

**`table-seats.ts` puts the reader at the bottom**, whichever chair the server gave them, and it is
shared because poker and backgammon want the same table. Play passes to the RIGHT - counter-clockwise
at a real table, clockwise on a screen looking down at one - so the next seat is drawn to the reader's
right and the angle decreases. Backwards, a four-handed game still works perfectly, because partners
are opposite either way, and everybody watches the turn travel the wrong way round the table all
evening.

**A name carries `dir="auto"`.** This is the rule a chat message already follows and for the same
reason: a display name is somebody's own content and has its own direction. Without it a Latin name
inside a Persian tile is clipped at the line's end, which in an RTL line is the LEFT - so
`Bot 63848b` truncates to `...t 63848b` rather than to `Bot 638...`. Nothing overflows, nothing logs,
and the accessible name is perfect. It is fixed on the hokm board; **every other place this product
renders a display name still has it**, because nothing else passes `dir="auto"` to a name.

## One stage, never a scroll

The owner's rule, in their words: nobody scrolls during a game - not down for the cards and back up
for the table. So every board is one **stage** that never scrolls, and `tools/qa/fit-pass.mjs` fails
the moment anything a player needs is below the fold.

- `.table-stage` is a size container named `stage`, filling what the play page leaves under its
  header (`<Page fill class="page-table">`, overflow hidden while a stage exists). Inside it
  `.table-grid` has four areas - `top`, `fit`, `hand`, `bar` - because a container query cannot
  restyle the container itself, only what is inside it.
- `.table-fit` is a size container named `fit`, and `.table-surface` inside it is
  `min(100cqw, 100cqh * var(--ratio))` wide - the board is sized from BOTH axes of the room it has, so
  a tall phone and a short laptop each get the largest board that fits. A game that has two drawings
  of its table picks one by the fit cell's aspect, not by the screen's.
- A wide stage (`@container stage (min-width: 44rem) and (min-aspect-ratio: 3 / 2)`) puts the bar in
  a side column; backgammon and ludo put the whole side column beside the board instead.
- `TablePlate` is the one seat plate for all four games: avatar with the speaking ring and a turn ring
  that runs from `remainingMs` over the turn's full length, a marker (crown, dealer, checker colour,
  seat initial), the game's facts, a one-line tag for what is unusual (`plate-tag.ts`), a trailing
  slot (the ludo die) and the chat bubble. The turn length is `turnMs(mode)` and the miss rule is
  `nextMissForfeits(timeouts)` over `MISSES_ALLOWED`, all from `backend/src/domains/match/turns.ts`, a
  zero-import module: the server's deadline reads `turnMs` and the sweep's forfeit asks
  `nextMissForfeits`, and so do the browser's ring and its last-chance tag (`plate-tag.ts`, the ludo
  `YardBadge`). The COMPARISON is shared, not just the number - three copies of `>=` over one constant
  would leave the warning a miss early the day the sweep's own comparison moved - and
  `table-plate.spec.ts` and `ludo-table.spec.ts` move the rule under both tags and require them to
  follow. A watcher is sent no `remainingMs`, so a watcher sees no ring, and no `timeouts` while the
  game is live, so no plate of theirs says a turn was missed.
- Hokm decides one row of cards or two from the stage's measured size (`room`), because two rows are
  only worth their height when one row would squeeze each card below a readable strip.
- `MatchResult` overlays the stage rather than pushing it down.
- Poker's raise is a toggle that opens the slider over the table, so the bar is one row of actions;
  the last hand is a `<details>` chip on the felt, which keeps a spectator's page free of buttons.
- A poker plate is centred on the rail, at 10% and 90% of the table's height, and is CLAMPED onto the
  table (`.poker-seat`, a `translate` over the table's own `cqw`/`cqh`), because a plate with its avatar
  and a tag is 93px: on a 266px table - a phone held sideways, reader folded - it hung 20px past the
  edge. On a table 20rem tall or less the avatar goes, as it already did under 22rem wide.
- **A bet is a child of its own seat and is placed by measurement.** The clamp alone moved the plate
  over the chip at half the radius: an all-in reader's 1,500 hid under their own plate on a short
  table, and so did a tagged top seat's. Fixed CSS geometry could not promise clearance at every
  size - six plates, six chips, five cards and the pot on a 320x200 table leave pixels, not margins -
  so `seatBets` (`game/chip-spot.ts`, pure) tries the twelve spots beside each plate (each side; centred,
  then flush with either end), keeps those on the table, and takes the one that touches nothing, nearest
  the pot. The most constrained bet is seated first, and a plate weighs a thousand times anything else,
  so a table too crowded for a clean answer overlaps two bets before it lets a plate cover one. The
  board re-seats on every view change and on a resize, in a frame; before that the CSS default puts the
  chip on the plate's side facing the pot (`--ux`/`--uy`, from the seat's place and the table's own
  `--ratio`).

**The gate is `tools/qa/fit-pass.mjs`.** It opens a live hokm-2, hokm-2-draw, hokm-4, poker-2, poker-6,
backgammon and ludo-4 table over the api (dana.w plus guests), advances each to a state with the most
controls (hokm-2 through the draw to the opening lead, hokm-2-draw to the Hâkem's last offer), seats
every player at a parked ludo table that never starts, so every page carries the other-tables row -
the tallest header a seated player gets; while only dana had other tables, a cell passed or failed on
whether the opening roll or the Hâkem draw put her on turn. Three poker cells exist for the plates:
poker-6-folded opens each page as a seat that has folded (no hole cards, so no hand row, so the
tallest table and the biggest plates), poker-6-allin as a seat that has shoved (a tag and a 1,500
bet in front of the reader), and poker-2-facing as the seat facing a shove (a tagged top seat with
the big bet), and poker-6-crowd as the seat to act after a limp and three all-ins over the blinds - six
chips round a pot of three shoves, the most a table carries. Two hokm cells have a trick on the felt:
hokm-2-follow opens as the dealer facing the Hâkem's lead, the card the reader has to follow, and
hokm-4-trick as the seat to play to three cards and as the leader watching them. hokm-3 is the one
table with no dana and nobody parked: three guests, named long enough to fill a plate and to wrap the
caption's last line in both languages, opened as the seat whose turn it is and as one waiting on it.
Three hands put two plates in the felt's top corners under the longest sentence the caption has, and
there the TALLER stage is the worse one: a waiting reader with no other table is drawn the upright
table at 360x640 and 375x667, 324 to 329px tall, where the caption's crown reached both plates, while
the other-tables row leaves those screens only the wide table, whose crest has gone. ludo-4-teams is
ludo opened two against two: its plates sit beside the board and not on a felt, so the cell asks of
every plate on the page what a felt asks of its own, a side mark that is drawn, inside the screen
and clear of every other plate, and it carries the "Partner" tag the plain game never has. Each
re-makes its state per cell, because a live turn lasts thirty seconds. It opens every page as the seat whose turn
it is at 360x740, 390x844, 375x667, 360x640, 768x1024, 1024x768, 1280x720, 1280x800, 1440x900,
1920x1080, 740x360 and 844x390, with the chat closed and open, then as a stranger watching. It fails
on a scrolling page, a plate, the surface or any button outside the viewport, a button whose centre
hits something else, a surface under its game's usable size (`USABLE`, by short and long side), a
plate on the table that reaches past its edge, a felt chip on a plate, a bet chip whose centre hits
anything but itself, a bet chip that meets a plate, another chip, the cards, the pot or the felt's own
chips and their tap areas, a trick card that meets a plate, a pile of backs or another trick card or
whose centre or either index corner hits anything but the card, and an open bottom sheet whose top
edge is above the bottom of the board's fit cell. On a hokm felt with nothing on it, it also fails on
a line of the caption that meets a plate, a pile of backs or the stock, and on a caption that does
not say what takes the hand. Three exceptions are deliberate: a button in a
horizontally scrolling rail is judged by its rail; the open chat may overlay the bar on a phone held
sideways, and on an upright phone too short for the board and the chat together (`data-sheet="over"`),
because there the chat has nowhere else to be and closing it brings the controls back - never
anything inside the fit cell, which is the board; and the reader's own open raise slider may cover a
chip, because it is an overlay they opened. Two things keep a live game from failing a cell for the
wrong reason: a cell whose game ended while it was measured - a poker seat nobody plays is forfeited
after three thirty-second turns - is measured again on a fresh deal, up to three deals, and only the
last is recorded; and every table is left as soon as its cells are done, the reader first, so a
result line from a game the pass has finished with never puts a toast over a later cell. It removes
`#azeroth-devtools` first, which only exists under vite. `--only`, `--sizes`, `--shots` and `--keep`
narrow a run; every run writes its screenshots to a folder of its own under `out/fit`, because
Windows refuses to overwrite a PNG something else still has open. `npm run qa` reports `scroll` and
`fold` on any page with a stage too, and tours a hokm table as well now.

## The game screen gives the table everything

A game is the one screen in this product somebody looks at for twenty minutes without scrolling, so
the rule for it is the opposite of every other page: the chrome gets out of the way and the table
takes what is left. Each of these was a defect found by playing on a phone, and none of them was
visible to a gate - the matrix passes a board that needs scrolling to reach its own dice.

**The shell steps back on an `immersive` route.** At sidebar width the 15rem sidebar collapses to
the 4.5rem rail, which is 170px handed to the table; on a phone, and on ANY screen 540px tall or
less, `bareFor` drops the top bar and the nav as well. The second half matters because a phone
turned sideways is 844 wide, which is rail posture, and the top bar plus the rail took 130px of a
390px-tall screen. The keys banner is not drawn on a game route either: it is about reading
messages, and the table's chat already says the same thing where it applies.

**Everything needed to play is on the table, and most of it is on the board.** Ludo sits on a
real wooden tabletop: `ludo-table.webp` is rendered by `tools/blender/surfaces.py` in Cycles from
Poly Haven's CC0 `wood_table_001`, lit evenly from off-axis, with the specular turned down because an
orthographic camera looking straight down sees every overhead lamp as a white disc. The lamp pool and
the vignette are CSS gradients over it, because the photo is cover-cropped to a phone's tall table
and a desktop's wide one and a baked pool would sit in the wrong place on both. A felt table like
hokm's was tried here and taken back the same day: the user liked this tabletop and wanted the BOARD
on it improved, which is a different thing.
Each player is drawn INSIDE their own yard - `YardBadge`: the avatar in the
yard's outer corner, a name pill with the four home dots along its outer edge, and the die they rolled
beside the avatar - so there is no row of cards above and below the board taking height from it, and
the board is the full width of the phone. Whose turn it is is the whole yard breathing in its colour.
The badges are `pointer-events: none`, so a tap on a token in the yard goes through to the token.

The roll is a die in the MIDDLE of the board, a real `<button>` named "Roll the dice", shown only
when the reader can roll: tap it, it shakes while the request is in flight, and it is gone; the tokens
that can move then glow and a tap on one moves it. The strip on the table under the board carries the
turn, the clock, a one-line hint ("Tap the die in the middle of the board.") and the move choices,
which are the keyboard and screen-reader path to the same moves. On a 390x844 phone the roll used to be
100px below the fold; now nothing scrolls. The table bleeds almost to the screen edge on a phone
(`margin-inline` against `--page-pad`), and hokm's table does the same.

Everything on the board is placed from `game/layout.ts`: the board stage sets `--cell-cq` and
`--margin-cq` in `cqi` from `CELL` and `MARGIN`, so a badge sits in its yard at every size for the
same reason the tokens do, and scales with the board rather than with the screen.

**The dock is in the header.** Sound, full screen, give up and the chat are icon buttons at the right
of the title, and the table code is a copy chip in the subline - the same pattern a native game uses,
and it frees the bottom of the screen, which is where the thumb is. Giving up asks first
(`match.resign.*`, which had copy and no caller): it used to be a bare ghost button that ended the
game on one tap.

**A rotated phone gets a real landscape layout.** Every stage puts its bar in a column beside the
table under `@media (orientation: landscape) and (max-height: 540px) and (min-aspect-ratio: 4/3)`, the
same threshold as `bareFor`, and `device.landscape()` asks the same 4:3. "Wider than tall" alone is not
landscape: 375x360 is wider than tall, and two columns there need a 228px board, a gap and a 13rem
strip - 452px on a 375px screen, eight overflowing matrix cells. A near-square window is laid out
upright, which is also what it looks like.

**Ludo is played upright, and landscape is its safety net rather than its layout.** The board is
square, so turning a phone sideways only makes it smaller - 258px against 360px upright on the same
phone. A browser cannot stop a phone rotating, so the landscape layout stays and fits the screen, and
it says so: "Ludo plays best upright" in the strip. Full screen from a ludo table also asks
`screen.orientation.lock('portrait')`, which Android grants in full screen and everything else
refuses quietly. Hokm keeps a real landscape layout, because a card table is wide.

**The felt carries the two numbers somebody glances at.** The trump, the round and the score are two
chips in the felt's top corners at every size, and the last trick is a tile in its bottom-left; the
full sentences they abbreviate are the `.hokm-side` summary, which is screen-reader only. On a stage
24rem tall or less - a phone sideways, or upright with the chat open - the chips, the centre caption and
the last trick would sit on top of the plates, so they leave the felt and the chips move into the bar.
One line of the caption stays: what takes the hand, which the bar has no room to say. A chip for it
there was tried first and cost the bar a third row at 360 wide, where the clock alone is 123px - 32px
that at 360x740 pushed the bottom of the bar under the open chat. The caption is as wide as its words,
up to the medallion's width or nine rem, and never wider than the room between the two side plates
(`93cqw - 2 * --side-w - 1rem`), so no line of it can sit on one; and a table 17.5rem tall or less -
where the plates have already given up their piles - drops the caption's crown and name, which pays
for the line where the room is shortest.
Three hands pay sooner on the upright table. Their two top plates hang 17% down in the corners and all
but meet over the middle - 44% of the width each, 13px apart at 360x640 - and the whole caption with
its last line wrapped is 141px, which centred on the felt reaches them on any table under 342px and
wedges its crown between the two. So an upright three-handed table 21.5rem tall or less drops the
crown and the name as well, and one 19rem or less the piles under those two plates too, because the
lines that are left sit 22px higher and the widest of them would reach a pile under 298px. The wide
table keeps both - its corner plates stop well short of the middle, and at 1024x768 it is 343px tall
with its crest clear.
A narrow table does the same for the chips alone: upright at 360x740 the tall table is 289px wide under
a 127px top plate, and both chips sat 16px under it. The board measures it rather than guessing a
width - a chip touching a plate or a pile sets `data-felt="cramped"` on the stage, the chips go
`visibility: hidden` (so they keep their box and the next measurement is of the same layout) and the
bar shows the trump and the score. It is only ever re-judged from scratch when the stage changes size;
otherwise it can turn on and never off, so the bar cannot grow a chip, shrink the table and bounce.

**The table's chat floats, and the board keeps the width.** It used to be a full-height column docked
beside the game, and the owner called the whole thing ugly: a third of the screen for a thread that
is quiet most of a game, reading as a second app. The spec is
`docs/superpowers/specs/2026-09-23-play-screen-chat-design.md`. At sidebar width, and on any screen
turned sideways (landscape at rail width, or any landscape 540px tall or less), it is a card
anchored to the bottom-right corner, 23rem by at most 34rem, 30rem and the full height on "bigger";
closed, it is a pill in the HEADER beside the dock with the unread count and the last line said - it
used to be fixed in the bottom-right corner, which is exactly where a wide stage puts its bar. It starts
closed - `settings.railOpen` keeps its old name and now means "the card is open" - and whenever it is
open the table makes room for it, so it never covers the board or the bottom-right player's plate.
Everywhere else - a phone held upright, and an upright tablet - it is the bottom sheet, half the
screen first and the whole screen on request.

**The half sheet yields to the board; the board does not shrink to fit the sheet.** At a fixed 48dvh
the stage at 360x740 was 261px, backgammon's board was drawn 47x39 and hokm-4's table 79x49 - and a
gate that accepted anything over a pixel passed both. Now every board declares its floor as
`--fit-min` on its `.table-fit` (a registered `<length>`, so it reads back in px), and
`lib/sheet-room.ts` measures the fit cell by a `ResizeObserver` in a frame and writes two lengths on
the row. `--sheet` is the ROOM, `clamp(0, sheet + fit - floor, max(48dvh, the chat's floor))`, and the
arena's bottom padding reads it, so the board never goes under its floor for the chat's sake.
`--sheet-h` is the sheet's own height: the room, or the chat's floor where that is taller - its
header, its notice, its composer and one line of the thread (`chatNeeds().least`). Within one open
the room only ever gets smaller - a sheet that grew back whenever the bar got shorter would bob the
composer up and down every turn - and it starts again from 48dvh when the screen's height changes.

**When the screen cannot hold both, the board wins and the chat lies over the bar.** It took the whole
screen under the header for a while (`data-sheet="full"`), which at 360x740 - one of the commonest
phones there is - hid every board the moment a guest, whose unsealed notice is four lines, opened the
chat, and its gate skipped every board check because nothing was visible. Now the sheet is taller than
its room (`data-sheet="over"`) and covers the bottom of the bar - the hint, the clock, at worst the
hand - while the board above it stays whole at its floor, and closing the chat brings the controls
back, as on a phone held sideways. It never reaches above the fit cell: past that the notice gives up
its height first (`data-yield` on its wrapper, a `min-h-12` scroller that keeps its first line), so
the floor it can shrink to is the header, the composer, the first line of the notice and the thread's
inset (`chatNeeds().bare`), and only a chat that cannot keep even that reaches over the board, because
a composer cut in half is worse than a board short of a few pixels. Shrinking the sheet under its
floor without the notice yielding was refused: the composer went off the bottom of the screen.

The floors are the boards' own needs, and `fit-pass.mjs` holds the surface to each (`USABLE`):
backgammon 16rem wide, where the two 1.75rem dice still clear the point tips (124 of the 820 viewBox
units) and a checker is 15.7px across - the move list is the 44px path, because a point column is
17px wide on any phone; ludo 13rem, where the roll die in the middle (3.2 cells) is still a 44px
target, in a 20rem fit cell with its plates; hokm a 13rem fit cell for a table of 12rem by 18rem,
the height four trick cards at their 2.6rem minimum need clear of the top plate and the bottom one
(`--top-room`, `--band` and `--trick-w` on the table, with the piles of backs and the avatars gone
under 17.5rem); poker 12.5rem by 20rem, five 1.6rem cards and the pot with six compact plates round
them. Poker's tall table is drawn only in a fit cell at least 19.5rem tall, its own usable height
(`or (max-height: 19.5rem)` beside the 9:8 aspect test): at 360x640 an all-in reader's 328x295 cell is
just under 9:8, and drew a 236x295 tall table where the wide one is 328x205.

**While the half sheet is open the table takes its short layout explicitly** (`data-sheet`, `half`
or `over`, on the arena), the same rules a stage 24rem tall gets: hokm's trump and score leave the felt for the bar
and its caption keeps only the line that says what takes the hand,
poker's blinds chip and cost line go, backgammon's match line and pick hint go and its two plates share
one row above the board, and every board's coach line goes - a 44px note on a touch screen, and the
difference between hokm-2's opening lead and ludo's first roll keeping their floors at 360x740 or
not. It used to get the short layout for free, because the 48dvh sheet made the stage that short; a
sheet that yields leaves the stage taller than 24rem with the table at its floor, and hokm's felt chips
sat on its plates. Closing the chat brings all of it back.

**And the other tables fold into the title row** (`PlayHeader`'s `compact`): only the ones waiting on
the reader, each a 44px game icon with a live dot and its name, code and "Your go" as its accessible
text, with the hidden count beside them. Their own row was 52px of a phone the sheet now shares.
Hiding the row outright, as the first attempt did, took the "your turn at another table" signal and
the spoken count with it. With nothing waiting nothing is drawn; closing the sheet brings the row back.
The chat need not be open: at 360x640 the row alone put backgammon's board at 236x193 and a folded
poker reader's at 236x295, under both floors, so `watchFold` folds it whenever the fit cell is under
its floor with the sheet closed, and unfolds it only when the screen's height changes - folding grows
the board, so a fold re-judged on every layout would fold and unfold forever.

The rule is about which way the SPARE ROOM runs, not about width. It used to float the card at
every width above a phone and make room only at sidebar width, so a phone turned sideways (844x390,
which is rail posture) opened a 23rem card straight over the board, and an upright tablet did the
same over the bottom of the board. A board is sized by the screen's height in landscape, which
leaves room beside it, and by its width upright, which leaves room below it - so the card goes where
the room is. `play.spec.ts` holds both shapes.

**One chat instance, never unmounted while the table is open.** The card and the sheet are the same
`TableChat` in one container whose classes change with the posture and which is `hidden` when closed.
That keeps the thread open, which is what makes the unread count, the pill's preview and the speech
bubbles work while nobody is looking at the chat, and reopening it lands where the reader left it.

**A line appears as a speech bubble over the speaker's plate** for 4.5 seconds, on every screen size -
the only way a message reaches somebody watching the board. The page keeps the bubbles in a plain
map and publishes a version stamp rather than writing `speech` from itself, which the
`self-write-in-effect` rule refuses; the first batch of a thread is recorded as heard once it has
loaded, so opening a table does not replay the history as bubbles.

**Things a finger can actually hit.** A tap on the Ludo canvas picks the nearest MOVABLE token within
1.25 squares of it (`pickNear` in `game/layout.ts`), measured to the pawn's body rather than its foot,
because a pawn on a phone is 17px across and nobody taps a sprite that exactly. On a coarse pointer a
hokm card is lifted by the first tap and played by the second, or by the "Play the ..." button that
appears - a hand of thirteen shows each card as a 26px strip, and one mistap used to throw the wrong
card. A mouse still plays on the first click, because hover already lifts the card.

**A badge says only what is unusual.** "Your go" and "Waiting" are what the breathing yard and the
strip already say, and beside four home dots they truncated to "Your...". They are `sr-only`; won,
out, lost, missed turns and last chance are still written out, because those are what somebody needs
to read at a glance.

**A page that failed while the server was away heals itself.** Every connection rings every scope
once, the first one included, and the lobby and the match re-read then. A deploy, a
restart or a dropped train connection used to leave "Couldn't load this" on screen until somebody
pressed Try again - found by restarting the built server with a game open. The play page also stopped
drawing its skeleton and its error at the same time: the error waits until nothing is loading.

**No error is `null`, not `undefined`.** A resource's `error()` is null until a fetch fails. The play
page and the group page both asked `!== undefined`, which is true of null, so a table or a group
that is simply not there - the answer both stores go out of their way to give as `null` - was drawn
as "Couldn't load this" with a Try again that could only fail the same way, and the group page drew
that sentence over its own skeleton on every visit until the group arrived. Each store's spec held
its half ("an answer, not a failure") and no spec mounted either page in that state;
`play.spec.ts` and `groups.spec.ts` do now.

## Helpers at the table

`docs/superpowers/specs/2026-09-24-game-helpers-design.md` is the design. Three helpers, each a device
preference that is on by default and can be switched off on the settings page or from the table menu
without leaving the game: `hintMoves` lights up what can move, `hintOutcome` says what a move does
before it is made, and `hintRules` is the rules coach - one line, `CoachLine`, under the status.

**Every helper is the SERVER's rules asked a question.** `game/helpers/<game>.ts` is pure, imports
nothing from AzerothJS, and computes from the same modules the engine runs - ludo's board, hokm's
`trickWinner`, backgammon's `stage`, poker's evaluator - because a second copy of a rule in the
browser agrees with the server right up until the position where it matters. Each spec plays whole
games through the real engine and fails on any sentence the engine would contradict. `coachOf`
answers null when nothing is worth saying: a tip that is always there is one nobody reads.

**Turning a helper off never removes a way to play.** The move lists beside every board are the
keyboard and screen-reader path, and they stay whatever `hintMoves` says; what goes is the lighting
on the board. Hokm's hand says why a card is dimmed with the follow line, which stays when the coach
is off and gives way to the coach's own words when it is on, so it is never said twice.

**A poker hand is named by its ranks**: "a pair of kings", "sevens full of twos", and "you are playing
the board" when the five shared cards alone make the hand, because "a pair" is true of a pair that is
nobody's. `namedHand` reads the ranks out of the evaluator's own score, whose digits after the
category are the ranks in the order that decides a tie.

## The game page splits on its container

`lg:grid-cols-[minmax(0,1fr)_22rem]` fires at 1024px of SCREEN, and that column is nothing like the
screen: with the social panel open at 1280 the grid has 660px to divide, the 22rem aside takes 352 of
it, and everything on the left was laid out in 284px - three-word rule cards and a leaderboard whose
names all ended in an ellipsis. It is `@4xl:` now, for the same reason the people and group grids are
container variants. Nothing measured it: the matrix fails on overflow, hit targets, a landmark and
the console, and a column of truncated text is none of those.

## What a game leaves behind

The profile got its numbers back, and the difference from the ones that were deleted is the whole
point: every figure now moves because a match this server arbitrated ended. `player_stats` is one
row per person per game holding the rating, the peak, played, won, abandoned, the streak and the
tallies; `user_achievements` is who has earned what. Both are written inside the transaction that
finishes the match, because a match that is over and a record that has not moved are two rows
disagreeing about the same game.

The table was called `game_ratings` while `rating` was the only thing in it. Played, won, captures
and a streak are not ratings.

**One forfeit and rating rule for all four games, in one pure file.** Each engine used to decide for
itself whether a forfeit was rated - backgammon and heads-up poker after two actions each (counting
the turns the SWEEP played for an absent seat), poker at three seats whenever anybody resigned, hokm
and ludo never - so the same walkout cost a different amount at every table, a trailing player could
stop and be timed out to dodge a loss, and four-handed partners were rated against each other.
`judge.ts` imports only `rating.ts` and decides from facts:

- **Facts per seat.** `side` (the engine's `sideOf`; teams in four-handed hokm and in ludo two
  against two), `place` (`standings`, competition-ranked), `quitter` (a forfeit row in the ledger; it
  WALKED if the row names a person, was timed out if it is null, and its `rev` is the exit order),
  `own` (the seat's play rows that name a person and carry one of the engine's `engagement` verbs -
  the sweep writes `user_id = null`, so autoplay never counts), `unsettled` (hokm and ludo: everybody
  still at the table when a forfeit stopped it) and `trailing` (the same two: those of them whose
  side was behind a side still in play).
- **A quitter always takes a rated loss**, below everybody still playing when they left, a later
  leaver above an earlier one. That includes a TIMEOUT, or waiting out the clock would dodge the loss.
  A quitter is never rated against a seat that had quit BEFORE it: the first cut rated it against
  everybody, so the last of three to walk out of a four-seat ludo table beat the two who went first
  and moved from 1200 to 1205 without a decision, and a main account could climb by leaving after its
  alts. The earlier quitter is still rated against the later one, as the loss it is.
- **Only a seat that is paid earns XP** (`paid` on the verdict; `levels.ts` only prices it). A
  walkout and a `void` seat are never paid. A TIMED-OUT seat is paid only if it had played its share
  (the `engagement` below) before the clock took it, because missing three turns after playing is a
  dropped connection, while sitting down and letting the sweep play three turns is not playing - and
  its tally would have been the moves the SWEEP made for it.
- **Everybody else is rated against a quitter only if they and the quitter are both ENGAGED** - own
  decisions at least `engagement(format).after`: ludo 6 rolls, backgammon 4 moves or cube actions,
  hokm seven cards played at every player count, poker 3 betting actions with the blinds
  excluded - and only if the survivor was not `trailing`. Against a side with no quitter a seat is
  always rated, unless both are unsettled; then it is rated only when it is `trailing` and a member of
  its own side WALKED (the four-handed partner above).
- **A forfeit win pays the rating and the finish (D26).** A match whose LAST ledger row is a forfeit
  ended because the last opponent quit, and that is the fact the recorder hands the judge as
  `forfeited` (`unsettled` would only say so for hokm and ludo). Its winner's rating moves and the verdict pays
  `finish` - the 10 XP and no engine bonus - with `credit` false: no win bonus, no `won` count and no
  `played` count either (a win that lowered the winner's win rate would read as a punishment), the
  streak kept rather than extended, and `achieve/service.ts` asks the same question of the ledger
  (`PLAYED_OUT`) so the match climbs no win rung and gives no hosted credit. A game that goes on after
  a quitter and is then played out - poker at three or more - ends on a play and pays a full win.
  Every other seat paid in a match a forfeit ended is paid the same `finish` and no more - the partner
  sharing a loss, a timed-out quitter that had played its share - so nobody earns more from a forfeit
  than its winner does.
- **A seat with no counted pair is `void`**: no rating move, no XP, nothing written to
  `player_stats`, streak untouched, no achievements. A seat that beat every side it was counted
  against is `won`, a quitter is `abandoned`, anybody else `lost`. The match is `won` if anybody won,
  and `winner_seat` is the engine's first winner if they won, else the lowest seat that did.

Being the last one left in an empty room is therefore no contest rather than a win, which is the
rating farm `outcomeOf` used to close: three accounts sit down, two leave at once, and the third gets
nothing, while the two who left are each charged a loss. `judge.spec.ts` holds one test per case,
`record.db.spec.ts` holds it against a real Postgres over a hand-written ledger, and
`backgammon.db.spec.ts` plays real moves and sweeps through the match service, so the engagement
count is read off the rows the service actually writes.

**A rating is Elo over SIDES.** Two players is ordinary Elo; three and four score every pair of sides
and average over the sides counted, so beating a strong field is worth more than beating a weak one
and the answer does not depend on how the seats were numbered. A side is rated as one player at its
members' MEAN rating and every member moves by the same amount, so four-handed partners are never
scored against each other (HOKM-02: they used to be, as a draw, which moved a strong partner down for
sitting beside a weak one); equal teams move ±16 each. `rateField(standings, counts)` takes a mask of
which (seat, side) pairs count, and a seat with none gets no move. Ludo only ever declares a first, so
`placementsOf` reads the rest off the board - tokens home, then distance travelled - and anybody who
forfeited is last whatever their position says, or walking out while ahead would be a placement
somebody earned by leaving; `engine-contract.spec.ts` holds every engine to competition ranking, to
partners sharing a place and to every forfeiter placed below every seat still playing when it left.
K is 32 and the result is clamped to what the column takes, because a write Postgres refuses after a
match has finished strands the match rather than the rating.

**A peak is the highest rating somebody has ever HELD**, which includes the 1200 they started at.
Taking it from the new rating alone recorded a personal best of 1184 for a player who had never been
below 1200 in their life.

**Five thousand achievements, and every one of them is a threshold over something a finished match
records.** A thousand per game and a thousand across every game, because the owner asked for them -
and a thousand invented sentences would break the rule every unproduced tile here was deleted for.
So they are LADDERS: `achieve/families.ts` declares families (played, won, XP, peak rating, best
streak, distinct days, played and won at each seat count and each pace, and each engine's tallies;
across games, the same plus level, tables hosted to the end, distinct opponents, wins at four or more,
turn-based, live and two-player wins), and `ladders.ts` turns each into steps - one by one to twenty,
then by round numbers - so a scope sums to exactly 1,000 and `ladders.spec.ts` holds the count. A
family that could never be climbed at a game is not generated for it: no four-player backgammon, no
turn-based poker, and the spec compares every seat count and pace against the game's seed. Tiers
follow position in a ladder - bronze, silver, gold, platinum, diamond - and `.medal` has all five
metals. An id is `<game|all>-<family>-<step>`, stable while a ladder only grows at the end.

**The seventeen hand-written achievements are gone, and so is `first-seat`.** Each of the rest is a
rung now (a first win is `won 1`), and "sat down at a table" had nothing to count once a seat is
taken and left - and it was the only thing awarded outside a finish, so the table service no longer
knows achievements exist. Friends and groups are not counted either: a public record that published
how many friends somebody has would be a second copy of the social graph, the thing E2EE already
cannot hide.

**The definitions are GENERATED, and the table exists for the foreign key.** `seed-reference.ts`
upserts all five thousand in one `insert ... select unnest(...)` per boot and deletes any id no
longer generated, because reference content that can only be added to is how a database ends up
holding a tile nobody remembers writing. Everything a read needs - scope, family, step, need - comes
from the same generated list in memory rather than from columns that could disagree with it. Names
and blurbs are stored as text in both languages, and `achievements_translated` refuses a blank one:
a half-translated medal would put an English sentence inside a Persian page.

**Awarding re-evaluates everything and lets the primary key dedupe.** At a finish, `record` reads the
facts for the game that ended and for everywhere, works out every rung they reach, and inserts them
with `on conflict do nothing`. It answers what the record deserves rather than what has changed, so a
retried action, a replayed idempotency key and a reconnect converge on the same rows. Every fact only
grows, so what is held and what the facts reach agree between finishes, and a family's bar cannot say
full while its next rung says locked.

**Four facts are questions rather than counters.** Played and won by seat count and pace, distinct
days, distinct opponents and tables hosted to the end are asked of `match_players`, `matches` and
`tables` at the finish - once per game - through QueryBuilders; `grouping sets ((m.game), ())`
answers each game's days and everywhere's in one read. A `distinct days` column would be a number that
has to be right on every write forever; this is right by construction every time it is asked.

**Five thousand tiles is not a page, so the wire speaks FAMILIES.** A person's record carries each
scope's earned and total, each family's counter, rungs earned, top tier and next rung, and the twelve
most recent medals; `GET /social/people/:handle/achievements/:family?game=` is one family's whole
ladder, fetched when its card is opened. The profile shows the recent medals and a chip per scope
over the family cards; a game page shows that game's families and nothing else.

**Every rung has a rarity, and beside it how many players really hold it.** Rarity is fixed by the
rung's place in its ladder - the first 60% `normal`, the next 30% `rare`, the last 10% `legendary`,
so a ladder's top rung is always legendary and rarity never falls as a ladder climbs. It lives in
`achieve/rarity.ts`, a zero-import module the wire schema reads too: `RARITY_IDS` is the order and
`RARITY_SHARE` the cut, so a new rarity is one id and one share. Like scope and step it comes from the
generated list in memory, so it has no column and needs no rebuild. The SHARE is live: `holders` on a
rung and on a recent medal is the fraction of players (anybody with a `player_stats` row) who hold it,
counted per request for the ids on screen. The tile shows both - "Rare - 12% of players have it".

**A RECORD is anybody's to read and a HISTORY is your own.** The aggregate is what a profile has
always shown. A list of the games somebody sat at, with who else was there and when, is a
description of their week - the social graph is already the thing E2EE cannot hide, and this would
be a second copy of it that anybody could read. `GET /matches/history` takes no handle at all and
pages by keyset over `(finished_at, id)`, like chat history and for the same reason.

**A history row is what its two screens draw.** The game, when it finished, the reader's own `result`
with the rating pair when the game counted for them, and who played, by handle in seat order. It
carried the match's `outcome` and its seat count as well, and neither home's recent games nor the
profile's Games tab read either: how it went for the reader is their `result`, which is also the only
place `void` is said. Both are gone from the schema, the query and the row. `match.db.spec.ts` (*the
games somebody has finished*) runs that query against Postgres, which no test did, and
`reference-parity.spec.ts` parses a row carrying both and expects neither back.

**The live counts are counted.** `catalogue.store.ts` drifted "627 people at the tables" on a seeded
RNG, and the rule written beside it was that it goes the moment the server answers with real counts.
`GET /catalogue/live` counts SEATED PEOPLE at open public tables, LEFT JOINed from `games` so a quiet
game comes back as a zero rather than as a missing row. `waitSeconds` went with it and is not coming
back as a zero either: nothing measures how long somebody waits for a chair, because matchmaking is
a query over open tables rather than a queue with a length.

**A finished match stays on screen, and the test for that is which TABLE it belongs to.**
`tables.match_id` is the LIVE one, so it clears the instant somebody wins - and closing the board on
that dropped the winner straight back to a lobby with a Start button at the exact moment the game had
something to say. Asking "has it finished?" instead does not work either: the table's refetch and the
match's are two reads that learn about the end separately, so there is a window where the table has
dropped the id and the match view is still the one from before the final move. Belonging to this
table is true throughout.

**The rematch is asked for, not started.** A finish leaves every seat where it was and every chair
unready, so Play again is `lobby.again`: this seat says ready, and the start is sent only when that
was the last chair owed. The result panel then walks
Play again, "Waiting for {names}" while anybody else has not said so, and Start once everybody has
and no game began (a start that was dropped on the way), and it says a chair is free when somebody
left. `rematchOf` in `boards.ts` reads all of that off the table's chairs and trusts none of it while
the table still names the finished match as live, because that readiness is from before the finish.
`match-result.spec.ts` walks the states and `play.spec.ts` presses the button through the page.

**The panel says what the judge decided and nothing it did not.** It used to read every match nobody
won as "The table emptied" and "Nobody won this one, so no rating moved", which stopped being true the
moment a quitter's loss became rated. A match with no winner now reads "Ended too early to count" and
"It counts only against whoever stopped playing"; a seat whose own result is `void` in a match
somebody else won is told "This one did not count for you"; and a void seat's row, plate tag and yard
badge say "No contest" with no rating swing, in English and Persian.

## Levels, and a board a new player can reach

`domains/match/levels.ts` is pure and import-free, like `ludo/` and for the same reasons: it runs in
the default `npm test` with no Postgres, the same numbers can later be shown in the browser without
dragging a decorator into the web program, and a level is reproducible from a total rather than
being a counter somebody incremented.

**XP is for PLAYING and a level is a trophy.** It unlocks nothing, gates nothing and buys nothing,
because this product has no inventory, no balance and nothing that grants one — a level that
promised any of those would be the same class of claim as `game_rules.fairness` and the invented win
rates, both deleted for being decoration with no mechanism behind them. The copy on the bar says so
in as many words rather than leaving it to be inferred.

Finishing is 10, winning is 25 more, a capture is 2 and a token home is 3, and every one of those is
countable from `match_actions` — which is already an append-only record of what happened, so nothing
new is written to produce them. **A walkout earns nothing at all**, not even the captures it made on
the way: otherwise leaving a game you are losing banks the good half of it, which is the hole the
judge closes for the rating from the other side. A seat timed out of the game after playing its share
keeps the finish and its bonus, one timed out before that earns nothing, and a `void` seat earns
nothing, because nothing about that game is written for it. Whether a seat is paid at all is the
judge's `paid` - `full`, `finish` (the 10 alone, for a win the last opponent's forfeit handed over)
or `none`; `xpFor` only says how much.

A level costs `100 + 50 * (n - 1)`, so the total to reach level n is a quadratic in n and `levelOf`
is its positive root floored rather than a loop — a very large total costs what a small one does.
`levels.spec.ts` walks sixty thresholds and asserts each one lands exactly, because an off-by-one in
a root shows only at the boundary.

**`match_players.xp` is what makes a WINDOW possible.** `player_stats.xp` is the running total and
answers "who has the most" perfectly well; what a running total cannot answer is "who earned the most
this month", because it has no dates in it. The per-seat column does, through `matches.finished_at`,
and it is written on every finish rather than only when a rating moved — the two shared a branch for
one commit and every abandoned match recorded nothing, which made the windowed board quietly blind to
a whole class of game. A `void` row is written too (xp 0, no rating pair) and counted by NOTHING:
`FINISHED` in `achieve/service.ts` and the windowed board both read `result in ('won', 'lost',
'abandoned')`, so a game that did not count for somebody is neither a game played nor a game won.

**An account's XP is the SUM of its per-game rows and is never stored.** A stored account total is a
second copy of a derivable fact, which is the mistake `tables.status` exists to avoid; six rows
summed on a profile read is not a cost worth a second source of truth.

**Four windows — today, this month, this year, all time — because one all-time board is a board
nobody new can ever appear on.** Somebody who started this week will not out-total a year of
somebody else's play, and a product whose only ranking says so is one they stop looking at.

All four rank by XP, and the rating rides along beside it. XP is a count of what somebody did: it
only goes up, and it can be summed over a window, which is the whole reason a window means anything.
The rating is the estimate of how WELL they play and it can go down — ranking a monthly board by it
would have produced the all-time board with the inactive hidden.

Two queries rather than one with a branch, because they ask different things of different tables: all
time reads the running totals in `player_stats`, a window sums `match_players`. The all-time board
keeps the `MIN_PLAYED` floor and a windowed one has none and needs none — a floor there would keep
new people off the one board they can actually climb. The boundaries are `date_trunc` over Postgres
`now()`, never a date this process computed, for the reason every other window predicate in this
server is: `finished_at` was written by Postgres.

The windows are the SERVER's day and month, so somebody in Tehran sees a board that turns over at UTC
midnight. That is a real limitation, stated rather than hidden, and a smaller one than storing
everybody's timezone to fix.

**The person travels ON the row.** A leaderboard is the one list in this product where nearly every
row is somebody the reader has never been told about, so a payload of bare handles means the client
asks about each one - twenty rows, twenty requests, for one screen. That is the shape that took the
rate limiter out during the responsive matrix, and it is the defect `social.graph` already records
having fixed the same way. The board `remember`s them into `people.store` in an `effect` rather than
beside the read, because `remember` writes the signal `byHandle` reads and a `derived` that wrote it
would be a cycle. `lastSeenAt` is absent rather than null, which is the privacy rule: a board is read
by strangers who have no claim on when somebody was last online.

**The window labels are one word each**, and that is a layout fact rather than a style: "This month"
and "This year" in a four-way segmented control put the game page 335px wide at a 320px viewport, and
the matrix caught it. The legend above them carries the meaning.

## Five things that were written and never called

Each of these was built, reviewed and left wired to nothing, and every gate was green over all of
them. They are grouped because the shape repeats: something is declared, something else is supposed
to use it, and nothing ever does - which no test catches, because a test asserts what the code does
rather than noticing what it never does.

**The turn sweep had no caller.** `match.due` and `match.expire` were written, tested against a real
Postgres and driven by nothing - so a turn that ran out was never played, no seat was ever forfeited,
and a table somebody closed the tab on sat on its deadline forever while this file described the
sweep in the present tense. `main.ts` runs it now, beside the expiry sweep and cleared in the same
`beforeShutdown` - see *A turn that runs out is played* for why it is no longer a fixed interval.

**`chat.line.result` and `chat.line.invite` had no producer**, and `MessageKind` reserved a slot for
each. `lines.spec.ts` was supposed to be the rule - a key with no producer is filler copy - and it
only ever checked the `chat.line.group.*` keys, which is how two slipped past it for months. It
checks every key now, and the group keys keep a shape of their own because they are composed from a
suffix and never appear whole in the source.

`declareResult` writes the result line into the table's own thread, and it lives in its own
zero-import module because a game ends TWO ways - somebody plays the last move, or the sweep
forfeits the last player holding a turn - and both have to say it identically. A game somebody won
names them; a game nobody won (`matches.outcome = 'abandoned'`, every survivor `void`) does not, and
must not, because the engine calls the last player standing a winner so the board can stop.

The invite line goes in the TABLE's thread rather than into a direct message. A line in a DM would
create a conversation between two people as a side effect of an invitation, which is a thing nobody
asked for; who was invited is part of this room's history the way who joined a group is part of
that one's.

**Nothing told anybody it was their go.** `game_rules` offers ludo in `turns` mode, whose deadline is
twenty-four hours, so the product's answer to "whose go is it?" was to keep opening the page. The
`turn` notification is written only for `turns` tables - a live table gives thirty seconds to
somebody already looking at the board, so one per turn there is noise nobody wants, and the sweep
plays the turn of anybody who walked away. Its dedupe key is the MATCH, because `table:<id>` is what
an invite to the same table already uses and one key shared by two kinds is two things collapsing
into one row that says neither.

**Nothing ranked anybody.** `player_stats` made a leaderboard possible the day it existed.
`GET /catalogue/games/:game/leaderboard` is unguarded with the rest of the catalogue and has a
five-game floor: one win from one game puts a new account at 1216 and, on an empty board, at the
top - which says nothing about anybody and makes the board a measure of who played most recently.

**A courtesy must not be able to fail the thing it is a courtesy about.** The first turn notice ever
written hit a stale CHECK and turned a perfectly good roll into a 500: the game had been played, the
row was written, and the person was told their move failed. Everything that runs after a move has
landed - the result line, the invite line, the turn notice - goes through `courtesy()`, which is the
rule `wake` already followed for push.

**A contract member is not one of these.** `Engine.legal` has no caller in the product either - a
board is handed its plays by `view` - and it stays. It is how the specs drive every engine through
one seam: the move generator under the self-play in `engine-contract.spec.ts`, the thirty games a
format in `ladders.spec.ts` and the seam and poker specs. `Engine.formats` is what those loops run
over and what the contract spec holds to the catalogue's seed; it was `Engine.seats` and had no
caller in the product either, and it has one now, because a start asks it whether a table can be
played. The things above were runtime features wired to nothing; `legal` is the contract, and without
it every generic spec would carry a move generator of its own.

## The second audit, and the rules it produced

An 80-agent workflow audited the room/privacy work and the XP/level work along five dimensions -
authorisation, SQL, scoring, client reactivity and schema - with three independent refuters per
finding, each told to default to refuted. Twenty-five findings were raised, eighteen survived, and
four were dismissed outright.

**Every gate was green when it ran**, exactly as they were for the epoch-commitment break: `check`,
529 tests, 205 database tests, 680 QA cells, and three hand-run browser passes. That is the second
time on this codebase; it is not a coincidence and it is not fixable by adding gates. What it says
is that a gate asserts what the code does, and these were all things the code did not do.

Six of them were serious enough to be worth stating as rules.

**An invitation cannot reach past the level the table is at.** `invite` checked that the CALLER
could see the table and that the messaging policy allowed the approach, and never asked whether the
invitee could ever sit down. On a `room` table that wrote a chair nothing could free: `claimSeat`
skips a chair held for somebody else, the invitee's own claim 404s before it reaches one, and no
route anywhere clears `invited_id`. One misdirected invitation made a table permanently
un-startable, and told a non-member a table existed that every read of it denies. `create` had the
same hole through its `invitees` list. The rule: on every level but `invite`, the invitee must
already pass `visibleTo` - and on `invite` there is nothing to check, because the invitation is what
grants the visibility. `canSee` is `visibleTo` asked about a third party, which it could always
answer and was never asked.

**The room's head count is the table's ceiling, and the SERVER says so.** The sheet refuses to offer
a seat count the room cannot fill; that was the only place it was enforced, so the group page's
"Play together" - which composed its own config from the game's LARGEST seat count - opened a
four-seat table for a group of three. Nobody outside the room can take the fourth chair, so `ready`
never arrives and the table can never be started: a dead table from the primary button on the page.
This is the same argument `create` already makes about seats, modes and targets. A courtesy in a
form is not a rule.

**A room table outlives its room, and the CHECK is written to allow that.** `tables.room_id`
cascaded from `conversations` for one commit, which looked right - a `privacy = 'room'` row with no
room is one `tables_room_is_private` refused. What that missed is downstream: `conversations.group_id`
cascades from `groups` and `matches.table_id` cascades from `tables`, so the last member leaving a
group destroyed every match ever played in it, taking the history, the ratings' evidence and every
windowed leaderboard row. The constraint gave up the half it could afford - `room_id is null or
privacy = 'room'` still makes a public table carrying a private group's room unrepresentable - and
the delete rule became `SET NULL`. Such a table falls back to being visible only to the people
already sitting at it, which `visibleTo` gives for nothing.

**A refusal must not be an oracle.** `POST /tables/:id/start` read the table by id and never asked
`visibleTo`, so the ORDER it refused things in told a stranger holding an id whether the table was
open, closed, or of a game with no engine - and the 403 that finally stopped them confirmed it was
there. Being seated is asked first now and a no is a 404, which needs no visibility check of its
own: sitting at a table is the strongest form of being able to see one. FIRST means before the live
match too: for a while the route looked for a running game before anything else, and answered a
stranger holding the id "You are not in that game" with a 403 - so a table with a game on it was
still told apart from a missing one, and a player who had stood up mid-game was handed the board
they had walked away from. Anybody not in a chair is answered 404, and so is somebody in a chair the
running game never dealt them. `match.db.spec.ts` holds all three. `/matches/:id/watch` had the
same shape written as an optimisation - `found.live && ...` - so a FINISHED match skipped the table
check entirely and any signed-in caller holding a match id could read the final board of a game
played at a private room table. A game being over does not make the room it was played in public.

**A timeout is not a walkout, and a survivor of an abandoned match is not a winner.** `levels.ts`
says a walkout earns nothing and a timed-out seat keeps what it earned, and `record.ts` implemented
neither: `match_players.result` says `abandoned` for both, so a dropped connection was charged what
a quitter is charged. The ledger already knew - the sweep writes its forfeits with `user_id = null`,
because the server took that action rather than a person - so the question is asked of
`match_actions` rather than of the result column. And the survivor of a room that emptied was being
paid the finish and the tokens they happened to get home, which is the alt-account farm `outcomeOf`
exists to close, reopened at a slower rate. A game only pays when a game was played. Since the judge,
the timeout is still not a walkout for XP, but it IS a rated loss: otherwise a player losing badly
could stop moving and be forfeited by the clock for free. And it is paid only if it had played its
share first, or a seat that never acted would bank the finish and whatever the sweep did for it, at
a table where nobody else's game counted. The survivor of an opening walkout is `void`, which writes
nothing at all to their record.

**Counters are added by the database, never by the process, and the rows are locked first.**
`player_stats` was a read-modify-write over rows read once before the loop, and nothing serialises
two matches finishing for the same person: each holds `for update` on its OWN match row, and the
timeout sweep can finish several due matches in one tick. Two games ending together recorded one
game; then, once the counters were arithmetic the row did to itself, they recorded both games and
ONE rating move, because each finish rated from the 1200 it read before the other wrote. The finish
now inserts any missing `player_stats` row with `orIgnore`, then takes every counted player's row
`pessimistic_write` in user-id order before reading a rating, so the second finish waits and rates
from where the first left it (`record.db.spec.ts`: two wins at once are 1200, 1216, 1231). That test
seeds the player's row first and releases both finishes together from a gate on their match rows:
for somebody with no row yet, the insert-or-ignore already waits on the other transaction's insert and
the test passed with the lock deleted, and without the gate a fresh pool connection let one finish
commit before the other began. With both, deleting the lock fails it every run. Counters
still move by `played + 1` in the statement. The three that are not counters stay absolute - a rating
is a position, a peak is a maximum, a streak is a run - and the streak comes from the locked row.

**The finish is written BEFORE the achievements, in two updates.** `achieve.record` reads
`m.outcome = 'won'` for the hosted ladder and `m.finished_at` for everything, and the outcome is only
known once the judge has run - so a match whose row was finished afterwards would never count
towards its own rungs. `matches_live_has_deadline` and `matches_finished_has_outcome` require
`finished_at`, a null deadline and an outcome in ONE statement, so `commit` writes the state and rev
first (keeping the deadline) and the recorder writes the finish once the plan exists, then the
`player_stats` rows, then the achievements for non-void seats, and `commit` clears readiness last.

**A public route publishes everything on it.** The leaderboard is unguarded with the rest of the
catalogue, which is right - a board nobody can see until they sign in cannot say what the place is
like - and it shipped for one commit carrying a whole `personSummary` per row, which includes a bio
and `isMinor`. Every other route that says who somebody is sits behind a session. It carries a
handle, a display name and a hue now, which is what an avatar reads; `Avatar` was widened to ask for
those two fields rather than a whole person, because a type demanding a child-safety flag to draw a
coloured circle is the type asking for data the screen has no business holding.

And two smaller ones worth keeping. **A window is truncated in UTC explicitly**, because bare
`date_trunc` over a `timestamptz` uses the connection's `TimeZone` - a server setting rather than a
decision, so the same deployment answers a different board on a different machine. **A refused fetch
is not an empty list**: the leaderboard and the match history both rendered a dropped connection as
"nobody has done this yet", which is a confident statement about the world made from having failed
to ask it.
