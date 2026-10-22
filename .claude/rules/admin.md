# The admin

`/admin` is where the platform is run from, by the owner and the people the owner chooses. The
design, with the decisions and what was not chosen, is
`docs/superpowers/specs/2026-10-22-platform-admin-design.md`.

## The staff

**Three roles, each above the last: moderator, admin, owner.** `domains/admin/roles.ts` imports
nothing and both halves read it: `ABILITIES` says which role a section needs (`people` and `reports`
a moderator, `money`, `staff` and `log` an admin, `wallet` the owner), `may(role, ability)` answers, and `outranks(actor, other)` is
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

**A cursor here carries microseconds** (`domains/admin/keyset.ts`): the time of the page's last row
in whole microseconds since the epoch and its id, compared in SQL. A JavaScript date has
milliseconds, and a cursor built from one skipped a row written in the same millisecond as the
page's last row and a few microseconds before it. The log uses the same cursor.

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
  table that loses the stake, as any walkout does; a waiting table stands them up.
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

## Money

The vault section (`.claude/rules/stakes.md`, *The owner's view of the vault*) is `money`: an admin
sees it, read for their own wallet's roles on the vault. The calls that change it (fee, ceiling,
fees, pause) are `wallet`, the owner's alone: an admin asking for one is answered as a page that is
not there and no call is composed (`stake.db.spec.ts`).

## The page

**`/admin` is a layout of its own, outside the app shell** (`components/admin/admin-shell`): a
header with the way back to the app and the reader's handle and role, then the sections the role
opens, as a rail under the header on a phone and down the side from 64rem, each a lazy page under
`pages/admin/`. `lib/admin-sections.ts` lists the sections in order, and a section IS an ability of
`roles.ts`, so one list (`sectionsFor(role)`) draws the nav, guards the layout (`requireStaff`: the
role opens some section) and decides the shield in the profile's corner; each section keeps its own
`requireAbility`. `/admin` itself goes to the first section the role opens (`firstSection`), and
anybody whose role opens none is shown the page that is not there at every address under it, as
the server answers them. The shell starts the toasts, the session and the signed-out watch and holds
the overlays and the toasts; it opens no socket.

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

**People** is the first section, and the one a moderator has. The list searches once the typing
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

`admin-shell.spec.ts`, `admin-staff.spec.ts`, `admin-log.spec.ts`, `admin-people.spec.ts`,
`admin-person.spec.ts` and `admin-vault.spec.ts` hold the page; `app-stores.spec.ts` the guards and
`profile-page.spec.ts` the shield.

## The garbage pass

`tools/qa/garbage-pass.mjs` sends the admin's routes garbage like every other: the staff change, a
note, a suspension, a lift, a clear, a sign-out, a report's outcome and the vault's amounts as bodies, the pause as spared (its body is a
switch), the log's four query words, the people's three and the reports' two. Its garbage accounts are not staff, so every one of them is answered as missing; what it
proves is that none is a 5xx.
