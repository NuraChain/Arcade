---
paths:
  - "backend/src/domains/identity/**"
  - "backend/src/chain/**"
  - "frontend/src/lib/wallet.ts"
  - "frontend/src/stores/wallet.store.ts"
  - "frontend/src/stores/account.store.ts"
  - "frontend/src/stores/session.store.ts"
  - "frontend/src/stores/chain.store.ts"
  - "frontend/src/stores/connect.store.ts"
  - "frontend/src/components/layout/connect-dialog.component.azeroth"
  - "frontend/src/components/app/wallet-panel.component.azeroth"
  - "frontend/src/components/app/profile-sheet.component.azeroth"
  - "frontend/src/pages/sign-in.page.azeroth"
  - "frontend/src/pages/app/me.page.azeroth"
---

# Signing in, and the Nura Profile

## The profile the ecosystem holds

`contracts/profile` in the SmartContract project is the Nura identity primitive — one profile per
address, a global username namespace, and values addressed by `(profile, key, language)` with no
schema of its own — and it is live on Nurachain. `backend/src/chain/profile.ts` is the half of this
product that talks to it, and `/app/me` is where a person sees the two agree or disagree.

**The ABI is the SERVER's, and so is the calldata.** The read path needs it anyway, and `viem` is
already a server dependency and NOT an application one — so composing `setFields` in the browser
would be a second description of one contract AND a new dependency inside the landing budget. It is
written as human-readable ABI rather than a compiled artifact: five signatures a reader can compare
against `ProfileTypes.sol` by eye, against fifty kilobytes of JSON nothing here can check. Nothing
on this server signs; `publish` answers with an UNSENT transaction the browser hands its wallet,
which is what keeps a key that could write to anybody's profile out of this process.

**Unconfigured is a state, not a failure.** `NURA_RPC_URL`, `NURA_PROFILE_ADDRESS` and
`NURA_PROFILE_LENS_ADDRESS` are needed together and default to empty, so a deployment pointed at no
chain answers `configured: false` without opening a transport and the panel renders nothing — the
shape push already has without VAPID keys. What it must never do is answer "nobody has a profile"
for a read it could not MAKE: a dropped rpc throws and the page renders the failure, which is the
rule the second audit wrote down when the leaderboard rendered a refused fetch as an empty world.

**Every chain read goes through `boundedClient` (`backend/src/chain/rpc.ts`), and it is built per
operation.** The profile read, the publish lookup, an NFT's `tokenURI` and the contract-wallet check
all used to make their own viem client, and only the last was bounded: `/api/chain/people/:handle`
ran on viem's defaults (10 s, three retries, about 41 s) and the NFT reader on 8 s with three
retries, so against an rpc that takes the connection and never answers, both answered 500 long after
the browser's 15-second `REQUEST_MS` had given up, and the QA matrix logged it on `/app/me`. The
shared client has no retries, a 4-second limit on each request that covers the response body too, an
8-second `AbortSignal` over everything one operation asks, and `ccipRead: false`. It is built for
each read rather than kept, because a deadline signal made once at startup would fire eight seconds
later and refuse every read after that. None of these reads use multicall or batching. The 4-second
limit on each request is what makes a read fail fast. Every operation today asks at most twice, so
two slow requests reach eight seconds on their own and the deadline never fires first. It is the
ceiling for an operation that asks more, and `tests/chain-rpc.spec.ts` holds it there: three
requests answered after 3 seconds each, and the third is refused at eight. The silent and stalled
cases in `chain-profile.spec.ts`, `nfts.spec.ts` and `identity.spec.ts` must finish under 6 seconds,
so a regression to 8 fails them. Failing fast does not change what failing means: the profile still
throws, and the page still has to render that failure.

