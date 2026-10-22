# The admin

`/admin` is where the platform is run from, by the owner and the people the owner chooses. The
design, with the decisions and what was not chosen, is
`docs/superpowers/specs/2026-10-22-platform-admin-design.md`.

## The staff

**Three roles, each above the last: moderator, admin, owner.** `domains/admin/roles.ts` imports
nothing and both halves read it: `ABILITIES` says which role a section needs (`overview`, `live`,
`people` and `reports` a moderator, `play`, `notice`, `money`, `staff`, `log` and `health` an admin,
`wallet` the owner), `may(role, ability)` answers, and `outranks(actor, other)` is
the one rule about rank. Nobody outranks their own role, and every role outranks somebody who holds
none. The browser draws a section only where `may` says so; the server asks the same function on
every route, because the drawing is a courtesy.

**The owner is the wallet the operator names**, `ADMIN_WALLET_ADDRESS` in the root `.env`, compared
without regard to case (`isAdminAddress`), and empty means nobody. Exactly one, never a row and
never granted or taken away in the page: a page that could make an owner is a page an owner could
lose to. Admins and moderators are rows of `staff_members` (a CHECK keeps `owner` out of it). The
account payload says `staff` with the role, and nothing for everybody else; `profileFor` reads the
row with the account, and `roleOf` in `services.ts` puts the owner first.

**A suspended account holds no role.** `staffOf` answers nothing for one, so a suspended admin is
answered as anybody else is, and the page is not theirs.

**Who changes whom** (`POST /api/admin/staff`, `{ handle, role, reason }`, `role` being
`moderator`, `admin` or `none`): an actor may set a role only below their own and only on somebody
whose current role is below their own, so the owner grants and revokes admins and moderators and an
admin grants and revokes moderators. The refusals are words of their own (`domains/admin/refusals.ts`,
`staffRefusal`): `staff-rank` (409) for anything at or above the actor, `staff-self` (409) for one's
own role, `staff-owner` (409) for the owner, and `staff-nobody` (404, "No one by that name.") for a
handle nobody holds and for a suspended account, in the same bytes. The target's row is locked
(`pessimistic_write` on `users`) for the length of the change, so two changes to one person are one
after the other. A role asked for that is already held changes nothing and writes nothing.

**A caller who may not is answered as a page that is not there.** Every admin port answers `null`
for anybody whose role does not reach the section, and every admin route turns that into the 404
`onlyAdmin` sends ("Nothing there."), the same bytes a missing page gets. `app.spec.ts` holds the
bytes on every admin route; `admin-staff.db.spec.ts` holds a player, a moderator and a suspended
admin to `null` on every staff port.

## The log

**Every change writes one row of `staff_actions` in the transaction that makes it** (`record` in
`domains/admin/staff.ts`): who, the role they held then, the kind, the person with their handle as
it was (a CHECK makes a person always come with a handle, so a row still reads once the account is
renamed or gone; the foreign keys are `SET NULL`), the reason, and the details (`from`, `to`). A
reason is three to five hundred characters, held by the wire and by a CHECK. No route edits or
deletes a row. A reversal is a row of its own.

`GET /api/admin/log` reads it newest first, fifty a page, keyset over `(created_at, id)` (a cursor
that is not one reads the first page), by staff member, person (both whatever the case of the
handle) and kind. A row's time is its transaction's start, `now()`, as everywhere else here: two
changes that race for one person are told apart by the rows they leave, not by their order.

## People

**Anybody with an account can be found and read by the staff, a moderator included** (`people`,
the one section a moderator opens). `GET /api/admin/people` lists them newest first, fifty a page,
by a search (a handle or a name, folded as the social search folds them, so a name stored with
Arabic letterforms is found by its Persian ones and the other way round, with `%` and `_` read as
letters; or the start of a wallet) and by a list: `newest`, `suspended`, `minors`, `staff` (the
owner by the wallet the server names, and every row of `staff_members`) and `reported` (anybody a
report was filed against). A row carries the face, the first wallet, when the account was made,
the two flags, the role and how many reports there are against them.

`GET /api/admin/people/:handle` is one person: who they are and their settings, every wallet, the
sessions that are live (not ended, not expired), each with the browser and the system read from
its user agent (`agentOf` in `domains/admin/agent.ts`, names a person would recognise and nothing
for an agent it does not know) and when it was opened and last used, the browsers holding their
keys, the reports both ways (the other person, the category, the status, never a disclosed message),
whether they accepted the terms of paid play and any break, their recent games and paid games (read
by the account's id through the routes that serve a person their own; none when the server keeps
no vault), and the newest fifty staff actions on them by their id, so a rename does not hide one,
with `historyCursor` when there are more. The account's id never leaves the server. No IP is stored
or shown.

**A person's whole history is read a page at a time** (`GET /api/admin/people/:handle/history?cursor=`),
fifty a page by the log's own keyset, for anybody whose role opens People. It is how a moderator, who
cannot open the log, reads every change ever made about somebody.

**A note is a staff action** (`kind = 'note'`, its words where a change keeps its reason): `POST
/api/admin/people/:handle/notes`, `{ text }`, three to five hundred characters with one that is not a
space. The writer must outrank the person, as for any action on an account (a moderator writes on
players, an admin on players and moderators, the owner on anybody), and nobody writes one on
themselves (`staff-self`). It answers with the person as they now read.

