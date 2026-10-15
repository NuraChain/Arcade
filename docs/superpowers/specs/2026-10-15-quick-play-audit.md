# Quick play and player discovery: the audit

The owner's brief, 2026-10-15, the last task of the list: find out whether players using Quick Play
find each other, fix what stops them, and prove it with independent users against the real server,
for every game. This file is the ledger: how quick play works (1), what was wrong and why (2), what
was looked at and found right (3), what changed (4), what ran (5), what is left (6) and what
running it needs (7). Every number was measured on the production build unless it says otherwise.

## 1. How quick play works

**There is no queue, and there is one matchmaking path for all four games.** A search is a chair:
somebody waiting for a game is sitting READY at an open public table that has a free chair and no
game on (`lib/looking.ts` in the browser, `compatible()` in `table/service.ts` on the server). The
same request and the same transaction serve Ludo, Hokm, backgammon and poker; only the game's rules
row differs. Nothing is a bot and nothing is invented to fill a table.

From the button to the board:

1. **The press.** Every Quick play button (a game's page and the bar a phone keeps at its foot,
   Home's hero) opens one sheet, `QuickFinder` (`lib/find-game.ts`). It offers the game, the
   formats `formatsOf` says the game makes, and the options its rules have (pace, length, cube,
   blinds), each "Any" until chosen except the pace, which starts on Live. The last choice is kept
   for each game with the device's settings.
2. **The request.** `lobby.quick(game, ask)` posts `POST /api/tables/quick` with the game, what was
   chosen and the device's voice preference. One search per game is out at a time in the browser,
   and a second press is handed the same promise (`finding()`).
3. **The rules.** `quickOf(rules, ask)` (`table/quick.ts`, pure, read by the browser too) answers a
   FILTER (exact where chosen, any where not, live unless turns was asked) and a table to MAKE, the
   smallest the game plays where no size was chosen, or refuses (`quick-options`); an unknown or
   closed game is `quick-game`.
4. **One transaction**, tried again on a unique violation or a deadlock:
   - the SEARCHER's lock (`pg_advisory_xact_lock(hashtext('quick:who'), hashtext(person))`), so
     one person's searches run one after another;
   - **already playing**: a live search by somebody still in a live game, of any game, is answered
     with that game's table, and nothing is written;
   - the GAME's lock (`pg_advisory_xact_lock(hashtext('quick'), hashtext(game))`), so two
     searchers who both find nothing cannot both open a table; `lib/keyed-queue.ts` keeps one search
     a game at a time inside the process so the wait holds no pooled connection;
   - **already waiting**: a compatible table where the searcher sits ready is the answer, and
     nothing is written (a double tap, a reload);
   - the fifty-table limit (`seated-max`);
   - **one live search at a time**: a live search lets go of the searcher's other ready waits at
     live tables quick play opened;
   - **candidates**: open, that game and pace, public or the host's friends', no game on, a free
     chair the searcher may take, nobody blocked either way, no adult and minor who are strangers;
     fullest first, then fewest not ready, then oldest; at a live table everybody sitting must be
     here (`hub.present`: a socket open or lingering, or a request in the last twenty seconds);
   - **a chair**: the table's own lock, the free chairs `for update skip locked`, `chairFor`, an
     UPDATE that seats the searcher ready only if the table is still open with no game on, and the
     table's chat;
   - **or a table**: public, chat on, the call that was asked for, the searcher in the first chair
     and ready, and a `quick_tables` row.
5. **The start.** The port reads the table back; if every chair is taken and ready with no game on
   it starts the game itself (the start the Start button reaches), as a courtesy: a start that fails
   is logged and the table stays full and ready with Start on every page. Then the table is rung.
6. **The arrival.** The browser reads its tables again, goes to `/app/play/:id`, and the play page
   opens the table, which ends the search's `finding()`; a page that never opens it ends it after
   ten seconds (`ARRIVAL_MS`).
7. **Waiting.** The waiting room draws the table about to be played and says "Looking for players:
   n of N here". The page holds the socket while the reader sits ready at a live table, on any
   page; the strip on other pages says a search is on and offers to stop. Every change to the table
   rings it, and every page at it reads it again.
8. **The game.** The start pushes each seat a `game` frame (kept by the match store for ten
   seconds if the page has not opened the game yet), the table's ring turns the waiting room into
   the board, and somebody elsewhere in the product is told "Your Ludo game has started" with the
   way there.

**Leaving the search** is leaving the chair: the waiting room's Leave or the strip's Stop looking,
a leave that forfeits nothing, and the table closes behind the last one out. **Somebody who goes
away** is stood up by the waiting-table sweep on the second sweep that finds them absent (45 to about
105 seconds after their socket went), and nobody is notified. **Somebody who never comes to a game
that started** has their turns played by the clock and is forfeited on the third missed turn in a
row; a game of two then ends, and a larger one goes on without them.

The lifecycle in the brief's words: SEARCHING is the request in flight (`finding()`); QUEUED is a
ready chair at an open table with a free chair; MATCH_FOUND is the last chair taken; STARTED is the
server's start in the same request; CANCELLED is leaving the chair; EXPIRED is the sweep standing
an absent searcher up; FAILED is a refusal (`quick-game`, `quick-options`, `seated-max`), a failed
transaction (nothing written), or a start that would not start (logged; the table stays full and
ready). The backend decides every one of them; the browser only shows them.

**What is shared and what is not.** Tables, chairs, matches and the quick-play rows are Postgres,
and so are the searcher's, the game's and each table's locks, so DISCOVERY and ASSIGNMENT are the
database's and hold across processes. What is memory in one process: who is here, every doorbell
and every push, the waiting-table sweep's strikes, voice rooms and parties. The deployment is one
process per database; section 6 says what two do.

## 2. What was wrong, and why

R1 to R3 were reproduced with independent accounts, each with a real socket, against the built
server, before anything was changed. R4 is an absence. R5 was read in the code and then shown by
running two servers on one database, which is how R6 was found; R7 was found by walking quick play
by hand in a real browser.

**R1. Two people who leave every choice open waited at a table for four.** With nothing chosen, a
search opened `seatsByDefault`'s table, the smallest of four or more: four at Ludo and Hokm, six at
poker. Two fresh accounts pressing Quick play with "Any" were seated together at Ludo 2 of 4, Hokm 2
of 4 and poker 2 of 6, open, no game, for as long as they waited; only backgammon, which plays two,
started. The search's own table now is the smallest the game plays, so the next searcher fills it;
a table of four that somebody chose still fills first, because the fullest compatible table is
joined before anything is opened. (`1b8454b6`)

**R2. One person held several waits and was dealt two live games.** A search never let go of the
searcher's other waits. One account that looked for Ludo for four, then Ludo for two, then
backgammon held three waiting chairs; when two more people searched, it was in two live games at
once (Ludo for two and backgammon) and still waiting at Ludo for four. A live search now lets go of
the searcher's other ready waits at live tables quick play opened, under the table's lock, and one
person's searches run one after another under their own lock; two people's crossing searches can
deadlock on two tables' locks, Postgres ends one, and it is tried again. (`7e5122ef`)

**R3. A search from where the browser could not see the first one seated the player twice.**
Another tab, or a press after a request the browser gave up on while the server went on to seat
them and start the game: the second search found the game already started, no longer waiting, and
seated the player a second time. A live search now asks first whether the searcher is still playing
a live game, of any kind, and answers with that table; still playing is the engine's word, so a
seat that gave up and a poker seat out of chips search as before. The browser says "Your Backgammon
game is still on" when the table it is taken to is another game. (`f8afa98b`)

**R4. Nothing said what a search did.** No log line answered any of the brief's questions. Every
answer now writes a `quick play` line (the game, the account's id, what was asked, the outcome, the
table, the game that started, chairs taken of seats, tables passed over because somebody was away or
the chair went first, waits let go, time taken), a refusal writes `quick play refused` with its word,
and after each table sweep `waiting for a game` gives each game and pace its waiting players, tables
and longest wait. (`ab625d7e`)

**R5. Two servers on one database lose each other's players, and nothing said so.** Presence, the
sweep and the pushes are one process's. Two servers on one database pass over each other's waiting
players, never tell a player on one that the other started their game, and stand each other's
waiting players up. Development ran exactly that: two working trees' servers on one shared
development database. The deployment is one server per database and stays so (section 6 says why);
every server's connections now carry its name, a server that finds another one on its database
logs it, and the README says to run one. (`564c46d9`)

**R6. Two servers booting together on a new database: the second died.** Found by the cross pass's
first start, before it asked anything. Both seeded the catalogue at once, and `on conflict (id)`
cannot arbitrate an insert that meets the other's same row first on `games.slug`. The seed now takes
an advisory lock first. A spec seeding an empty database from two connections failed in round six
of eight before it and passes after. (`6138cb76`)

**R7. The toast that says a game has started left before it could be pressed.** Found walking quick
play by hand in a real browser: the walker searched backgammon, went to Friends, the helper filled the
table, and "Your Backgammon game has started" came with its button, an ordinary actionable toast of
six and a half seconds, gone by the time it was pressed. For a player away from the table that is
the only word that a game with a thirty-second clock is theirs; after it only the Games badge and
the tab's title say so. It now stays until the reader opens that table, leaves it, or the game
ends without them, and can still be closed. (`9f8912e7`)

Not defects, and recorded so nobody looks again: the table's ring reaches the waiting player two
milliseconds after the `game` frame (a check that does not wait sees none); a game nobody played
enough of is "no contest" for the one who stayed, not a win, by the judge's engagement rule.

## 3. What was looked at and found right

- **Queue keys.** The game is the lock's key and the filter's first column; seats, target, blinds,
  cube and sides are exact when chosen and "any" when not; the pace is live unless turns was asked.
  Ids are the catalogue's (`ludo`, `hokm`, `poker`, `backgammon`), and `quickOf` is one function
  both halves import, so the browser cannot send a filter the server reads differently.
  `reference-parity.spec.ts` asks it the same question of both copies of the rules.
- **Isolation.** Eight accounts searching four games at once made four tables of two, each one game.
- **Concurrency.** Eight at once for Ludo at four made two started tables of four, nobody twice;
  ten searchers through separate service instances make tables of four, four and two; two
  searchers on the last two chairs start one game; a search against a leave, a close and a claim
  by hand, each parked at a gate, takes one chair or none (`quick.db.spec.ts`).
- **Notifications.** Both players of a game quick play starts are pushed the game on their own
  socket and rung about the table; a third account is told nothing; somebody on another page is
  told by a toast that leads to the table.
- **Cancellation and stale waits.** Stopping takes exactly that chair, rings whoever still waits and
  closes an empty table; a closed socket's chair is stood up on the second sweep and not the first;
  a reconnect inside that window keeps the chair; a turn-based wait is never stood up.
- **A failure while opening a table** leaves no table, chair or thread, and is tried again when it
  is a collision (`quick.db.spec.ts`, *when opening a table fails*).
- **The browser's states.** One search per game, the same promise for a second press, the busy
  sheet, the strip, the arrival window, the refusal's sentence, the toast when a game starts
  elsewhere; nothing restarts a search by itself.
- **Each game's rules.** Ludo 2, 3, 4 and two against two; Hokm 2, 3 and two against two (four is
  only ever in pairs); poker 2, 6, 9, live only; backgammon 2, to 1, 3 or 5, live or a move a day.

