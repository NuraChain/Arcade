# The server — notes for Claude Code

Loaded when working under `backend/`. The house rules, commands and gates are in the root `CLAUDE.md`.

## The server

`backend/` owns the wire shape. A new field starts in `backend/src/schemas.ts`; the browser's type is
inferred from that declaration, so it is decided in exactly one place.

**The client-safe triangle is load-bearing.** `frontend/src/api.ts` does
`import type { Api } from '../../backend/src/api.ts'`, which pulls `api.ts`, `schemas.ts` and
`ports.ts` into the WEB typecheck program — and that program is `frontend/tsconfig.json`, which
has no `experimentalDecorators`. One entity reached from those three files, even as a type, is
parsed as an ES decorator instead of a legacy one and fails `azeroth check`. That is why route
handlers are **injected** through `Ports` rather than imported: `api.ts` names what it needs,
`services.ts` provides it, and the decorated half never crosses the line.

**TypeORM is on 1.x.** The major was taken behind its two canaries and both were green without a
source change: `decorator-metadata.spec.ts`, which pins entity registration, `design:type` metadata
and class fields staying off the instance - precisely the surface `experimentalDecorators` +
`emitDecoratorMetadata` + `useDefineForClassFields: false` rests on - and the whole 156-test
`test:db` suite against a real Postgres.

**This backend compiles.** `typeorm` in `dependencies` is what decides that — the CLI carries
`DECORATOR_PACKAGES = ['typeorm', '@mikro-orm/core']` and the name alone flips the project from
running `src/` directly to emitting `.dist-backend/`. Node's TypeScript support is strip-only and rejects
decorator syntax outright, so there is no other way to run an `@Entity` file. Consequences that
are not obvious, each of which costs an afternoon to rediscover:

- **`rootDir: "src"` is mandatory.** The CLI builds `builtEntry` as a flat `<outDir>/main.js`. One
  file pulled in from outside `src/` moves emit to `.dist-backend/src/main.js`, and `azeroth dev`
  then polls `existsSync` forever with no error and no timeout. Stating `rootDir` turns that into a
  TS6059.
- **`outDir` is spelled `./../.dist-backend`, and the `./` is load-bearing.** The CLI reads outDir
  from the tsconfig TEXT with a regex that strips one leading `.` or `./`, so a tidy `../.dist-backend`
  is read as `./.dist-backend` and `azeroth dev` waits on `backend/.dist-backend/main.js`, which never
  appears. The same silent hang as above, from the other end.
- **`useDefineForClassFields: false`, explicitly.** At the ES2022 default every declared entity
  field installs `undefined` over the accessors TypeORM attaches for relations. Silent corruption,
  never a crash.
- **`rewriteRelativeImportExtensions: true`**, because house style keeps `.ts` on relative imports
  and real emit would otherwise be TS5096.
- **No `incremental`/`composite`**: `azeroth check` (`--noEmit`) and `azeroth build` share one
  tsconfig and would share one `.tsbuildinfo`.
- **`backend/vitest.config.ts`, never `vite.config.ts`.** A vite config in a directory that declares
  no vite drops it to `kind: 'none'` and every `azeroth` command exits 2.
- **Two compilers transform this workspace, and both are configured.** `tsc` builds it from
  `tsconfig.json`; **vitest transforms it with oxc**, which does NOT read that tsconfig for files
  under `tests/`, so `backend/vitest.config.ts` states the decorator transform itself
  (`oxc.decorator.legacy`, `oxc.decorator.emitDecoratorMetadata`,
  `oxc.typescript.removeClassFieldsWithoutInitializer` — oxc's spelling of
  `useDefineForClassFields: false`). An `esbuild` block there is silently ignored with a warning.
  Without this, a spec importing an entity dies with a bare `SyntaxError: Invalid or unexpected
  token` that names neither decorators nor the config that fixes them.
  `backend/tests/decorator-metadata.spec.ts` pins all three properties — registration,
  `design:type`, and class fields staying off the instance — so none of it can regress quietly.