**A cursor here carries microseconds** (`lib/keyset.ts`, *A page cut by time* in
`backend/CLAUDE.md`), as every list paged by time does. The log uses the same cursor.

## A suspension

**`POST /api/admin/people/:handle/suspend`**, `{ days?, category, reason }`: `days` is 1, 7 or 30,
and none means for good; the category is harassment, spam, cheating, inappropriate or other
(`SUSPEND_DAYS` and `SUSPEND_CATEGORIES` in `roles.ts`). Who may suspend whom is the note's rule: a
moderator suspends players, an admin players and moderators, the owner anybody but themselves.

**It happens in one order** (`suspend` among the admin ports in `services.ts`), and each step is
there for the one after it:

- The rank is asked first (`accounts.reachable`), so a refusal changes nothing anywhere.
- Every table they sit at is left as they would leave it themselves, with the forfeit
  (`walkAway(target, table, true)`, the leave port's own path, each through `courtesy`): a live game
  is lost as a walkout, and the others are told and play on or are shown the result; at a paid
  table that loses the stake, as any walkout does; a waiting table stands them up. A table whose
  stakes are being locked cannot be left (`paid-locking`), so they stay in that chair, and when the
  lock lands no game is dealt and every stake goes back (*Marking somebody under 18*, below).
- Then, in one transaction with the target's row locked: the account is marked
  (`users.is_suspended`), the suspension is written (`suspensions`, one row an account, ending
  `now()` and the days later, or never), every live session is ended, and the log's row says the
  category, the term (`days`) and the end (`until`). Suspending somebody already suspended replaces
  the term and writes another row.
- Then their sockets are closed (`sessionsRevoked`) and their push subscriptions forgotten, so
  nothing wakes a phone for an account that cannot sign in.

A suspended account is hidden wherever it was before this (sessions, the social reads, quick play),
and holds no role on the staff. A guest's session is the whole of a guest account, so a guest who is
suspended has no way back in even once it is lifted.

**A lift** (`POST .../lift`, `{ reason }`) unmarks the account, deletes the suspension and writes
`lift`. Lifting somebody who is not suspended is `staff-not-suspended` (409). Their sessions stay
ended: they sign in again.

**A suspension for a time runs out by itself.** `main.ts` asks `jobs.liftSuspensions` once a minute
(stopped with the other minute sweeps on the way down). It lifts every suspension whose end is at or
before `now()`, by Postgres's clock as every window here is, with the rows locked so two sweeps cannot
lift one twice, and writes `expire` with nobody's name on it: the one kind of row that has none
(`staff_actions_actor_named`). A suspension for good is never touched by it.

**Signing in says so, and opens no session.** `signInWithWallet` refuses a suspended account once the
nonce is burned and the signature checked, with 403 `suspended` and `{ category, until?, vault? }` in
the details: `vault` is the address `NURA_VAULT_ADDRESS` names, a public value, there so the page can
say where the person's NURA still is. Before this the session was opened and the next request
refused, so a suspended person was signed in and signed out again with nothing said. The browser's
half is in `identity-and-profile.md` (*A suspended account is told why*).

`admin-people.db.spec.ts` (*a suspension*) holds each step against a real database and
`suspension-sweep.spec.ts` the sweep's place in `main.ts`.

## A profile cleared, and every session ended

**What the staff take off a profile** (`POST /api/admin/people/:handle/clear`, `{ part, reason }`,
`part` being `picture`, `name` or `bio`, `CLEAR_PARTS` in `roles.ts`): a picture is taken off the
account, and its file (`avatars`, by hash) goes with it once no account shows it, which also ends the
link the chain's profile holds; a name becomes the handle; a bio is emptied. The row keeps what a
name or a bio said (`from`), so the staff can still read what was taken down; a picture keeps only
the part, its file being gone. Taking off what is not there changes nothing and writes nothing. The
person is not told (D8): their own pages and the lists they are in change, rung as any change to a
profile is (`ringProfile`). Who may do it to whom is the note's rule.

**Every session ended** (`POST .../sign-out`, `{ reason }`): every live session of the account ends
in one transaction, the row counts them (`sessions`), and then their sockets are closed and their
push subscriptions forgotten, as signing out everywhere does. A session that has already run out is
left as it is, and with none live nothing is written. A wallet account can sign in again; a guest,
whose session is the whole account, cannot.

`admin-people.db.spec.ts` (*what the staff take off a profile, and every session ended*) holds both.

## Marking somebody under 18

**`POST /api/admin/people/:handle/minor`, `{ minor, reason }`**, an action of People, so a moderator
marks players, held to the note's rank rule (a moderator marks players, an admin players and
moderators, the owner anybody but themselves). In one transaction with the person's row locked:
`users.is_minor` is set, marking them under 18 turns `allow_stranger_messages` off with it (the
`users_minor_no_strangers` CHECK holds the pair), and the log's row is kind `minor`, about the
person, with `{ to: 'minor' }` or `{ to: 'adult' }`. A mark they already carry changes nothing,
writes nothing and rings nobody. Marked an adult, they keep strangers off until they turn them on
in Settings themselves.

