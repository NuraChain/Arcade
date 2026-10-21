# Playing for NURA: the design

The owner, 2026-10-21: "Ok now can you add paid version of games for example users can put Nura
Coin i mean https://nurachain.net/ on a table or board or cards games then they can play games with
real money and it is nura ... also you can create smartcontract here", and then "Also on
smartcontract project Arcade folder is related to this project".

So a table can be played for NURA, NuraChain's own coin: everybody at it puts in the same stake,
the winner takes the pot less a fee, and the money is held by a contract in the SmartContract
repository's `contracts/arcade/`, beside `ArcadeAchievements`, not by this server. This file is the
design: the contract (1), the trust it asks for (2), the server (3), the browser (4), fair dice and
cards (5), how it is proved (6) and how it reaches NuraChain (7). The decisions it rests on are
listed last (8), each with what was not chosen.

## 1. The contract: `ArcadeVault`

One contract holds every player's NURA, split two ways: **free**, which only its owner can move,
and **in play**, which is locked into one game and leaves it only to that game's winners or back to
its players. It is not upgradeable: the rules a player trusts with money cannot be rewritten under
them. A new version is a new address, and players withdraw from the old one.

**Roles** (OpenZeppelin `AccessControl`): the admin (the owner's wallet, then a multisig), the
referee (this server's key), the pauser (the admin).

**Money in and out.**

| Call | Who | What |
|---|---|---|
| `deposit()`, a plain transfer | anybody | credits the sender's free balance |
| `withdraw(amount)` | the owner of the balance | pays them from their free balance; never paused |
| `reclaim(id)` | anybody | three days after a game was opened and never paid, gives every player their stake back; never paused |

**A game.** What a player signs, as EIP-712 typed data in the domain `ArcadeVault`, version `1`,
this chain and this contract:

```
Stake(address player, string game, uint256 amount, uint16 feeBps, bytes32 commit,
      bytes32 nonce, uint64 deadline)
```

`game` is the game's id (`ludo`, `hokm`, `backgammon`, `poker`), `amount` the stake in wei,
`feeBps` the fee this player agrees to, `commit` the server's commitment to its part of this game's
dice and cards (*5*), `nonce` makes the signature good once, `deadline` makes it good for thirty
minutes.

| Call | Who | What |
|---|---|---|
| `open(id, game, amount, feeBps, seats)` | referee | locks one game: 2 to 9 distinct players, each with a signature valid for those values, unexpired, its nonce unused, and a free balance of at least `amount`; `feeBps` must be the contract's fee and `amount` within the ceiling. All or nothing. |
| `settle(id, winners, secrets)` | referee | pays one game: each secret must hash to the commit it was signed with; the pot is `amount x players`, the fee is `pot x feeBps / 10000`, the rest is split evenly among the winners (a bitmask over the seats), and what does not divide goes to the fee. Credits vault balances; sends nothing. |
| `refund(id)` | referee | gives every stake back, no fee |

**The owner.** `setFee(bps)` (never above 1,000, 10%), `setMaxStake(amount)`,
`withdrawFees(to, amount)`, `pause()` and `unpause()`. Pausing stops `deposit` and `open` and
nothing else: a game in play can still be paid, and every player can still take their money out.

**Views.** `balanceOf`, `lockedOf`, `gameOf(id)`, `fee`, `maxStake`, `fees`, the digest a signature
is made over (`stakeDigest`, for the server and the tests), and `solvent()`: the contract's NURA is
never less than every free balance, every stake in play and the fees together. The invariant suite
holds that after every call in any order.

**Events.** `Deposited`, `Withdrawn`, `Opened(id, game, amount, feeBps, players)`,
`Settled(id, winners, share, fee, secrets)`, `Refunded`, `Reclaimed`, and one for each change the
owner makes. A game's whole money story is in the chain's log.

**Built from what the repository already uses**: Solidity 0.8.28 for cancun, OpenZeppelin 5.6
(`AccessControl`, `Pausable`, `ReentrancyGuard`, `EIP712`, `SignatureChecker`, so an ERC-1271
contract wallet can sign as well as a plain one), custom errors, NatSpec, `Address.sendValue` after
the state has been written. Deployed by the `arcade` Ignition group (`--sc arcade`) with the admin,
the referee, the fee, the ceiling and the reclaim delay as parameters.

## 2. What it asks anybody to trust

| | Can | Cannot |
|---|---|---|
| A player | deposit, withdraw what is free, sign a stake for one game, reclaim an unpaid game after three days | move anybody else's money, take a stake back out of a game in play |
| The referee (this server's key) | lock a game every player signed for, pay its pot to some of its players, refund it | touch a free balance, raise a stake, change a fee a player signed, use a signature twice, pay anybody who was not at that game, stop a withdrawal |
| The owner | change the fee for games not yet opened (never above 10%), the ceiling, pause new games, take the fees, revoke the referee | touch a player's balance or a game in play |

What a player does trust is the referee's word about who won, because the games are played on this
server, as they always were. If the referee's key leaks, the worst it can do is pay locked pots to
the wrong player among the players of each game; the owner revokes the role in one transaction, and
a game nobody pays can be reclaimed. Section 5 makes the dice and cards checkable after the fact.

## 3. The server

**Configured or not.** `NURA_VAULT_ADDRESS` (public, the deployed vault) and `NURA_REFEREE_KEY`
(secret, a hot key funded with a little NURA for gas) beside the existing `NURA_RPC_URL` and
`NURA_CHAIN_ID`. Paid tables exist only when all four are set; with any missing the product is what
it is today, and every route answers `configured: false`. `backend/src/chain/vault.ts` is the half
that talks to the vault: the ABI written by hand, the typed data, the signature check (recovered
locally, an ERC-1271 wallet asked through the bounded client), the reads, the unsent calls the
browser hands its wallet, and the referee's writer (one nonce sequence in this process, every call
simulated before it is sent, receipts polled within a deadline).

**The data, in new tables only.** The second worktree shares the development database, so nothing
here adds a column or changes a CHECK on a table that already exists.

| Table | Holds |
|---|---|
| `table_stakes` | a table's stake (a table with no row is free) |
| `stake_consents` | a seat's signed Stake for the next game: nonce, deadline, commit, the server's secret, signature |
| `escrows` | one row per paid game: its on-chain id, table, match, game, stake, fee, state, winners, the transactions, the last error |
| `escrow_seats` | who was in it, their address, and their consent |
| `paid_accounts` | when somebody accepted the terms, and a break they asked for |

**An escrow's states.**

```
locking --open mined--> open --match ends--> settling --settle mined--> settled
   |                      |                     (no winner) --> refunding --> refunded
   +--open fails--> failed (the players it named are un-readied and told why)
open, never started (a crash) --> refunding --> refunded
any open game past three days and reclaimed by a player --> reclaimed
```

Every state is a row, so a restart loses nothing: at boot each escrow in `locking`, `settling` or
`refunding` is read back from the chain before anything is sent again, and a transaction is sent
only for a game the chain says has not had it. A double payment is not something the server
prevents by being careful; the contract refuses a second `settle`.

**Who may play for NURA**: a wallet account, never an account marked a minor, that has confirmed
once that they are 18 or older and accept the terms, and that is not on a break they asked for.
Anybody else is refused a chair at a paid table and a paid search, each with a word and a sentence.

**A table with a stake.** The create form sends a stake from the ladder; the server checks it, the
game and the live pace, and writes `table_stakes`. Somebody pressing Ready at a paid table is first
handed the typed data to sign (`POST /tables/:id/stake`: this table's game and stake, the vault's
fee, a fresh nonce and commit, thirty minutes); the signature comes back with Ready and is checked
(it recovers to the reader's own wallet, its values are this table's, it has not run out) together
with the reader's free balance, read from the chain. Un-readying drops the consent.

**Locking.** When every chair is ready the start does not deal: it writes an escrow `locking` with
every consent and answers with the table, which now says it is locking. The worker simulates and
sends `open`; on its receipt the match is created exactly as a start creates it today, under the
table's lock, and the table is rung. While a table is locking nobody can leave it, take somebody
out of it, close it or stop being ready (a sentence says it takes a moment). If the lock fails, the
consents it names (a balance that went, a signature that ran out) are dropped, those players are
un-readied and told, and the table is waiting again.

**Paying.** `commit`, in the transaction that finishes the match, writes the escrow `settling` with
the engine's winners: the seats `finish` names, so a team is both partners. The worker sends
`settle` with the seats' secrets; on its receipt the escrow is `settled` and every player's `me`
scope is rung, so their balance and the result card move. A game the engine ends with no winner is
`refunding`. Leaving, giving up and three missed turns are forfeits the engine already scores, so a
player who leaves loses the stake and the others play on for it. The rating and XP are what they
are at any table.

**Quick play at a stake.** The stake is part of the search (`quickOf` gains it): a search is
matched only with tables at the same stake, and a paid search carries its signed Stake, so the
searcher sits down ready and the table locks the moment its last chair fills.

**The routes.** `GET /vault` (configured or not, the vault's address and chain, the fee, the
ceiling, the ladder, the reader's free and locked balances and wallet balance, the terms and the
break), `POST /vault/deposit` and `/withdraw` (an unsent call with the amount), `POST /vault/terms`,
`POST /vault/break`, `GET /vault/history` (the reader's paid games, newest first, by keyset), and
the reclaim call for a game the server never paid. The table and match views carry the stake, the
pot, the fee, the escrow's state and its transactions.

## 4. The browser

- **`lib/wallet.ts`** sends a transaction with a value, asks for `eth_signTypedData_v4`, and switches
  the wallet to the vault's chain by its hex id. Sign-in is unchanged.
- **`/app/wallet`** (lazy): what is in the vault (free, in play) and in the wallet; Deposit and
  Withdraw with an amount and Max, the wallet asked, the chain waited for, the balance read again; the
  terms and the break; the history of paid games with explorer links; and a way to reclaim a game
  that was never paid. It is reached from the profile, from Settings, and from a balance chip where
  the shell's budget lets one in.
- **The create form and the quick play sheet** offer Free and the ladder, and say the pot, the fee
  and what the winner gets under the choice.
- **A paid table** wears its stake in `madder` (the colour already kept for "a table is playing for
  something") on its row, its header and in the lobby. Ready says the stake and asks the wallet; the
  lobby says "Locking the stakes on NuraChain" with the transaction; the result card says what was
  won or lost, and "Paying out" until it is paid. Poker's line that its chips have no value is
  reworded where the table has a stake.
- Every word is in English and in everyday Persian.

## 5. Fair dice and cards

A paid game draws its dice and cards from a seed nobody could choose alone, and anybody can check a
finished one.

- Each consent carries a **commit**: the hash of a 32-byte secret the server made for that seat. The
  player signs it as part of the Stake, so the server is held to its secret before it has seen
  anybody's signature.
- The game's seed is `keccak256(secrets in seat order, signatures in seat order)`. The server cannot
  steer it, because the signatures are unknown to it until each player signs, and a player cannot,
  because the secrets are unknown to them.
- Draw `k` of the action that makes revision `r` is `HMAC-SHA256(seed, "r.k.j")` read as a 32-bit
  number, `j` counting up only to reject a value that would favour low faces. The engines are
  untouched: they are handed a `Draws` built from this, where a free table keeps `randomInt`.
- `settle` reveals the secrets and the contract checks each against its commit, so the seed of every
  paid game is public on the chain once it is paid.
- A finished paid game offers "Check this game": the browser reads the moves, rebuilds the seed from
  the chain, replays every move through the same engines the server ran, and compares every event.
- What that costs, stated: once a game is paid, its seed is public, so every card dealt in it can be
  worked out, folded poker hands included. What it does not cover: a referee that lies about who
  won, which the replay then shows.

Node's and the browser's implementations of the draws are two copies of one formula, and one spec
runs both, as `devices.spec.ts` does for the device id.

## 6. How it is proved

- **The contract**: Mocha for every rule, refusal and event (replayed, expired and foreign
  signatures, duplicate players, a withdrawal between Ready and `open`, an ERC-1271 wallet, a
  re-entrant receiver, the fee and dust arithmetic, pause); Solidity fuzz over amounts, fees and seat
  counts; a stateful invariant run over every call; full line and branch coverage of the vault; the
  gas of `open` and `settle` at 2, 4 and 9 seats.
- **The server**: database specs on a disposable Postgres with a fake vault (every refusal, every
  state, a crash in each state reconciled, a second payment impossible, refunds) and specs for
  `chain/vault.ts` against a fake RPC.
- **The browser**: specs for the store, the wallet page, the sheets, the lobby and the result in
  both languages, and the bundle budgets.
- **`tools/qa/paid-pass.mjs`**, over the api of the built server, on a disposable database and the
  local hardhat chain with the vault on it: fresh wallets deposit, a paid game of every game and
  format is played to its end, and after each one the chain is asked who holds what and whether the
  vault is solvent; every refusal; two stakes in quick play never mixed; a walkout loses; a game
  with no winner refunds; the server stopped while locking and while paying, and started again,
  pays once; a reclaim after the chain's clock is moved three days.
- **`tools/qa/paid-play-pass.mjs`**: two real browsers with wallets on the local chain, from a
  deposit to a game played by clicks to a withdrawal.
- **By hand**, through the Playwright MCP with the real MetaMask extension on the local chain, in
  Persian on a phone and in English on a desktop.

## 7. How it reaches NuraChain

Nothing here is deployed to NuraChain by this work. `npm run preflight:nurachain` measures the
deploy's gas, the block time and the gas price, and checks that a nine-seat `open` fits under the
request size the public RPC accepts (it once dropped bodies over about 1.2 KB). Then the owner
deploys with `npm run deploy:nurachain:arcade` and its parameters, funds the referee, writes the two
lines into the root `.env`, and restarts the server. Before real value: an independent audit of the
contract, the admin role behind a multisig, and a check that playing for money is allowed where the
product is offered.

## 8. The decisions

| | Decision | Not chosen |
|---|---|---|
| D1 | A non-custodial vault: deposit once, a signed stake per game, withdraw any time | A transaction per game from the wallet; a balance kept by this server |
| D2 | Native NURA | WNURA or other tokens |
| D3 | The winner takes the pot less the fee; a team splits it; no winner is a full refund | Places paid at poker 6 and 9 |
| D4 | A 5% fee held by the contract, at most 10%, signed by every player for their game | 0, 2.5 or 10% |
| D5 | Leaving, giving up or missing three turns loses the stake, as the game scores it | Refunding an early leaver |
| D6 | Live tables only, every game, size and format | Turn-based tables, whose stakes would be locked for weeks |
| D7 | A ladder of 1, 5, 10, 25, 50, 100 and 250 NURA; a ceiling of 1,000 at deploy | A stake typed in |
| D8 | Wallet accounts only, never a minor, 18+ and the terms once, a break on request | |
| D9 | One signature for every paid game, good for thirty minutes | One signature for several games |
| D10 | Fair dice and cards at paid tables, checked by the contract and in the browser | Trusting the server's dice |
| D11 | `contracts/arcade/ArcadeVault.sol`, not upgradeable, withdraw and reclaim never paused | A proxy |
| D12 | A hot referee key on the server, its gas paid out of the fee | Winners paying gas to claim |
| D13 | Quick play matches the same stake only | A range |
| D14 | Not built: cash games, tournaments, place payouts, fiat, KYC, a typed stake, deposit history (the explorer instead) | |
| D15 | Built and tested on a local chain; NuraChain mainnet waits for the owner | |