## 4. What changed

| Commit | What |
|---|---|
| `1b8454b6` | fix(quick): a search that leaves the size open opens a table of two |
| `7e5122ef` | fix(quick): one live search at a time for each player |
| `ab625d7e` | feat(quick): the server's log says what each search did and who is waiting |
| `f8afa98b` | fix(quick): a live search finds the live game the searcher is still in |
| `122071e0` | test(quick): a table that fails to open leaves nothing behind |
| `564c46d9` | feat(server): a server that finds another on its database says so |
| `6138cb76` | fix(db): two servers starting on one database seed it one after the other |
| `28d899d5` | test(qa): quick play through the api, through the browser and across two servers |
| `9f8912e7` | fix(cues): the toast that says a game has started stays until it is seen |
| `767b3690` | test(qa): the quick play pass waits out an ordinary toast before it presses |

Files: `backend/src/domains/table/{quick,service}.ts`, `backend/src/domains/match/service.ts`,
`backend/src/services.ts`, `backend/src/main.ts`, `backend/src/data-source.ts`,
`backend/src/db/seed-reference.ts`, `frontend/src/components/games/quick-finder.component.azeroth`,
`frontend/src/stores/cues.store.ts`, the two Persian and English catalogues, and the specs and
passes below. No schema change, no new environment variable.