**What being under 18 takes away is what the product already refuses a minor** (D7): no messages
from strangers either way and offline to strangers (`social/policy.ts`), never seated beside an adult
stranger by quick play, and no playing for NURA (`paid-minor`). The mark makes the rest of that true
at once, each step through `courtesy`: they are stood up from every table played for NURA that waits
(`walkAway`, no forfeit, since nothing has begun there), and every paid game they are playing ends
as no contest with every stake given back (`voidPaid` in `play.ts`, through the same `voided` as
End game, one `void` row a game with the mark's reason). The others in such a game are asked no
rank, because giving every stake back costs nobody anything. A free table and a free game are left as
they are, as sitting down by a link always was. Then a team-up with a stranger ends
(`party.revalidate`), and the hub (`edgesChanged`), their vault page and their profile are rung.

**A lock already on its way refunds rather than deals.** A table whose stakes are being locked cannot
be left (`paid-locking`), so a player sitting there stays; when the lock lands, `match.begin` deals
the game only if nobody it locked for has since been marked under 18 or suspended, and otherwise the
escrow is `refunding` (`.claude/rules/stakes.md`, *The worker*). A suspension meets the same moment
and is answered the same way.

`admin-minor.db.spec.ts` holds the mark both ways, a mark that changes nothing, the rank rule, who is
answered as nothing, a team-up with a stranger ending and a free table and game left alone;
`stake.db.spec.ts` (*a player marked under 18, or suspended*) the paid game ended, the paid table
stood up from, and a lock that lands after a mark or a suspension.

## Reports

**What players report is worked by the staff, a moderator included** (`reports`, `domains/admin/
reports.ts`). `GET /api/admin/reports?status=&cursor=` lists them newest first, fifty a page, keyset
over `(created_at, id)` with the microsecond cursor: `received` (the default, "waiting"),
`reviewed`, `actioned` or `all`. A row is the report's id, category, status, when, whether a message
came with it, and the two people (face, handle, and their role on the staff when they hold one, the
owner by the wallet the server names), and every page carries how many are waiting, which is also
`GET /api/admin/reports/waiting` (`{ count }`) for the count in the nav.

**One report** (`GET /api/admin/reports/:id`, an id that is not a uuid answered as missing before
Postgres sees it) adds the disclosed message as the reporter showed it (the sealed document,
`{"text", "reply"?, "fwd"?}`, which franking verified at filing; nothing else of the conversation is
ever read), up to five of their most recent games together (each with both seats' results, or live),
and every staff action on that report (`ofReport`, by `details ->> 'report'`).

**Closing a report** (`POST /api/admin/reports/:id/review`, `{ outcome, reason }`, `outcome` being
`reviewed` or `actioned`) is held to the rank rule of any action on the person reported: nobody
closes a report about themselves (`staff-self`) or about somebody at or above them (`staff-rank`), so
a report about a moderator goes to an admin and one about an admin to the owner. The report's row is
locked, the status moves, and one row of kind `report` is written about the person reported, with the
report, the outcome and the reporter's handle in its details, in that transaction. An outcome it
already has changes nothing and writes nothing; a later outcome is a row of its own. The reporter's
`social` scope is rung, so their own list of reports shows the new status; nobody is notified (D9).
`admin-reports.db.spec.ts` holds the queue, one report, the outcomes and the refusals.

## Play

**An admin or the owner turns a game off and on** (`play`, `domains/admin/play.ts`). `GET
/api/admin/play` lists every row of `games` in the catalogue's order with its status, the games
being played (`matches` with no finish) and the tables waiting for one (open, with no game on: a
table a finished game left behind is waiting, a closed one is not). `POST /api/admin/play/games/:game`,
`{ on, reason }`, locks the game's row (`pessimistic_write`, so two switches at once write one
change), sets `available` or `disabled`, and writes one row of kind `game` with `{ game, from, to }`
and no person, in that transaction; it answers the list as it now stands. A game nobody has heard
of and one still `coming-soon` are answered as a page that is not there: coming soon is the state
of a game whose table does not exist yet, and a switch is not how one ships. A switch to what the
game already is changes nothing, writes nothing and rings nobody.

**Off stops everything new and nothing under way** (D10). Nobody can open a table of it (`create`
reads the rules through `available`), look for one (`quick-game`) or start one: the start asks
`gameOn` under the table's lock and refuses `game-off` (409, "That game is paused, so no game can
start here for now."), and the browser says it in the reader's words (`tables.refused.game-off`).
A table played for NURA is asked the same at both of its starts: the stake to sign is refused
`game-off` and so is a signed Ready, so nothing is locked on the chain for a paused game, and a
lock whose last Ready landed in the moment of the switch locks nothing while the game is off; the
sweep that locks a paid table whose chairs all signed locks it once the game is on again. A lock
already sent to the chain deals its game, as a start already under way does: the stakes are
locked, and refunding them would cost the players a game they had agreed to. The games being
played go on to their end, moves, sweeps and walkouts alike.

**Everybody learns at once.** A switch that changed something rings `catalogueChanged`, the hub
asks for a pulse, and the pulse carries every game's status (`gameLive.status`) beside its counts,
so every page that is open hears it: the catalogue store takes a game's status from the newest
counts it holds over the catalogue it read once (`statusOf`), a paused game is not `playable`, and
its card, tile, page and create page say "Paused" where a game still coming says "Coming soon".
A waiting room of a paused game says so where it would say go ("This game is paused for now. A
game can start here again once it is back.", under the clock and not the green dot) and offers no
Start, so nobody presses one to be refused; Ready stays, and Start comes back when the game does.
Its leaderboard stays: a board of results needs nothing to be playable.

**What is being played, and what waits.** `GET /api/admin/play/matches?list=&game=&cursor=` lists
the games being played newest first, fifty a page by the log's keyset over `(started_at, id)`: the
game, the table's code and pace, when it started, when the turn runs out (`deadline`), its stake,
and who plays in which seat. `GET /api/admin/play/tables?game=&cursor=` lists the tables waiting
for a game the same way over `(created_at, id)`: open with no game on, the host (none once the host
has left), who sits in which chair, the chairs taken of the seats, who may sit, whether quick play
opened it, and its stake.
A table a finished game left behind waits again; a closed one is gone.

**A game the sweep cannot play is stuck, and says why.** The turn sweep postpones a match it cannot
play (no engine for its game, nobody on turn, no turn it can play for the seat, a turn the game
refuses, or a throw) and logs `unplayable match`; it also keeps each one in memory with when it
first met it and the kind of reason (`STUCK_KINDS` in `roles.ts`, `stuckKindOf` in `play.ts`: what
follows the colon, which can be an error's message, never leaves the server). `list=stuck` is the
ones still live, and Play counts them (`stuck` on its answer); one the sweep plays after all, or
that finishes, is forgotten. It is memory for the reason the table sweep's strikes are: a restart
forgets it, and the sweep meets a stuck game again at its next deadline, a turn after its last.

**A game being played can be ended as no contest** (`POST /api/admin/play/matches/:id/void`,
`{ reason }`, D10). `voidIn` in the match service is the finish, in one transaction with the
match row locked (`pessimistic_write`, and never the table's lock, which a finish never takes): the
match is finished `abandoned` with no winner and no deadline; its revision moves on by one, with
`voided: true` written into the state beside `rev`, and one ledger row at that revision (seat -1,
nobody's id, kind `forfeit`, `{ verb: 'void' }`, no events, `VOIDED`), so every catch-up and every
push reaches the end; every seat is `void` with no XP and no rating pair, a seat that had walked
out as well, so the recorder never runs and nothing reaches `player_stats` or the achievements;
the chairs stop being ready; and an escrow that is `open` becomes `refunding`, every stake going
back in full. The admin's half (`voidMatch` in `play.ts`) writes the log's row in the same
transaction, kind `void`, no person, `{ match, game, table }` with the table's code. Then each seat
is pushed the end, a turn notice is taken back, the table's chat says
`chat.line.result.void` ("Nura's team ended it as no contest"), the table is
rung, the stake worker is nudged, and the answer is Play as it now stands (a stuck game it ended
is forgotten by the next read, as one that finishes is).

**It is held to the rank rule against everybody in the game**, asked before anything is written:
nobody ends a game they play in (`staff-in-game`, 409) or one with anybody at or above their
role in it (`staff-rank`), so an admin ends the games of players and moderators and the owner
any game but their own. The owner is known by the wallet the server names and a suspended account
holds no role (`STAFF_OF` in `play.ts`, one expression for the rank and for the list). A game
already over is `staff-match-over` (409), asked under the row's lock, so two of the staff ending
one game write one end; a game that is not there, and an id that is no uuid, are the page that is
not there. The list of games being played names each player's role on the staff (`staff`), as a
report names its two people's, so the page offers the end only where it would be taken.

**A game ended this way says so wherever it is read.** A match view of it carries `voided: true`
and names nobody on turn: the engine's state was not finished by the engine, so `asMatch` asks
`finishedAt` before it asks `turnOf`. A play in it is `game-over`. The player's history lists it
as `void`. The proof of a paid one leaves the end's ledger row out (`isVoided`), so every move
still checks in the browser.

**A table waiting can be closed by the staff** (`POST /api/admin/play/tables/:id/close`,
`{ reason }`, D10). `shutIn` in the table service is the close, under the table's lock as the
host's own close is (`lockTable`): a table that is not there is the page that is not there, one
already closed is `staff-table-closed` (409), and one with a game on or whose stakes are being
locked on the chain is `staff-table-playing` (409), because a game under way is ended as no contest
first and a lock already sent is the chain's to finish. Otherwise the table is closed (`status`,
`closedAt`), and the admin's half (`closeTable` in `play.ts`) writes the log's row in the same
transaction: kind `close`, no person, `{ id, table, game }` with the table's code. Then the table's
chat and the table are rung, and the answer is Play as it now stands. Nothing is locked at a table
played for NURA while it waits, so nothing is refunded; the Readies its chairs signed are never used.

**It is held to the rank rule against everybody in a chair**, asked before the table is touched:
nobody closes a table they sit at (`staff-seated`, 409) or one where anybody sits at or above their
role (`staff-rank`), so an admin closes the tables of players and moderators and the owner any table
they do not sit at. The list of tables waiting names who sits in which chair with their role on the
staff (`people`, by `STAFF_OF`, a suspended account holding none), so the page offers the close only
where it would be taken. Two of the staff closing one table at once close it once: the second waits
on the table's lock and finds it closed.

**Whoever sits there is told who closed it.** A closed table that a `close` row of the log names
reads `closedBy: 'staff'` (`closed_by_staff` in the table query, so `tables` takes no column, D16),
and its page says "Nura’s team closed it. Open another whenever you like." where a table its host
closed says whoever opened it ended it. Nobody is sent a notification (D8).

`admin-play.db.spec.ts` holds the list, the switch, the refusals, the row lock (two switches parked
on a held row) and everything new refused while a live game plays on; `admin-void.db.spec.ts` the
end of a game: what is written and what is not, who is told, a seat that had walked out, the
escrow, a stuck game, every refusal, a suspended member of the staff, a move holding the row, two
ends at once and no table lock; `admin-close.db.spec.ts` the close of a table waiting: what is
written, a host's own close saying nothing of the staff, the refusals, the people at each table with
their roles, a close waiting on the table's lock and two closes at once; `stake.db.spec.ts` the paid
table and a paid game ended, refunded by the worker with its proof whole; `realtime-hub.spec.ts` the
pulse.

## Money

The vault section (`.claude/rules/stakes.md`, *The owner's view of the vault*) is `money`: an admin
sees it, read for their own wallet's roles on the vault. The calls that change it (fee, ceiling,
fees, pause) are `wallet`, the owner's alone: an admin asking for one is answered as a page that is
not there and no call is composed (`stake.db.spec.ts`).

## The overview, and who is online

**The overview is counted, never estimated** (D11), and every member of the staff reads it
(`overview`). `GET /api/admin/overview` answers the accounts (every one, the new ones of the last
day and the last week, those seen in the last day, the suspended and those under 18:
`accounts.counts`, by Postgres's clock), how many people are online now (the hub's own list), every
game with how many are being played and how many tables wait (Play's own read), the games the sweep
could not play, and the reports waiting. For a role that opens Money it adds the money from the
database alone, so the page never waits on the chain: the paid games being played, the NURA locked
in games (every stake of an escrow locking, open or settling) and the payments stuck on the way, by
the vault panel's own rule (`vaultAdmin.counts`). For an admin and the owner (`health`) it adds this
server's health: how long it has run, its memory, how much of the last full minute its event loop
was busy and the longest it waited past its own tick, the database pool, the sockets open, the
requests of the last hour and how many of them failed, and the last fifty failures by method, path
and status, never a query and never an error's message (`http/ops.ts`, fed by the request observer
`main.ts` wraps round the request log). A minute's count is a slot of a ring of sixty, so what it
keeps is bounded by its shape. The loop is said as a share of the time it was busy
(`eventLoopUtilization`) and not as the delay percentiles `monitorEventLoopDelay` keeps: those
record the whole interval between its ticks, so on Windows, where a timer fires on the next 15.6 ms
tick of the clock, an idle loop read as 32 ms of delay at a 20 ms tick; what is left of the
monitor is the longest wait less the tick, which is what a stall looks like. The numbers are this
server's: one server per database stays the rule.

**Who is online now** (`live`, a moderator included): `GET /api/admin/live?cursor=` lists everybody
with a socket open now (`hub.online()`: a tab looked away from as `away`, nobody whose last socket
has closed), fifty a page by handle, each with their role on the staff, when they came, the tables
they sit at (code, game, pace, and whether a game is on there) and the call they are in
(`hub.calls()`, a call for each side under its table), named only at a table they sit at. A private
table is named and never offered to watch (D12). It is memory, as presence is: the server holding
the sockets is the one that knows.

`admin-overview.db.spec.ts` holds the counts against rows dated by hand, the money and the health
for the roles that open them and for nobody else, and the money left out where there is no vault;
`admin-live.db.spec.ts` the list, its pages and who is answered as nothing; `ops.spec.ts` the
requests, the failures and the hour's ring; `realtime-hub.spec.ts` (*who the staff see online*, and
the calls) the hub's two reads.

## The notice everybody sees

**One line, in English and in Persian, at the top of every page of the app, for as long as an admin
or the owner says** (`notice`, D13; the page calls it the announcement). `notices` is a table of
its own: the two lines (three to two hundred characters each, held by the wire and by a CHECK), until
when it stands, who put it up and when, and when it was taken down if that was early. The one that
stands is the newest with no end and an `until` still ahead of Postgres's `now()`
(`createNoticeService` in `domains/admin/notice.ts`). One stands at a time: putting one up ends
whatever stands in the same transaction, and two of the staff putting one up at once go one after
the other (`pg_advisory_xact_lock(hashtext('nura:notice'))`, raw, because no repository can say
it). A notice that ran out needs no sweep: it is simply not the one that stands.

`GET /api/admin/notice` is the one that stands, with when it was put up and by whom.
`POST /api/admin/notice`, `{ en, fa, hours, reason }`, puts one up for an hour, six, a day, three
days or a week (`NOTICE_HOURS` in `roles.ts`), the lines trimmed by the wire, and writes one row of
kind `notice` with `{ to: 'up', en, fa, hours, until }`. `POST /api/admin/notice/end`,
`{ id, reason }`, takes down the one it NAMES and writes `{ to: 'down', en, fa }`; a notice that
is not the one standing, gone or replaced meanwhile, is `staff-no-notice` (409), so a take-down never
takes down something its reader never saw. **A notice ends no earlier than it began**
(`greatest(now(), created_at)`): a change that began first and waited for the lock would otherwise
end, with its own earlier `now()`, a notice committed while it waited, and the CHECK on the end
refused that as a 500. The database spec met it once by chance, in a run of its test of two puts at
once; a notice written by hand to begin a minute ahead holds it now, for a put and for a take-down.

**Everybody learns at once.** Putting one up or taking it down rings `catalogueChanged`, and the
pulse carries the notice standing (its id, its two lines and its end, nothing about who put it up)
beside each game's counts, as `GET /catalogue/live` does, so a page with no socket reads it on the
lifeline's beat. The hub tells a pulse only when what it says differs, and the notice is part of
what it compares.

`admin-notice.db.spec.ts` holds the rows, the log, the rings, the pulse and the live counts, a
notice replaced and one that ran out, the newest shown when two stand, the refusals, a moderator, a
player and a suspended admin answered as nothing, the lock for a put and for a take-down, and an end
that comes before its beginning; `app.spec.ts` the routes, their words and the live counts on the
wire; `realtime-frames.spec.ts` and `realtime-hub.spec.ts` the pulse.

## The page

**`/admin` is a layout of its own, outside the app shell** (`components/admin/admin-shell`): a
header with the way back to the app and the reader's handle and role, then the sections the role
opens, as a rail under the header on a phone and down the side from 64rem, each a lazy page under
`pages/admin/`. `lib/admin-sections.ts` lists the sections in order, and a section IS an ability of
`roles.ts`, so one list (`sectionsFor(role)`) draws the nav, guards the layout (`requireStaff`: the
role opens some section) and decides the shield in the profile's corner; each section keeps its own
`requireAbility`. `/admin` itself goes to the first section the role opens (`firstSection`), and
anybody whose role opens none is shown the page that is not there at every address under it, as
the server answers them. The shell starts the toasts, the session, the signed-out watch and the
count of waiting reports, and holds the overlays and the toasts; it opens no socket. With no socket
the count is read rather than rung (`stores/reports.store.ts`): when the admin opens, whenever the
reader moves to another section, when the tab is seen again, and from every page of the queue, which
carries it. Reports wears it as a badge in the rail and down the side ("3 reports waiting" to a
screen reader).

**The admin's words are a catalogue of their own** (`locales/{en,fa}/admin.ts`, registered by
`locales/admin-catalogue.ts`, which only the admin shell imports), so the app's catalogue carries
none of them.

**Staff** lists the owner apart, then the team in the server's order with who made each and when,
and has one form: a handle (folded as the server folds one, a leading @ dropped), a role from those
below the reader's own, and a reason. A change is shown at the press (`createGuesses`), said once
the server has (`attempt`), and a refusal takes it back and says why in the reader's words
(`whyStaffRefused`, `admin.refused.<word>`), keeping what was typed. Change on a row fills the form
with that person and puts the keyboard on their role; it is drawn only on somebody the reader
outranks.

**Log** draws each row as a sentence, the reason as written, when, and the role the change was made
with. `logParts` in `lib/staff-words.ts` hands the sentence over in parts, each handle a part of its
own that the page draws with `dir="ltr"`: a handle runs left to right, and two of them side by side in
a Persian sentence ("{staff}، {person} رو … کرد") were one run, which put the person before whoever
acted for a reader going from the right. The same goes for "by whom" on a member of the staff, which
is the word and the handle beside the time as a line of facts, not one string with a number after a
handle. A closed report's row names whoever filed it as a third handle ("mina reviewed sara.k’s
report about reza.t: nothing to do."). The kind, by whom and about whom are in the address
(`kind`, `staff`, `person`); a handle is written there once the typing pauses, or at Enter. Older
entries come a page at a time and are dropped whenever the first page is read again, so a new filter
never shows the old one's tail.

**Overview** is the first section, open to every role on the staff. It says the accounts (all of
them as one number, then the new ones of the last day and the last week and those seen in the last
day; the suspended and those under 18 as links to People's own lists), how many people are online
and how many reports wait (each leading to its section), every game with how many are being
played and how many tables wait, the games stuck in danger only when there are some, and the way
into Play only for a role that opens it. A role that opens Money also sees the paid games being
played, the NURA locked in games in madder, and the payments stuck on the way (in danger when
there are some), with the way to Money; an admin and the owner see this server: how long it has
been up ("less than a minute" when it is, minutes alone under an hour), its memory, how busy the
event loop was and its longest wait, the database connections, the sockets, the hour's
requests and failures, and the last failures by status, method and path, their exact time under a
pointer. It is read when it opens, at "Read again", every fifteen seconds while the tab is seen and
at once when it is seen again (`whileSeen` in `lib/while-seen.ts`, on the product clock), never
while the tab is hidden, and says when it was read. The count of reports it reads is the nav's too.

**Online now** lists everybody online by handle, each leading to their page: the name, the
handle, their role on the staff, "Away" when no tab of theirs is looked at, when they came (exact
under a pointer), and what they are doing in sentences with the code set apart ("Playing Ludo at
K7QX", "Waiting at a Hokm table, H2AB", "In the call at K7QX", or "Not at a table"). How many are
online stands beside "Read again"; fifty come a page at a time under "Show more", the older pages
dropped whenever the first page is read again; and it is read again as the overview is.

**People** is open to a moderator, as the two before it are. The list searches once the typing
pauses or at Enter, keeps its words and its list in the address (`q`, `list`), and pages like the
log. A row leads to `/admin/people/:handle`, which keeps People lit in the nav and draws the person
from one read: who they are and their flags, their account and paid play, their wallets, where they
are signed in now ("Chrome on Windows", or "An unknown browser" for an agent `agentOf` does not
know), the browsers holding their keys, the reports both ways (each a sentence with the other
person's handle set apart, `handleParts`), their record (`PersonRecord`: the level, and the ratings once they have
played, because its empty state speaks to the reader as the player),
their recent games and paid games, and what the staff did about them, drawn by the log's own
`LogEntry`, older pages under "Show older"; the older pages are kept by the first page's cursor and
dropped once that cursor moves (a new action, read again), so nothing is skipped between the two. The note form is drawn only for somebody the reader outranks and never on their own
page; a note is shown at the press, said once kept, and taken back with the refusal's words. A
handle nobody holds is "No one by that name." (a 404 read as missing, never as a failure).

**A person's page acts on the account** for somebody the reader outranks, and never on their own
(`PersonSuspension`, under "Act on this account"). Suspending asks for how long (a day, a week, 30
days, for good), what it is for (no reason is chosen for the staff: "Choose one" until they do) and
why, then asks as a destructive question naming the person and the term, with the keyboard on
Cancel, and for a guest says that a guest cannot sign back in even once it is lifted. Said yes to,
it is shown at the press: the status under the name ("Suspended until 29 October 2026 at 14:30:
Cheating.", since when), signed in nowhere, the row in the history and the lift form; a refusal
takes it all back in the refusal's words and keeps what was typed. A suspended person's page offers
the lift, with its own reason, shown and taken back the same way.

Under it (`PersonContent`) the profile's panel offers only what the profile has of its own (a
picture, a name other than the handle, a bio) with one reason for whichever is pressed, each asked
as a destructive question that says what happens to it; the sign-out panel offers the sign-out only
while they are signed in somewhere, and tells the staff that a guest cannot come back. Both show at
the press and are taken back in the refusal's words. A cleared name or bio is drawn in the log with
what it said ("It said: …", in its own direction).

Between the two (`PersonAge`) a panel says what being under 18 means here and offers one press with a
reason: "Mark as under 18" for an adult, asked as a destructive question that says what stops and
what ends (messages from strangers, playing for NURA, the paid tables they wait at and the paid games
they play, with every stake given back), and "Mark as an adult" for a minor, asked as one that loses
nothing. Said yes to, the Minor badge, the strangers line and the history's row change at the press,
the toast says so once the server has, and a refusal takes it back in the refusal's words and keeps
the reason. The log says "mina marked reza.t as under 18." and "alex marked reza.t as an adult.",
under the chip "Age".

**Reports** is the queue, waiting first: a filter in the address (`status`: Waiting, the default and
never written, Reviewed, Acted on, All), the waiting count on its chip, and a row for each report as
who reported whom (both handles set apart, `handleParts`), what for, when, whether a message came
with it, its status as a badge, and the accused's role when they are on the staff; older ones under
"Show older". A row leads to `/admin/reports/:id`, which keeps Reports lit and draws the report from
one read: what it is for as the title, who reported whom, the status and when it was filed, both
people as cards leading to their pages (the accused first: acting on their account is done there),
the message as the reporter showed it (the document decoded by `decodeText`, plain text in its own
direction, marked when it was forwarded; a document that does not decode says it could not be read),
their last games together with both seats' results or a live mark, and what the staff did about it,
by `LogEntry`. The close form (a reason, then "Reviewed, nothing to do" or "Acted on it", the one
the report already has not drawn) is drawn only for a report about somebody the reader outranks; a
report about the reader, about somebody at or above them, or about the owner says why in its place.
A close is shown at the press (the status, the row, and one off the waiting count when it was
waiting), said once the server has, taken back with the refusal's words, and the count is read
again either way. A row of the log about a report offers "Open the report", except on that report's
own page, and a report on a person's page leads to it. In Persian the log is «تاریخچه», so that it
is never read as «گزارش‌ها» beside it.

**Play** lists the games in the server's order, each as its picture, its name, its status as a
badge (on in green, paused in gold, coming soon plain) and how many games are being played and
tables wait, with one button: Pause for a game that is on, Turn on for one that is paused, and
nothing but "Not ready to be played yet" for one still coming. The button asks why in a sheet
(`ReasonSheet`, `components/admin/`, which closes with the reason or nothing: the reason is three
characters or more, and the sheet says so where it is typed), a pause as a destructive question
that says what stops and what goes on, turning on as one that loses nothing. Said yes to, the
game's new status is shown at the press, said once the server has ("Ludo is paused."), and a
refusal takes it back with the refusal's words. The log says "mina paused Ludo." and "alex turned
Ludo back on.", the game in the reader's own words. Above the games a filter in the address
(`view`) shows the games, the games being played, the tables waiting, and the stuck games, the
last offered only while one is stuck; each chip counts its list. A game being played is its game,
code, pace, when it started and when its turn runs out (exact under a pointer, `When`), its stake
in madder and its players by handle in seat order; a stuck one wears a danger badge and says why
and since when. A table waiting is its game, code, pace, who may sit, the chairs taken, quick play,
when it opened and its stake. Both lists page with "Show older".

A game being played offers "End game" to a reader who outranks everybody in it, and says why in
its place where the reader plays in it or somebody there is at or above their role. The press
asks why in the same sheet, as a destructive question that says the game counts for nobody and
everybody stays at the table, and at a table played for NURA that every stake goes back. Said yes
to, the game leaves the list at the press, is said once the server has ("The Ludo game at K7QX is
over and counts for nobody."), and a refusal brings it back in the refusal's words; the list and
the counts are read again either way. The log says "mina ended a game of Hokm at K7QX as no
contest.", the code set apart as a handle is. A player's result card says "Nura's team ended this
game." and that it counts for nobody (`match.over.staff`), in place of the words for a game that
ended too early.

A table waiting lists the people in its chairs by handle, the host with a crown, and offers "Close
table" to a reader who outranks everybody at it, saying why in its place where the reader sits there
or somebody there is at or above their role. The press asks why in the same sheet, as a destructive
question that says nobody can sit or start a game there again and that whoever sits there is told
Nura's team closed it. Said yes to, the table leaves the list at the press, is said once the server
has ("The Ludo table K7QX is closed."), and a refusal brings it back in the refusal's words; the
list and the counts are read again either way. The log says "mina closed the Ludo table K7QX.", the
code set apart as a handle is.

**Announcement** (`notice`, for an admin and the owner) shows the notice standing as everybody
sees it, in the reader's language, with both lines under it (the English left to right and the
Persian right to left, whatever the page), when it ends and who put it up, each time exact under a
pointer, and a way to take it down that asks why in the sheet; with nothing standing it says so.
Under it is the form: the line in English and the line in Persian (each folded to one line as it is
sent, two hundred characters at most), how long it stands, and why. Putting one up while one stands
asks first. Both are shown at the press, said once the server has, and taken back with the
refusal's words, and the page reads the server again after a refusal, so a notice somebody else put
up meanwhile is the one shown. Nothing on its way can be taken down until the server has said what
it put up. A link leads to every notice so far, which is the log's kind `notice` ("alex put up an
announcement for a day.", with what it said in the reader's language).

**The strip** is the strips chunk's (`components/app/notice-strip`), on every page of the app that
draws the strips: the line in the reader's language beside a megaphone, and a close that keeps the
id of the notice closed on this device (`settings.noticeSeen`), so the next notice is shown again.
It goes by itself when its time is up, on the product clock, and it is the same strip through every
pulse. A table draws no strip (nothing takes room from a board), so `sayAtTable`
(`components/app/notice.ts`, started by the chunk's `begin`) says a notice once a page as a toast
at the table the reader has open, with "Got it", which closes it as the strip's close does.

**A time in the admin gives its exact moment under a pointer or a held finger** (`When`, in
`components/admin/`): the words stay what they were ("2 days ago", "Signed in 3 hours ago") and the
`Tooltip` says the date and the minute in the reader's own calendar, with the moment in `datetime`.
A log row and a person's history, their joining, last seen and suspension, their sessions, their
keyed browsers and their reports, who made a member of the staff and when, and a paid game stuck on
the way each use it, because the staff ask "when exactly" of exactly these. A report's status on a
person is a status badge (waiting in gold, reviewed plain, acted on in green).

**Money** is the vault panel, and its calls are drawn for the owner alone (`may(role, 'wallet')`):
an admin whose wallet happens to hold a role on the vault is told that only the owner changes it
from here, because the server would refuse the call.

`admin-shell.spec.ts`, `admin-overview.spec.ts`, `admin-live.spec.ts`, `admin-notice.spec.ts`, `admin-staff.spec.ts`, `admin-log.spec.ts`, `admin-people.spec.ts`,
`admin-person.spec.ts`, `admin-reports.spec.ts`, `admin-report.spec.ts`, `admin-play.spec.ts`,
`reason-sheet.spec.ts` and `admin-vault.spec.ts` hold the page (`admin-play.spec.ts` its lists, the end of a game and the close of a table as well, `match-result.spec.ts` the card),
`paused-game.spec.ts` what a player sees of a paused game, `play.spec.ts` of a table the staff closed and `notice-strip.spec.ts` the notice on every page and at a table; `app-stores.spec.ts` the guards and `profile-page.spec.ts` the shield.

## The garbage pass

`tools/qa/garbage-pass.mjs` sends the admin's routes garbage like every other: the staff change, a
note, a suspension, a lift, a clear, a sign-out, a mark under 18, a report's outcome, a game's switch, a game's end, a table's close, a notice put up and one taken down, and the vault's amounts as bodies, the pause as spared (its body is a
switch), the log's four query words, the people's three, the reports' two, the games being played's
three, the tables waiting's two and the live list's one. Its garbage accounts are not staff, so every one of them is answered as missing; what it
proves is that none is a 5xx.
