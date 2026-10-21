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

## How it is held

`stake-policy.spec.ts` holds the rules with no Postgres; `chain-vault.spec.ts` the vault's module
against a fake rpc; `vault.db.spec.ts` the vault page and who may play; `stake.db.spec.ts` the paid
table through the real ports with `fake-vault.ts`, which a spec steers: what it mines, what it
refuses, whether it can be reached. A lock or a finish nudges the worker in the background, so a
spec that awaits `jobs.sweepStakes` after one gets the nudged pass and one more. `app.spec.ts`
holds the routes, and `tools/qa/garbage-pass.mjs` sends them garbage.

Not here yet: a player's history and reclaiming a game the server never paid,
the browser, provably fair dice and cards, and the admin's view of the vault.
