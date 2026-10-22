# The platform admin: the design

The owner, 2026-10-22: "You should work on admin page research and add those things that really
one admin game should have such as i dont know users monitoring everything that admin should have
for control this platform plan mode task mode work on it also we should have multi admins".

So `/admin` becomes the place the platform is run from, by the owner and by the people the owner
chooses. This file is the design: what the admin shows and does (1), who may do what (2), the log
every change leaves (3), what can be done to an account (4), the reports (5), the games (6), what
is happening now (7), a notice to everybody (8), what staff can and cannot see (9) and how it is
proved (10). The decisions are listed last (11), each with what was not chosen.

## What there was

`/admin` opened for one wallet, `ADMIN_WALLET_ADDRESS`, and held the vault of the paid tables. Two
safety flags had no caller: `users.is_suspended` was honoured by every read (sessions, the social
reads, quick play) and nothing set it, and `users.is_minor` could only be set by hand. Wallet
sign-in did not ask about suspension: it opened a session the session lookup then refused, so a
suspended person would have been signed in and at once signed out, with no word of why. Reports,
franked so the message a reporter disclosed is checked, had a status nothing moved, and nobody could
read them. `games.status` was meant for an operator and only SQL could change it. A match the turn
sweep could not play was postponed and logged as `unplayable match` for ever.

What game platforms' admin tools have in common: staff roles (moderator, admin, owner) where nobody
acts on a rank above their own; a search for players and a profile view with their history and
staff notes; warnings, suspensions for a time or for good, and lifting them; a reports queue; a live
overview; a log of every staff action that nothing edits or deletes, searchable by who, whom and
what; announcements; every action decided on the server. Chess.com closes an account with a reason,
gives the games it was playing to the opponent, and takes appeals through support.

## 1. The sections

`/admin` keeps a layout of its own, outside the app shell, mobile first, in both languages. The
sections are a row at the top of a phone and a column beside the page from 64rem, and each is drawn
only for a role that may see it (2).

| Section | Shows | Does |
|---|---|---|
| Overview | accounts (all, new today, new this week, active today), online now, live matches and waiting tables by game, reports waiting, accounts suspended, the vault (in play, fees held, games stuck), and this server's health (uptime, memory, event-loop delay, database pool, sockets, requests and errors in the last hour, the last fifty server errors) | read again |
| Live | everybody online now and what they are doing: a game of what at which table, waiting at one, in a call | open the person |
| People | a search by handle, name or wallet, and lists: newest, suspended, minors, staff, reported. A person: who they are, their ratings and recent games, their paid play, their sessions and devices, the reports they filed and the ones against them, every staff action on them and the notes | suspend, lift, mark or unmark a minor, remove the picture, reset the name, clear the bio, end every session, add a note |
| Reports | the queue, the oldest unhandled first. A report: who filed it, against whom, the category, the message disclosed with it, and their recent games together | reviewed, actioned, open the person |
| Play | the games and their status, live matches, waiting tables, matches the sweep cannot play | a game on or off, void a match, close a table |
| Money | the vault, as the paid tables built it | the wallet calls (fee, ceiling, fees, pause) |
| Staff | the owner, the admins and the moderators, who made each one and when | grant, change, revoke |
| Log | every staff action: who and in which role, what, on whom, why, when | filter by staff member, person or kind |
| Notice | the notice everybody sees now | put one up, take it down |

## 2. Roles

Three, each above the last: **moderator**, **admin**, **owner**. `domains/admin/roles.ts` imports
nothing and is read by both halves, so the server's rule and the sections a page draws are one table.

| | Moderator | Admin | Owner |
|---|---|---|---|
| Overview, Live, People, Reports | yes | yes | yes |
| Account actions and notes | on players only | on players and moderators | on anybody but themselves |
| Report outcomes | yes | yes | yes |
| Play | | yes | yes |
| Notice | | yes | yes |
| Money | | sees it | sees it and is handed the wallet calls |
| Staff | | grants and revokes moderators | grants and revokes admins and moderators |
| Log | the history on a person's page | all of it | all of it |

**The owner is the wallet the operator names**, `ADMIN_WALLET_ADDRESS`, as before: exactly one,
never granted or taken away in the page. Admins and moderators are rows of `staff_members`, made in
the page. Nobody acts on themselves or on a rank equal to or above their own.

**A caller who is not staff is answered as a page that is not there**, on every admin route, in the
bytes a missing page gets: the rule every private thing in this product follows. A section a role
may not see is the same 404 for that role.

## 3. The log

Every change an admin makes needs a reason, from three to five hundred characters, and writes one
row of `staff_actions` in the transaction that makes the change: who did it, the role they held, the
kind, the person, report, table, match or game it was done to (with the handles as they were then,
so a renamed or deleted account still reads), the reason and the details (until when, from what to
what). No route edits or deletes a row, and the rows are kept. A reversal is a row of its own:
lifting a suspension does not erase it.

## 4. An account

