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
seats, so quick-matching backgammon - which plays two - had always asked for a four-seat table. It
asks `catalogue.defaults(game)` now.

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

**Matchmaking is a query.** `quick(game)` reads the open LIVE tables for that game, claims a chair
at the first one that still has one, and opens a table to wait in only when there is nothing to
join. Nobody is invented to fill it. Three things about that list were wrong for as long as there was
one game, and each put somebody at the wrong table silently:

- **A table with a game running is not open.** A player who left mid-game frees a chair, and the list
  offered it - to a newcomer who would sit in a chair with no seat in the match. `open()` excludes any
  table with an unfinished match, and the chair itself cannot be taken until the match is over:
  `claimSeat` refuses with the code `playing`, which the browser turns into its own sentence, and the
  claim's UPDATE carries `not exists` over an unfinished match as the belt. The play page no longer
  offers a watcher "Sit down" while a game is on.
- **Quick play means live.** A `turns` table is a day per move, and landing in one from a button
  called Quick play is a correspondence game nobody chose. The list takes a `mode` and quick play
  asks for `live`.
- **Fullest first, then oldest.** Newest-first scattered a burst of quick players across a burst of
  fresh tables, one each, all waiting. Filling the nearest-to-full table first is what actually starts
  games.

Quick play also sits down READY, and whoever takes the last chair presses Start - `matches_one_live`
already makes that idempotent, so two people filling the last two chairs at once still make one
match. A quick-play table waiting on somebody to press Ready is a table that never starts because
nobody was told they had to. `catalogue.defaults` opens the SMALLEST seat count of four or more, or
the largest the game plays: the largest was nine-seat poker, which a quick player would wait at all
evening.

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

**The realtime socket carries the introductions and that is its first non-doorbell frame.** `voice`
joins, leaves and reports a mute; `signal` relays one offer, answer or ICE candidate to one person.
It is not a delivery path for content - an SDP says how to reach a browser, not what anybody said -
and nothing about it is stored. The rooms live in the hub's memory and empty themselves when a
socket closes; a restart drops every call and the client rejoins through `onBack`.

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
`services/voice.rtc.ts` is framework-free (perfect negotiation, the lower handle is polite, a peer is
opened on its first signal so an offer that beats the roster cannot deadlock), and
`stores/voice.store.ts` takes it through `setVoiceCall` so a spec can observe the store without a
real `RTCPeerConnection`.

`tools/qa/voice-pass.mjs` is two real browsers on Chromium's fake microphone: join, a live remote
track in each, the tone lighting "speaking" in the OTHER browser, mute, leave. Run it by hand against
the built server with every change to this path.

### Voice while the game plays

**The host switches voice, and the switch is a table ring.** `POST /tables/:id/voice` is host-only and
refuses a closed table; turning it off needs no new hub verb, because every table ring re-asks
`voiceAllowed` for the whole room and `voiceAllowed` reads `tables.voice`. The dock carries the
switch at a wide container and the table menu on a narrow one. Turning it back on rings the others'
lobby, so their page offers the call - a toast with Join, once per table per visit, and again after
the host switches it off and on - without a reload.

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

**A `<Show>` with a thunk child rebuilds whenever its `when` re-evaluates, so a control inside one
that reads a roster loses its focus.** The per-person volume slider sat in a `when` that read the
voice roster, which changes on every speaking level, and the keyboard lost the slider after the first
key. It is a value-bound `<Show when let>` now, which swaps only when the value's truthiness does -
the voice pass is what found it, as "turning them back up" failing after "turning one down" passed.

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

**Every refusal has words, and the compiler checks it.** `REFUSALS` in `match/service.ts` maps each
reason an engine can give to a status and a sentence. It is a literal map rather than a
`Record<string, ...>` so `engine-contract.spec.ts` can require every engine's refusal union to be a
subset of its keys - the reasons are type unions and nothing about them exists at runtime to iterate.
An unlisted reason still answers, as "That move is not allowed.", but hokm's were unlisted for a whole
release and every one of them told a card player their TOKEN could not move there.

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
label for each in `docs/games/04-ludo.md`, which also lists the two open choices - and every one of
these was wrong in the first engine:

- **Own tokens share a square and never block each other**, on the track and in the home lane alike.
  There are no barriers; a token moves through an occupied square freely.
- **A six with no legal move still earns the extra roll.** Only a non-six with nothing to do ends the
  turn.
- **There is no "three tries to find a six".** A full yard rolling one to five simply passes. That
  rule belongs to other variants and was invented here.
- **Entering is a choice**, not an obligation: any yard token may come out on any six, with no
  requirement to finish a previous one first.