**The entities had drifted from the schema, and nothing could see it.** Every query in this server
is raw SQL through `DataSource.query()`, which never loads entity metadata - so an entity could be
missing a column the schema had carried for a long time and every gate stayed green.
`users.allow_stranger_messages` and `users.show_online` were absent from `User` while
`PERSON_COLUMNS` read them on every person payload; the whole franking disclosure was
absent from `Report`, whose docblock still said franking "arrives with the E2EE work"; and
`GameRule.stakes` carried a duplicate `@Column` - a stray decorator with a blank line after it - so
the property was registered twice and TypeORM silently used one of them.

None of that is cosmetic the moment anything reads through a repository, which is the direction this
server is moving. `tests/schema-parity.db.spec.ts` compares `entityMetadatas` against
`information_schema.columns` in BOTH directions and fails on a duplicate registration, because the
two failures are different: a column in the entity and not in the table is a query that breaks
loudly, and a column in the table and not in the entity is the drift above, which breaks nothing
until it matters.

**`DataSource.query()` does not return one shape, and the difference is silent.** A SELECT gives
the rows. An INSERT, UPDATE or DELETE — *even with `returning`* — gives `[rows, affectedCount]`.
So `result.length === 0` is never true for a mutation that matched nothing, and `result[0].x`
reads the rows ARRAY rather than the first row. A "did this UPDATE match?" check written the
obvious way always says yes, and the value it reads is always `undefined`. It cost an afternoon:
a sign-in that burned its nonce correctly, handed `undefined` to the signature verifier, and
reported "that signature did not match the address" for a perfectly good signature. **Every
mutating query in this server goes through `lib/rows.ts`** — `rowsOf`, `firstRow`, `affectedBy` —
and `tests/rows.spec.ts` pins all three shapes.

**What reads through a repository, and what cannot.** About thirty call sites moved to
`getRepository(X).find/findOne/insert/update/delete` - the plain ones, where the SQL was a `where`
and a column list and nothing else - and roughly a hundred and thirty did not. The ones that stay
are not leftovers, and each is doing something a repository cannot say: `FOR UPDATE SKIP LOCKED`
inside a scalar sub-query (the seat claim), `pg_advisory_xact_lock` (the double-tap, the
first-device test), `UNION ALL`, `ON CONFLICT (target) WHERE predicate` against a partial index,
`ON CONFLICT DO UPDATE SET count = notifications.count + 1`, `LEFT JOIN LATERAL` with `array_agg`,
keyset pagination by row-value comparison, the `CASE WHEN` that derives a table's `status`, and the
FROM-less select of four correlated sub-queries that exists precisely so four truths arrive as one
row.

And one whole class stays for a reason worth stating: **`now()` in a predicate**. The nonce burns,
session expiry and validity, the presence touch, the franked-message read and the expiry sweep are
all mechanically expressible as `MoreThan(new Date())`, and that is exactly why they should not be -
it moves a security window onto the Node process's clock while the matching predicate elsewhere in
the same feature still runs against Postgres `now()`. Session validity, nonce replay and
disappearing-message lifetime are not places to introduce clock skew.

Anything inside a transaction uses the callback's `EntityManager` (`tx.getRepository(X)`), or
`runner.manager` for `epochs.ts`, which is the one bare `QueryRunner`. A global repository checks
out a DIFFERENT pooled connection, so the write would land outside the transaction and outside its
locks - which for the seat claim means outside the advisory lock, and for the epoch mint means
outside the primary key that arbitrates the race.

**No application test may reach the network.** `frontend/src/api.ts` fetches the route manifest
at module load, so importing any store from a spec opens a real socket. `frontend/tests/setup.ts`
mocks that module globally with `tests/fake-api.ts`, an in-memory server that records its calls
and can be told to refuse; specs that assert on those calls import `server` from it. The fake
derives handles with the REAL `handleFromName`, imported from the server, so the two cannot drift.