- **Suspend**, for a day, a week, thirty days or for good, under a category (harassment, spam,
  cheating, inappropriate, other). In this order: every seat they hold is left as a walkout through
  the port a player's own Leave goes through, so a live game is forfeited (at a table played for
  NURA the stake goes with it), the people at each table are rung and the result is said; then the
  account is marked, every session is ended and every socket closed. Every read already hides a
  suspended account. A suspension for a time is lifted by a sweep each minute, which writes its own
  row.
- **What the suspended person is told.** Signing in answers `suspended`, with when it ends and the
  category, and the sign-in page says so in the reader's language. The NURA they hold in the vault
  stays theirs: the vault's `withdraw` is never paused and anybody can call it from their own
  wallet. There is no appeal in the product.
- **Mark a minor**, or take the mark away. Stranger messages go off (the CHECK on `users` asks for
  that), paid play is barred, and a paid game they are playing is voided with every stake given back.
- **Content**: remove the picture (the server's copy, and the stored file when no other account uses
  it), reset the name to the handle, clear the bio. Nobody is notified.
- **End every session**: what a person reaches for after losing a laptop, done for them.
- **A note**: a line for the other staff, kept in the log.

## 5. Reports

The queue holds what nobody has handled, the oldest first. A report shows who filed it, against
whom, the category, the message disclosed with it (checked against its frank when it was filed, so
it is what was said), and the games the two played together recently. It ends **reviewed** (nothing
done) or **actioned** (an account action was taken, and the report says which). The reporter's own
list of reports shows the new status; nothing else tells them.

## 6. Play

- **A game off or on**: off stops new tables and searches (`rulesOf` already refuses a game that is
  not `available`), and games being played finish.
- **Void a match**: it ends as no contest: nobody is rated, nobody earns anything, the seats are
  `void`, a game played for NURA gives every stake back, and the table's chat says the staff ended
  it. For a match the sweep cannot play, and for anything else that has gone wrong.
- **Close a waiting table**: everybody stands up and the table closes.

## 7. What is happening now

The overview is counted, never estimated, read when it opens, when asked and every fifteen seconds
while it is seen. This server's health comes from an ops reader `main.ts` hands the services: the
hub's sockets and the people on them, the process's uptime and memory, the event loop's delay, the
database pool, and a ring of the last fifty server errors kept where `request failed` is logged. One
server per database stays the rule, and these are that server's numbers. **Live** lists who is
online and what they are doing; staff never watch a table they could not otherwise watch.

## 8. A notice to everybody

One line in English and one in Persian, with an end time, shown as a strip on every page of the app
until it ends or is taken down. It travels in the realtime `pulse` frame, which already goes to
everybody, so every open page shows it at once.

## 9. What staff see

No message but what a report disclosed: everything else is sealed and stays sealed. No IP address is
stored or shown. A session shows the browser it was opened in and when it was last used. Wallet
addresses are shown: they are public on the chain.

## 10. How it is proved

Unit specs for every role against every action and rank; database specs for each service against a
disposable Postgres (a non-staff caller answered as a missing page byte for byte on every route,
each action's effects and its log row, a suspension's forfeits and the sign-in refusal, the sweep
on time and not before, a minor's paid game refunded, a void, a game off, the counts, the notice);
browser specs for every section in both languages; `tools/qa/admin-pass.mjs` over the api of the
built server; the garbage pass taught the new routes; a walk through the Playwright MCP with the
owner, a moderator and a player in three browsers at 390 in Persian and 1280 in English.

## 11. Decisions

| | Decision | Not chosen |
|---|---|---|
| D1 | The owner is the operator's wallet, one, never granted | several owners made in the page |
| D2 | The owner grants admins and moderators, admins grant moderators; a handle and a reason, the session is enough | a wallet signature for every staff change |
| D3 | Nobody acts on themselves or on an equal or higher rank | owners and admins act on anybody |
| D4 | A reason on every change, one row in the same transaction, nothing edited or deleted, kept | a retention window |
| D5 | Suspension forfeits live games at once, ends sessions and sockets; a sweep lifts a timed one | leaving live games to the clock |
| D6 | Sign-in says suspended, until when and why; the vault stays withdrawable; no appeal flow | an appeal form |
| D7 | A minor's live paid game is voided and refunded | letting it finish |
| D8 | Content reset without a notification (a new kind would change a CHECK the other worktree's database shares) | a notification |
| D9 | Report outcomes show in the reporter's list | a notification |
| D10 | Void is no contest with a full refund | forcing a result |
| D11 | The overview reads every fifteen seconds while seen | realtime frames |
| D12 | Live shows who is online and what they are doing; no watching private tables | watching any table |
| D13 | A notice in the `pulse` frame, shown as a strip | none |
| D14 | `/admin` keeps its own layout; staff reach it from their profile | inside the app shell, whose budget is spent |
| D15 | No message beyond a disclosure, no IPs, sessions by browser and last use | |
| D16 | New tables only (`staff_members`, `staff_actions`, `suspensions`, `notices`) | changing `users` or `reports` |
| D17 | Not here: automatic cheat detection, IP or device bans, an appeal desk, email, charts over time, export | |
