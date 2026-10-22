---
paths:
  - "backend/src/domains/stake/**"
  - "backend/src/chain/vault.ts"
  - "backend/src/entities/escrow.entity.ts"
  - "backend/src/entities/escrow-seat.entity.ts"
  - "backend/src/entities/stake-consent.entity.ts"
  - "backend/src/entities/table-stake.entity.ts"
  - "backend/src/entities/paid-account.entity.ts"
  - "backend/tests/stake.db.spec.ts"
  - "backend/tests/vault.db.spec.ts"
  - "backend/tests/fake-vault.ts"
---

# Playing for NURA

A table can be played for NURA, NuraChain's own coin: every player stakes the same amount, the
winner takes the pot less a fee, a team of two splits it, and a game nobody won is refunded. The
money is held by `ArcadeVault` (`contracts/arcade/ArcadeVault.sol` in the SmartContract project),
never by this server. The design and its decisions D1 to D15 are
`docs/superpowers/specs/2026-10-21-paid-tables-design.md`; this file is what the code does.

## The vault, and what the server may do with it

**Unconfigured is a state, not a failure.** `NURA_VAULT_ADDRESS` and `NURA_REFEREE_KEY` are both
optional. Paid tables exist only when both are set beside `NURA_RPC_URL` and `NURA_CHAIN_ID`
(`createVault(...).configured`, which also wants an address and a key of the right shape). Without
them `GET /vault` answers `configured: false`, every change is `paid-off` (404), a table cannot be
opened with a stake, and the worker does nothing.

**This is the first thing on this server that signs.** The referee key can lock stakes players
signed for, once each, and pay a locked pot to that game's players; it cannot touch a free balance,
raise a stake, change a fee a player signed or stop anybody withdrawing (the contract's own tests
hold all of that). It is a hot key: fund it with a little NURA for gas. `chain/vault.ts` sends
nothing it has not first SIMULATED with an `eth_call`, so a refusal costs no gas and comes back
decoded (`refusalOf`) with the player it names, and it pays NuraChain's floor (`NURA_GAS_FLOOR`,
47 gwei, because the chain reports a base fee of nothing and refuses anything under the floor). The
nonce is kept in the process (`nonceManager`) and reset after a send that failed.

**Deposits and withdrawals are the player's own transactions.** The server composes them
(`POST /vault/deposit`, `/vault/withdraw`: `to`, `data`, `value` and the gas price as quantities,
and `from`, the account that must send it) and the browser hands them to the wallet, as the profile
publish does. A withdrawal never waits on this server's rpc: when the price cannot be asked, the
call carries the floor.

## Who may play

**A wallet account, never a minor, that accepted the terms, not on a break** (`eligibilityOf` in
`stake/policy.ts`, asked in that order, each no a table refusal word: `paid-wallet`, `paid-minor`,
`paid-terms`, `paid-break`). The terms are accepted once (`paid_accounts`). A break of a day, a week
or a month sets `break_until` to the later of the break already running and the new one, so a
shorter break never cuts a longer one short, and whether one is running is Postgres's `now()`.
A break stops deposits and paid play; **withdrawals never stop**, for a minor and during a break
too, because the money is theirs.

## A table with a stake

**Live tables only, on the ladder, under the vault's ceiling** (`paid-pace`, `paid-stake`): 1, 5,
10, 25, 50, 100 and 250 NURA, the ceiling read from the contract. `create` writes the
`table_stakes` row in the transaction that opens the table. Every read of a table says `stake`,
and `money`: the table's newest escrow, its state, the two transactions, the winning seats, and for
a lock that failed the contract's word and the handle of whoever it was about (`blame`). A chair at
a paid table is refused to anybody who may not play, in their own words; an invitation is never
refused for it, because that would tell the host something private about the invitee. A free quick
search never finds a paid table.