Ports: server **3200**, vite **3100**. 3000/3001 belong to Explorer. In development the two halves
are two processes and `frontend/vite.config.ts` proxies `/api`, `/ws` and `/_image`; in
production one process answers everything, so there is no CORS between halves in either mode.

## The schema, and reference data

Two things that look alike and are not.

**The SCHEMA** is the entities. Changing it means changing an entity and re-recording
`tests/schema-snapshot.json` - deliberately, as its own commit, so the change is visible rather than
absorbed. The check to run afterwards is the real one: drop the database, boot, and let `syncSchema`
build it from nothing.

**There is no legacy database anywhere.** Every database is built from the entities against an empty
one, so nothing can meet rows from before. A backfill that repairs rows "from before" is code
describing a database that does not exist - the attestation work carried one for exactly one
afternoon and it is gone, along with every migration.

**Watch for backticks in a `@Check` expression - inside a template literal they end the string.**
This has now cost five afternoons. The symptom is never what it looks like: the string terminates
at the backtick and the rest becomes a JavaScript expression, so you get a bare
`ReferenceError: <identifier> is not defined`, or `TS1002: Unterminated string literal` pointing at
a line that reads fine. `users_handle_shape` and `groups_slug_shape` both needed a backtick in a
character class and both broke this way; they avoid it now by checking those characters with
`strpos` instead.

**A shape CHECK must not use POSIX character classes.** `[[:alnum:]]` is evaluated against the
database's ctype, which is ASCII here - so `users_handle_shape` and `groups_slug_shape` refused
every Persian handle and every Persian slug while `checkHandle`'s own `/^[\p{L}\p{N}]/u` accepted
them. A Persian guest sign-up was a 500 on the main onboarding path, and CLAUDE.md describes Persian
slugs as a feature. Both are denylists now: length, no whitespace or control characters, no leading
or trailing separator, and none of the characters that break a URL path segment. That accepts any
letter in any script without the database having an opinion about which alphabets exist, and
`naming.db.spec.ts` holds the two halves together.

**An `on conflict` target must IMPLY the partial index's predicate**, or Postgres cannot work out
which index arbitrates and raises 42P10. `conversations_group_one` is partial on
`kind = 'group' and group_id is not null`, and an upsert stating only the first half fails. The
same rule bit `push_subscriptions`: the entity never declared `unique: true` on `endpoint`, so a
synchronized schema had no constraint for `on conflict (endpoint)` to find and every push
subscription was a 500.

**Reference data** is content the product cannot run without: the games, their rules, the
achievement definitions, and the three demo personas. `backend/src/db/seed-reference.ts` upserts it on every boot, so a changed
blurb ships without a schema change. It is not development fixtures — those are a separate file that
refuses to run outside development.

A seed that upserts into a table real people also write to needs a guard, and the demo personas
were that case: their `on conflict (handle)` ended in `where users.kind = 'demo'`, because without
it a deploy would silently convert whoever had claimed `alex` into a shared account anyone could
sign into. That was not hypothetical — it happened in development the first time that seed ran,
against an account that had claimed `sara.k` minutes earlier. The personas are gone and so is the
guard, but the shape of the mistake is worth keeping: a seed that writes into a table people also
write to needs to say which rows are ITS rows.

One sharp edge, because it will surprise someone: `status` is deliberately never overwritten on
conflict. An operator who disabled a game did so for a reason and a deploy must not re-enable it.
That makes the `status` in the seed an INITIAL value only — changing it on a database that already
has the row is `update games set status = …`, not a redeploy.

**The catalogue is split, and the split is the point.** The server owns what a game IS — seats,
modes, targets, fairness, whether it can be opened. `frontend/src/data/games.ts` keeps where its
game STANDS in the landing's showcase — `anchor`, one row 1.6 m apart — because that is scene
geometry and the landing route is `render: 'static'`: it must paint with no JavaScript and no
server. The two merge by id, the server wins where both hold a field, and
`backend/tests/reference-parity.spec.ts` fails if they ever drift.