The rest is the ordinary game and is worth stating because each half is a test: capture happens on
exact landing only and never by passing over; the eight starred squares send nobody home; the five
home cells need an exact count, and an overshoot is simply absent from the legal set rather than
refused after the fact; three consecutive sixes end the turn and the third grants no roll; a capture
or a finish on a six still earns the roll.

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
times per seat count with random legal moves and fails if a family names a counter the engine never
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

**`match_actions.kind` is `play` or `forfeit`, and nothing else.** It was `roll | move | forfeit`,
which is ludo's vocabulary on the ledger every game writes to. What the platform actually reads is
whether somebody STOPPED - `record.ts` tells a walkout from a timeout by asking whether a forfeit
names a person - and how many decisions a seat made itself, which it counts from `payload ->> 'verb'`
on the rows that name a person, so the verb lives in `payload` where an engine's own words belong.

**`asMatch` reads no state at all.** The seats come from `match_players`, the turn from
`engine.turnOf`, and the winner from `matches.winner_seat`, which the recorder writes from the judge's
plan. `match_players.colour` went with it: its docblock said it was what the table is joined
on to draw a board, which stopped being true the moment the board became the engine's to compose, and
nothing had read it since. `tests/engine-seam.spec.ts` covers the whole shared path now -
`services.ts`, `watch.ts`, `record.ts`, `judge.ts` - and fails if any of them imports anything under
`ludo/`; `judge.ts` may import `rating.ts` and nothing else, and `rating.ts` nothing at all.

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

**Starting is a table verb and its preconditions live in the WHERE clause.** `POST /tables/:id/start`
inserts with `not exists`, a seat count and a readiness check all inside one statement, so there is
no window between reading a ready table and writing a match against it. That is still not enough on
its own - `not exists` cannot see another transaction's uncommitted row - so `matches_one_live`
arbitrates and a 23505 is read as "somebody else started it", which answers with their match. Any
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

**Leaving a live match is a forfeit with reason `left`.** It used to free the chair and nothing else,
so the leaver stayed in the match while the sweep played their turns and forfeited them three misses
later as a TIMEOUT - which the judge pays when the seat had played its share, so walking out of a lost
game banked the finish. `table.leave` now takes a forfeit callback and calls it FIRST inside its
transaction; `services.ts` passes `match.walkOut`, which locks the live match, and only then is the
chair freed, so the locks are taken match first and seats second, the order a finish takes them in.
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
idempotency key, and after every committed action each seat is PUSHED a `game` frame, composed for that
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
40, `resume` 20, `ping` 10), and past it the socket is closed 4429.

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
backgammon's turn counter, hokm's round and tricks taken, poker's hand and actions taken). `commit`
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

**`tools/qa/ludo-pass.mjs` plays complete games over the real api**, at two, three and four players,
through the routes a browser uses. It is API-level on purpose: it proves the rules, the persistence,
the turn order, the authorisation and the wire agree end to end, over hundreds of turns, in seconds.
What it cannot prove is that any of it is visible, which is the browser pass's job.

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

**The deck is stripped until it divides, and every other number is derived from that.** 52 at four,
51 at three (Pagat drops *"one of the 2's"*), and 50 at two - the house rule the product implements,
two twos out and twenty-five each, rather than Pagat's keep-or-reject draw over a stock.
`trickCount` is the deck over the seats and `winningTricks` is more than half of that, so the famous
seven is a MAJORITY rather than a constant: written as a literal 7 the two-handed hand would end on
the seventh of twenty-five tricks with eighteen still in hand.

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
the state would be a pause that depended on every reader being careful.

**Two phases, not eight.** The plan sketched a seven-state enum walking the deal round by round; what
a caller can DO is name trump or play a card, so those are the phases. Rounds of five and four are a
dealing ritual with no decision in them, and a state nobody can act in only exists to be stepped
past. There is no `deal.ts` and no `rotation.ts` for the same reason.

**A forfeit ends the MATCH, not the hand.** Four-handed hokm cannot be played three-handed, so there
is nothing to continue with; the side left standing is named so the board can stop, and `finish`
reports every seat still at the table as `unsettled`, because the game stopped before it decided
their order. The judge never rates two unsettled sides against each other: the three-handed survivors
are not rated against one another. The quitter takes a rated loss, team against team; the opponents
win only if they and the quitter had each played a hand's worth of cards (`engagement`: 7 at three and
four, 13 at two). `standings` puts a side with a seat out LAST whatever its points and lets sides
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
The one private thing is the deal, and the deal is not an event - so nothing private ever enters an
append-only ledger that `since` replays from revision zero forever.

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
else. It writes `revOf(state)` now.