**Ready is a signature.** `POST /tables/:id/stake` writes a consent for that chair: a fresh nonce,
a secret and its commitment, the game, the stake, the vault's fee and a deadline half an hour away,
and answers the EIP-712 typed data the wallet signs (`eth_signTypedData_v4`). Asking again replaces
it and takes the reader's ready back. `POST /tables/:id/ready` with `signature` is checked: a
consent that still has two minutes left (`LOCK_MARGIN_S`, on Postgres's clock), signed by the
reader's wallet (`signedBy`: recovered locally, a contract wallet asked through ERC-1271), at the
fee the vault has now, a stake under its ceiling, and that much NURA free in the vault
(`paid-consent`, `paid-stake`, `paid-funds`, `paid-paused`). Taking a ready back and leaving the
chair forget the consent.

## There is no Start button at a paid table

**The last signed ready locks the stakes** (`lockIfReady`, under the table's lock): every chair
taken and ready, no game on, no escrow in flight, every consent still with two minutes left and all
at one fee. A consent about to run out un-readies its player; two fees un-ready everybody, because
the contract takes one. The consents become `escrow_seats` and an escrow is written `locking`. A
start pressed at a paid table answers what a free one would, ending in `paid-locking` where a free
table would deal: no game is ever dealt there but by the lock.

**While the stakes are locking nothing frees a chair**: a leave, a close, a host's removal, taking
a ready back, signing again and the switch to or from a team call are `paid-locking` (409), and the
sweep that stands absent players up passes the table over. Each is asked under the table's lock.

## Quick play at a stake

**The stake is part of the search, and so is the signature.** `POST /tables/quick/stake` writes a
consent with no table yet (a searcher's newest replaces any other) and answers the typed data; the
search carries `stake` and `signature`, checked as a ready is (`signedSearch`: on the ladder, live,
the reader's wallet, the fee, the balance). Only a table at exactly that stake is found: a free
search never finds a paid table and a paid search never a free one, and a table it opens is a paid
quick table. The consent is bound to the chair in the search's own transaction (`attach`), so a
searcher who sits down has signed for that table, and a table the search fills is locked as the
last ready locks one. A wait at a paid quick table is let go of like any other when its player
looks for another game (*One live search at a time*, in `games.md`), never while it is locking.

## The worker

**One pass at a time in a process**, every two seconds (`STAKE_SWEEP_MS` in `main.ts`) and at once
when a lock is written or a paid game ends (`kick`), which only makes it sooner. A pass takes the
escrows that are `locking`, `settling` or `refunding`, oldest first, and then any paid table whose
players have all signed with nothing in flight: a server that stopped between a ready and its lock
locks it on the next pass. A fault in a step is reported and the next escrow goes on; `main.ts`
logs a fault once for as long as it is the same one.

- **Locking.** Asked of the chain first: a game already open there is a send whose hash was lost,
  and it is begun, never sent twice. A lock whose stakes have run out is failed, and so is one still
  waiting to be mined after that, because no block can take it then. Otherwise `open` with every
  seat in seat order, and the hash is written down. Mined, `match.begin` deals the game under the
  table's lock, from the chairs the escrow names, and the escrow is `open` with its match; a table
  that is not as it was locked (closed by hand, a chair that changed) is `refunding` instead.
- **A lock the vault refused.** Named a player (a signature, a balance, a nonce they cancelled,
  their stake run out): that player alone is un-readied, the escrow keeps their seat as
  `failed_seat`, and everybody else's signature goes back to being a consent, so the next lock
  takes them as they signed. Named nobody (paused, a fee or a ceiling that moved, a revert):
  everybody is un-readied.
- **Paying.** `commit` marks the escrow `settling` with the engine's winners (`maskOf`) in the
  transaction that finishes the match, or `refunding` when the engine named nobody. So leaving,
  giving up and three missed turns lose the stake, as the game scores them (D5); at a team table a
  walkout loses the team's stakes, because the side left standing is the engine's winner. The chain
  is asked first: a game already paid, refunded or reclaimed there is written down and not paid
  again. `settle` reveals every seat's secret in seat order. A payment the chain reverted is sent
  again thirty seconds later (`RETRY_AFTER_S`), and so is one the vault refused.
- **The next game** locks on the pass that writes the last one paid, if everybody has signed again.
- **Who is told.** Every step rings the table. A step that moves money (the stakes locked, a game
  paid, refunded or found reclaimed on the chain) also rings each of that game's players on their
  `me` scope with `vault`, so a page that shows their balance reads it again. A lock the vault
  refused moved no money and rings the table alone. `stake.db.spec.ts` (*tells each player their
  vault moved*) holds who is rung and when.

## Dice and cards that can be checked

**A paid game draws from a seed nobody could choose alone** (D10). Each consent carries a commit,
keccak256 of a 32-byte secret the server made for that seat, and the player signs it inside the
Stake, so the server is held to its secret before it has seen anybody's signature. The game's seed
is keccak256 of every secret and then every signature, in seat order (`seedOf` in
`domains/match/fair.ts`, which imports nothing, so the browser runs the same formula). Draw `k` of
the action that makes revision `r` is HMAC-SHA256 of the seed over `r.k.j`, its first four bytes
read as a big-endian number, `j` counting up only past a number that would favour the low faces
(`drawOf`). The match service hands an engine `drawsOf(seed, r)` for the opening (`OPENING`, the
revision every engine opens at), every play, every turn the sweep plays and a walkout; a free table
keeps `randomInt`. The engines are untouched.

**The seed is never stored.** It is worked out from the escrow's seats wherever a draw is made
(`seedOfMatch`, one indexed read beside the match row), because a copy of it would be a second fact
to keep right, and the secrets and signatures it comes from never change once the stakes are
locked. `settle` reveals the secrets on the chain, and `open` carried the signatures, so once a game
is paid its seed is public.

What it does not cover, stated: the server learns the seed when the last player signs, so it could
still decline to lock a game it did not like, and anybody would see the lock fail; it cannot change
a die or a card of a game it locked. It deals the cards, so it knows every hidden card while the
game is on, as any dealer does. And once a game is paid every card dealt in it can be worked out,
the hands nobody showed included. At a game of dice it can work out every roll before it is thrown,
so a check shows that no roll was changed, not that nobody heard one in advance.

`fair.spec.ts` holds the formula to a copy written apart from it, a draw that would favour the low
faces drawn again, the seed to viem's keccak of the parts, and the opening revision of every engine
at every format. `stake.db.spec.ts` (*dice that can be checked*) plays a paid Ludo game through
rolls, moves, a turn the sweep played and a resignation, one through a walkout, and a six-seat paid
poker game whose walkout deals the next hand, and replays every event of each from the seed; a
seed with one secret changed does not replay.

## Checking a finished game

**`GET /matches/:id/proof` hands a player of a finished paid game everything that proves it**, and
anybody else the bytes of a game that is not there (404, "No game there."): a game still on, a free
game, an id that is no uuid, somebody who did not play. What it holds: the game and how it was set
up (variant, seats, target, cube, blinds), the vault and its chain, the stake, the fee and the
escrow's state, each
seat's address, commit, secret, nonce, deadline and signature, and every row of the ledger from
the opening on, its payload and its events as JSON text because the wire has no shape for an
engine's own events. It is the players' alone because it publishes every card dealt, the hands
nobody showed included, even though once the game is paid the chain holds the same secrets and
signatures. The match half is `match.proof` and the money half `stake.proofOf`; `services.ts` puts
them together, so the match domain still reads no vault.

**The browser checks it with nothing of the server's but the data** (`lib/proof.ts`, fetched only by
the page): each signature is recovered over the EIP-712 Stake the browser hashes itself
(`stakeDigest`, with `addressFrom` in `lib/signer.ts`, which `attestation.ts` now recovers through
too) and must be the seat's own address; each secret's keccak must be its commit; the seed is made
from those parts; and every row is played again through the same four engines the server runs:
the opening with `create`, a person's play through `parse`, a turn the clock played through
`autoplay` (its payload says `auto`), a forfeit through `forfeit`, each with the draws of the
revision it makes. Every replayed event must equal the logged one, compared with the keys sorted,
because Postgres keeps a row's keys in its own order. Where the design said the browser rebuilds
the seed from the chain, it rebuilds it from what the server hands over after checking every
signature against its player and every secret against its commit; the two transactions where the
vault checked the same values are linked on NuraChain, and reading them back from the chain is not
built.

**`/app/me/wallet/check/:id` is the page.** It says first whether everything checks out, then who
signed, what the server promised and kept, the seed, the moves played again (or the first move the
seed does not give, with both versions of it), the two transactions on NuraChain and what this
does not show. It speaks of rolls at a game of dice and of cards at a game of cards (the
catalogue's `category`), and what it says the chain checked follows the escrow's state: the secrets
when the vault paid out, and none when every stake was given back for want of a winner or taken
back by the players, where no closing transaction of the server's is linked. A player whose name is
still their address is named once. A proof that will not load says so with a way to ask again; one
it may not see says there is nothing to check. The result card at a paid table offers "Check this game" once the
money line is shown, and so does each row of the wallet's paid games whose stakes were paid or
given back. `fair.spec.ts` in the browser holds the two halves of the formula to each other, the
stake's hash to the server's, all four games replayed, and a forged event, a changed opening deal,
a wrong secret, a stranger's signature, another fee or vault, a reordered seat list and an unknown
game each caught; `check-page.spec.ts` the page; `table-money.spec.ts` and `wallet-page.spec.ts`
the links; `stake.db.spec.ts` and `app.spec.ts` the route.

## A player's paid games, and taking back stakes nobody paid out

**`GET /vault/games` is the reader's own paid games**, newest first, twenty a page by keyset over
when each was locked (a cursor that does not parse is the first page): the game, the stake, how
many sat, the reader's seat, the state, whether they won, what the winner was paid, and the two
transactions for an explorer link. A lock that failed is left out, because no money moved. It is
nobody else's to read, like the match history.

**A game the server never paid can be reclaimed by any of its players** once the vault's wait has
passed (three days at deploy), which is the contract's promise that a stake is never stuck behind
this server. `POST /vault/reclaim` asks the chain, not the database, whether the game is still
locked there and since when, and hands the reader's wallet the call: `paid-done` when the stakes
are not locked any more and `paid-early` when the wait has not passed, and a game the reader did not
play is answered as one that is not there. The worker then finds the game reclaimed on the chain
when it next looks at it.

**The wait is over when either clock says so: this server's, or the chain's own** (`vault.clock()`,
the time of its newest block). The vault judges by the time of the block that takes the reclaim, and
the server judged by its own clock alone, so a chain whose clock was past the wait was answered
`paid-early` for a reclaim the vault would take: a server whose clock lags the chain's, and a local
node moved three days on, which is how the paid pass found it. The server's clock stays in it for a
chain that makes blocks only when it is sent something, whose newest block can be older than the
block a reclaim would make. The wallet page still offers "Take the stakes back" by the reader's own
clock, which on a chain that keeps time is the same moment. `stake.db.spec.ts` (*asks the chain's
clock as well as its own*) and `chain-vault.spec.ts` hold it.

## The owner's view of the vault

**`/admin` shows the vault to its owner, and the owner is whoever `/admin` already opens for**: the
account whose wallet is `ADMIN_WALLET_ADDRESS`. One function decides it (`adminOf` in `services.ts`,
through `isAdminAddress`), so more than one admin replaces one function. Every route under
`/admin/vault` answers anybody else as a page that is not there (404, "Nothing there."), the read and
the four calls alike, and asks the chain nothing for them.

**What it reads** (`GET /admin/vault`, `domains/stake/admin.ts`): the fee and its ceiling of 10%
(`MAX_FEE_BPS`, the contract's constant), the most a seat may stake, whether the vault is paused,
what it holds, the players' free NURA, what is in play, the fees held and whether it covers all of
that, in one `ledger` read that also refreshes the terms every player reads; the referee's address,
its gas, whether it still holds `REFEREE_ROLE`, and how many nine-seat games that gas pays for at
today's gas price (1.1M gas a game: `open` was measured at 943k and `settle` at 114k for nine
seats), low under twenty; the roles the owner's wallet holds (`DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`);
how many paid games are in each state; and the games stuck on the way: locking, paying or giving
back for more than ten minutes, or carrying an error the chain gave, oldest first, fifty at most.

**What it composes, and never sends**: a new fee, a new ceiling, fees taken out to the owner's own
wallet, and a pause or a resume, each asked of the vault from the owner's address first, so what the
vault would refuse is said in a sentence (`vault-role`, `vault-fee`, `vault-fees`, `vault-paused`,
`vault-running`, `vault-refused`) before the wallet is asked anything. The owner's wallet sends it
through the path a deposit takes (`vault.send`). A new fee applies to stakes signed after it: a table
whose players signed the old one fails its lock and asks them to sign again, as any failed lock does.

**The page** is `components/admin/admin-vault.component.azeroth`, one section of `/admin`, so the
admin console the owner asked for next can place it. It offers only what the wallet's roles allow,
asks before it pauses (deposits and new games stop; withdrawals, payouts and reclaims carry on),
keeps what was typed when something is refused, and says each result in a line of its own, because
`/admin` is outside the app shell and has no toast host. `admin-vault.spec.ts` holds the page,
`stake.db.spec.ts` (*the owner's view of the vault*) the service through the real ports,
`chain-vault.spec.ts` the reads and the calls asked of the vault, and `app.spec.ts` the routes.

## In the browser

**`stores/vault.store.ts` is the one place the browser talks to the vault.** It reads `GET /vault`
for whoever is signed in. A deposit, a withdrawal and a reclaim are composed by the server and handed
to the wallet (`sendTransaction` in `lib/wallet.ts`, with the value and the gas price), after the
wallet has been moved to the vault's chain (`toChain`) and only from the account the reader signed
in with; then the receipt is asked for every second and a half, for up to a minute, and the vault
is read again. Whatever did not go through comes back as a sentence of its own: declined in the
wallet, refused by the vault, sent and not landed yet, another account, another chain, a locked
wallet, NuraChain out of reach. A stake is never a transaction: it is `eth_signTypedData_v4` over
the typed data the server answered (`signStake`, `signSearch`).

**The store hears the vault move only while somebody looks at it.** A page that shows a balance
holds `listen()` from its mount to its teardown; holds are counted, and a release from before a
`reset()` lets go of nothing after it. While held, a `me` ring with `vault`, or every scope at once,
reads the vault again and moves `moved`, which the list of paid games is keyed on, as is a pull to
refresh. The first hold reads a vault that was already read once more, so the page never shows a
balance from before a game played on another page, and it never asks again for a read still on its
way.

**`/app/me/wallet` is the page** (beside `me/nfts` and `me/devices`, where the plan said
`/app/wallet`). What is in the vault, in play and in the wallet, in the reader's digits to four
places, never rounded up (`nuraOf` in `lib/nura.ts`). What else it offers follows the server's `may`:

- `yes`: put in and take out, and a break;
- `paid-terms`: the terms, with the vault's own fee, a switch for being eighteen and allowed to
  where they live, then Accept; NURA can only be taken out until then;
- `paid-break`: until when, a longer break, and taking out;
- `paid-minor`: taking out, and only when there is something to take;
- `paid-wallet`: the sentence, and nothing else is read.

While the vault is paused deposits are shut with a sentence and withdrawals stay open. An amount is
typed as NURA (`parseNura`: Persian and Arabic digits and the Persian decimal mark read, a comma
refused, so "1,000" is never one NURA); All of it fills the free balance to take out, or the wallet
less a hundredth of a NURA left for gas to put in. A break is asked first, as a destructive question.
The paid games: what each came to (the share paid for a win, the stake otherwise), a link to the
explorer on NuraChain and nowhere else, and "Take the stakes back" on a game nobody paid once the
vault's wait has passed, which the server asks the chain about again. It is reached from a card
under the profile's header and from Settings › Account, both only where the vault is open.
`wallet-page.spec.ts` and `vault-store.spec.ts` hold it.

**A stake is chosen where a table is opened or looked for.** The create form offers Free and the
vault's ladder (only the stakes under its ceiling) at a live table and at no other, and says what
the pot comes to, the fee that comes out of it and what the winner, or each of a winning pair,
takes, by the server's own `potOf`, `cutOf` and `shareOf`. It says when the vault holds less than
the stake, and to somebody who may not play it shows the stakes disabled, the sentence of their
refusal and the way to the vault's page. At poker the chips' sentence says what the chips are at a
table played for NURA. Quick play offers the same choice, to somebody who may play and for a live
search; a stake asks the wallet to sign the search before it is sent (`signSearch`), and the search
carries the stake and the signature. A refusal about money is said in its own sentence, where any
other refusal of a table that would not open is "That table would not open".

**Ready at a paid table is a signature first.** The lobby's Ready asks the wallet to sign this
game's stake (`signStake`) and then says ready with the signature; a stake the wallet would not sign
is said and nobody is ready. Taking a ready back asks the wallet nothing. Play again does the same
for the next game, and at a paid table it never presses Start, because the server's lock starts the
game. `stake-choice.spec.ts` holds all of it, and `play.spec.ts` the Play again.

**Nobody is asked to sign a stake the vault cannot cover.** The walk on the built server found it: a
player who had lost their last ten NURA pressed Play again, signed in the wallet, and was refused
`paid-funds` by the server, with nothing on the card to say why. The table's page holds the vault's
listening (`vaults.listen()`) for as long as the reader sits at a paid table, so the free balance it
holds is the one the last game left. `stakedOf` is handed it and says `short`, the balance, when it
is under the stake, never while money is moving on the chain (a lock, a payment or a refund in
flight), because then the balance is about to change. The waiting room and the result card then say
"You have 3 NURA free in your vault, less than the stake." with the way to the vault's page, to a
seated reader who has not said ready, and Ready and Play again ask the wallet nothing and say
`tables.refused.paid-funds`. `table-money.spec.ts` and `play.spec.ts` hold it.

**A paid table says what it is played for, and what came of it.** Its row in every list and the
play header wear the stake in `madder`, the colour that means a table is playing for something,
with "Played for" said to a screen reader. The waiting room says what each player stakes and what
the winner, or each of a winning pair, takes, at the fee the table's last lock was made at or else
the vault's; while the stakes are being locked it says so, with the transaction on NuraChain; and
when a lock was refused it says whose stake it was (the reader's own in the second person), or that
everybody has to sign again, until the next lock or game. The result card says what the reader
won, with "Paying it out…" until the payment has landed and then its transaction, what they lost,
or that every stake goes back from a game nobody won. It learns that from the table's newest
escrow while that escrow is a payment (`settling` to `reclaimed`), and keeps it for its own game
(`kept`, by the match's id) while the next game's stakes are locked, so pressing Play again does
not take the money line away; a card first drawn during that lock, or for another game, says
nothing of it, because nothing on the server names which game an escrow paid. It says nothing to
somebody watching. At a paid table the card offers no Start for the next game: once everybody has
signed again it says the stakes are being locked. The boards hand the card what they are handed
(`stake` beside `rematch`, `stakedOf` in `boards.ts`). `table-money.spec.ts` and `play.spec.ts`
hold it.

**The winner on the card is whoever the stakes were paid to.** A game whose last opponent gave up
early is not rated for the one left (the judge's `void`, *What a game leaves behind* in
`games.md`), and the card said "Ended too early to count." over "You won 19 NURA.". At a paid
table the escrow's winners are the engine's, so once a payment names them the headline names them
too ("You won.", "Sara Kamali won.") and the line under it says the rating and the streak did not
move (`match.over.voidPaid`). The finished game reaches the page a moment before the table that
says what its stakes came to, so while the table still says its stakes are `open` the card says
only "That game is over." (`awaiting`): the walk saw "Ended too early to count." stand for twenty
milliseconds before "You won.", and the headline is a live region, so a screen reader said both. A
free table, a refund and a lock still read as they did.

## How it is held

`stake-policy.spec.ts` holds the rules with no Postgres; `chain-vault.spec.ts` the vault's module
against a fake rpc; `vault.db.spec.ts` the vault page and who may play; `stake.db.spec.ts` the paid
table through the real ports with `fake-vault.ts`, which a spec steers: what it mines, what it
refuses, whether it can be reached. A lock or a finish nudges the worker in the background, so a
spec that awaits `jobs.sweepStakes` after one gets the nudged pass and one more. `app.spec.ts`
holds the routes, and `tools/qa/garbage-pass.mjs` sends them garbage.

Not here yet: the passes that play paid games end to end over the local chain, and the deploy to
NuraChain.