**The live counts on the home page are SIMULATED, and deliberately not zero.** No table has ever
been opened — tables arrive with the play domain — so `BASE` and `seededStats` in
`catalogue.store.ts` drift on a seeded RNG. Both are deleted outright the moment the server
answers with real counts. Zeroing them instead would be a different lie: "0 people at the tables"
reads as a broken product rather than an unbuilt feature.

**A store that reads the server must be read reactively.** `catalogue.rules()` used to be a
synchronous array and is now backed by a resource, so `const rules = catalogue.rules(id)` captures
whatever was there before the answer landed — silently, with no error. Use `derived`, and where a
component's whole premise is the server's answer (the create form exists to offer the legal seat
counts), do not mount it until `catalogue.loading()` is false. Reading inside an event handler is
fine: by click time the answer is in.

## The social graph, and the privacy over it

`backend/src/domains/social/` is two files and the split matters. `policy.ts` is PURE - it decides
who may write to whom, who may see somebody online, who may knock, and what a minor is allowed to
hold - and `service.ts` resolves two accounts and a relation from the database and then does
nothing but call it. Four places ask the same question (starting a chat, sending a message,
inviting to a table, adding a friend), and four copies of the answer would be four chances to be
generous by accident.

**The rules, in the order they are checked.** Blocking first, because a blocked pair is refused
whatever anybody set. Friendship next, because a friend is somebody you already said yes to.
Only then the RECIPIENT's settings - and a minor's setting can never be the permissive one.

| | strangers | friends | blocked |
|---|---|---|---|
| ordinary account | may write | may write | refused |
| strangers turned off | `strangers-off` | may write | refused |
| minor | `minor-safety`, both directions | may write | refused |

Presence has the same shape: invisible means invisible to everyone but friends, and a minor is
offline to strangers whatever they set. Discovery does NOT: being a stranger is not grounds for
invisibility, because this is a product for finding people to play with. What a stranger cannot do
is write.

**A minor who allows stranger messages is not a row this database can hold.**
`users_minor_no_strangers` is a CHECK, and `clampPrivacy` applies the same rule in the service so
the route can answer with what was STORED rather than with a 500. Two locks on one door, and they
are not redundant: the constraint makes the unsafe row unrepresentable whoever writes it, the
function makes the unsafe answer unrepresentable whoever asks. The constraint earned its keep
immediately - the demo seed inserted the minor persona with the column default and took the whole
server down at boot, which is exactly the failure it exists to cause.

**Friendships are mirrored**: two rows, written by one function, so "my friends" is one index scan
rather than a union of two half-queries. **A friend request is unique on the UNORDERED pair while
pending**, so A asking B while B is asking A cannot become two rows describing one intention - the
second call finds the first and accepts it. Both are proved in `social.db.spec.ts` against a real
Postgres, because neither is a claim about TypeScript.

**Privacy is enforced by what the server does not SEND.** `lastSeenAt` is absent from a person
payload the viewer may not have it for - not null, not flagged. A client cannot render what it was
never given, and a filter it is trusted to apply is a filter one component forgets.

**One mute, four kinds of subject.** `mutes (user_id, subject_kind, subject_id)` holds people,
conversations, games and kinds of notification. The product used to keep a muted-people list in
`social.store.ts` and muted conversations and games in `settings.store.ts` - three spellings of one
idea, and every feature had to remember all three. `settings.store.ts` is now only what this DEVICE
prefers: sound, haptics, the rail and the sidebar, the voice defaults and the game helpers. Nothing in
it belongs to the account.

**A person is muted by HANDLE at the edge and by uuid underneath.** `setMute` resolves the handle
and `graph` turns the stored uuid back into one, because the client names everybody by handle and
the notification writer compares `actorId`, which is a uuid. For one release the edge passed the
handle straight through: the row stored a string no notification's actor could ever equal, so muting
a person silenced nothing, and `mutes.db.spec.ts` is what says so now.