## 5. What ran

**Specs.** `quick.db.spec.ts` 58 against Postgres (it was 39), `servers.db.spec.ts`,
`seed-race.db.spec.ts`, `table-sweep.spec.ts`, `quick-options.spec.ts`, `quick-finder.spec.ts`, and
every database spec that reaches quick play (`match`, `table-removal`, `table-refusals`,
`table-sweep`, `party`: 147). Faults put into the code one at a time, each caught by a spec: 3 for
R1, all of R2's meaningful ones, 23 for R4, 8 for R3's server half and 3 for its browser half, 2 for
the failed-opening specs, 8 for R5, 6 for R7; R6's spec failed against the code before the fix,
in round six of eight. A guard no fault could tell from its absence was taken out.

**The api pass**, `tools/qa/quick-pass.mjs`, 70 checks, 44 accounts each with a real socket.

**The browser pass**, `tools/qa/quick-play-pass.mjs`, 39 checks, 20 accounts each in a browser
context of its own (desks and phones): all four games, Hokm two against two with four browsers,
stopping and looking again, a game starting while the player is elsewhere and its toast still there
after an ordinary toast's time, a reload while waiting, the live-game answer, one search at a time,
and a clean console.

**Two servers**, `tools/qa/cross-pass.mjs`, 12 checks, 10 accounts over two independent production
servers on one disposable database: what holds (eight turn-based searches through both servers make
two full tables with players from both, nobody twice; the two boot together) and what does not
(section 6).

