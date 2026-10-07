---
paths:
  - "backend/src/domains/chat/**"
  - "backend/src/domains/device/**"
  - "backend/src/domains/notify/**"
  - "backend/src/realtime/**"
  - "backend/src/db/seed-wallets.ts"
  - "frontend/src/lib/**"
  - "frontend/src/services/chat.source.ts"
  - "frontend/src/services/realtime.source.ts"
  - "frontend/src/stores/chat.store.ts"
  - "frontend/src/stores/seal.store.ts"
  - "frontend/src/stores/devices.store.ts"
  - "frontend/src/stores/enrolment.store.ts"
  - "frontend/src/stores/recovery.store.ts"
  - "frontend/src/stores/realtime.store.ts"
  - "frontend/src/stores/notifications.store.ts"
  - "frontend/src/stores/search.store.ts"
  - "frontend/src/pages/app/chat.page.azeroth"
  - "frontend/src/pages/app/chats.page.azeroth"
  - "frontend/src/pages/app/devices.page.azeroth"
  - "frontend/src/pages/app/notifications.page.azeroth"
  - "tools/qa/seal-pass.mjs"
---

# Chat, sealing, devices, notifications and realtime

## Chat is the server's

`backend/src/domains/chat/` owns conversations, membership and messages; the browser reads them
through `createApiSource()` and nothing else. The local source that stood in for it is gone.

**`pinned` and `last_read_at` are per MEMBER.** The mock kept both on the conversation, which
meant one person pinning a thread pinned it for everybody in it. Unread is a count of messages
after my own watermark - which is also the only way to count them once the bodies are sealed and
the server cannot read one.

**A message is words XOR a line.** `body` for what somebody typed, `payload` `{ key, params }` for
the three kinds the server authors, and a CHECK constraint so a row can never be both or neither.
The browser renders a line through `lib/lines.ts`, which declares the keys it knows; an unknown
key renders as NOTHING rather than as its own name, because an old client meeting a new server is
a designed state and not an excuse to print an internal identifier on the screen.

**`LINE_KEYS` grows when a domain starts WRITING a line, never before.** `chat.line.system` was
declared with no producer and had to be given copy - "Something changed here" - which is filler
standing in for a sentence nobody has written. It was removed; the group work adds its own keys
with the lines that actually occur.

**That shape exists for one reason, and `tests/lines.spec.ts` is the proof**: a sentence the
server authored is composed at DISPLAY time, so switching language re-renders it in place. The
version this replaces stored bilingual strings in the chat store, which could not follow a switch
at all. A message somebody TYPED does not change - words are words - and seeing both behaviours
in one thread is what the design is for.

**A list the UI renders needs an ORDER BY.** `social.mutes()` had none, so Postgres returned
whatever it found first and the settings page reshuffled between loads. It surfaced as
`social.db.spec.ts` failing the day a later schema change moved what "first" happened to mean, which
is the only warning an unordered SELECT ever gives.

**A message carries `dir="auto"`.** Fixture conversations are single-language now, so an English
sentence inside a Persian page is the normal case rather than an artefact, and a paragraph that
inherits the page direction puts its full stop on the wrong end. The direction of a message
follows its CONTENT; the direction of the UI around it does not.

**History pages by keyset**, `(created_at, id)` descending. An OFFSET page repeats or skips a line
every time a message arrives at the other end while somebody is scrolling up, and
`chat.db.spec.ts` has a test that does exactly that and expects the page not to move.

**A conversation you are not in answers exactly as one that does not exist**, and so does a
malformed id - which is not only tidiness. Postgres raises 22P02 when a path parameter that is not
a uuid is compared against one, and that surfaces as a 500, so any visitor could turn a typo in the
address bar into a server error. `membership()` checks the shape before the query.

**A block hides the thread, not just the person.** The membership row stays - unblocking has to
give the conversation back - so the list and every read filter on the block instead.

**Nothing invents a message any more.** The store used to run an ambient timer that wrote lines
from people who were not there, and a per-send timer that typed a reply back; both are deleted.
Until the realtime work lands, the only thing that produces a message is somebody sending one, and
the list refreshes when the app asks it to.

**The browser's mock is gone.** `frontend/src/data/mock/` held twenty-four invented people, the
threads between them, a script of replies to type back, and a copy of the achievement definitions.
Every name on every screen came out of it - including for accounts that really exist - through
`personById`, and `account.store.ts` synthesised the rest. What replaces it is `people.store.ts`: a
cache of whatever the server has actually said, keyed by handle, where a handle nobody has described
is ABSENT and the caller renders the handle.

Two rules make that store safe to read anywhere. It only ever holds what the server sent - nothing
is derived or defaulted - and `byHandle` never fetches, so it is safe inside a `derived`; asking is
a separate `want()` the owning store calls once its own list has landed.

The chat view types moved to `data/chat.ts`, which is where they always belonged: they are the
client's view of a `ConversationSummary` and a `ChatMessage`, not fixture shapes. `Message.text` is
a plain string now, because a message is what somebody typed.

**Development fixtures are six REAL accounts.** `backend/src/db/seed-wallets.ts` is the whole seed:
six wallet accounts, each holding a device whose attestation verifies, with friendships written
both ways, three direct threads and one group. They sign in through the real wallet route, so
everything a development database contains is something the product's own code path produced.

The twenty-four invented guests that used to fill it are gone, and so is `seed-fixtures.ts`. That
file did two jobs: it defined the arrangement the browser specs are written against, and it seeded
those invented people into a database the product then rendered as its population. The first job is
honest and now lives in `frontend/tests/fixtures.ts`, beside `fake-api.ts`, which is the
browser's server. The second job was the problem.

The seed runs on EVERY boot and is idempotent about the device as well as the account: P-256 keys
cannot be generated deterministically from a seed, so the guard is "does this account already have
a device" rather than a fixed id - which is also the rule a real account follows.

Each fixture conversation is written in ONE language, because a real message is one language. The
bilingual strings were a mock convenience the wire format does not have.

## Reading chat

`chat.store.ts` reads through `services/chat.source.ts` and nothing else. That interface is the
whole seam the server slots into: `conversations`, `thread`, `post`, `openDirect`, `archive`.
`createApiSource()` is the only implementation the product ships and `setChatSource()` swaps it,
which is how the failure states — loading, refused, offline — are driven in a spec. It is also where
the SEALING happens and the only place it does: a message goes out as ciphertext and an envelope and
comes back as a row this browser has to open for itself, and the store above never sees either half.

**Two reads, two shapes, and the split is the point.** The LIST carries a row per conversation —
the conversation, its last message, its unread count — and the THREAD carries the messages of the
one conversation that is open. So `unread()`, `lastOf()` and `totalUnread` are answered from the
list, never by loading every thread; under E2EE the server cannot count unread messages by reading
them, so it has to be a column on the row, and the client has to ask for it that way.

Both are `createResource`. The list's source is the `ChatScope` (who I am, who I have blocked), so
blocking somebody refetches it rather than filtering a stale copy. The thread's source is the open
conversation id, and returning `null` while nothing is open is the framework's documented way to
skip a fetch — which is why `messages()` is `[]` on the chats list rather than the last thread you
happened to visit. `chat.page.azeroth` calls `openThread` in an effect and `closeThread` on
teardown; no page loads anything by hand.

**A failed fetch keeps the data it already had.** `createResource` retains the last resolved value
and reports the failure alongside it, so the failure SCREEN is gated on having nothing to show
(`failed && all.length === 0`). A dropped connection must not blank a list that is still perfectly
readable — the connection banner is what says the network is the problem.

**`chats.page` filters what the list row holds** — the title and the last message — and its search
box says "Search conversations" because that is what it does. Full-text search over messages is
`search.store.ts`, and it reads `chat.archive()`: the messages THIS DEVICE has fetched and managed
to open. That is the only shape E2EE allows, because a server-side message index cannot exist.

**The archive is the plaintext, and it has to be surrendered like a key.** Six independent audit
routes converged on the same defect: `surrenderKeys` dropped the epoch keys, the device keypairs and
the signer cache, and left every message those keys had already opened sitting in a module-level
`Map`. Sign-out was a client-side navigation — no reload, same module — and signing in as somebody
else did not replace it. It loads `/sign-in` now (see *What the browser held on to*), and the rest of
this section stays true as the belt under that brace. So the next person at the keyboard signed in as themselves, opened search,
typed a common word, and read the previous person's conversations **without needing a key at all**.
The plaintext outlived the keys that produced it, while `session.store.ts`'s own docstring promised
the opposite in so many words.

`forgetArchive()` is exported from `chat.source.ts` — which imports no store, so it can be reached
from `session.store.ts` without closing the session→chat→account cycle — and is called first in
`surrenderKeys`, before the keys, because it is the thing a person can read with no key. Two belts
beside it: `archive(scope)` answers nothing when `scope.me` is not the account the messages were
opened for, and search terms move to `lib/search-terms.ts` so they are dropped on the same path.
A search term against a sealed conversation is a fragment of what was said in it, and it was the one
thing this product wrote down in cleartext.

**The archive filters expiry on the way OUT, not only on the way in.** A message that runs out while
it is being held is never read again — the server stops returning it — so nothing ever comes back to
evict it, and it stayed findable by its words for as long as the tab was open. The eviction that
looked like the fix was unreachable in the normal path.