**The whole graph is the server's now.** `social.store.ts` reads friends, both request
directions, blocks, the directory, suggestions, mutes, privacy and my own reports from the API,
and every one of them is a handle. What is left of the browser's mock is a NAME cache - a display
name, a bio and a hue for people no domain owns yet - and nothing more.

Two behaviours went away with it, and both were furniture:

- **Nobody answers a friend request on a timer.** `planRequestReply` used to accept for them
  after a few seconds. A request now sits pending until the other person answers it.
- **Nothing walks a report to "reviewed".** The client used to move its own report along on a
  20-second timer. It says what was filed and waits, because nothing in a browser knows what
  moderation did.

**Blocking ends the friendship, and unblocking does not restore it.** The block deletes both
friendship rows inside the same transaction, so afterwards there is nothing left to disagree
about; getting back to friends means asking again. Worth knowing before writing a test that
blocks the same person twice and wonders why the second one measures nothing.

**Three of the reads are LAZY, and pages ask for them.** `graph` and `privacy` are fetched on
boot because the shell reads both on every route. The directory, the suggestions and my reports
are not - that would be three more requests on every navigation for three lists that two pages
between them ever show - so a page calls `social.want('people' | 'suggestions' | 'reports')` in
its `mount`. The responsive matrix is what found this: nine API calls per page over six hundred
pages took the rate limiter out, and the limiter was right.

## Groups

`backend/src/domains/group/` owns them, and three of its rules are INDEXES rather than application
code — because each one is a state that has to be impossible, not merely unlikely.

**The slug is claimed by INSERT.** `groups.slug` is `citext` and unique, and `create` walks
`candidatesFor` letting the index arbitrate, moving on only for a genuine 23505 — the same shape
as the handle claim, sharing `lib/naming.ts` with it. "Check then insert" is the same race with
extra steps, and two people making "Friday Night Crew" in one second is the case it has to
survive. `groups.db.spec.ts` runs five at once and expects five distinct slugs.

A slug hyphenates where a handle strips: "Friday Night Crew" is `friday-night-crew`, and Persian's
zero-width non-joiner becomes a hyphen so `تخته‌نرد` reads as `تخته-نرد` rather than gluing two
words into one. A name with nothing claimable in it — all emoji — folds to the empty string and
the service falls back to a word the product owns rather than inventing one.

**The slug does not move when the name changes.** A url that changes because somebody edited a
name is a url that breaks every link they shared. `edit` takes the whole editable surface and
never the slug.

**The owner is a ROLE on the membership row**, with a partial unique index over
`(group_id) where role = 'owner'`. An `owner_id` column on the group would let a transfer that
promotes before it demotes leave two owners behind — a state nobody notices until one of them
removes the other. This makes it unrepresentable, so `transfer` demotes FIRST inside one
transaction or fails.

**One conversation per group**, enforced by a partial unique index on
`conversations (group_id) where kind = 'group'`. Membership moves in lockstep: joining a group
seats you in its thread and leaving takes the seat back, both inside one transaction. A member who
is not in the thread cannot read what the group is saying, and a thread member who is not in the
group keeps reading it after they leave.

**The last member out takes the group with them.** An empty group is a row nobody can ever see
again. An owner who leaves a populated group hands it to the longest-standing remaining member —
which keeps the single-owner index satisfied — and the handover is ANNOUNCED with a line, so it is
visible rather than silent.

**A group is public or private, and private means it does not exist to anybody outside it.**
`groups.privacy` is two levels, and the rule is the chat domain's: a private group answers a
non-member exactly as a group that was never made - 404, "No such group." - rather than 403, because
a 403 confirms it is there and the point is that a stranger cannot tell a closed door from a typo.
One predicate, `VISIBLE_TO`, is shared by `bySlug` and `byId` so the rule cannot be applied to one
read and forgotten on the next; `discover` filters on the constant half; `join` needs no code at all,
because it already refuses what it cannot see. `mine` is deliberately untouched - it joins through
`group_members`, so membership already is the WHERE clause.