**A fake chain never listens where `fetch` will not go.** Those specs stand a local server up on a
port the system picks, and viem reaches it with `fetch`, which refuses eighty-two ports outright
before it opens a socket (the Fetch Standard's port blocking: 6000, 6665 to 6669, 10080 and the rest;
the error is `fetch failed` with the cause `bad port`). On most machines the system never picks one.
On a machine whose dynamic range starts low (a Windows box set to 1024 upwards) it hands them out
like any other, so every few runs a fake landed on one: the read "could not be made" in two
milliseconds without reaching the fake, the reader answered nameless, and a case that expected a name
failed. It read as a race for an evening, because the failures came two or three in a row and then
stopped - the IRC ports are five in a row, and the next test gets the next port. `listen` in
`tests/fake-chain.ts` binds again until it holds a port `fetch` calls; `chain-rpc.spec.ts` holds
that, and that every port the helper names is one this runtime really refuses. The swallowed error
is what hid it: a spec that sees an answer it did not expect from a chain read should print the
cause before anything else.

**The @handle and the on-chain username are two namespaces and stay that way.** A handle is 2..32 in
any script — Persian handles are a feature this file describes and `naming.db.spec.ts` pins — and a
registry username is 3..32 of `[a-z0-9_]`, lower-cased, never starting with `0x`. They cannot be one
identifier without one of them losing, so Games writes NO username: `createProfile` passes the empty
string, the registry name is rendered beside the handle, and claiming one is Nura Wallet's job. It
is also a claim against a global index that can be REFUSED, which is a second refusal path the
profile sheet deliberately does not have — the same argument that gives `/handle` its own route.

**Every field goes under the default language.** An account holds one bio here, not one per language.
Writing it under `en` would hide it from a Persian reader resolving `fa` with fallback, while
claiming to be the English of something nobody ever localized.

**A profile page shows what the registry holds, and nothing else.** The owner's rule: the name,
the bio and the picture on `/app/me` and on anybody's `/app/people/:handle` are read from the Nura
Profile or are empty - the games, the achievements and the friends are this server's. So there is no
drift to show and nothing to adopt: the sync panel, the "differs" tag and `chain.adopt` are gone.
`GET /api/chain/people/:handle` answers `configured` and, when the person's wallet holds a profile,
`{ username, displayName, bio, avatar }` - never the owner address or the record - and 404s a handle
nobody holds, like the person route. A guest has no wallet and so no profile. With no name the header
shows the handle as the title. The picture is kept only when it is one stored HERE
(`avatarHashOf`), because the registry is written by other applications too and a link to anywhere
else would point every viewer's browser at a stranger's host. Everywhere else a person is drawn -
lists, chat, tables - still uses this server's copy.

**Saving the profile sheet IS the publish.** The owner updated a profile, saw it saved, and found
the chain unchanged: Save wrote this server only and the chain write was a separate button on
`/app/me` that nobody reached. Now Save uploads a new picture, claims the @handle, writes the server
copy, and for a wallet account on a deployment with a registry hands the wallet one transaction -
`createProfile` or `setFields` with `displayName`, `bio`, `avatar` and the record - and says "saved"
only once it is mined. The @handle never goes to the chain; it is this server's namespace. The
wallet is asked for nothing only when the save changes nothing the chain holds AND the registry
already agrees - a registry still holding an older name is written on the next Save, edited or not,
because skipping it there is the original complaint again. The server copy is written FIRST because
`publish` composes from the stored row, so a wallet that says no leaves the server ahead of the
chain, the sheet says exactly that, and the `/app/me` panel shows the drift with Publish beside it.
A wallet account on a deployment with no registry is told the profile stayed on this server, since a
plain "saved" there is how the original complaint happened.