**Search says what it covers, because a person who finds nothing concludes it is not there.**
`search.thisDevice` states the scope where somebody starts a search, and `search.locked` counts the
messages this browser holds but could not open. "It is not there" and "it is not here" are very
different answers when the thing being looked for is something somebody remembers reading. A locked
message is also excluded from the results outright: its `text` is empty but its `from` is not, so it
would otherwise match on the sender's handle and render an empty row that reads as a bug.

**Sending is not optimistic.** `send` seals, posts and revalidates, so the message appears when the
server has acknowledged it. That is a round trip plus a signature rather than a microtask now, which
is why `chat.listLoading()` is what a test waits on rather than one macrotask.

**The composer is a `TextArea`, and the limit is 500.** It was an `<input>`, so a message ran off
the right-hand edge at about sixty characters and the only way to read back what you had written was
to arrow through it - nothing about the control admitted the limit it had. It grows to six lines and
scrolls after that, because past a paragraph the box is eating the conversation it belongs to. Enter
sends and Shift+Enter breaks the line, which is what `enterkeyhint="send"` already promised on a
phone keyboard. Two details are load-bearing: `height` is cleared before `scrollHeight` is read, or
a box that is already tall reports the height it HAS and only ever grows; and the effect writes the
caller's value back into the field, because a textarea holds its own content and the composer clears
its draft after a send.

**A TABLE conversation is named after its game.** `titleOf` fell through to a generic "Table chat"
for every one of them, so a chats list holding two tables held two rows with identical titles - and
a table nobody has spoken in has no timestamp either, so there was nothing else on the row to tell
them apart. It takes its names as one object now (`{ group, game }`) rather than a growing tail of
positional strings, which is what the third one would have made it. The row draws a seat tile for
one too: `AvatarGroup` rendered NOTHING for a table nobody else has joined - which is every table
while its host waits - while keeping its 40px box, so the row opened with a blank gutter where
every other row has a face.

**Do not put `await import()` inside a spec.** Resolving a module mid-run races the other workers
resolving `@azerothjs/testing` through its junction, and `npm run test:shuffle` starts failing
three or six FILES at a time with `Failed to resolve import` — a resolution error that looks
nothing like the isolation bug the gate is meant to catch. Import at the top of the file.

## The chat wire format — `nura-e2ee/v1`

Written down before any of it is implemented, because a wire format decided while coding is a
wire format nobody can review. `GET /api/meta` reports the version the client must speak.

**Only user-authored text is sealed.** A message is one of four kinds, and the line is absolute:

| kind | body | who can read it |
|---|---|---|
| `text` | ciphertext | the conversation's member devices |
| `system` | `{ key, params }` | the server — it authored it |
| `invite` | `{ key, params }` | the server — it authored it |
| `result` | `{ key, params }` | the server — it authored it |

The server generates the last three, so it must be able to read them; they are structured data
rendered through the message catalogue at display time, never prose. That also fixes a real defect:
the hardcoded bilingual strings in `chat.store.ts` today cannot follow a language switch.

**Keys.** One AES-256-GCM key per `(conversation, epoch)`. An epoch is a frozen set of member
devices; any membership change mints the next one. The epoch key is wrapped once per recipient
device over ephemeral ECDH P-256. Each message is sealed under a per-sender key derived from the
epoch key by HKDF and signed by the sending device with ECDSA P-256 — members share the epoch key,
so without a per-message signature any member could forge another's line.

There is no ratchet. Forward secrecy is epoch-coarse and post-compromise security arrives only at
revocation. Both are stated in the privacy copy rather than implied away.

**Device identity** is client-derived and self-certifying, and it is BUILT - see *Devices, and the
degraded states that shipped first* below for what the schema, the races and the states actually
are:

```
deviceId = base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)
```

so the server cannot mint an id for keys it does not hold — which proves the keys were not SWAPPED
and proves nothing about whose device it is. A device is authorised by a plain-text
`personal_sign` that names it, with an ERC-1271 `eth_call` branch for contract wallets. Guest accounts have no
wallet, so their devices are `attested: 'server'` — and `attested` is a REQUIRED prop on the trust
badge, so a server-asserted device cannot be rendered as wallet-verified by forgetting to say so.
How a PEER decides whether to believe any of that is *Whose device is that?* below.

**The envelope**, with its AAD fields joined by the ASCII unit separator (0x1F) in exactly this order:

```
'nura-e2ee/v1' ␟ 'msg' ␟ conversationId ␟ epoch ␟ seq ␟ messageId
               ␟ senderAccountId ␟ senderDeviceId ␟ kind ␟ clientAt
               ␟ commitment ␟ expiresAt
```

Binding `kind` stops the server relabelling a fabricated row as a person's words; binding
`clientAt` stops it re-dating one; binding `senderDeviceId` stops it re-attributing one; binding
`commitment` stops either end lying about what the message can later be reported as saying; binding
`expiresAt` stops the server giving a disappearing message a longer life than its sender asked for.

**The format is settled.** It took three hard cutovers to get here — the sealing, the commitment and
the expiry — and every one of them was taken while nothing had shipped to anybody, because a wire
format patched around after the fact is one nobody can reason about. Nothing left in the plan
touches these bytes.

**No wallet-signature-derived backup key.** A deterministic `personal_sign` over a fixed string is
an unrevocable, phishable, remote skeleton key to the entire archive. Recovery is a *generated*
120-bit phrase only; a user-chosen passphrase is refused, because PBKDF2 is the only KDF
`SubtleCrypto` offers and it is weak enough against GPUs that a human-chosen phrase is a real
break. It is BUILT — see *Recovery* below.

**No plaintext key bytes at rest.** Keys are non-extractable `CryptoKey`s; IndexedDB holds vault
ciphertext. The honest claim is *"no key bytes at rest"*, not *"key bytes never exist"* — they
exist in memory at three moments (minting, wrapping, backup) and the buffers are zeroed after.

**What the server still sees**, stated rather than buried: who is in a conversation, who sent a
message, when, and how large it was. E2EE hides content, not the social graph.

**What it costs**, and these are consequences, not regrets: no server-side message search — the
index is per device, over the archive that device can decrypt; push notifications are contentless;
moderation sees only the excerpt a reporter chooses to disclose, which is what *Franking* below
makes worth reading; a device that loses its keys and its recovery phrase cannot get the history
back, and the UI says so plainly rather than showing an empty thread.

## Devices, and the degraded states that shipped first

This is the half of `nura-e2ee/v1` that had to exist before any of the sealing, and it was built in
the order the plan asks for: the states that mean something went wrong were written, rendered and
tested BEFORE the happy path, so they are exercised rather than discovered. *The sealing* below is
what was built on top of it.

**A device id is derived, not issued.** `base64url(SHA-256(exchangeSpki || signingSpki)).slice(0, 22)`,
computed by the client and recomputed by the server, which refuses a mismatch. An id the SERVER
hands out is an id the server can mint for keys it holds itself and quietly wrap an epoch key to;
this one can only be claimed by whoever published those two public keys. There are two
implementations of the formula — `backend/src/domains/device/id.ts` over `node:crypto` and
`frontend/src/lib/device-id.ts` over WebCrypto — and `tests/devices.spec.ts` runs both over the
same real P-256 keys, because two implementations of one formula are two chances to disagree and a
disagreement means every enrolment on one side is refused by the other.

**The browser re-derives every id it is shown.** A server that swapped a device's exchange key for
its own would produce a row that no longer adds up, and the client can see that without trusting
anybody. Such a row renders as `tampered`: no trust badge, no rename, and the single
offered action is to sign it out.

**A revoked id never comes back.** The row stays forever with `revoked_at` set and enrolment
refuses an id already in that state. Deleting it would let a stolen laptop re-present the same keys
and be trusted again, which is the entire thing revocation exists to stop. The browser's answer to
that 409 is to mint fresh keys and try ONCE more — a loop there would fill somebody's list with
abandoned keys.

**Revoking ends the sessions, in the same transaction.** `sessions.device_id` is what makes that
possible, and `services.ts` closes the sockets afterwards. A revoke that leaves the browser signed
in is a button that lies, and this is the column that stops it being one.

**There is no confirmation step: a browser is live the moment it enrols.** The owner asked for it
twice - first for wallet browsers, then for everyone - so `devices` has no `confirmed_at`, there is
no confirm route, no `pending` or `waiting` state, and nothing asks one browser to vouch for another.
What that costs, stated plainly: one phished wallet signature or one stolen wallet yields a browser
that reads every FUTURE message at once; the recovery phrase still guards the past. Sealing loses
nothing by it - a peer only ever wraps to wallet-attested devices, and for those the attestation
anchored to the account's wallet is the ghost-device defence, not an approval from another browser.
A guest's devices are server-attested and never reach a recipient set either way.

**Three device states and three readiness states.** A row is `ready`, `locked` (revoked) or
`tampered` (does not verify). `Readiness` says what THIS browser can do: `unsupported` (no WebCrypto
or no IndexedDB - an insecure origin, or a private mode), `absent`, `ready`. Both are exhaustive
`Record`s over the union, so a state added later cannot render as nothing.

**`attested` is a required prop on the trust badge.** `'wallet' | 'contract' | 'server'`, where
`server` means NOBODY vouched — a guest has no wallet to sign with. Required, with no default, so a
server-asserted device cannot render as wallet-verified because somebody forgot the prop: forgetting
it fails to compile rather than failing quietly on a screen.