TWO levels here, not three, and `groups_privacy_known` is a CHECK so a third cannot be added without
a WHERE clause to go with it. `tables` had the opposite problem and *Who may sit at a table* says
what happened to it.

**The column has NO default, and that is the interesting line.** Postgres materialises a column
default into every existing row at `add column` time, which is exactly the backfill this file forbids
elsewhere - so a default would be the forbidden thing wearing a different hat. The consequence is
real and is the documented one: a development database that already holds a group refuses the
column rather than quietly deciding for it, and the answer is to rebuild from nothing.
`groups.db.spec.ts` pins both halves - an insert naming `friends` is refused, and an insert naming no
privacy at all is refused - so neither decision can decay into a comment.

**Closing the doors writes a line.** `chat.line.group.closed` and `.opened`, for the reason the
expiry lines exist: a rule about who can walk in is not something to change behind the room's back,
and a member who does not know cannot tell "we went private" from "nobody is joining any more".

**Adding somebody is gated twice, and the two are different questions.** The server asks
`mayMessage`, because putting a person in a group is writing into their chat list and that is the
act the messaging policy already governs — blocks, stranger settings and minor safety all apply
without a second opinion. The UI offers only friends, which is narrower on purpose: a group is
somebody's room, and being put in one by a stranger with open settings wants an invitation rather
than an addition. The server's rule is the floor; the picker is the door.

**`LINE_KEYS` grew by six, and every one has a producer.** `created`, `joined`, `left`,
`removed`, `renamed` and `owner` are written by the group half of `services.ts`, and
`tests/lines.spec.ts` reads that file to prove it — the rule that a key without a producer is
filler copy, as a test rather than a convention. The line is written OUTSIDE the transaction that
changes the membership: the membership is the fact and the announcement is the courtesy, so a
failed line must not undo a completed change. Leaving writes its line BEFORE the seat goes, or it
lands in a thread the writer has just been removed from.

**A group is named by its SLUG on the wire**, the way a person is named by their handle — including
`conversationSummary.groupId`, which carries the slug and not the uuid. One identifier at the edge
means a link, a route parameter and an api call are all the same string.

**A slug nobody has claimed is an answer, not a failure.** `groups.store.ts` turns a 404 from the
view route into `null`, so the page says "No such group" rather than offering to retry the same
missing thing. Every other status still surfaces as an error.

**A group is a row, and nothing in the browser holds a copy of one.** `GROUP_FIXTURES` in
`frontend/tests/fixtures.ts` is what the browser specs arrange, and nothing else reads it. The
crest is a closed set the CLIENT owns (`data/crests.ts`): the server sends a string, `Icon` takes an
`IconName`, and a value from a newer server draws the first crest instead of a blank square.

Two things the browser pass caught that no type could:

- **`SectionHeading` took no children**, so a heading written with a button inside it rendered the
  heading and dropped the button — silently, on two pages at once. It takes `actions` now, the
  same named slot `FriendRow` uses, and `components.spec.ts` pins it.
- **The group page opened itself from an `effect` over `params()`.** A route parameter is shared
  router state, so the effect fired again on the way out with the NEXT route's id in hand — asking
  the groups api for a conversation id and putting a 404 in the console on every navigation away.
  It opens once in `mount` and closes in the teardown.

## A changed CHECK is not a schema change TypeORM makes

`synchronize()` creates a CHECK constraint on a new table and leaves a CHANGED one exactly as it was
on a table that already exists. `notifications_kind_known` gained a sixth kind in the entity; both
real databases went on refusing it.

**No test could have caught it, and that is the part worth keeping.** `schema.db.spec.ts`,
`converge.db.spec.ts` and the snapshot recorder all build a database FROM NOTHING, where a changed
constraint and a new one are the same thing - and the documented check after a schema change, "drop
the database, boot, and let `syncSchema` build it from nothing", passes for exactly the same reason.
Production runs the same function through `npm run schema:sync`, so a deployed database would have
kept the old rule forever.