**The picture is a link on the chain and a file on this server.** The registry never holds an
image - `avatar` is a URI and every value is capped at 4096 bytes - so the browser crops to a 256px
square on a canvas (WebP, or JPEG where the canvas cannot encode WebP, never PNG, which can outgrow
the cap), and `POST /api/auth/avatar` takes it as base64. The server reads the type from the BYTES
(`sniffAvatar`: WebP, JPEG or PNG, never SVG), caps it at 64 KB, stores it in `avatars` under its
SHA-256 and answers `${PUBLIC_ORIGIN}/avatars/<hash>.<ext>`. `GET /avatars/:file` serves it with the
stored type, `nosniff`, an immutable cache and the hash as the ETag, and vite proxies `/avatars` in
development. `profileInput.avatar` accepts only `''` or a link to a picture stored here, so nothing
this product renders points a reader's browser at a third party. The link is ABSOLUTE and on a
public chain: a development save writes `http://localhost:3100/avatars/...` into the live registry
for good. `users.avatar` is the server copy, nullable with no default, and every person payload
carries it, so `Avatar` draws the picture and falls back to the initials when it will not load.

**A publish answers with the outcome that happened, not a boolean.** Declining in a wallet is not a
failure, a revert is the contract refusing, and a transaction nobody has mined yet is neither. This
repository has twice recorded a screen reporting success before the answer landed; one boolean
could say none of it, so `settled` reports three states and the store waits through
`runtime().clock`. A send that fails reads WHY from `wallet.failure()` - a locked Nura Wallet answers
4100 rather than prompting, and it used to be reported as "you declined it"; a locked Nura Wallet
also answers `eth_accounts` with nothing, so an unknown address is asked for with `wallet.reach()`
before anything is concluded from it; any other send failure points at the wallet, most often gas,
rather than at the registry - and the store refuses
to send at all when the wallet's active account is not the signed-in one, because `createProfile`
from the wrong address creates somebody else's profile and the chain calls that success.

**A guest sees nothing at all.** No wallet means no address means no profile and nothing a button
could fix, and a strip explaining an absence nobody can act on is furniture. That is the branch this
file already records as structurally unrendered by every gate, so it was checked by hand.

**`callsFor` is pure and exported because it is the half that fails SILENTLY.** A read that goes
wrong throws; a write with the wrong selector or a mistyped field key lands in storage nobody reads,
costs real gas, and the chain reports success — the registry stores any key that validates and has
nothing on its side to refuse `displayNmae` with. `tests/chain-profile.spec.ts` decodes both
branches back out with no chain in the room.

**Testing it needs a chain, and a local one is the honest bed.** Live Nurachain holds the contracts
and no profiles, and the wallet fixtures have no gas there. `npx hardhat node` in the SmartContract
project gives accounts 0–5, which ARE `dana.w` through `leila.a`; deploy the implementation, the
proxy and the lens onto it and point the three variables at those addresses. A browser provider can
then be a plain fetch proxy to `127.0.0.1:8545` — the node holds the keys, so `personal_sign` and
`eth_sendTransaction` both work unlocked, and it sets `Access-Control-Allow-Origin: *`. One catch
worth writing down: it wants the message HEX-encoded, which is the step MetaMask does for you.

**The node does not have to be on 8545**, and on this machine it cannot be: Windows reserves a port
range that includes it and `listen` fails with -4092. `npx hardhat node --port 8645`, then
`node tools/qa/chain-deploy.mjs` deploys the implementation, the proxy and the lens from the
SmartContract project's artifacts (`QA_CONTRACTS` moves where it looks) and prints the three
addresses to set, with `NURA_CHAIN_ID=31337`. `tools/qa/chain-pass.mjs` then drives /app/me as
`dana.w` with a provider whose requests Playwright forwards to the node - through the test process
rather than a page `fetch`, so the page's own policies cannot stand between the wallet and the chain.