**A wallet account signs for its devices and cannot opt out.** Enrolment without a signature is
refused rather than recorded as `server` — that would be a downgrade nobody would see. The device is
named on a line of its own, `Browser key: <id>`, and the server checks with `namesDevice` - a whole
line, never a substring - that the burned challenge really names the device being enrolled. Without
that check, a signature collected for one device — or for a sign-in that names none — would
authorise any device the caller chose to name.

**Signing in and authorising the browser are ONE signature.** They used to be two prompts back to
back. `wallet.store.connect()` takes this browser's keys (or mints them) before it asks for the
challenge and sends the device id with it; `services.ts` asks `device.liveFor` whether that device
is already a live device of the account the address signs in to. If it is, the text is the short
`Sign in to Nura Games (<site>).`; if not, it is `Sign in to Nura Games (<site>) and let this
browser read and send your messages.` with the `Browser key:` line. Either way the last line is
`Nonce: <nonce>`, which is what makes the signature single-use. After the signature verifies and the
session opens, the SAME verified proof records the device through `device.enrol`'s ordinary path -
live, attested by the wallet that signed, and the session bound - but only when `namesDevice` holds
and the proof's address is the account's wallet, so a sign-in that named no device is never stored
as an attestation. A `ConflictError` there (keys revoked, or somebody else's) does not fail the
sign-in; the browser falls back to the separate enrolment, which mints fresh keys. The standalone
enrolment route stays for a signed-in browser that lost its keys, with its own sentence (`Let this
browser read and send your messages on Nura Games (<site>).`).

**The text is plain, not EIP-4361, and says nothing about Ethereum.** The owner asked for the site's
name and nothing a person has to decode. The address is not in it (the signature recovers it) and
neither is the expiry (the server holds it beside the nonce). One thing went with the format:
MetaMask checks a SIWE message's domain against the page asking and warns on a mismatch, and it does
not do that for plain text - so a phished signature is caught only by the person reading the site
name, and it now yields a session AND a live device that reads future messages - nothing
contains that any more but the person reading what they sign. Signing out surrenders the device
keys, so the short sign-in text appears only when a session ended without a sign-out.

**Keys live behind a seam.** `lib/device-keys.ts` generates both keypairs non-extractable and keeps
them in IndexedDB; the public halves are exported to base64url because they are published. The test
environment has no IndexedDB and neither does a browser in some private modes, so `setKeyStore`
swaps it and `available()` is what `unsupported` reads. PR 12's `keyring-db.ts` extends this file
rather than replacing it.

## Whose device is that? — the proof a peer checks

The self-certifying device id answers "were these keys swapped in transit?" and nothing else. It
does NOT answer "is this device really Bob's", and the difference is the whole of end-to-end
encryption: a device this server fabricates hashes its own keys, so it re-derives perfectly. Without
something more, "wrap the epoch key to
every member device" means wrapping it to whatever list this server hands over, and the product
would be end-to-end encrypted against everyone except the one party it is supposed to be encrypted
against.

**So the enrolment signature is kept and published.** `devices.attested_address`,
`attested_message` and `attested_signature` hold the address that signed, the exact bytes it
signed, and the signature. PR 11 verified those and threw them away, which was enough while this
server was the only one asking. A peer recovers the address ITSELF -
`frontend/src/lib/attestation.ts`, over `@noble/curves` - and checks with `namesDevice` that the
message names that device on its `Browser key:` line. Two CHECK constraints make the proof non-optional: all
three columns together or none, and `attested in ('wallet','contract')` requires them. A
wallet-attested device with no proof beside it is not a row this database can hold.

**The attestation is anchored to the ACCOUNT's wallet, and that is what stops it being circular.**
`verifyPeerDevice` on its own checks four values from one response against each other: the id hashes
the keys, the signed message names that id, the signature recovers to the address printed beside it.
A server that minted a device and signed its enrolment with any key it liked passes all three — the
whole chain agrees with itself and with nothing outside the response. So `conversationMember` carries
the address the account signs in with, and `sealabilityOf` renders `wrong-address` (an alarm, not an
absence) for any device attested by anything else. Injecting a device now means also swapping the
member's published wallet: one value, in one place, that a person can compare.

**What it still cannot prove, stated plainly.** That the ADDRESS is the right person's. That is not a
gap in the maths, it is where the trust has to come from — the address is published so it can be
compared out of band, the way a safety number is. A server that swapped a peer's address would have
to swap it everywhere that person's address appears, and one comparison catches it.

**`GET /chat/:id/devices` is a separate wire shape, not `devices.list` with a different WHERE.**
The owner's list carries a label somebody typed and a last-seen time; handing
those to anybody who can open a conversation publishes a device count and a description of
somebody's life for a feature that needs two public keys. `peerDevice` is the keys, the id, and the
proof. Membership is the authorisation, exactly as it is for reading the messages, so a conversation
you are not in answers precisely as one that does not exist.

**Two filters, each a rule rather than a tidy-up**, and `peer-devices.db.spec.ts` owns both against
a real Postgres: revoked devices are absent (wrapping to a signed-out device is what revocation
exists to prevent), and server-attested devices are absent (there is no proof to travel, so a peer
cannot check them at all). For a wallet device the ghost-device defence is
the attestation itself: a device the server fabricates cannot carry the account wallet's signature.

**A member with no sealable device comes back as an EMPTY ARRAY, never omitted.** "Nobody on the
other side can read this" and "I have not loaded the other side yet" are different states, and a
missing key cannot tell them apart.

**One bad device condemns the whole list.** A list containing something that does not verify is not
a trustworthy statement about the rest of it either, so `sealabilityOf` yields NO devices for that
member and renders `tampered` — an alarm with `role="alert"`, not a shrug. Quietly using the good
ones is exactly how a fabricated device ends up wrapped in beside the real ones.

**Sealing needs a wallet on both sides.** A guest has no wallet, so a guest has no provable device,
so nothing can be sealed to them - and a message is only ever sent sealed, so in a conversation with a
guest NOBODY can write, a table's chat included. That is a product decision with a real cost —
guests are the main onboarding path — and it is stated rather than hidden behind a padlock. The
notice used to state it as "These messages are not sealed", which was true when the sentence was
written and stopped being true the day an unsealed message became a 422: it read as a warning about
messages somebody could still send, above a composer that would send nothing. Every sentence of the
notice says who cannot write and why now ("Nobody can write here yet. sara.k is signed in without a
wallet...", "You cannot write here..." when the wallet missing is the reader's), and
`seal-state.spec.ts` refuses the old words in both languages. A reader with no wallet is told about
their own first: `sealabilityOf` named somebody else whenever anybody else was stuck too, so at a
table of two guests each read that the OTHER one had no wallet, as if that were all that stood in
the way. And an empty thread nobody can write in says "No messages yet." (`chat.emptyShut`), on the
chat page and in a table's panel: both said "No messages yet. Say something." above the notice that
said nobody could, and the panel added that everyone at the table could read it.
`table-chat.spec.ts` holds the panel. A
contract wallet is refused too, for now: ERC-1271 has no signature to recover and the answer needs
an `eth_call` this browser does not make. Unverifiable is not verified, and the copy says which.

**The notice names the person it is about**, and speaks in the second person when that person is
the reader — being told about your own account in the third person reads like a bug. It shipped with
no positive case, because a padlock ahead of its mechanism is a claim rather than a fact and at the
time nothing was sealed; it has one now, and *The sealing* says what it claims.

**`@noble/curves` 2.x flipped what `sign()` is given.** 1.x signed the 32 bytes handed to it; 2.x
HASHES them first unless told `prehash: false`. `signRecovery` passes a SHA-256 digest, so on the
default it signed SHA-256(SHA-256(challenge)) and the server - which verifies through WebCrypto
ECDSA with `hash: 'SHA-256'` over the raw challenge - refused a perfectly well-formed 64-byte
signature. Recovery would simply never have worked for anybody. `recovery.spec.ts` is what said so,
which is the whole reason the crypto specs gate that upgrade rather than riding along with it. The
2.x subpaths also need their `.js` (`@noble/hashes/sha3.js`), `p256` moved to
`@noble/curves/nist.js`, `Point.toRawBytes` is `toBytes`, and `sign()` returns the compact bytes
rather than a `Signature` to call `toCompactRawBytes()` on.

**Two things about the maths that fail silently.** EIP-191's prefix begins with the byte 0x19,
written as `String.fromCharCode(0x19)` because an invisible control character in a source file is
one an editor or a lint autofix eventually eats; and the length in that prefix is the BYTE length of
the UTF-8 encoding, not the character count, so a Persian message is longer than it looks. Either
mistake recovers a perfectly valid address that is simply not the signer, with no error anywhere.
`attestation.spec.ts` signs with `viem` — the library that really produces these signatures — and
recovers with the browser's own code, because a disagreement between the two halves would mean every
peer device on earth failing to verify and nothing saying why.

**`attestation.ts` is behind a dynamic import.** It is 14 KB gzip of elliptic-curve code for a
question most conversations never reach — a thread where nobody has a provable device is answered
entirely by the empty-array branch. A static import put all of it in the chat page's chunk and
pushed that chunk from 5.7 KB to 19.8 KB, past its budget, for code that would not run.

## The wallet fixtures, and why a happy path has to be reachable

`backend/src/db/seed-wallets.ts` seeds the six accounts that ARE the development population, their
friendships, three direct conversations and one group. They sign in with a wallet through the real
challenge-sign-post round trip, and five of the six hold a live device whose attestation really
verifies.

They exist because without them **the sealed half of this product had no reachable happy path in
any development database.** Everybody who used to be in one was a guest or a demo persona, so
`attested` was `server` for all of them, `peers.ts` published none of their devices, and
`sealabilityOf` answered `no-wallet` for every conversation that had ever existed here. The 640-cell
matrix could not reach a sealable thread; neither could a browser pass, because signing in as a
wallet account needs a wallet. The `ready` branch shipped in a PR whose gates were all green and had
never once rendered.

**The sixth, `dana.w`, deliberately has no device**, because it is the one a person and the matrix
sign in as — see *The sealing* for why an account you sign into must not already hold a device
nobody has the keys to.

**The signatures are real and the recipe is shared.** `deviceText` in `domains/identity/signature.ts`
composes the bytes for a live enrolment AND for the fixture, so the two cannot drift; `deviceLine`
and `namesDevice` live in `domains/device/resource.ts`, a module with NO imports, because the
browser needs them too and would otherwise carry `node:crypto` or `viem` into its bundle for a
template literal. `frontend/tests/wallet-fixtures.spec.ts` runs the seed's own `deviceText` through
the browser's own `verifyPeerDevice`, which is what makes "the browser accepts what the seed writes"
a claim rather than a hope. The seed never re-attests an account that already has a device, so a
database built before a change to this text has to be rebuilt, not repaired.

**The private keys are the published hardhat test keys**, already in this repository's specs. They
are there so a person can sign in as one of these accounts through the REAL wallet route - fetch the
challenge, sign it, post it - rather than through a development-only sign-in door that would have to
exist forever afterwards. The DEVICE keys are generated at seed time and only their public halves
are kept: nobody holds these devices, which is exactly what the other end of a conversation is.

Idempotent about the device as well as the account, because P-256 keys cannot be generated
deterministically from a seed and the fixture runs on every boot. The guard is "does this account
already have a device", which is also the rule a real account follows.

## The sealing

Only `kind: 'text'` is sealed, exactly as the wire format says. Everything else in this section is
the part that had to be decided while writing it rather than before, and three of the decisions
came out of design audits that found the first draft broken.

**`chat/envelope.ts` is a zero-import module, and both halves compose their strings from it.** The
separator is `String.fromCharCode(0x1f)` for the same reason `attestation.ts` writes 0x19 that way:
an invisible control byte in a source file is one an editor or a lint autofix eventually eats, and
the failure is a signature that verifies against different bytes than it was made over — which
reads as "everyone's messages are forged" with nothing anywhere naming the cause.

**The minter signs its recipient set AND its key check value, and every recipient checks both.**
The recipient half stops the server choosing WHO reads an epoch: it picks which wrapped keys a
client is shown, so without a signature it could withhold a device to keep somebody out of their own
conversation, or wrap one of its own in beside the real members.

The key half stops it choosing WHICH KEY, and it was missing for four commits. Every input to a wrap
and to a key check value is public — the recipient's exchange key, the conversation, the epoch, the
device id — so a server could mint its own key K', wrap it to one targeted recipient, compute a
matching confirmation, and leave the genuine recipient signature untouched. That recipient verified
a real signature over a real recipient set, unwrapped K', checked it against the server's own tag,
and sealed everything it typed under a key the server had chosen. Both checks passed. **Neither of
them was about the key.** A multi-agent audit of the shipped code found it; the live reproduction
confirmed the substituted key unwraps cleanly and matches the server's tag, and that binding the
confirmation into `epochCommitment` refuses it before the unwrap is ever reached.

The lesson generalises and is worth keeping: a commitment is only as good as the list of things it
commits to, and "I signed something about this epoch" is not the same as "I signed this epoch's key".

**The server verifies the commitment too**, which is a different job from the client's. It cannot
judge whether a recipient set is RIGHT — that is the recipient's check, against devices it verified
itself — but it can tell a signature from a string, and accepting a string let any member POST an
epoch carrying junk, wedging every other member's `adopt` forever with no product path back. Refused
at the boundary, like the subset check beside it. `epoch` is bounded to what the column holds for the
same reason: 2147483647 makes the NEXT mint raise 22003 rather than the 23505 the race handler
catches.

**`GET /chat/:id/signers` is a second device read, and revoked devices are IN it.** The recipient
list must exclude a device somebody signed out — that is what revocation is for. The signer list
must not: a device that minted an epoch in March and was revoked in April still signed it, and
hiding it would make every message of that epoch permanently unverifiable the moment somebody
replaced a laptop. Devices are never deleted, only revoked, which is what keeps the past checkable.

**`senderAccountId` is the account UUID, and it is the one uuid this product puts on the wire.**
Everywhere else a person is a handle, because that is the public identifier and the url key — but a
handle can be renamed, and an identifier that changes is one an old signature stops matching. It
travels on `conversationMember.accountId` and on the message, and the reader checks that the signing
device belongs to the account the message names.

**`seq` is per SENDER DEVICE, not per conversation.** A conversation-wide counter would have two
devices picking the same number whenever two people typed at once, and the loser would refetch and
retry for nothing: the AAD already binds the device, so a sender's own counter orders that sender's
own messages and nothing needs coordinating. One honest limit, stated rather than implied away: a
gap in a sender's sequence is visible, but nothing proves there is no gap — a server that drops the
LAST message leaves nothing to see. Detecting that needs each message to commit to the one before
it, which this version does not do.

**Every epoch carries a key check value.** `confirmation` is the epoch key encrypting a fixed
sentence about itself, bound to the conversation and the epoch. Without it a device holding the
wrong key finds out at the first message it cannot open, where a failed AES-GCM tag means "wrong
key" and "corrupt ciphertext" and "edited row" all at once.

**Rotation is client-driven and server-detected.** `GET /chat/:id/epoch` reports `stale` when the
recipient set no longer equals the eligible set — which is what enrolling a device or revoking one
changes — and the next sender mints the next epoch. The server cannot do it: it holds no key it
could re-wrap with, which is the point.

**Losing the race is ordinary, and `mint` must never pretend otherwise.** Two devices noticing one
change both compute the same number and the primary key on `(conversation_id, epoch)` arbitrates;
the loser is answered 200 with `minted: false` and reads the epoch again, where it usually finds the
set it was going to mint already minted. Writing that insert as `on conflict do nothing` is the
single most dangerous thing anybody could do to this codebase: the loser would believe it minted,
seal under a key nobody else holds, and the messages would be unreadable forever — with the symptom
appearing days later in somebody else's client. The client re-reads before it seals anything, and
`epochs.db.spec.ts` owns the whole race.

**Confirming or revoking a device rings every room the account is in.** `ringRooms` in
`services.ts` walks `chat.seatedIn` and sends the ordinary `chat` doorbell; `seal.store.ts`
subscribes and re-reads, dropping its signer cache with it. Without that a peer with the thread
open goes on sealing to the set it fetched when it opened — which is the one that still lists the
laptop somebody just signed out. It is the only thing this server can do about a membership change,
and it is enough, because rotation happens at the next thing anybody says.

**Rotating does not rewrite history.** The old epoch, its wrapped keys and the messages under it
stay exactly where they are, and an epoch fetched BY NUMBER is never `stale` — it describes the room
as it was. A member who joins gets no wrapped key for the epochs before them and nothing can make
one; the thread says `no-epoch-key` for those lines, which is true rather than empty. `seq` starts
again in each epoch, because a counter shared across epochs would make a message's position
meaningless the first time anybody rotated.

**The server's eligibility test is a SUBSET, deliberately.** Its idea of who can be sealed to is
"unrevoked, attested by a wallet or a contract"; the client's is narrower, because it
refuses a contract wallet it cannot check without a chain call it does not make. Demanding they
match would refuse an honest client for being more careful than the server. So the server bounds the
set from above — nothing unknown gets wrapped in — and the signed commitment bounds it exactly, from
the only place that can.

**The epoch key is BYTES, and that is forced rather than chosen.** WebCrypto refuses both halves of
what a key object would need here: a non-extractable AES key cannot be wrapped, and HKDF cannot
derive from an AES-GCM key at all. So the bytes exist in memory while a message is being sealed or
opened and are zeroed afterwards, and at rest they live as ciphertext under a per-browser vault key
that IS a non-extractable `CryptoKey` (`lib/epoch-keys.ts`). `structuredClone` preserving
non-extractable keys is what makes that possible. The honest claim stays "no key bytes at rest".

**`lib/keyring-db.ts` owns the IndexedDB version, and both key modules go through it.** Two modules
opening one database with their own idea of the version is a `VersionError` for anyone who ran the
first one — a keyring that looks empty and a device that appears never to have enrolled.

**A message that cannot be opened is a sentence, never a blank bubble.** `MessageLock` is five
states and `message-bubble` maps every one of them; `bad-signature` and `tampered` render as alarms
because they mean the row was EDITED, and the other three mean this browser simply does not hold
what it needs. The chats LIST opens previews only from keys this browser already holds — thirty rows
each fetching an epoch is thirty requests per navigation, which is the shape that took the rate
limiter out during the responsive matrix.

**There is a "this conversation IS sealed" line now, and only because the mechanism is here.** The
seal notice shipped with a comment saying there deliberately would not be one; that was right while
nothing was sealed. What it says is what happens: the bodies are ciphertext, the server stores them,
it cannot open them.

**A thread nobody can be sealed to is a thread nothing can be said in.** There is no unsealed
message any more, so the composer is disabled when `sealabilityOf` is blocked and the notice above
it names the person in the way. The browser pass found this: a send that could not seal threw into
the console instead of being a state.

**Sealing was a HARD CUTOVER.** No pre-sealing text row survived it, because a text row whose body
is gone renders as an empty bubble forever. There is no production data; a development database is
built from nothing and reseeds as empty threads.

**One wallet fixture deliberately has no device.** The seed mints device keys and throws the private
halves away, which is the honest shape for modelling the far end of a conversation and exactly wrong
for the near end: a seeded device on the account a person signs in as would be one nobody holds the
keys to, sitting beside the browser actually in use. `dana.w` is that account, so `enrolled` is false
for it and the browser's own enrolment is its first.

**Signing out surrenders the keyring.** `surrenderKeys` in `session.store.ts` drops the epoch keys,
the archive key and the device's own keypairs. A session ends but IndexedDB does not, and
`forgetEpochKeys` sat with zero callers for four commits — so signing out on a shared machine handed
the next person every conversation the last one had open, and the ability to sign as their device.
Each step is best-effort and independent: a browser that refuses IndexedDB must still be able to
sign out.

**`tools/qa/seal-pass.mjs` is the browser pass for this, and it is run by hand.** It injects an
EIP-1193 provider backed by a hardhat key, signs in through the real chooser, enrols through the
real button, opens a thread and sends a message — at 390 and 1280, both languages,
reading the console each time. It empties the account between cells because every fresh browser
context has an empty keyring and would otherwise enrol yet another device. It found two
defects on its first run: the console error above, and copy still offering a demo seat.

**What a reader is shown comes from the SIGNATURE, not from the row beside it.** The author is
resolved from the account uuid in the AAD through the signers list — `from` is an unsigned column,
and rendering it made the name over a message the server's to choose. The timestamp and the ordering
are the sender's `clientAt`, also in the AAD, not `created_at`, which the server writes and can
rewrite. The envelope's stated guarantees are only true if the read path actually looks at the
authenticated values, and for four commits it did not.

**`sessions.device_id` is written by a first enrolment and never moved again.** Re-enrolling used to
rebind it, and everything that branch checks is satisfied by PUBLIC data — the id is a hash of two
published keys, and `GET /devices` hands every device's keys to any session on the account — so any
signed-in browser could name somebody else's device and become it. That binding decides which
wrapped epoch key a caller is handed. Possession is proved by USING the key, which a browser does on
every seal, so nothing is given up by refusing to move it.

Sending is therefore authorised by device OWNERSHIP rather than by the session's binding, which also
fixes a lockout: a browser that signed out and back in holds perfectly good keys, is never offered
the enrolment that would set a binding (its keyring is not empty), and could otherwise never send
again. The barrier that actually decides authorship is the per-message signature; the server's check
is defence in depth. `GET /chat/:id/epoch` takes the caller's device for the same reason.

**A sender cannot choose how long their own words last.** `send` checks the signed expiry against
`conversations.expire_after` and refuses one the room did not agree to. The server still never
CHOOSES the value, so it still cannot lengthen a message's life — but without the check, expiry was
per-sender whatever the design said, and sixty seconds on your own messages in a room with expiry off
means your words are gone before anybody can report them, taking the frank with the row.

**The signer list is not a function of who is seated today.** It is anybody in the conversation now,
plus anybody who ever sent a message or minted an epoch in it. The argument that relaxes the
revocation filter relaxes this one: leaving a group or standing up from a table deletes a membership
row, and joining those two facts made a departed member's entire history render as forgeries.

**The browser specs run the real thing.** `tests/sealed-fixtures.ts` builds a genuinely sealed
corpus once at module load — a device per fixture person with real P-256 keys and a real wallet
attestation, one epoch per thread, every line sealed by its own sender — and `fake-api.ts` serves
it. A fake handing the browser plaintext would be testing a wire format this product does not have.

## Replies, reactions, forwards and deletions

`docs/superpowers/specs/2026-09-23-chat-actions-design.md` is the design; this is what it cost to
build and the rules it left behind.

**The plaintext is a document now, and `lib/body.ts` is the only thing that writes or reads it.** A
text message seals `{"text", "reply"?, "fwd"?}` and a reaction seals `{"react", "on"}`. It was the
fourth hard cutover of what goes inside the ciphertext, taken for the same reason as the first three:
nothing has shipped. The envelope, the AAD, the signature and the franking construction did not move.
A document that does not parse opens as `tampered`, and the franking commitment covers the whole
document - so a disclosure sends `message.plain`, never the rendered words, or the server recomputes
a commitment over different bytes and every report of a reply fails verification.

**A reaction is a sealed row whose TARGET is in the clear and whose emoji is not.** The server pages
history, so a target only the client knew would mean every client downloading every reaction in the
room to draw one page. Who reacted to what is the same class of fact as who replied when. The target
column is NOT in the AAD, and that is why the sealed document repeats it as `on`: a server moving a
reaction onto another message produces a row whose `on` disagrees with its `target_id`, and
`decodeReaction` drops it. Adding the target to the AAD would have been a fifth field in a format
this file calls settled.

**A reaction is exactly one emoji**, enforced by `isEmoji` over one grapheme cluster. Without it a
reaction is a free-text channel that renders as a chip - "BUY NOW" in a pill under somebody's words.

**Deleting leaves a tombstone, not a hole.** `kind = 'deleted'` keeps the id, the sender, the epoch,
the device and the sequence number, and nulls the body and every cryptographic column. Three things
need the row: the next sequence number is the maximum the server holds, so a hole would hand the
same number out twice; a reply has to be able to say its original was deleted rather than never
loaded; and every browser holding the plaintext in its search archive evicts it when it sees the
tombstone. The thread never draws one. Reactions on a deleted message go in the same transaction.

**Unread, the list preview, notifications and push all ignore reactions and tombstones.** A reaction
that rang "new message" would be the most annoying feature in the product, and one that bumped the
list would reorder somebody's inbox because a friend pressed a thumb.

**The emoji picker is never a modal on a pointer.** One `EmojiPopover`, hosted in the shell and
opened through `useEmojiPop`, anchors itself to whatever asked - the composer bar, a message's hover
bar, the "+" chip - with `lib/anchor.ts`, the maths the tooltip uses. A coarse pointer gets the
long-press sheet or a panel docked above the composer instead, because a popover under a thumb is
one the keyboard covers. The composer's popover stays open for several picks and a reaction's closes
on the first, which is the Telegram arrangement and the one people expect.

**The picker and the actions sheet are lazy.** `play.page` sat at 15.5 KB of a 15 KB budget the
moment the table chat learned reactions; the picker's data and the sheet are only needed once
somebody asks, and the table chat itself now loads right after the route through `<Dynamic>`, the
way the boards already did. The route went to 11.6 KB.

**Emoji are the one place an OS-drawn glyph belongs** - they are what somebody typed, or chose in
place of typing. The product's own chrome still draws none; see *No glyph the OS draws*.

**Formatting is Discord's, painted as DOM nodes.** `lib/markdown.ts` parses and
`lib/markdown-dom.ts` builds elements with `textContent`; nothing touches `innerHTML`, so a message
reading `<img onerror=...>` renders as those characters. Bare http(s) links only: a masked link
whose text lies about its target is a phishing primitive. A message of one to three emoji and nothing
else renders large and without a bubble.

**A `<For>` row binding cannot be used as a shorthand property.** `{ emoji }` compiles to
`{ emoji() }`, which does not parse, while `azeroth check` stays green. Framework register #30; write
`{ emoji: emoji }`.

## Recovery

A device that loses its keys loses what it could read, and the only honest way back is a secret the
person holds outside this product. That is a **generated** 120-bit phrase, and everything about the
design follows from refusing the two shortcuts a wallet-first product reaches for first.

**It is not derived from a wallet signature, and that is the most important sentence here.** A
deterministic `personal_sign` over a fixed string would be the obvious move on a platform where
everybody already has a wallet — and it would be an unrevocable, phishable, remote skeleton key to
every message the account has ever received. Getting one signature out of somebody is the single
most practised attack in this industry, and unlike a stolen device there would be nothing to
revoke. The phrase is random, it is shown once, and it exists only where the person put it.

**It is not chosen either.** PBKDF2 is the only KDF `SubtleCrypto` offers, and against a GPU it is
weak enough that a human-chosen phrase is a real break rather than a theoretical one. 600,000
iterations is in `recovery.ts` as belt; the 120 bits of entropy are braces, and the comment on the
constant says so — because the day somebody argues for letting people type their own phrase, that
number is what will be quoted as though it made it safe.

**Crockford base32, not a wordlist.** BIP-39 is 13 KB of dictionary shipped to every browser for a
string people write on paper once. Crockford excludes the four characters people confuse and folds
the confusable ones back on input, so a hand-copied `O` becomes `0` and nobody is told they got it
wrong for writing a capital letter.

**The phrase is minted in CANONICAL form and grouped only for the screen.** `mintPhrase` returns
twenty-four bare symbols; `groupPhrase` is for display and `normalisePhrase` is what everything
derives from. It shipped the other way round for an afternoon — minted pre-grouped, so setting up
recovery derived from `AB12-CD34-…` while using it derived from `AB12CD34…`, and the feature could
never have worked for anybody. Every gate was green. The browser pass found it, and
`recovery.spec.ts` now pins the round trip through the form a person is actually shown.

**What it protects is an ARCHIVE KEY, and the archive key seals every epoch key.** One secret
restores every conversation. It does NOT restore a device's identity: those keypairs are
non-extractable and stay that way, so a replacement browser enrols as itself with its own wallet
attestation and then restores what it can read. The working copy of the archive key lives in this
browser's vault beside the epoch keys, because otherwise archiving a key learned today would need
somebody to type twenty-four characters first.

**Recovery is for HISTORY.** A replacement browser is live the moment it enrols, so what it lacks is
the archive key. The phrase is offered on any live browser of the account that does not hold the
archive key (`recovery.holdsArchive()`), the server issues a challenge for any of the account's live
devices, and a correct answer to `POST /devices/recovery/restore` hands back the wrapped archive key. The client signs a one-shot
challenge naming the account and the device, and the server checks it against a stored public key.
The nonce names the DEVICE for the same reason the enrolment message does, and is burned FIRST by a
conditional UPDATE, so two replays of one signature race in the database and one wins.

**The server holds nothing it could use.** The salt is public by construction, the public key
verifies and decrypts nothing, and the wrapped archive key and its check value are sealed under a
phrase that has never been here. Holding the whole table gets an attacker no closer to a message
than holding none of it.

**Writing a vault needs a live device of the account on the session**, so a stolen cookie alone
cannot replace somebody's phrase.

**Rolling a phrase keeps the archive key** and re-seals it, so everything already backed up stays
readable and only the outer wrapping changes. Minting a fresh archive key instead would silently
orphan every row in the archive — and a browser that enrolled the ordinary way never receives the
archive key at all, so that was the COMMON case, not the exotic one. `setUp` refuses to roll when it cannot
produce the existing key rather than quietly destroying the backup.

**An archived key is bound to its slot.** `sealForArchive` authenticates `(conversation, epoch)`
alongside the key, because otherwise the archive is a bag of interchangeable blobs whose labels the
server supplies: relabelling one key onto another conversation makes that conversation permanently
unreadable on a recovered device, and the entry is preferred over the server's own wrap and never
evicted, so it does not heal.

**An archive write replaces what is in the slot.** `do nothing` meant a slot could be poisoned once —
junk written for an epoch before the real browser got there made every honest write afterwards a
silent no-op. **Turning recovery off needs a live device**, like writing a vault: it destroys
the vault AND the archive irreversibly, and it was reachable by any session at all, so a stolen
cookie could throw away somebody's only way back into their own history in one request.

**`readiness` reads this browser's keyring, never the server's `current`.** It used to fall back to
the device the SESSION is bound to, which reads as reasonable until the keyring is gone — a browser
whose storage was cleared or evicted went on reporting `ready`, the panel said "This browser is set
up", and the chat silently refused to send. That is precisely the situation recovery exists for and
the one place the product must not be confidently wrong. The browser pass found it by deleting
`nura-keyring` and reloading, which is what losing a laptop looks like from the inside.

**`tools/qa/seal-pass.mjs` loses a laptop in every cell.** It makes a phrase, throws the keyring
away, re-enrols and types the phrase back in to get the history back — at 390 and 1280,
both languages. Two of the defects above were found that way and neither was visible to any gate.

## Franking

Under end-to-end encryption moderation can only ever see what a reporter chooses to show it. Without
franking there would be no reason to believe a word of it: anybody could type a sentence, attribute
it to somebody they disliked, and nobody — including this server — could tell. That is not a small
gap on a social product. It turns the report button into a weapon aimed at whoever the most willing
liar dislikes.

**The construction, and what each half buys.** The sender mints a random franking key per message,
commits with `HMAC(key, plaintext)`, and seals the KEY inside the ciphertext while the COMMITMENT
travels in the clear. The server MACs that commitment together with the context it arrived in and
stores the result. So: the server learns nothing at send time, because a commitment under a key it
does not have is noise; a reporter cannot fabricate a message, because a valid frank needs the
server's key; and a sender cannot deny one, because the commitment binds the exact words.

**A disclosure is exactly one message.** The reporter picks it, and it proves nothing about any
other. That is the shape moderation has to take here and it is not a limitation to be engineered
around later — bulk disclosure would be a different product.

**The commitment is in the AAD**, which is why franking was the second hard cutover: every
signature before it covers ten fields and every one after covers eleven. The alternative was leaving
the commitment outside the authenticated bytes, where the server could move one message's commitment
onto another and a sender could publish one that does not match what they wrote — making their own
messages quietly unreportable. Every recipient recomputes the commitment from the key inside the
envelope, so a mismatch renders as `tampered` rather than as an unreportable message.

**The franking key is 32 bytes and lives in the first 32 bytes of the plaintext.** It is read back
out by length, so a key of any other size is silently mixed into the words — which is exactly what
happened the first time `crypto.spec.ts` used a readable string as a fixture, and every open failed
as `tampered` with nothing pointing at the length.

**The server's frank never travels.** A client cannot check it and has no reason to hold it, and
publishing it would hand every reader a token that only matters when a report is filed.

**The key is derived from `SESSION_SECRET`** by HKDF under its own label rather than being a second
environment variable to set, rotate and get wrong. One consequence, stated rather than discovered:
rotating that secret invalidates every frank. Old messages stay readable — franks are not part of
the sealing — but they stop being reportable. Splitting the two secrets is the right change the day
rotation is a real procedure rather than a paragraph.

**The disclosed message has to be the reported person's.** Franking proves what was said and that
it passed through this server; it says nothing about who is being accused. Without that check a
report against anybody could carry anybody else's words, and a moderator would read a real, verified,
correctly-attributed message and act on it against the wrong person — the exact outcome the whole
mechanism exists to prevent.

**A disclosure outlives the message it discloses.** `reports_disclosure_whole` held the four
disclosure columns all-or-none while the foreign key nulled `message_id` on delete, and those two
rules cannot both be satisfied: the first reported disappearing message wedged `sweepExpired` for
the whole deployment, every minute, forever, so nothing expired again anywhere. The CHECK says what
was meant now — the words, the key and the moment travel together, and the pointer may go null. Expiry must not become a way to
destroy the evidence in a report already filed.

**A report says what actually happened.** The sheet used to show "Report sent" and close before the
request resolved, so a refused disclosure — an expired message, a failed verification, a dropped
network — read as success. On a safety surface that is the worst failure mode there is: somebody
stops looking for another way to get help.

**A report with no message attached is still a report.** Reporting a person for what they have been
doing across a room was always legitimate and still is; attaching one message is what turns "they
said this" into something a moderator can check. A reporter who does not want to show a specific
message is not made to.

## Disappearing messages

**A property of the ROOM, not of a browser.** `conversations.expire_after` is seconds, null for off,
and anybody in the conversation may change it. The version where each device decides for the
messages it sends is the one that reads as broken: somebody turns it on, watches their own lines
vanish, and the other half of the conversation sits there forever.

**The change is ANNOUNCED.** `chat.line.expiry.on` and `.off` are written by `setExpiry`, following
the rule every other line key follows — a key without a producer is filler copy. A rule about how
long words last is not something to alter behind somebody's back, and a change nobody can see is one
people discover by noticing their history is shorter than they remember.

**The expiry is signed per message, not read from a column.** It rides in the AAD, so this server
can delete the row on time and cannot extend a message's life by a second; a recipient checks the
expiry it was signed with rather than the one a row happens to carry. That is also why changing the
setting cannot reach backwards: every message already sent carries its own, and nothing shortens or
lengthens one after the fact.

**Two places enforce it and they are not redundant.** The read filters on `expires_at > now()`, so
nobody ever sees a message in the window between its moment and the next sweep; the sweep deletes
the rows every minute. Filtering alone would leave the data; sweeping alone would show it for up to
a minute after it was supposed to be gone.

**A message that has run out cannot be reported.** `frankedMessage` filters on the same condition.
Franking proves what was said; it does not resurrect something both sides agreed would be deleted.

**Expired plaintext leaves the browser's archive.** `chat.archive()` is what `search.store.ts`
reads, so a disappearing message that stayed there went on being findable by its words long after it
stopped being readable in the thread — the opposite of what the room agreed to.

**What it does NOT do, said before what it does.** It does not un-say anything. Anybody who read a
message can screenshot it, copy it or simply remember it — that is true in every product with this
feature, and `expiry.honest` says so on the screen above the choices rather than below them. What is
real is narrower and still worth having: the row leaves this database, and it leaves the thread of
everybody following the rule. A stolen laptop, a scrollback in a year and a backup all stop
containing it.

**The minimum is a minute, not a second.** `conversations_expire_after_positive` refuses anything
shorter. Zero is what an off-by-one in a picker produces and it means "vanishes before it is read";
off is expressed by null, which is a different thing and says so.

## Notifications, and a push that carries nothing

A notification has NO TEXT. It is a kind, whoever caused it, a count and a reference, and the
sentence is composed at display time through the message catalogue — so it follows a language
switch. The version this replaces baked a bilingual string into the row when it was written, which
is the same defect `nura-e2ee/v1` calls out for chat lines and the same fix.

**The dedupe key is the whole design.** `notifications_dedupe` is unique over
`(user_id, dedupe_key)` and the write is an upsert that bumps `count`, moves `created_at` to
now and clears `read_at`. Twelve messages in one conversation are ONE row saying twelve, not
twelve rows to swipe away. The producer composes the key — `chat:<conversationId>`,
`friend:<actorId>`, `group:<groupId>`, `table:<tableId>` — and choosing it is the only
interesting decision in writing one.

**Six kinds, each with a producer**, the same rule `LINE_KEYS` follows: `friend-request`,
`friend-accepted`, `group-added`, `table-invite`, `message`, `turn`. A kind with nothing writing
it is filler copy standing in for something nobody has built.

**What somebody wants to be told about is a MUTE, and it belongs to the account.** The settings page
used to offer five switches kept in `localStorage` that nothing ever read - "Game results" and
"Achievements" for two kinds no producer writes, and three more whose off position changed nothing,
since the server writes the row and pushes the wake-up. A preference the writer never sees is a
switch with nothing behind it. The categories are `NOTICES` in `domains/notify/notices.ts`, a
zero-import module the settings page reads too, and `NOTICE_OF` maps each kind onto one; turning a
category off is a `notice` mute, which `tell` checks in the same `exists` as the actor and the
conversation. `mutes_notice_known` is a CHECK, so a category with no kinds behind it cannot be
stored, and `reference-parity.spec.ts` holds every kind to exactly one category.

**The mute is checked when the row is WRITTEN**, not when it is rendered. A notification that
exists and is hidden is still a badge somebody has to clear. Same for a block, and for your own
actions: nobody is told about something they did.

**`ref` is a closed set** — `conversationId`, `tableId`, `groupId`, `requestId`,
`personId` — filtered on the way in. The column is `jsonb` and would happily take a sentence;
that filter is what stops a "structured" notification from carrying prose.

**The list pages by keyset**, `(created_at, id)` descending, like chat history. `more()` appends;
anything that CHANGES the list drops the older pages and refetches the first, because stitching a
fresh head onto a stale tail is how a list shows one row twice.

**A push carries no payload at all**, and that is why `domains/notify/push.ts` is forty lines
rather than four hundred. A payload would have to be encrypted to the subscription's
`p256dh`/`auth` with HKDF and AES128GCM — and an encrypted payload of a message this server will
not be able to read under `nura-e2ee/v1` is a contradiction. What is left is the VAPID half: an
ES256 JWT naming the endpoint's ORIGIN (never its path, which identifies the subscription) and
expiring within the hour. The browser wakes the worker with an empty event, the worker shows one
generic notice, and the content comes from the api when the app is opened — over a session the
reader is already authorised on.

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are all three optional and all
three needed TOGETHER. With none set, `GET /notifications/push` answers with no key and the
client never asks the browser for permission: a prompt for something that cannot be delivered is
one somebody denies once and never sees again.

**`public/push-worker.js` is plain JavaScript served as-is, never bundled.** A service worker's
url is its identity, so a hashed filename would register a new worker on every deploy while the
old one kept running.

Sending is fire-and-forget and never blocks a request: a slow push service must not make sending a
message slow, and a dead one must not make it fail. A 404 or 410 from the service means the
subscription is over — the row is retired rather than retried forever.

**A row that is written, read or dismissed rings its owner's `me` scope**, with `notifications` as
the id, and that is the only doorbell the notifications store answers. It used to re-read on EVERY
nudge of every scope - a request per move per player in a live game - while a mark-all-read in one
tab never reached the other, because nothing about reading rang at all.

**A notification that changes KIND under one dedupe key takes the new kind and counts from one.**
`friend:<id>` carries both a request and an acceptance, and the upsert used to keep the old kind - so
somebody who was unfriended and then asked again was told they had been accepted.

**An invitation at create is held to the invite route's rules.** A table opened with invitees writes
a `table-invite` notice now, so the same `mayMessage` check `invite` makes is made for each of
them before a chair is written, and a friends table refuses an invitee who is not a friend. Without it
the notice was a way for a stranger to reach a minor.

**A friend request is RETRACTED once it is answered or withdrawn.** `notify.retract` deletes the
`friend-request` row under that pair's dedupe key, and only that kind: a `friend-accepted` under the
same key is a different fact and stays. A request that is no longer pending and still sits in the
bell with Accept on it is a button that can only fail.

## Realtime — `nura-rt/v1`

One WebSocket at `/ws`, and it is a **doorbell, not a delivery**. A frame says "something about
this conversation changed" and the store that cares re-reads it through the route that already
exists — with the same membership check, the same block rules, the same read watermark. A second
delivery path carrying message bodies would be a second place to get all three wrong, and it would
have to be rewritten again the moment a body becomes ciphertext.

`backend/src/realtime/frames.ts` is the whole wire. Server frames: `hello`, `presence`, `nudge`,
`typing`, `voice`, `signal`, `game`, `ack`, `refused`, `pong`. Client frames: `sync`, `presence`,
`typing`, `voice`, `signal`, `play`, `ping`. And
`parseClientFrame` is total and strict — **unknown keys are refused**, because a frame carrying a
field this version does not know is a frame from something that is not this client.

**`n` is a per-connection sequence number and is NOT the e2ee `seq`.** It stamps the order frames
left this server for one socket, nothing more. The envelope's `seq` in `nura-e2ee/v1` is bound
into AAD and orders messages inside a conversation epoch. They are different numbers with different
lifetimes; do not derive one from the other.

**The origin gate is a union, and the union is load-bearing.**

```
isSameOrigin(origin, request.headers.host) || origin === config.origin
```

`config.origin` alone refuses every socket in the mandatory QA run: the browser is on `:3200`
against the built server while `PUBLIC_ORIGIN` is `:3100`, and a refused handshake writes exactly
one console error that `tools/qa` cannot suppress — 600 failing cells. `isSameOrigin` is
reimplemented in `realtime/admit.ts` because `@azerothjs/ws` does not export its own copy; that is
recorded in the framework register, and the copy is not trivial (implied ports, the opaque `null`
origin a sandboxed frame sends).

**Nothing in `onConnection` may await.** The package replays the bytes that arrived in the same TCP
segment as the handshake AFTER `onConnection` returns, so a handler assigned behind an `await`
misses an eager client's first frames and they are dropped against a null handler with no error at
all. `realtime.socket.spec.ts` asserts this over the source text rather than by racing a socket —
a deterministic test beats an atmospheric one.

**Shutdown order is load-bearing.** `handleShutdownSignals` gives two seams and they are not
interchangeable: `beforeShutdown` runs while connections are still live, which is the only moment
`hub.closeAll(1001)` can say goodbye with a code; `beforeExit` runs after they are gone, which is
where the DataSource is destroyed. Swap them and every client sees 1006 and reconnects into a
server that is on its way out.

**`isMetered('/ws')` is now nearly dead code.** The rate limiter still scopes to `/api` and
`/ws`, but a socket costs one request per connection and the gateway meters frames itself
(`sync` 5s, `presence` 2s, `typing` 3s, ten faults and the socket is closed 4400; the budgets under
*A game is played over the socket*). Keep the
prefix — a handshake flood is still a flood — but the per-frame budget is where the real metering
happens.

**Presence has three states on the client, not two.** `Presence.known` says whether the server
mentioned this person at all; absent from the snapshot is NOT "offline", because it could equally
be `show_online: false`. An unknown person renders **no dot** (`presence.dot()` returns null) and
no presence word — a handle, which is always true, goes in that line instead. The store is a
projection of `useRealtime().presence()` and nothing else: the seeded roster that used to drift on
a timer is gone, so a page with no socket shows nobody online rather than inventing a room.

**A departure is a field, because it cannot be an absence.** `announce` builds its entry from the
presence record, and going dark is precisely the state where there is no record - so it used to send
`people: []`, a delta naming nobody, which the client merged into no change at all. A tab left open
showed people who had left hours earlier, and the client's own comment claimed "a delta naming
somebody with an empty list is how the server says they went dark", which is not a thing an empty
array can say. `gone: string[]` carries the handles instead, and is OMITTED rather than sent empty so
a reader can tell "nobody left" from "somebody left and I could not say who". `realtime-hub.spec.ts`
asserted the empty frame - the bug written down as an expectation - and now asserts the departure.

Removing them leaves them UNKNOWN rather than offline, which is the honest answer and the reason
`Presence.known` exists: somebody who left and somebody who turned presence off are the same thing
from outside, and `presence.dot()` draws nothing for either.

**The typing indicator is new server-visible metadata.** The server learns that somebody is typing,
in which conversation, and when — that is on the same list as who talked to whom and how large it
was, and it belongs in the privacy copy alongside them. A notice carries its own 4s expiry because
nobody ever sends "I stopped": the tab may have closed, the socket may have dropped, or they may
have walked away.

The client half is `services/realtime.source.ts` (the only module that constructs a `WebSocket`)
and `stores/realtime.store.ts` (one connection, jittered backoff seeded from `runtime().seed`, a
visibility pause, coalesced nudges). **Connecting does not reset the backoff — staying connected
for `STEADY_MS` does**, or a socket that opens and dies 200ms later in a loop is hammered at one
second forever. 4400, 4401 and 4429 are terminal and never retried.

**The seed is random per browser.** It was the constant 1, so every client on the deployment drew the
same jitter and a restart brought them all back in the same instant; tests set theirs explicitly.

**A table holds the socket, and a held socket is probed.** The play page holds it while a live match is
on screen, and while the reader sits ready at a live table waiting for one (*Somebody waiting at a live
table keeps their socket* in `games.md`), which keeps it through a hidden tab. Ten seconds without a
frame sends a `ping`; four more without an answer hang it up and reopen it at once, because a socket
whose far end has gone quiet without a FIN is otherwise trusted until TCP gives up minutes later. The
pongs also give the round trip and the server clock's offset, from the fastest of the last eight. The
server's own heartbeat is 15 s with a 10 s pong timeout. The fake socket answers pings the way the
server does and has a `deaf` switch for the case where it does not.

`stores/connection.store.ts` reports only what it can see: the socket's own status plus
`navigator.onLine`. The `latency` it used to publish was never measured by any request, and the
fixed 1800ms "reconnecting" animation had nothing to do with a reconnection. It deliberately does
NOT follow every flap — between drop and retry the socket is `down`, during the retry it is
`connecting`, and at the first backoff rung that alternates once a second — so `offline` means
something that will not fix itself and everything in between is one steady `reconnecting`.

It says one more thing, and does one. A socket that NEVER connected used to be passed over in
silence: the strip spoke only after a first connection, on the reasoning that the app was then "a
working pull-model app" - and it pulled nothing. Behind a proxy that does not pass the upgrade, or
on an origin the handshake refuses, somebody pressed Ready and nobody else saw it until they
reloaded, and the owner reported exactly that. After `UNREACHED_MS` (six seconds) without a first
connection the state is `unreached` and the strip says live updates are not getting through. And
while the socket is apart - never up, or dropped - every `LIFELINE_MS` (eight seconds) rings every
scope locally through `realtime.ring()`, the call a new connection makes, so every store reads
itself again: a chair, a Ready, a game that started arrive late, not never. Not while the browser
says offline, not in a hidden tab, and not once the socket is up. A play already went by HTTP when
there was no socket. `app-stores.spec.ts` holds the grace, the beat, the silence once connected
and the offline case.

**The socket starts FIRST in the app shell's `stops` array**, which means it stops LAST, because
the teardown runs in reverse and every store under it holds an unsubscribe against it. Each stop is
wrapped in its own try/catch: one that throws must not strand the sockets, timers and listeners of
every store after it.

### Who hears what

Five scopes, and each is one question somebody can be asked: `chat` (this conversation moved),
`social` (your graph moved), `game` (this board moved), `table` (this table moved) and `me` (a thing
of your own moved - `notifications`, `devices` or `profile`, carried as the id).

**A social doorbell and an edge change are two different calls, and conflating them was the bug.**
`socialChanged` used to drop the person's cached friends-and-blocks AND send a fresh presence
snapshot to every socket on the server. Dropping the edges made `visible()` false for that person
until they reconnected, so a friend request, a group join or a seat taken made the person who did it
vanish from every presence list at once - and it cost one snapshot per socket per call. It is a
doorbell and nothing else now. `edgesChanged` is what a block, an unfriend, an accept, a privacy
change or a handle claim calls: it RELOADS the edges in the flush, sends the moved people a snapshot
and everybody else a delta only if their view of them flipped - or, on a rename, the old handle in
`gone` and the new one in `people` - and re-asks `mayTalk` for every voice pair they are in, so a
block stops the audio without anybody leaving the room.

**Presence names people by HANDLE, and for a long time it named them by uuid.** The cached `Party`'s
`id` is the account uuid, and the hub used it as the `who` of every entry, while the client keys
presence by handle - so in production no dot ever lit for anybody. The hub spec could not see it,
because its fake uses handles AS user ids; `Edges` carries the handle now and the spec has a person
whose id and handle differ. `tools/qa/realtime-pass.mjs` is what found it.

**A table is its own scope, and it reaches three kinds of people.** Seated and invited are
`table.peopleAt`; the third is anybody LOOKING at it. `GET /tables/:id` records the reader in the
hub (`tableViewed`, memory only, the last four tables per person, dropped when they go dark), and
that is how a spectator's page turns into the board when the match starts and back when it ends,
without a reload. It rides on `social` no longer: a seat taken rang everybody's graph, and a
spectator was never in the `social` set anyway. A table ring also re-asks `voiceAllowed` for
everybody in its voice room, so standing up or closing the table takes the audio with it.

**`chatChanged` takes the people who just LEFT.** `recipientsOf` answers who is in the room now, so
somebody removed from a group, or standing up from a table, was exactly the one person never told
the thread had gone from their list.

**A look at a table is kept even before the socket exists.** A deep link fetches the table before
the socket has bound, so `tableViewed` refusing an account with no socket meant a spectator who
arrived by url never heard the table start. It records the look regardless, and the sweep drops the
looks of accounts that are neither connected nor lingering.

**A reload that lands late must not overwrite a fresher one.** Edges are reloaded after an await,
and a bind or a second flush can load newer ones meanwhile; an entry that was swept or is newer than
what came back is left alone. Anybody who connected during the await was not in the baseline the
deltas are computed against, so they are sent a full snapshot instead of a delta that assumes they
saw the old state.

**Asking somebody who already asked you IS an acceptance**, and it rings like one: the edges reload
and the request leaves the bell. It used to ring the plain doorbell, which left the two new friends
invisible to each other's presence until a reconnect.

**Every connection re-reads everything, the first one included.** Each one rings every scope once
with no id - on boot, after a drop, after a sleep behind a hidden tab. A store answers a bare scope as
"read it all again", which is what catches every doorbell that rang while nobody was listening - only
three stores re-read after a drop before, and none after an idle.

The first connection is not exempt, because it is never first. The stores read over HTTP the moment
the shell renders, on a pooled connection, while the socket is a new one: the server binds it about
3ms after the upgrade, but a browser opening `ws://localhost` spends about 300ms first (the api listens
on 127.0.0.1 only, so the attempt on `::1` has to fail), and no deployment makes that gap zero. A
doorbell rung in between reached no socket. The realtime pass blocked `omid.k` as
soon as his chats list had painted after a page load, the hub published both chat doorbells 150ms
later, his socket bound 130ms after that, and the two threads the block hid stayed in his list until a
reload. A second tab is the same window, and a server-side replay would miss it: the account already
has a socket, so nothing looks missed. The price is one re-read per store per page load.

**"Read it all again" still asks only for what the reader may read.** The chat store's answer to a
bare ring used to be the list and the open thread together, with the seal store asked about the open
room before either came back. Somebody taken out of that conversation while they were away - stood
up from a waiting table by the sweep, with the table's chat still on their screen - asked for a
thread and a device list that were no longer theirs, and a 404 is a console error however right the
answer is. The ring that names a conversation always read the list first and the thread only if it
was still listed; the bare ring does the same (`nudgedAll`): the list, then nothing more if the open
conversation was listed and has gone, otherwise the listeners and the thread. A thread the list's
pages have not reached is read as before. `realtime-stores.spec.ts` holds all three.

**A voice call HOLDS the socket.** A hidden tab lets its socket go after a minute, and the server
empties the voice room when the socket closes - so switching away from a call hung it up for good.
`realtime.hold()` keeps the socket through a hidden tab, and the voice store holds it from join to
teardown.

`tools/qa/realtime-pass.mjs` is three browsers on the built server - `dana.w`, `mina` and `omid.k`
watching - and every check is made in the OTHER browser without a reload: a request lights the
badge and the bell, an accept shows the friend with a live dot while everybody else keeps theirs,
the bell forgets an answered request, a group thread arrives and leaves, a rename reaches a friend's
list, an invitation at create rings the bell, a spectator's page turns into the board and back, and
reading everything in one tab clears the other.

## The audit, and what it found in shipped code

After PRs 11–14 landed, a 137-agent workflow audited the IMPLEMENTATION along ten dimensions —
three adversarial verifiers per finding, each prompted to refute — because everything until then had
reviewed the DESIGN. Thirty-three findings survived refutation, six of them critical, and the worst
was a complete break of the property the whole feature exists for: the epoch commitment signed who
received a key and not which key it was.

Two things about that are worth keeping.

**A design review cannot find an implementation gap.** The two design audits run before any crypto
was written caught thirty problems and were worth every token; neither could have caught this one,
because the design said "the minter signs the recipient set" and the code did exactly that. The gap
was in what the set did not include.

**Green gates said nothing.** At the moment the break existed, `npm run check` passed, 445 tests
passed, 640 QA cells passed, and the browser pass was clean. Every one of those is a real gate and
none of them is a substitute for somebody adversarial reading the code with the threat model in hand.

The findings that survived are recorded above in the sections they belong to, each beside the rule it
produced. `tools/qa/seal-pass.mjs` and the `.db.spec` suites pin the fixes; where a fix was subtle,
the test that would fail without it is named in a comment rather than left to be inferred.