`rewriteChecks` is the third thing `syncSchema` exists for, beside the extensions and the six
hand-built indexes. Every `@Check` the entities declare is dropped and re-added rather than compared,
because Postgres stores one normalised (`(kind)::text = ANY (ARRAY[...])`) while the entity declares
it as somebody wrote it, and any textual comparison is a guess that fails open. The cost is a
validating scan per constraint on a sync - a development boot or a deliberate `schema:sync`, never
something a request waits for. `not valid` is deliberately not used: a constraint that is not
validated is one that lets the rows it was added to stop obeying it.

## What the server spends, and where it stopped spending it

Five audits read the server and the browser for cost and for leaks; these are the rules the server
half left behind.

- **The pool is configured, not defaulted.** `DATABASE_POOL_MAX` was read by `env.ts`, logged at boot
  and applied nowhere, so every deployment ran pg's default of ten with no timeouts. `data-source.ts`
  passes it as `extra.max` with a five-second connection timeout and a thirty-second
  `statement_timeout`, so a runaway query fails rather than holding a connection for ever.
- **A request costs one statement to authenticate.** The session lookup and the hourly `last_used_at`
  touch are one data-modifying CTE; they were two round trips, and the second ran on every request
  whether or not it changed anything.
- **A room is told in one statement.** `notify.tellAll` inserts a message notification for every
  member with `insert ... select` over `unnest`, checking the same mutes and blocks `tell` checks, and
  answers who it told so exactly those are rung and woken. It was five queries per recipient per
  message.
- **Reading or pinning a thread rings only the reader** (`chatSeen`), because nobody else's screen
  changes; it rang every member.
- **The chat list is a page.** Every pinned room and the sixty most recently active, keyset over
  `(last activity, id)` for the rest - "Show older conversations" at the foot of the list. A room with
  something unread is by definition recently active, so the first page carries every unread count
  anybody needs. It was every room the person had ever sat in, each with four correlated sub-queries,
  on every chat doorbell.
- **Nobody sits at more than fifty open tables** (`SEATED_MAX`). Create and claim refuse the next one
  with the code `seated-max`, which the browser turns into its own sentence, so `/tables/mine` is
  bounded by a rule rather than by a silent `LIMIT`.
- **A finish inserts only the rungs it newly reached**, reading what is held first, and records its
  players in id order so two matches finishing for the same people take their locks in one order.
- **Push has a timeout, a cap and one key.** A push service that never answers is abandoned after ten
  seconds, the response body is cancelled, at most sixty-four wakes are in flight (a wake is a courtesy,
  so one past the cap is dropped rather than queued), and the VAPID key is imported once.
- **The handshake limiter trusts the proxy's hop, not the client's.** `X-Forwarded-For` is read from the
  RIGHT, because the left end is whatever the client wrote; an IPv6 address counts as its /64, because
  one host owns the whole block; and the table of addresses is capped, oldest first.
- **Housekeeping runs daily** (`jobs.tidy`): expired sign-in and recovery nonces, sessions a month past
  their expiry or revocation, and push subscriptions a push service has retired. Nothing deleted any of
  them before, whatever the comments said.

## The database, and how its schema is held

**The database is Postgres, and the ENTITIES are the only description of it.** The root `.env`
carries `DATABASE_URL` and is the one place the name is written down; `tools/qa/db.mjs` reads it so
the browser passes cannot drift from the server the way they once did. There are no migrations.
`backend/src/db/schema.ts` builds the schema with `syncSchema()`: the `citext` and `pgcrypto`
extensions, then TypeORM's `synchronize()` from the entity metadata, then the indexes no
decorator can express. `main.ts` runs it on every DEVELOPMENT boot; a production start does not,
and `npm run schema:sync --workspace backend` is the same code as a deliberate act. `DATABASE_SYNC`
overrides either way when it is set. A sync cannot apply a NOT NULL column or a new CHECK to rows
that predate it - a VPS database from before `tables.chat` failed exactly that way - so boot names
the rebuild (`drop schema public cascade; create schema public`) instead of dumping the stack,
because nothing here migrates rows.
It is never TypeORM's own `synchronize: true` on the DataSource: that would build the tables and then
drop the DESC and partial indexes `syncSchema` exists to rebuild, on every start.