**On the final build**, after the last commit: `npm run check` clean with no warning; the server's
suites 1,386 and the browser's 3,372, and both again in a shuffled order (seeds 1792092186957 and
1792092141750); every database spec against Postgres, 492 tests in 33 files (the 34th,
`record-snapshot.db.spec.ts`, records only when asked to), and `seat-race.spec.ts` with
`realtime.socket.spec.ts` given the database too, 29; the api pass 70, the browser pass 39 and the
two-server pass 12 again, all clean, the two servers this time started together on a new database
and both seeding it, and the games pushed through B where the first run pushed them through A; the
voice pass 55 of 55. The shuffled order that failed one browser test during the networking audit
(seed 1792086833443: a four-second wait in `play-chunks.spec.ts` missed by 17 ms on a loaded machine,
and passing alone) passed whole on a quiet one, 3,372 of 3,372. The responsive matrix was started on
this build and stopped at the owner's word that it was not needed now; its last full run, 960 cells
with no finding, was on the networking audit's build.

**By hand, in a real browser** through the Playwright MCP, on the built server, a fresh wallet as
the walker and a second driven over the api: in Persian at 390, the Ludo page and its sheet, the
waiting room ("1 of 4 here"), the strip on Home counting the helper in without a reload, Stop looking
(the walker held no chair and the helper kept theirs), the backgammon sheet asking only what
backgammon has, the toast on Friends when the game started (where R7 was found), and Quick play for
Ludo during a live backgammon game taking the walker back to it with "the game is still on"; in
English at 1280, the poker sheet, its waiting room, and the waiting room turning into the table as
the helper filled it. The console held nothing, error or warning, over the whole walk. The server's
log carried a `quick play` line for every search and a `waiting for a game` line after each sweep.

## 6. What is left

- **One server per database.** Discovery and assignment hold across processes; presence, pushes,
  the sweep, calls and parties do not, and the cross pass shows each: a live search on one server
  passes over the other's waiting player and opens a table of its own, a game is pushed only to the
  starting server's sockets, and the other server's sweep stood a connected player up, after 53
  and 52 seconds in the two runs. Carrying them across would take a channel between processes (Postgres `LISTEN`/`NOTIFY`
  is there to be used) for every push and for presence. That is not built: the product runs one
  process, and a half that crossed would mislead more than it helped. The server warns when it
  finds another.
- **A server from before this does not carry a name**, so the warning cannot see it.
- **Sitting down by a link** still asks whether the table has closed before its own transaction,
  and can land in one that closed in that instant.
- **A live game somebody plays at a table opened by hand** is answered too: a search sends them back
  to it, whatever game they asked for, until they give it up.

## 7. Running it

Nothing to migrate and nothing to configure. Run one server per database (README). The log answers
the brief's questions: how many wait for each game is the last `waiting for a game` line; whether
people who should meet are kept apart is two tables of one game and pace there, or two `quick play`
lines that each `opened` with nothing passed over; where a search stopped is its `outcome`, with
`away` or `missed` when it walked past tables; whether a filled table started is its `match`; a chair
stuck waiting is an `oldest` that keeps growing (the sweep's `absent players stood up` line frees
one); which games and formats fail most is the `quick play refused` lines counted by `game` and
`code`; a second server is `another server is using this database`. The table's id joins a search
to its game, the sweep and every request that reads the table.