**`tools/qa/hokm-pass.mjs` plays whole matches at two, three and four over the real api**, and it
checks one thing ludo's pass structurally cannot: every seat reads `GET /matches/:id` for ITSELF
after every turn, and no answer ever carries a card that reader is not holding. `hokm-seam.spec.ts`
proves the engine composes per seat; this proves it survives the route, the projector, the
serialiser and the wire.

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
table rather than touring a lobby for the rest of the run. A finish clears readiness, so that is
three requests: the partner's ready (the matrix keeps the partner's session for the whole run), the
tour account's ready, then the start. `fit-pass.mjs` readies every player before it restarts a
finished table for the same reason.

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
to vanish from the view entirely. Two to four pawns on one square stand side by side (`STACKS`), and
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
wrong browser at the wrong moment is a different failure from a broken build. It was asked at the
DEAL first, and at two players the deal pauses with cards in the Hâkem's hand and nowhere else - so
it passed or failed on which fixture happened to be Hâkem. It is asked after trump is called now, of
the browser that did not call it.

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
step that shrinks to fit, and breaks into two rows past thirteen, because twenty-five cards in one
row on a phone is a strip twelve pixels wide per card.

**Sort is the reader's, and it moves nothing on the server.** `arrangeHand` puts trump first,
alternates the colours after it and holds each suit high to low, which is how people hold cards; the
server's order is suit-major ascending and stays what `view.hand` is.

**Each board is its own chunk.** The play page loads `hokm-board` or `match-board` through a dynamic
import once it knows which game the match is, and renders it through `<Dynamic>` with a props THUNK,
so match updates flow into the loaded board the way direct markup props would. The route chunk fell
from 17.8 KB to 9.1 KB, and a Hokm player never downloads the Ludo UI.

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
  follow. A watcher is sent no `remainingMs`, so a watcher sees no ring.
- Hokm decides one row of cards or two from the stage's measured size (`room`), because two rows are
  only worth their height when one row would squeeze each card below a readable strip.
- `MatchResult` overlays the stage rather than pushing it down.
- Poker's raise is a toggle that opens the slider over the table, so the bar is one row of actions;
  the last hand is a `<details>` chip on the felt, which keeps a spectator's page free of buttons.

**The gate is `tools/qa/fit-pass.mjs`.** It opens a live hokm-2, hokm-4, poker-2, poker-6, backgammon
and ludo-4 table over the api (dana.w plus guests), advances each to a state with the most controls,
and opens every page as the seat whose turn it is at 360x740, 390x844, 768x1024, 1024x768, 1280x720,
1280x800, 1440x900, 1920x1080, 740x360 and 844x390, with the chat closed and open, then as a stranger
watching. It fails on a scrolling page, a plate, the surface or any button outside the viewport, and
a button whose centre hits something else. Two exceptions are deliberate: a button in a horizontally
scrolling rail is judged by its rail, and a phone held sideways lets the open chat overlay the bar,
because there the chat has nowhere else to be and closing it brings the controls back. It removes
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

**A page that failed while the server was away heals itself.** `onBack` in `realtime.store.ts` fires
when the socket connects after being down, and the lobby and the match re-read then. A deploy, a
restart or a dropped train connection used to leave "Couldn't load this" on screen until somebody
pressed Try again - found by restarting the built server with a game open. The play page also stopped
drawing its skeleton and its error at the same time: the error waits until nothing is loading.

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

- **Facts per seat.** `side` (the engine's `sideOf`; teams only in four-handed hokm), `place`
  (`standings`, competition-ranked), `quitter` (a forfeit row in the ledger; it WALKED if the row
  names a person, was timed out if it is null, and its `rev` is the exit order), `own` (the seat's
  play rows that name a person and carry one of the engine's `engagement` verbs - the sweep writes
  `user_id = null`, so autoplay never counts), `unsettled` (hokm only: everybody still at the table
  when a forfeit stopped it) and `trailing` (hokm only: those of them whose side was behind a side
  still in play).
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
  decisions at least `engagement(seats).after`: ludo 6 rolls, backgammon 4 moves or cube actions,
  hokm one hand's cards (7 at three and four, 13 at two), poker 3 betting actions with the blinds
  excluded - and only if the survivor was not `trailing`. Against a side with no quitter a seat is
  always rated, unless both are unsettled; then it is rated only when it is `trailing` and a member of
  its own side WALKED (the four-handed partner above).
- **A forfeit win pays the rating and the finish (D26).** A match whose LAST ledger row is a forfeit
  ended because the last opponent quit, and that is the fact the recorder hands the judge as
  `forfeited` (`unsettled` would only say so for hokm). Its winner's rating moves and the verdict pays
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
was the last chair owed - the same `settle` quick play sits down with. The result panel then walks
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
`turn` notification is written only for `turns` tables - a live table gives forty-five seconds to
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