**The game record is a field the profile holds, written by the person's own wallet.**
`games.nura.record` sits beside the display name and the bio in the same `setFields`, so publishing
is still one signature. A new profile is `createProfile` first, and the record needs the id that
creates, so the store asks for a second round once the first has landed. The value is compact JSON
(`v`, the level, the XP, each played game's rating, peak, played and won, and the medal count) and
nothing else: no tallies and no streaks, because the registry is public and permanent and a record
there should be the one somebody would put on a card. `recordValue` refuses anything over the
registry's 4096 bytes before a wallet is asked, and answers the empty string for somebody who has
finished nothing - a record of zeroes is not an achievement. It is read back with `getField`, and
/app/me says whether what the registry holds is what this product would publish now. Nothing here
claims the record is verified: the server composed it and the person signed it, which is exactly
what it is.

## The NFTs a wallet holds

`/app/me` counts them and the count links to `/app/me/nfts`, a grid of every token the signed-in
wallet holds. Nothing here is a claim the product makes about the tokens; it is a reading of the chain.

**Holdings come from the explorer, and everything else from the chain.** `NURA_EXPLORER_API` is the
explorer's Etherscan-compatible api: `backend/src/chain/nfts.ts` pages `tokennfttx` and `token1155tx`
for the address and REPLAYS them - an ERC-721 token is held when its last transfer landed here, an
ERC-1155 balance is what came in minus what went out - because the chain itself cannot list what an
address owns without an indexer. The name and the picture are `tokenURI`/`uri` read through
`NURA_RPC_URL`, then the metadata JSON. With the explorer unset the answer is `configured: false`, the
stat is not drawn and the page says the server reads no NFTs - never "this wallet is empty".

**A token the chain could not name is asked about again next time.** The metadata cache keeps an
answer for an hour. That is right when the contract answered (a revert, or nothing at all, is
`refusedByContract`). It is wrong when the call could not be made: with no retries now, one dropped
request would leave a token nameless for an hour. So a timeout or an HTTP error returns a nameless
token for this response only, and the next view asks the chain again.

**A picture is fetched by this server and never by the reader's browser.** Metadata points anywhere
its minter liked, so a browser told to load it would hand every viewer's address to a stranger's
host. `GET /api/nfts/image/:contract/:tokenId` answers only a token the signed-in wallet HOLDS - with
a bare session check it was an open fetch proxy, since anybody can sit down as a guest and anybody can
deploy a contract whose `tokenURI` names any host - and the fetch behind it is the SSRF-guarded one: `https` only (`ipfs://` and `ar://` go through public gateways), a DNS
lookup that refuses any private, loopback, link-local or mapped address, the same refusal for an IP
written into the url itself (`allowedUrl` - `request` skips the lookup for a literal), three
redirects at most, size caps and one deadline. The bytes are sniffed and only PNG, JPEG, WebP and GIF
come back, never SVG, served `nosniff` with `default-src 'none'`. `tests/nfts.spec.ts` in each half
pins the replay, the guard and the page.

**A metadata host gets eight seconds of wall clock, whatever it sends.** `fetchPublic` used to pass
`timeout` to `https.request`, and that is a socket IDLE timer: it fires only after 8 seconds with no
bytes, and each redirect started a fresh one. Anybody can mint a token whose `tokenURI` names a host
that sends one byte every 7 seconds. Each view of `/app/me/nfts` then held a socket per token for as
long as that host liked, and under systemd's 1024 open files the api would stop answering. Now one
`AbortSignal` is passed as the request's `signal` and down through every redirect. When it fires the
request is destroyed, and trickled bytes do not move it. `meta()` also shares a read that is already
in flight, so repeated views of one token open one socket, not one each. `nfts.spec.ts` points
`node:https` at a local host for this, because the SSRF guard rightly refuses loopback. A host that
trickles is dropped at eight seconds, and redirects that would take longer than the deadline are cut
short.

## The admin

`/admin` opens for one wallet: `ADMIN_WALLET_ADDRESS` in the root `.env`, compared without regard to
case by `isAdminAddress`, and empty means nobody. The server decides it - the account payload carries
`admin: true` for that wallet and omits the field for everybody else - and `requireAdmin` only reads
the answer. Anybody else, signed in or not, is refused by the guard and shown the ordinary not-found
page, never a "forbidden" one. The page holds nothing yet; whatever an admin can DO has to be a
server route that checks `isAdminAddress` itself, because the guard is a courtesy like every other.

## Signing in

**The session belongs to the server.** It is a row in `sessions` addressed by an HttpOnly cookie
the browser cannot read, and identity is whatever `GET /api/auth/me` says it is.
`stores/session.store.ts` is a CACHE of that answer, never the source of it. The version this
replaces kept the answer in `localStorage` and trusted it, which meant editing one key in devtools
impersonated anyone.

`lib/guards.ts` is therefore a **courtesy**, not the enforcement: it exists so a signed-out visitor
lands on `/sign-in` instead of on a page of empty states. The enforcement is `requireSession` in
`backend/src/http/auth.ts`, which answers 401. Both guards await `session.ready()`, which resolves
after the first `/auth/me`; one request on boot, every navigation after it synchronous. They reach
the store through a **dynamic import** — see Performance for why that import must stay dynamic.

**A who-am-I that could not be asked is not a signed-out answer.** The store used to take ANY failure
of that first request for "nobody": a dropped connection, a 502 while the server restarted, a 429,
and `requireSession` then sent a signed-in person to `/sign-in`, where they stayed. (The same
catch already said a failed request is not a signed-out answer, and left the landing page's note
alone for that reason; the guard read the answer it had made up anyway.) Only an ANSWER signs
somebody out: a 200 with no account, or a refusal the server itself wrote, any status under 500
but 429. Anything else is asked again, after one second, then two, four and eight, and every eight
after that (`ASK_AGAIN_MS`, `ASK_AGAIN_MAX_MS`), on the runtime's clock so a spec can drive it.
`ready()` does not resolve until there is an answer, so both guards HOLD the navigation instead of
deciding it. A guard cannot draw anything and a guard that throws is a 403 in this router, which
draws "No table here"; so the store says it is held up through `lib/held-up.ts`, one signal that
imports nothing but the framework, and the page `<Routes>` falls back to while a navigation is
pending (`not-found.page` with `holding`) draws "The server is not answering" with a spinner
where it drew nothing. It says so from the SECOND failure on: one dropped request is asked again
a second later and is not worth a sentence, so the page holds as it always did for that second.
It needs no button: the page is already asking, and it opens by itself.
`session.refresh()` went with this; nothing had ever called it.

**The landing page's way in is a wallet chooser, and it is a dynamic import.**
`stores/connect.store.ts` is one boolean shared by the site header and the two landing CTAs;
`components/layout/connect-dialog.component.azeroth` is fetched the first time somebody asks for
it. That import MUST stay dynamic for the same reason `lib/guards.ts`'s is — see Performance.

The chooser lists Nura Wallet, MetaMask and Trust Wallet, in that order, matched against EIP-6963
announcements by `rdns` (a prefix match, so `io.metamask.flask` is still MetaMask). **A provider
keeps the first identity it announces.** Nura Wallet announces its own `net.nurachain.wallet` and
then the SAME provider again as `io.metamask`, `com.trustwallet.app` and three more, so a dApp's
MetaMask button works inside its browser - which here made every row open Nura, and a real MetaMask
lost its entry to whichever extension announced last. `discoverWallets` drops an announcement whose
provider is already known under another `rdns`, and `detect()` prefers Nura. A wallet that did not announce
itself is shown as missing with a link to its own download page — **except Nura Wallet, which has
no download link on purpose**: it injects its provider only inside its own in-app browser and
registers no url scheme, so there is nowhere to send a desktop browser. Its row expands into a
panel with a QR of this page and a copy button instead. A row that offered to install it, or that
called connect and waited, would be a button that lies.

`/sign-in` stays, wears the same `SiteHeader` (with `cta={ false }`, because that page IS the
connect surface) and `SiteFooter`, and remains what `lib/guards.ts` redirects to and where guest
and demo entry live.

Two ways in, and the account says which one was used through `kind`:

- **Wallet** (`kind: 'wallet'`). `stores/wallet.store.ts` asks an EIP-1193 provider for accounts,
  switches to NuraChain when `data/chain.ts` is configured, then asks the SERVER for the message
  to sign. The client never composes it: the site and the nonce are claims the server
  relies on when it verifies, so a client that writes its own is a client that can sign "for"
  somewhere else. The
  signature goes back and is CHECKED (`viem`'s `verifyMessage`, with an ERC-1271 `eth_call`
  branch for contract wallets). The version this replaces awaited `personal_sign` and threw the
  result away, which made the whole prompt theatre.
- **Guest** (`kind: 'guest'`). A typed name, no proof of anything, and the actual onboarding for
  most people. `handleFromName` folds the name into a handle.

**`/sign-in` offers the chooser too, and for a while only the landing page did.** `WalletPanel`
connects to whichever provider EIP-6963 announced first, which is the right default and was the only
option: somebody holding both MetaMask and Trust Wallet had no way to say which, and somebody holding
neither was pointed at MetaMask specifically. The same `connect-dialog` the landing uses opens from
the sign-in page now — **still behind a dynamic import**, because that component reaches
`wallet.store.ts` and therefore `api.ts`, and the landing chunk must not grow by a byte for it.

**There is no demo account and no `/auth/demo`.** Three seeded personas used to be offered on the
sign-in page so somebody could look around without connecting anything - but a guest already does
that, and does it as a REAL account nobody else can sign into. What `demo` added was precisely the
shared-identity property: several people in one account, whose profile the product then rendered
exactly like a person's. `users_kind_known` names `('wallet','guest')` and nothing else, rather
than leaving the value legal with nothing writing it.

**Nothing signed in as a GUEST had ever been rendered by a gate**, and that is the same structural
blind spot the wallet fixtures exist to close, seen from the other end. `tools/qa` tours 640 cells
as `dana.w` and `seal-pass.mjs` signs in with a wallet, so every control behind
`!account.isWallet()` shipped without once being drawn. What it hid was a PRIMARY button on settings
reading "Connect a wallet", sitting directly above "Sign out" and carrying the identical handler:
there is no wallet-link route on this server - `/auth/wallet` mints a NEW user from the address and
never reads the session - and a guest handle is claimed by INSERT, so signing out of a guest account
is the end of it. The button destroyed the account while the card that steered people to it promised
"this profile, these friends and every result follow you to any device".

The copy now says what happens, and `tests/settings.spec.ts` renders both pages as a guest so the
branch has something looking at it. Building the link instead is a real project - a schema change, a
route, and a decision about whether a guest's `attested: 'server'` devices become wallet-attested -
and it is not smuggled in under a copy fix.

**The QA matrix signs in with a WALLET**, through the real challenge-sign-post round trip, as the
`dana.w` fixture. It used to POST `/auth/demo`, which meant the one sign-in path exercised on every
run was the one no real person used. It now needs `seedWalletFixtures` to have run, exactly as it
used to need the demo rows.

**An ordinary wallet is verified with no network, and the chain is asked only about a contract
wallet.** `verifySignature` recovers the signer locally first and answers `wallet` the moment it
matches; `NURA_RPC_URL` is consulted only when it does not. Sign-in once ran viem's
`client.verifyMessage` for EVERY wallet whenever an rpc was set, and that call embeds the 1.7 KB
ERC-6492 validator bytecode in an `eth_call`. On 2026-10-04 rpc.nurachain.net began dropping
request bodies over about 1.2 KB (and refusing Node clients outright for a while), viem's default
transport tried four times (three retries) at 10 s each, and every `POST /api/auth/wallet` took 41
or 82 seconds - while the browser gives up at 15 (`REQUEST_MS`). Both MetaMask prompts succeeded,
every person in every browser was told the server could not be reached, and the server went on to
open a session whose cookie never arrived. `.env.example` had promised all along that a
key-holding wallet needs nothing here.

The contract branch is small, bounded and asks nothing it does not need:

- **One deadline for all of it.** This is `boundedClient`, the client every chain read uses. Each
  request has 4 seconds, body included. There are no retries, and an `AbortSignal` of 8 seconds
  covers every request one verification makes. viem's own timeout stops at the response HEADERS, so
  a node that sends headers and stalls the body would otherwise hold sign-in for undici's five
  minutes. Do not pass the signal in `fetchOptions`. Once `fetchOptions.signal` is set, viem gives
  fetch that signal INSTEAD of its own, and its timeout then aborts nothing. Until 2026-10-04 that
  made the 4-second limit here really 8 seconds. The signals are now combined in `fetchFn`. A
  verification asks at most twice, so it is the 4-second limit that fails a silent or stalled chain
  in about four seconds, and the identity tests fail at six.
- **No CCIP-Read, ever.** `ccipRead: false`. viem follows an EIP-3668 `OffchainLookup` revert by
  default, so the direct ERC-1271 call would let any contract anybody deploys make this server fetch
  the urls it names - cloud metadata, the api's own loopback, a tarpit - with no timeout, no size cap
  and no depth limit, before anyone has signed in. An offchain lookup is a refusal.
- **A deployed wallet is asked with ERC-1271 directly**: `getCode`, then `isValidSignature` over
  `hashMessage` with the signature as given. That body grows with the signature - a few hundred
  bytes for one ECDSA signature, more for a passkey or several Safe owners - so on an rpc with a body
  limit a large contract signature can still be refused, and is reported as `unreachable-chain`.
- **A wallet that is not deployed yet** proves itself only through its ERC-6492 wrapper, and that
  check is the deployless validator call, issued here rather than through `client.verifyMessage`:
  viem's `verifyHash` turns every failed call, a timeout included, into `false`, which would tell a
  person their signature was wrong when the network never answered.
- **A refusal is something the EVM said.** `bad-signature` means the chain answered with a revert
  (`ExecutionRevertedError`, or a `ContractFunctionRevertedError` that carries revert data), with
  nothing (`ContractFunctionZeroDataError`, a contract with no `isValidSignature`), or with data too
  short to decode. Everything else - a timeout, an HTTP error, `-32603` from an rpc's own upstream,
  a rate limit - is `unreachable-chain`, because "try again" is the true instruction for those.

`identity.spec.ts` holds every one of those shapes against a fake rpc, plus a chain that never
answers (an ordinary signature still passes in under two seconds) and one that stalls mid-body.

**The nonce is single use, and it is burned FIRST.** `signInWithWallet` runs a conditional UPDATE
that only matches an unconsumed, unexpired row and takes the stored message from its `returning`
clause. Two requests replaying one signature race in the database and exactly one wins. Verifying
first would leave a window where both passed.

**A handle is claimed by INSERT, never by "check then insert."** `insertUser` loops over
`candidatesFor` and lets the unique index arbitrate, moving on only for a genuine 23505.

`personFor` in `stores/account.store.ts` turns the server's account into the `Person` the app
renders: identity from the account, and — until the profile and social domains land — statistics,
achievements and a favourite game from the mock dataset, joined on the handle for a `demo` account
only. The four mock-backed stores read `account.user()?.id`, not the raw account id, because that
join is what keeps a demo tour's friends and chats attached to it.

Chain details come from `VITE_NURA_*` env vars (see `.env.example`); with none set the app signs
in on whatever network the wallet is already on and skips the switch. The sign-in text names no
chain; `NURA_CHAIN_ID` is what a wallet row records and what a contract wallet is checked on.

`lib/wallet.ts` discovers providers through **EIP-6963** and falls back to `window.ethereum`.
It does not believe `isMetaMask` — any injector can set that flag — so with no announcement it
takes the first injected provider, and `walletName(null)` says "Browser wallet" rather than naming
a wallet that is not installed.
