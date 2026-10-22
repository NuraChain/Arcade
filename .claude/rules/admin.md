# The admin

`/admin` is where the platform is run from, by the owner and the people the owner chooses. The
design, with the decisions and what was not chosen, is
`docs/superpowers/specs/2026-10-22-platform-admin-design.md`.

## The staff

**Three roles, each above the last: moderator, admin, owner.** `domains/admin/roles.ts` imports
nothing and both halves read it: `ABILITIES` says which role a section needs (`people` a moderator,
`money`, `staff` and `log` an admin, `wallet` the owner), `may(role, ability)` answers, and `outranks(actor, other)` is
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
no vault), and every staff action on them by their id, so a rename does not hide one. The account's
id never leaves the server. No IP is stored or shown.

**A note is a staff action** (`kind = 'note'`, its words where a change keeps its reason): `POST
/api/admin/people/:handle/notes`, `{ text }`, three to five hundred characters with one that is not a
space. The writer must outrank the person, as for any action on an account (a moderator writes on
players, an admin on players and moderators, the owner on anybody), and nobody writes one on
themselves (`staff-self`). It answers with the person as they now read.

**A cursor here carries microseconds** (`domains/admin/keyset.ts`): the time of the page's last row
in whole microseconds since the epoch and its id, compared in SQL. A JavaScript date has
milliseconds, and a cursor built from one skipped a row written in the same millisecond as the
page's last row and a few microseconds before it. The log uses the same cursor.

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
handle. The kind, by whom and about whom are in the address
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
`LogEntry`. The note form is drawn only for somebody the reader outranks and never on their own
page; a note is shown at the press, said once kept, and taken back with the refusal's words. A
handle nobody holds is "No one by that name." (a 404 read as missing, never as a failure).

**Money** is the vault panel, and its calls are drawn for the owner alone (`may(role, 'wallet')`):
an admin whose wallet happens to hold a role on the vault is told that only the owner changes it
from here, because the server would refuse the call.

`admin-shell.spec.ts`, `admin-staff.spec.ts`, `admin-log.spec.ts` and `admin-vault.spec.ts` hold the
page; `app-stores.spec.ts` the guards and `profile-page.spec.ts` the shield.

## The garbage pass

`tools/qa/garbage-pass.mjs` sends the admin's routes garbage like every other: the staff change and
the vault's amounts as bodies, the pause as spared (its body is a switch), the log's four query
words. Its garbage accounts are not staff, so every one of them is answered as missing; what it
proves is that none is a 5xx.