**Every query runner asks one thing at a time.** `data-source.ts` wraps the driver's
`createQueryRunner` in `lib/one-at-a-time.ts`, because TypeORM 1.1.1 fans `loadTables` out with
`Promise.all` over one client and pg 8.16+ prints "Calling client.query() when the client is already
executing a query is deprecated" on every sync - and pg@9 will refuse it outright. pg queued those
queries anyway, so the queue changes nothing but the warning. Upstream is typeorm#12238, fixed by
PR #12421; delete the wrapper when the pin carries that fix.

**That only works because the entities are complete**, and making them complete was the work. They
carry 56 `@Check` constraints, 43 relations with their `onDelete` rules, every default, every
unique and every expressible index. Three tests hold it there, all in `npm run test:db`:

- `schema.db.spec.ts` compares what `syncSchema` builds against `tests/schema-snapshot.json`, which
  was recorded from a database built by the migration sequence on the day the migrations were
  deleted. Tables, columns with types/nullability/defaults, CHECK expressions, foreign keys with
  their delete rules, primary keys, uniques and index SHAPES. Names are deliberately not compared
  for primary keys and uniques, because TypeORM calls what it generates `PK_<hash>`/`UQ_<hash>`; the
  hand-built indexes keep their real names and are asserted by name.
- `converge.db.spec.ts` proves a second sync has nothing to do beyond two wrinkles it lists by
  name, so a THIRD one appearing fails. The two: TypeORM drops the five DESC indexes it cannot
  express (and `syncSchema` rebuilds them afterwards, which is why its order matters), and
  `conversation_members.last_read_at` re-issues its default because TypeORM compares defaults as
  strings and Postgres renders `to_timestamp(0)` back as `to_timestamp((0)::double precision)`.
  It builds a throwaway database of its own, and BOTH of its hooks carry a long timeout: dropping
  that database overran vitest's 10-second default while the machine was busy with the responsive
  matrix, which read as a flaky schema failure in a suite with nothing wrong in it.
- `naming.db.spec.ts` proves the database stores every handle and slug the product accepts.

**`uuidExtension: 'pgcrypto'` is on the DataSource and is not decoration.** Without it TypeORM
generates `uuid_generate_v4()` and the schema silently acquires a dependency on `uuid-ossp`.

**The entity graph has to stay acyclic.** Relations are owning sides only - `@ManyToOne`, and
`@OneToOne` where the foreign key IS the primary key (`game_rules.game_id`,
`recovery_vaults.user_id`). There are no `@OneToMany` inverses: two entity modules importing each
other is `ReferenceError: Cannot access 'X' before initialization` at load, which is what adding
`Table.chairs` and `ConversationEpoch.keys` produced. Nothing read them, and the owning sides alone
carry every foreign key.

**Several indexes are built by hand and always will be.** `friend_requests_pending_pair` is UNIQUE over
`LEAST(from_user, to_user)`/`GREATEST(...)` where the request is unanswered - a functional index,
and the only thing stopping A asking B while B is asking A from becoming two rows for one
intention. `messages_keyset`, `notifications_keyset`, `reports_against`, `groups_public`,
`tables_open`, `matches_history`, `match_actions_feed` and `matches_finished` each order a column
DESC, which `@Index` cannot say - and `matches_finished` is partial on top of that, so the
leaderboard's window never walks a live match. `synchronize()` therefore drops every one of them each
time, and `syncSchema` recreating them afterwards is the whole reason it exists
rather than a bare call. `converge.db.spec.ts` lists them by name, so adding one without telling it
fails rather than passing quietly.
