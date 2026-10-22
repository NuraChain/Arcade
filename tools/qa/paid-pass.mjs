/**
 * Playing for NURA over the real api, the built server and a local chain. Fresh wallets put NURA in
 * the vault and every format is played to its end for a stake, and after every lock and every payout
 * the chain is asked whether each player holds what a ledger kept here says they should. Then the
 * ways in that are refused, quick play at two stakes, a stake taken out from under a Ready, a table
 * nobody can leave while its stakes lock, a game whose table closed under the lock, a server stopped
 * while it locks and while it pays, and a game nobody paid taken back once the vault's wait is over.
 *
 *   PGDATABASE=<the server's database> QA_BASE=http://localhost:5300 QA_RESTART="<starts the server>" \
 *     node tools/qa/paid-pass.mjs
 *
 * The server runs built and in production, with the limiter raised (API_RATE_MAX=20000), on a
 * database nobody else uses, and with NURA_RPC_URL, NURA_CHAIN_ID, NURA_VAULT_ADDRESS and
 * NURA_REFEREE_KEY naming a hardhat node and a vault `vault-deploy.mjs` deployed on it for this run
 * alone: the pass asks of the vault's whole balance that it is exactly what its players and its fees
 * hold, and at the end it moves the node's clock past the vault's wait, so the next run wants a new
 * node. QA_RPC is the node (http://127.0.0.1:8645). PGDATABASE names the server's database because
 * three checks write a row by hand; the pass refuses the database the root .env names, and makes sure
 * the one it was given is the server's. QA_RESTART is a shell command that starts the server again,
 * and without it the part that stops the server is left out. QA_ONLY names parts: refuse, formats,
 * consent, withdraw, quick, locking, refund, restart, reclaim. The last moves the clock, so it runs last.
 */
import { execSync, spawn } from 'node:child_process';

import { createWalletClient, createPublicClient, decodeFunctionData, encodeAbiParameters, formatEther, http, keccak256, pad, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';

import { turns } from '../../backend/src/domains/match/backgammon/moves.ts';
import { databaseName, sql } from './db.mjs';
import { tableBody } from './tables.mjs';
import { vaultArtifact } from './vault-deploy.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const RPC = process.env.QA_RPC ?? 'http://127.0.0.1:8645';

const RESTART = process.env.QA_RESTART;

const ONLY = (process.env.QA_ONLY ?? '').split(',').filter((one) => one !== '');

const PARTS = ['refuse', 'formats', 'consent', 'withdraw', 'quick', 'locking', 'refund', 'restart', 'reclaim'];

const WEI = 10n ** 18n;

const BPS = 10_000n;

const DAY_MS = 86_400_000;

const HELLO_WITHIN_MS = 8000;

const LOCKED_WITHIN_MS = 30_000;

const PAID_WITHIN_MS = 60_000;

const RUNG_WITHIN_MS = 3000;

const BACK_WITHIN_MS = 120_000;

const ACTIONS_MOST = 12_000;

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];

const STATUS = ['none', 'open', 'settled', 'refunded', 'reclaimed'];

const ABI = vaultArtifact().abi;

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }${ detail === '' || detail.length > 100 ? '' : ` — ${ detail }` }`);
        return true;
    }

    failures += 1;
    console.log(`  FAIL  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);
    return false;
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const within = async (ms, happened) =>
{
    const until = Date.now() + ms;

    while (!happened() && Date.now() < until)
    {
        await pause(100);
    }

    return happened();
};

const until = async (ms, look) =>
{
    const end = Date.now() + ms;

    for (;;)
    {
        const found = await look();

        if (found !== null && found !== undefined && found !== false)
        {
            return found;
        }

        if (Date.now() > end)
        {
            return null;
        }

        await pause(200);
    }
};

const nura = (count) => BigInt(count) * WEI;

const shown = (wei) => `${ formatEther(wei) } NURA`;

const tag = () => Math.floor(Math.random() * 100000);

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const literal = (text) => `'${ String(text).replaceAll('\'', '\'\'') }'`;

const said = (answer) => answer === null || answer === undefined
    ? 'no answer'
    : `${ answer.status } ${ answer.body?.error?.code ?? '' } ${ (answer.text ?? '').slice(0, 160) }`;

const refusedAs = (label, answer, word) =>
    ok(label, answer.status >= 400 && answer.body?.error?.code === word, `${ answer.status } ${ answer.body?.error?.code ?? answer.text.slice(0, 120) }`);

const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        for (const line of response.headers.getSetCookie?.() ?? [])
        {
            if (line.startsWith('nura.session=') || line.startsWith('__Host-nura.session='))
            {
                cookie = line.split(';')[0];
            }
        }

        const text = await response.text();
        let parsed = null;

        try
        {
            parsed = text === '' ? null : JSON.parse(text);
        }
        catch
        {
            parsed = null;
        }

        return { status: response.status, body: parsed, text };
    };

    return {
        get: (path) => call('GET', path),
        post: (path, body) => call('POST', path, body),
        cookie: () => cookie,
        handle: null,
        socket: null,
        vault: 0
    };
};

const connect = (who) => new Promise((resolve, reject) =>
{
    const socket = new WebSocket(`${ BASE.replace(/^http/, 'ws') }/ws`, { headers: { cookie: who.cookie(), origin: BASE } });
    const patience = setTimeout(() => reject(new Error(`the server never said hello to ${ who.handle }`)), HELLO_WITHIN_MS);

    socket.addEventListener('message', (event) =>
    {
        const frame = JSON.parse(String(event.data));

        if (frame.t === 'hello')
        {
            clearTimeout(patience);
            who.socket = socket;
            resolve();
        }

        if (frame.t === 'nudge' && frame.scope === 'me' && frame.id === 'vault')
        {
            who.vault += 1;
        }
    });

    socket.addEventListener('error', () =>
    {
        clearTimeout(patience);
        reject(new Error(`the socket for ${ who.handle } would not open; is PUBLIC_ORIGIN ${ BASE }?`));
    });
});

const node = async (method, params = []) =>
{
    const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const answer = await response.json();

    if (answer.error !== undefined)
    {
        throw new Error(`${ method }: ${ answer.error.message }`);
    }

    return answer.result;
};

const chain = { ...hardhat, rpcUrls: { default: { http: [RPC] } } };

const reader = createPublicClient({ chain, transport: http(RPC) });

let vault = null;

const read = (functionName, args = []) => reader.readContract({ address: vault, abi: ABI, functionName, args });

const gameOf = async (escrowId) =>
{
    const [status, feeBps, openedAt, amount, players] = await read('gameOf', [pad(`0x${ escrowId.replaceAll('-', '') }`, { size: 32 })]);

    return { status: STATUS[status], feeBps, openedAt, amount, players: players.map((one) => one.toLowerCase()) };
};

const ledger = { held: new Map(), fees: 0n };

const everyone = [];

const holding = (who) => ledger.held.get(who.address) ?? { free: 0n, locked: 0n };

const move = (who, free, locked = 0n) =>
{
    const now = holding(who);

    ledger.held.set(who.address, { free: now.free + free, locked: now.locked + locked });
};

const lock = (people, amount) =>
{
    for (const who of people)
    {
        move(who, -amount, amount);
    }
};

const giveBack = (people, amount) =>
{
    for (const who of people)
    {
        move(who, amount, -amount);
    }
};

const payOut = (people, amount, feeBps, winners) =>
{
    const pot = amount * BigInt(people.length);
    const fee = pot * BigInt(feeBps) / BPS;
    const share = (pot - fee) / BigInt(winners.length);

    for (const who of people)
    {
        move(who, winners.includes(who) ? share : 0n, -amount);
    }

    ledger.fees += pot - share * BigInt(winners.length);

    return share;
};

const agrees = async (label, people) =>
{
    const wrong = [];

    for (const who of people)
    {
        const [free, locked] = await Promise.all([read('balanceOf', [who.address]), read('lockedOf', [who.address])]);
        const want = holding(who);

        if (free !== want.free || locked !== want.locked)
        {
            wrong.push(`${ who.name } holds ${ shown(free) } free and ${ shown(locked) } in play, not ${ shown(want.free) } and ${ shown(want.locked) }`);
        }
    }

    const [fees, solvent] = await Promise.all([read('fees'), read('solvent')]);

    if (fees !== ledger.fees)
    {
        wrong.push(`the vault holds ${ shown(fees) } of fees, not ${ shown(ledger.fees) }`);
    }

    if (!solvent)
    {
        wrong.push('the vault says it is not solvent');
    }

    return ok(`${ label }: every player holds what the ledger says, the fees are in the vault and it is solvent`, wrong.length === 0, wrong.join('; '));
};

const send = async (who, call) =>
{
    const hash = await who.wallet.sendTransaction({
        to: call.to,
        data: call.data,
        value: BigInt(call.value),
        ...(call.gasPrice === undefined ? {} : { gasPrice: BigInt(call.gasPrice) })
    });

    return (await reader.waitForTransactionReceipt({ hash })).status === 'success';
};

const putIn = async (who, wei) =>
{
    const call = await who.post('/vault/deposit', { amount: wei.toString() });

    if (call.status !== 200 || !await send(who, call.body))
    {
        throw new Error(`${ who.name } could not put ${ shown(wei) } in the vault: ${ said(call) }`);
    }

    move(who, wei);
};

const takeOut = async (who, wei) =>
{
    const call = await who.post('/vault/withdraw', { amount: wei.toString() });

    if (call.status !== 200 || !await send(who, call.body))
    {
        return false;
    }

    move(who, -wei);

    return true;
};

const player = async (name, { deposit = 0, terms = true } = {}) =>
{
    const who = session();
    const account = privateKeyToAccount(generatePrivateKey());

    who.name = `${ name } ${ tag() }`;
    who.account = account;
    who.address = account.address.toLowerCase();
    who.wallet = createWalletClient({ account, chain, transport: http(RPC) });
    who.handle = (await signInWallet(who.post, who.name, account)).handle;
    everyone.push(who);
    await connect(who);
    await node('hardhat_setBalance', [account.address, toHex(nura(1000))]);
    ledger.held.set(who.address, { free: 0n, locked: 0n });

    if (terms)
    {
        const accepted = await who.post('/vault/terms', { adult: true });

        if (accepted.status !== 200)
        {
            throw new Error(`${ who.name } could not accept the terms: ${ said(accepted) }`);
        }
    }

    if (deposit > 0)
    {
        await putIn(who, nura(deposit));
    }

    return who;
};

const signed = (who, terms, deadline = undefined) =>
{
    const typed = JSON.parse(terms.typedData);

    return who.account.signTypedData({
        domain: typed.domain,
        types: { Stake: typed.types.Stake },
        primaryType: 'Stake',
        message: { ...typed.message, amount: BigInt(typed.message.amount), deadline: BigInt(deadline ?? typed.message.deadline) }
    });
};

const stakeAt = (who, tableId) => who.post(`/tables/${ tableId }/stake`);

const sayReady = async (who, tableId) =>
{
    const terms = await stakeAt(who, tableId);

    return terms.status !== 200 ? terms : who.post(`/tables/${ tableId }/ready`, { ready: true, signature: await signed(who, terms.body) });
};

const tableOf = async (who, tableId) => (await who.get(`/tables/${ tableId }`)).body;

const seatAll = async (host, guests, wanted) =>
{
    const made = await host.post('/tables/', tableBody({ mode: 'live', privacy: 'public', ...wanted }));

    if (made.status !== 200)
    {
        return { refused: made };
    }

    for (const guest of guests)
    {
        const sat = await guest.post(`/tables/${ made.body.id }/seat`);

        if (sat.status !== 200 || sat.body?.seat === undefined)
        {
            return { refused: sat };
        }
    }

    return { tableId: made.body.id };
};

const leaveAll = async (people, tableId) =>
{
    for (const who of people)
    {
        await who.post(`/tables/${ tableId }/leave`, { forfeit: false });
    }
};

const begun = (who, tableId) => until(LOCKED_WITHIN_MS, async () =>
{
    const table = await tableOf(who, tableId);

    return table?.matchId !== undefined && table.money?.state === 'open' ? table : null;
});

const moneyIs = (who, tableId, state) => until(PAID_WITHIN_MS, async () =>
{
    const table = await tableOf(who, tableId);

    return table?.money?.state === state ? table : null;
});

const locking = (who, tableId) => until(LOCKED_WITHIN_MS, async () =>
{
    const table = await tableOf(who, tableId);

    return table?.money?.state === 'locking' && table.money.openTx !== undefined ? table : null;
});

const gamesOf = async (who) => (await who.get('/vault/games')).body?.games ?? [];

const escrowOf = async (who, matchId) => (await gamesOf(who)).find((one) => one.match === matchId);

const resign = (who, matchId) => who.post(`/matches/${ matchId }/resign`, { key: `resign-${ tag() }` });

const winnersOf = (table, people) =>
{
    const byHandle = new Map(people.map((who) => [who.handle, who]));

    return (table.money?.winners ?? []).map((seat) => byHandle.get(table.chairs.find((chair) => chair.seat === seat)?.who));
};

const choose = (match) =>
{
    const view = match.view;

    if (match.game === 'ludo')
    {
        return view.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: pick(view.moves) };
    }

    if (match.game === 'hokm')
    {
        if (view.phase === 'trump')
        {
            return { kind: 'hokm', verb: 'trump', suit: pick(SUITS) };
        }

        if (view.phase === 'discard')
        {
            return { kind: 'hokm', verb: 'discard', cards: view.hand.slice(0, view.discard) };
        }

        return view.phase === 'draw' ? { kind: 'hokm', verb: pick(['keep', 'reject']) } : { kind: 'hokm', verb: 'card', card: pick(view.plays) };
    }

    if (match.game === 'backgammon')
    {
        if (view.phase === 'opening' || view.phase === 'roll')
        {
            return { kind: 'backgammon', verb: 'roll' };
        }

        if (view.phase === 'double')
        {
            return { kind: 'backgammon', verb: 'take' };
        }

        const own = view.seats.find((row) => row.seat === match.turn).checkers;
        const other = view.seats.find((row) => row.seat !== match.turn).checkers;

        return { kind: 'backgammon', verb: 'move', hops: pick(turns({ me: [...own], them: [...other] }, view.dice)) };
    }

    const roll = Math.random();

    if (view.minRaiseTo !== undefined && roll < 0.25)
    {
        return { kind: 'poker', verb: 'allin' };
    }

    if (view.minRaiseTo !== undefined && view.minRaiseTo < view.maxRaiseTo && roll < 0.45)
    {
        return { kind: 'poker', verb: 'raise', amount: view.minRaiseTo };
    }

    if (view.toCall > 0 && roll > 0.9)
    {
        return { kind: 'poker', verb: 'fold' };
    }

    return { kind: 'poker', verb: view.toCall === 0 ? 'check' : 'call' };
};

const playOut = async (matchId, people) =>
{
    const byHandle = new Map(people.map((who) => [who.handle, who]));
    let state = (await people[0].get(`/matches/${ matchId }`)).body;
    const bySeat = new Map((state?.players ?? []).map((row) => [row.seat, byHandle.get(row.who)]));

    for (let action = 0; action < ACTIONS_MOST; action += 1)
    {
        if (state === null || state.finishedAt !== undefined)
        {
            return state;
        }

        const actor = bySeat.get(state.turn);

        if (actor === undefined)
        {
            console.log(`        nobody of the pass holds seat ${ state.turn }`);
            return null;
        }

        const own = (await actor.get(`/matches/${ matchId }`)).body;

        if (own.finishedAt !== undefined)
        {
            return own;
        }

        const play = choose(own);
        const answer = await actor.post(`/matches/${ matchId }/play`, { key: `paid-${ action }-${ matchId.slice(0, 8) }`, rev: own.rev, play });

        if (answer.status !== 200)
        {
            console.log(`        ${ said(answer) } for ${ JSON.stringify(play) }`);
            return null;
        }

        state = answer.body.match;
    }

    console.log(`        still going after ${ ACTIONS_MOST } actions`);

    return null;
};

const played = (match) => match === null
    ? null
    : { match, winners: match.players.filter((row) => row.result === 'won').map((row) => row.who) };

const pairedAt = async (one, two, amount) =>
{
    const seated = await seatAll(one, [two], { game: 'ludo', seats: 2, stake: amount.toString() });

    return ok(`a table for two played for ${ shown(amount) } opens and both chairs are taken`, seated.tableId !== undefined, seated.refused === undefined ? '' : said(seated.refused))
        ? seated.tableId
        : null;
};

const playedFor = async (label, people, wanted, end = async (table, them) => played(await playOut(table.matchId, them))) =>
{
    console.log(`[${ label }]`);

    const [host, ...guests] = people;
    const amount = BigInt(wanted.stake);
    const seated = await seatAll(host, guests, wanted);

    if (!ok(`${ label }: a table played for ${ shown(amount) } opens and every chair is taken`, seated.tableId !== undefined, seated.refused === undefined ? '' : said(seated.refused)))
    {
        return null;
    }

    const { tableId } = seated;
    const rung = people.map((who) => who.vault);
    const answers = [];

    for (const who of people)
    {
        answers.push(await sayReady(who, tableId));
    }

    if (!ok(`${ label }: every player signs the stake and is ready`, answers.every((answer) => answer.status === 200), answers.map(said).filter((one) => !one.startsWith('200')).join('; ')))
    {
        return null;
    }

    const started = await begun(host, tableId);

    if (!ok(`${ label }: the last signed Ready locks the stakes on the chain and deals the game`, started !== null, started !== null ? '' : said(await host.get(`/tables/${ tableId }`))))
    {
        return null;
    }

    lock(people, amount);
    await agrees(`${ label }, locked`, people);

    const escrow = await escrowOf(host, started.matchId);
    const there = escrow === undefined ? null : await gameOf(escrow.id);
    const seats = [...started.chairs].sort((one, two) => one.seat - two.seat).map((chair) => people.find((who) => who.handle === chair.who)?.address);

    ok(`${ label }: the vault holds the game at the stake and fee signed, its players in seat order`,
        there?.status === 'open' && there.amount === amount && Number(there.feeBps) === started.money.feeBps && there.players.join() === seats.join(),
        there === null ? 'no paid game listed' : `${ there.status }, ${ shown(there.amount) }, ${ there.feeBps }, ${ there.players.length } players`);
    ok(`${ label }: every player is told their vault moved when the stakes locked`,
        await within(RUNG_WITHIN_MS, () => people.every((who, index) => who.vault > rung[index])), people.map((who, index) => who.vault - rung[index]).join(' '));

    const rungLocked = people.map((who) => who.vault);
    const ended = await end(started, people);

    if (!ok(`${ label }: the game comes to its end`, ended?.match?.finishedAt !== undefined))
    {
        return null;
    }

    const paid = await moneyIs(host, tableId, 'settled');

    if (!ok(`${ label }: the pot is paid out on the chain`, paid !== null, paid !== null ? '' : JSON.stringify((await tableOf(host, tableId))?.money ?? {})))
    {
        return null;
    }

    const winners = winnersOf(paid, people);
    const share = payOut(people, amount, paid.money.feeBps, winners);

    await agrees(`${ label }, paid`, people);
    ok(`${ label }: the pot goes to the seats the game named, ${ shown(share) } each`,
        winners.every((who) => who !== undefined) && winners.map((who) => who.handle).sort().join() === [...ended.winners].sort().join(),
        `${ winners.map((who) => who?.handle).join(' ') } against ${ ended.winners.join(' ') }`);
    ok(`${ label }: the vault says the game was paid`, (await gameOf(escrow.id)).status === 'settled');

    const rows = await Promise.all(people.map((who) => escrowOf(who, started.matchId)));
    const wrong = people.filter((who, index) =>
    {
        const row = rows[index];
        const won = winners.includes(who);

        return row?.state !== 'settled' || row.won !== won || row.closeTx === undefined || (won ? row.share !== share.toString() : row.share !== undefined);
    });

    ok(`${ label }: each player's list of paid games says what came of it for them`, wrong.length === 0, wrong.map((who) => who.name).join(' '));
    ok(`${ label }: every player is told their vault moved when the pot was paid`,
        await within(RUNG_WITHIN_MS, () => people.every((who, index) => who.vault > rungLocked[index])), people.map((who, index) => who.vault - rungLocked[index]).join(' '));

    await leaveAll(people, tableId);

    return { tableId, matchId: started.matchId, escrow: escrow.id, winners, share };
};

const proven = async (label, people, stranger, game) =>
{
    const proof = await people[0].get(`/matches/${ game.matchId }/proof`);
    const body = proof.body;
    const commits = (body?.players ?? []).every((seat) => keccak256(encodeAbiParameters([{ type: 'bytes32' }], [seat.secret])) === seat.commit);

    ok(`${ label }: a player is handed the proof of the game, every secret in it the one its commit was made from`,
        proof.status === 200 && body.state === 'settled' && body.players.length === people.length && commits, said(proof));

    if (proof.status !== 200)
    {
        return;
    }

    const settling = decodeFunctionData({ abi: ABI, data: (await reader.getTransaction({ hash: body.closeTx })).input });
    const opening = decodeFunctionData({ abi: ABI, data: (await reader.getTransaction({ hash: body.openTx })).input });
    const secrets = body.players.map((seat) => seat.secret.toLowerCase()).join();
    const signatures = body.players.map((seat) => seat.signature.toLowerCase()).join();

    ok(`${ label }: the vault was paid out on the secrets the proof hands the players`,
        settling.functionName === 'settle' && settling.args[2].map((one) => one.toLowerCase()).join() === secrets);
    ok(`${ label }: and the stakes were locked on the signatures it hands them`,
        opening.functionName === 'open' && opening.args[4].map((seat) => seat.signature.toLowerCase()).join() === signatures);

    const nosy = await stranger.get(`/matches/${ game.matchId }/proof`);

    ok(`${ label }: somebody who did not play it is told there is nothing there`, nosy.status === 404, said(nosy));
};

const refuse = async () =>
{
    console.log('[who may not play for NURA]');

    const stake = nura(10).toString();
    const host = await player('Host', { deposit: 20 });
    const opened = await host.post('/tables/', tableBody({ game: 'ludo', mode: 'live', stake }));
    const tableId = opened.body?.id;

    ok('a table played for NURA opens for somebody who may play', opened.status === 200 && opened.body?.stake === stake, said(opened));

    const fresh = await player('No terms', { terms: false });

    ok('somebody who has not accepted the terms is told so by the vault', (await fresh.get('/vault')).body?.may === 'paid-terms');
    refusedAs('they cannot put NURA in the vault', await fresh.post('/vault/deposit', { amount: stake }), 'paid-terms');
    refusedAs('nor open a table played for NURA', await fresh.post('/tables/', tableBody({ game: 'ludo', mode: 'live', stake })), 'paid-terms');
    refusedAs('nor sit at one', await fresh.post(`/tables/${ tableId }/seat`), 'paid-terms');
    refusedAs('nor look for one', await fresh.post('/tables/quick/stake', { game: 'ludo', stake }), 'paid-terms');

    const accepted = await fresh.post('/vault/terms', { adult: true });

    ok('once they accept the terms they may play', accepted.status === 200 && accepted.body?.may === 'yes', said(accepted));

    const young = await player('Minor', { terms: false });

    sql(`update users set is_minor = true, allow_stranger_messages = false where handle = ${ literal(young.handle) }`);
    refusedAs('an account marked a minor cannot accept the terms', await young.post('/vault/terms', { adult: true }), 'paid-minor');
    ok('and the vault tells them they may not play', (await young.get('/vault')).body?.may === 'paid-minor');
    refusedAs('a minor cannot sit at a table played for NURA', await young.post(`/tables/${ tableId }/seat`), 'paid-minor');
    refusedAs('nor open one', await young.post('/tables/', tableBody({ game: 'ludo', mode: 'live', stake })), 'paid-minor');

    const rested = await player('Break', { deposit: 20 });
    const week = await rested.post('/vault/break', { days: 7 });
    const ends = Date.parse(week.body?.breakUntil ?? '');

    ok('somebody can take a week\'s break from playing for NURA', week.status === 200 && week.body?.may === 'paid-break' && ends > Date.now() + 6.9 * DAY_MS, said(week));

    const day = await rested.post('/vault/break', { days: 1 });

    ok('a shorter break asked for later never cuts the longer one short', Date.parse(day.body?.breakUntil ?? '') === ends, `${ day.body?.breakUntil } against ${ week.body?.breakUntil }`);
    refusedAs('on a break nobody can sit at a table played for NURA', await rested.post(`/tables/${ tableId }/seat`), 'paid-break');
    refusedAs('nor open one', await rested.post('/tables/', tableBody({ game: 'ludo', mode: 'live', stake })), 'paid-break');
    refusedAs('nor put NURA in', await rested.post('/vault/deposit', { amount: stake }), 'paid-break');
    refusedAs('nor look for a game at a stake', await rested.post('/tables/quick/stake', { game: 'ludo', stake }), 'paid-break');
    ok('but NURA can always be taken out, on a break too', await takeOut(rested, nura(5)));
    await agrees('a withdrawal on a break', [rested]);

    refusedAs('a turn-based table cannot be played for NURA', await host.post('/tables/', tableBody({ game: 'ludo', mode: 'turns', stake })), 'paid-pace');
    refusedAs('nor a stake off the ladder', await host.post('/tables/', tableBody({ game: 'ludo', mode: 'live', stake: nura(3).toString() })), 'paid-stake');
    refusedAs('an amount that is not one is not put in', await host.post('/vault/deposit', { amount: '0' }), 'paid-amount');
    refusedAs('a search at a stake for a turn-based game is refused', await host.post('/tables/quick', { game: 'ludo', mode: 'turns', voice: 'off', stake, signature: '0x00' }), 'paid-pace');

    const closed = await host.post(`/tables/${ tableId }/close`);

    ok('the host can close a table played for NURA that is only waiting', closed.status === 200, said(closed));
};

const FORMATS = [
    { label: 'ludo for two', game: 'ludo', seats: 2, stake: 10, at: [0, 1] },
    { label: 'ludo for four', game: 'ludo', seats: 4, stake: 5, at: [2, 3, 4, 5] },
    { label: 'ludo two against two', game: 'ludo', seats: 4, teams: true, stake: 25, at: [0, 1, 2, 3] },
    { label: 'hokm for two', game: 'hokm', seats: 2, target: 7, stake: 10, at: [4, 5] },
    { label: 'hokm for three', game: 'hokm', seats: 3, target: 7, stake: 1, at: [0, 1, 2] },
    { label: 'hokm two against two', game: 'hokm', seats: 4, teams: true, target: 7, stake: 50, at: [2, 3, 4, 5] },
    { label: 'poker heads-up', game: 'poker', seats: 2, blinds: 'high', stake: 10, at: [0, 1] },
    { label: 'poker for six', game: 'poker', seats: 6, blinds: 'high', stake: 5, at: [0, 1, 2, 3, 4, 5] },
    { label: 'backgammon to one point', game: 'backgammon', seats: 2, target: 1, stake: 100, at: [3, 4] }
];

const formats = async () =>
{
    console.log('[every format, played to its end for NURA]');

    const pool = [];

    for (const name of ['Ava', 'Bijan', 'Cyrus', 'Dorsa', 'Elham', 'Farid'])
    {
        pool.push(await player(name, { deposit: 300 }));
    }

    const stranger = await player('Stranger');

    await agrees('six players have put 300 NURA each in the vault', pool);

    const standing = (await pool[0].get('/vault')).body;

    ok('the vault page reads the balances the chain holds', standing?.balances?.free === holding(pool[0]).free.toString() && standing.balances.locked === '0', JSON.stringify(standing?.balances ?? {}));

    for (const { label, at, ...wanted } of FORMATS)
    {
        const people = at.map((index) => pool[index]);
        const game = await playedFor(label, people, { ...wanted, stake: nura(wanted.stake).toString() });

        if (game !== null && label === FORMATS[0].label)
        {
            await proven(label, people, stranger, game);
        }
    }
};

const consent = async () =>
{
    console.log('[a stake signed, and signed wrong]');

    const amount = nura(10);
    const one = await player('Signer', { deposit: 20 });
    const two = await player('Other', { deposit: 20 });
    const tableId = await pairedAt(one, two, amount);

    if (tableId === null)
    {
        return;
    }
    const first = await stakeAt(one, tableId);
    const typed = JSON.parse(first.body?.typedData ?? '{}');
    const fee = (await one.get('/vault')).body?.fee;

    ok('the stake to sign names the vault, its chain, the player, the game, the stake and the vault\'s fee',
        typed.domain?.verifyingContract?.toLowerCase() === vault.toLowerCase() && typed.domain?.chainId === chain.id
        && typed.message?.player?.toLowerCase() === one.address && typed.message?.game === 'ludo'
        && typed.message?.amount === amount.toString() && typed.message?.feeBps === fee, JSON.stringify(typed.message ?? {}).slice(0, 220));

    refusedAs('a Ready with no signature is refused', await one.post(`/tables/${ tableId }/ready`, { ready: true }), 'paid-consent');
    refusedAs('a Ready signed by another wallet is refused', await one.post(`/tables/${ tableId }/ready`, { ready: true, signature: await signed(two, first.body) }), 'paid-consent');

    const second = await stakeAt(one, tableId);

    refusedAs('a signature for a stake that was asked for again is refused', await one.post(`/tables/${ tableId }/ready`, { ready: true, signature: await signed(one, first.body) }), 'paid-consent');

    const dueIn = (seconds) => sql(`update stake_consents set deadline = date_trunc('second', now()) + make_interval(secs => ${ seconds })
        where table_id = ${ literal(tableId) } and user_id = (select id from users where handle = ${ literal(one.handle) })
        returning extract(epoch from deadline)::bigint`);
    const dying = dueIn(60);

    refusedAs('a stake signed with under two minutes left is refused', await one.post(`/tables/${ tableId }/ready`, { ready: true, signature: await signed(one, second.body, dying) }), 'paid-consent');

    const living = dueIn(600);
    const kept = await one.post(`/tables/${ tableId }/ready`, { ready: true, signature: await signed(one, second.body, living) });

    ok('the same stake signed with ten minutes left is taken', kept.status === 200 && kept.body?.chairs?.find((chair) => chair.who === one.handle)?.ready === true, said(kept));
    ok('NURA taken out of the vault leaves less free than the stake', await takeOut(two, nura(15)));
    refusedAs('a Ready for more than the vault holds free is refused', await sayReady(two, tableId), 'paid-funds');
    await putIn(two, nura(10));

    const after = await sayReady(two, tableId);

    ok('with the NURA put back the same Ready is taken', after.status === 200, said(after));

    const started = await begun(one, tableId);

    if (!ok('and the stakes lock, the one signed with ten minutes left among them', started !== null))
    {
        return;
    }

    lock([one, two], amount);
    await agrees('a stake signed with ten minutes left, locked', [one, two]);
    await resign(one, started.matchId);

    const paid = await moneyIs(one, tableId, 'settled');

    if (ok('the one who stayed is paid when the other gives up', paid !== null && winnersOf(paid, [one, two]).join() === [two].join()))
    {
        payOut([one, two], amount, paid.money.feeBps, [two]);
        await agrees('a game given up', [one, two]);
    }

    refusedAs('a signature that locked a game cannot be used for the next', await one.post(`/tables/${ tableId }/ready`, { ready: true, signature: await signed(one, second.body, living) }), 'paid-consent');
    await leaveAll([one, two], tableId);
};

const withdraw = async () =>
{
    console.log('[NURA taken out between a Ready and the lock]');

    const amount = nura(10);
    const early = await player('Early', { deposit: 20 });
    const late = await player('Late', { deposit: 20 });
    const tableId = await pairedAt(early, late, amount);

    if (tableId === null)
    {
        return;
    }

    ok('the first player says Ready with their stake signed', (await sayReady(early, tableId)).status === 200);
    ok('and then takes their NURA out of the vault', await takeOut(early, nura(15)));

    const last = await sayReady(late, tableId);

    ok('the last Ready is taken, because the vault is asked when the stakes lock', last.status === 200, said(last));

    const failed = await moneyIs(early, tableId, 'failed');

    ok('the lock fails on the chain and names the player whose NURA left', failed?.money?.blame === early.handle, JSON.stringify(failed?.money ?? {}));
    ok('only that player is asked to sign again', failed?.chairs?.find((chair) => chair.who === early.handle)?.ready === false
        && failed.chairs.find((chair) => chair.who === late.handle)?.ready === true);
    ok('and no game was dealt', failed?.matchId === undefined);
    await agrees('a lock the vault refused moves no NURA', [early, late]);
    await putIn(early, nura(10));
    ok('with NURA put back they sign again', (await sayReady(early, tableId)).status === 200);

    const started = await begun(early, tableId);

    if (!ok('and the stakes lock with the other player\'s signature as they gave it', started !== null))
    {
        return;
    }

    lock([early, late], amount);
    await agrees('the second lock', [early, late]);
    await resign(late, started.matchId);

    const paid = await moneyIs(early, tableId, 'settled');

    if (ok('the game given up is paid to the one who stayed', paid !== null && winnersOf(paid, [early, late]).join() === [early].join()))
    {
        payOut([early, late], amount, paid.money.feeBps, [early]);
        await agrees('the game after a failed lock', [early, late]);
    }

    await leaveAll([early, late], tableId);
};

const quick = async () =>
{
    console.log('[quick play at two stakes, and a walkout]');

    const five = nura(5);
    const ten = nura(10);
    const [low, lower, high, higher] = [await player('Five', { deposit: 20 }), await player('Five', { deposit: 20 }), await player('Ten', { deposit: 20 }), await player('Ten', { deposit: 20 })];
    const free = await player('Free', { terms: false });
    const searched = async (who, amount) =>
    {
        const terms = await who.post('/tables/quick/stake', { game: 'ludo', stake: amount.toString() });

        return terms.status !== 200
            ? terms
            : who.post('/tables/quick', { game: 'ludo', voice: 'off', stake: amount.toString(), signature: await signed(who, terms.body) });
    };

    refusedAs('a search at a stake with no signature is refused', await low.post('/tables/quick', { game: 'ludo', voice: 'off', stake: five.toString() }), 'paid-consent');

    const atFive = await searched(low, five);
    const atTen = await searched(high, ten);
    const unpaid = await free.post('/tables/quick', { game: 'ludo', voice: 'off' });

    ok('a search at five NURA opens a table at five', atFive.status === 200 && atFive.body?.stake === five.toString(), said(atFive));
    ok('one at ten does not join it and opens a table at ten', atTen.status === 200 && atTen.body?.id !== atFive.body?.id && atTen.body?.stake === ten.toString(), said(atTen));
    ok('a free search finds neither table played for NURA', unpaid.status === 200 && ![atFive.body?.id, atTen.body?.id].includes(unpaid.body?.id) && unpaid.body?.stake === undefined, said(unpaid));
    await free.post(`/tables/${ unpaid.body?.id }/leave`, { forfeit: false });

    const joinsFive = await searched(lower, five);
    const joinsTen = await searched(higher, ten);

    ok('each paid search joins the table at its own stake', joinsFive.body?.id === atFive.body?.id && joinsTen.body?.id === atTen.body?.id, `${ said(joinsFive) }; ${ said(joinsTen) }`);

    const [startedFive, startedTen] = [await begun(low, atFive.body?.id), await begun(high, atTen.body?.id)];

    if (!ok('both tables lock their stakes and begin, nobody pressing anything else', startedFive !== null && startedTen !== null))
    {
        return;
    }

    lock([low, lower], five);
    lock([high, higher], ten);
    await agrees('two quick games locked at two stakes', [low, lower, high, higher]);

    const left = await lower.post(`/tables/${ atFive.body.id }/leave`, { forfeit: true });

    ok('a player walks out of a game played for NURA', left.status === 200, said(left));

    const walked = await moneyIs(low, atFive.body.id, 'settled');

    if (ok('the one who walked out loses the stake to the one who stayed', walked !== null && winnersOf(walked, [low, lower]).join() === [low].join()))
    {
        payOut([low, lower], five, walked.money.feeBps, [low]);
    }

    await resign(high, startedTen.matchId);

    const gaveUp = await moneyIs(high, atTen.body.id, 'settled');

    if (ok('the one who gives up loses the stake to the other', gaveUp !== null && winnersOf(gaveUp, [high, higher]).join() === [higher].join()))
    {
        payOut([high, higher], ten, gaveUp.money.feeBps, [higher]);
    }

    await agrees('a walkout and a resignation', [low, lower, high, higher]);
    await leaveAll([low, lower], atFive.body.id);
    await leaveAll([high, higher], atTen.body.id);
};

const held = async (people, tableId, last) =>
{
    await node('evm_setAutomine', [false]);

    try
    {
        const answer = await sayReady(last, tableId);

        return answer.status === 200 ? await locking(people[0], tableId) : null;
    }
    catch (error)
    {
        await node('evm_setAutomine', [true]);
        throw error;
    }
};

const mined = async () =>
{
    await node('evm_mine');
    await node('evm_setAutomine', [true]);
};

const lockingPart = async () =>
{
    console.log('[a table while its stakes lock]');

    const amount = nura(10);
    const first = await player('Holder', { deposit: 20 });
    const last = await player('Waiter', { deposit: 20 });
    const tableId = await pairedAt(first, last, amount);

    if (tableId === null)
    {
        return;
    }

    await sayReady(first, tableId);

    const pending = await held([first, last], tableId, last);

    try
    {
        ok('the last Ready starts the lock, and its transaction waits for a block', pending !== null);
        refusedAs('nobody can leave while the stakes lock', await last.post(`/tables/${ tableId }/leave`, { forfeit: false }), 'paid-locking');
        refusedAs('nor take a Ready back', await first.post(`/tables/${ tableId }/ready`, { ready: false }), 'paid-locking');
        refusedAs('nor ask for a new stake to sign', await stakeAt(first, tableId), 'paid-locking');
        refusedAs('nor can the host close the table', await first.post(`/tables/${ tableId }/close`), 'paid-locking');
        ok('and no game is dealt before the stakes are locked', (await tableOf(first, tableId))?.matchId === undefined);
    }
    finally
    {
        await mined();
    }

    const started = await begun(first, tableId);

    if (!ok('once the block is mined the game is dealt', started !== null))
    {
        return;
    }

    lock([first, last], amount);
    await agrees('a lock that waited for its block', [first, last]);
    await resign(last, started.matchId);

    const paid = await moneyIs(first, tableId, 'settled');

    if (ok('and is paid when it ends', paid !== null))
    {
        payOut([first, last], amount, paid.money.feeBps, [first]);
        await agrees('a game whose lock waited for its block, paid', [first, last]);
    }

    await leaveAll([first, last], tableId);
};

const refund = async () =>
{
    console.log('[a game that could not be dealt after its stakes locked]');

    const amount = nura(10);
    const one = await player('Refund', { deposit: 20 });
    const two = await player('Refund', { deposit: 20 });
    const tableId = await pairedAt(one, two, amount);

    if (tableId === null)
    {
        return;
    }

    await sayReady(one, tableId);

    const pending = await held([one, two], tableId, two);

    try
    {
        ok('the stakes are locking', pending !== null);
        sql(`update tables set status = 'closed', closed_at = now() where id = ${ literal(tableId) }`);
    }
    finally
    {
        await mined();
    }

    const back = await until(PAID_WITHIN_MS, async () =>
    {
        const row = (await gamesOf(one))[0];

        return row?.state === 'refunded' ? row : null;
    });

    ok('a table closed under the lock deals no game and gives every stake back', back !== null && back.match === undefined,
        back !== null && back.match === undefined ? '' : JSON.stringify((await gamesOf(one))[0] ?? {}));

    if (back !== null)
    {
        ok('the vault says the stakes were given back', (await gameOf(back.id)).status === 'refunded');
    }

    lock([one, two], amount);
    giveBack([one, two], amount);
    await agrees('a refund takes no fee', [one, two]);
};

const stopServer = async () =>
{
    const port = Number(new URL(BASE).port || 80);
    const owners = execSync('netstat -ano', { encoding: 'utf8' }).split('\n')
        .filter((line) => new RegExp(`[:.]${ port }\\s.*LISTENING`).test(line))
        .map((line) => line.trim().split(/\s+/).at(-1));

    for (const pid of new Set(owners))
    {
        execSync(process.platform === 'win32' ? `taskkill /PID ${ pid } /F` : `kill -9 ${ pid }`);
    }

    return until(15_000, async () => !await fetch(`${ BASE }/api/healthz`).then((answer) => answer.ok).catch(() => false));
};

const startServer = async (people) =>
{
    spawn(RESTART, { shell: true, detached: true, stdio: 'ignore' }).unref();

    const up = await until(BACK_WITHIN_MS, async () => await fetch(`${ BASE }/api/healthz`).then((answer) => answer.ok).catch(() => false));

    for (const who of people)
    {
        await connect(who);
    }

    return up;
};

const restart = async () =>
{
    console.log('[the server stopped while the stakes lock, and while they are paid]');

    const amount = nura(10);
    const one = await player('Crash', { deposit: 20 });
    const two = await player('Crash', { deposit: 20 });
    const tableId = await pairedAt(one, two, amount);

    if (tableId === null)
    {
        return;
    }

    await sayReady(one, tableId);

    const pending = await held([one, two], tableId, two);

    if (!ok('the stakes are locking, the transaction sent and not yet in a block', pending !== null))
    {
        await mined();
        return;
    }

    const opening = await reader.getTransaction({ hash: pending.money.openTx });

    ok('the server is stopped while the lock waits for its block', await stopServer() !== null);
    await mined();
    ok('and started again once the block is mined', await startServer([one, two]) !== null);

    const started = await begun(one, tableId);

    ok('the game is dealt from the lock the stopped server sent', started !== null);
    ok('nothing was sent twice: the referee sent the lock and nothing more',
        await reader.getTransactionCount({ address: opening.from, blockTag: 'pending' }) === opening.nonce + 1);

    if (started === null)
    {
        return;
    }

    lock([one, two], amount);
    await agrees('a lock the stopped server sent', [one, two]);
    await node('evm_setAutomine', [false]);

    let paying = null;

    try
    {
        await resign(one, started.matchId);
        paying = await until(PAID_WITHIN_MS, async () =>
        {
            const row = await escrowOf(two, started.matchId);

            return row?.state === 'settling' && row.closeTx !== undefined ? row : null;
        });

        if (!ok('the game ends and the payout is sent, not yet in a block', paying !== null))
        {
            return;
        }

        const payment = await reader.getTransaction({ hash: paying.closeTx });

        ok('the server is stopped while the payout waits for its block', await stopServer() !== null);
        ok('and started again with the payout still waiting', await startServer([one, two]) !== null);
        await pause(8000);
        ok('the server that came back sends no second payout while the first one waits',
            await reader.getTransactionCount({ address: payment.from, blockTag: 'pending' }) === payment.nonce + 1);
    }
    finally
    {
        await mined();
    }

    const paid = await moneyIs(one, tableId, 'settled');

    if (ok('once it is mined the payout is recorded', paid !== null && winnersOf(paid, [one, two]).join() === [two].join()))
    {
        payOut([one, two], amount, paid.money.feeBps, [two]);
        await agrees('a payout the stopped server sent, paid once', [one, two]);
    }

    await leaveAll([one, two], tableId);
};

const reclaim = async () =>
{
    console.log('[a game nobody paid, taken back after the vault\'s wait]');

    const amount = nura(10);
    const one = await player('Reclaim', { deposit: 20 });
    const two = await player('Reclaim', { deposit: 20 });
    const nosy = await player('Nosy');
    const tableId = await pairedAt(one, two, amount);

    if (tableId === null)
    {
        return;
    }

    await sayReady(one, tableId);
    await sayReady(two, tableId);

    const started = await begun(one, tableId);

    if (!ok('a game is locked and dealt', started !== null))
    {
        return;
    }

    lock([one, two], amount);

    const escrow = await escrowOf(one, started.matchId);

    refusedAs('its stakes cannot be taken back before the vault\'s wait', await one.post('/vault/reclaim', { id: escrow.id }), 'paid-early');
    ok('somebody who did not play it is answered as if there were no such game', (await nosy.post('/vault/reclaim', { id: escrow.id })).status === 404);
    ok('and so is an id that is no game', (await one.post('/vault/reclaim', { id: 'not-a-game' })).status === 404);

    const wait = (await one.get('/vault')).body?.reclaimAfter ?? 0;

    await node('evm_increaseTime', [wait + 60]);
    await node('evm_mine');

    const call = await one.post('/vault/reclaim', { id: escrow.id });

    if (!ok('once the vault\'s wait has passed on the chain, a player is handed the call that takes every stake back',
        call.status === 200 && call.body?.to?.toLowerCase() === vault.toLowerCase(), said(call)))
    {
        return;
    }

    if (ok('their wallet sends it and the vault takes it', await send(one, call.body)))
    {
        giveBack([one, two], amount);
    }

    await agrees('a game nobody paid, taken back', [one, two]);
    ok('the vault says the stakes were taken back', (await gameOf(escrow.id)).status === 'reclaimed');
    refusedAs('they cannot be taken back twice', await two.post('/vault/reclaim', { id: escrow.id }), 'paid-done');
    await resign(two, started.matchId);

    const closed = await moneyIs(one, tableId, 'reclaimed');

    ok('when the game ends the server finds the stakes taken back and pays nothing', closed !== null,
        closed !== null ? '' : JSON.stringify((await tableOf(one, tableId))?.money ?? {}));
    await agrees('after the game nobody paid ended', [one, two]);
    await leaveAll([one, two], tableId);
};

const run = async () =>
{
    const named = process.env.PGDATABASE ?? '';

    delete process.env.PGDATABASE;

    const shared = databaseName();

    process.env.PGDATABASE = named;

    if (named === '' || named === shared)
    {
        throw new Error(`PGDATABASE must name the server's own database, one nobody else uses${ named === '' ? '' : `, not ${ shared }` }`);
    }

    const probe = session();

    probe.handle = (await signInWallet(probe.post, `Probe ${ tag() }`)).handle;

    if (sql(`select count(*) from users where handle = ${ literal(probe.handle) }`) !== '1')
    {
        throw new Error(`${ named } is not the database the server on ${ BASE } writes to`);
    }

    const standing = (await probe.get('/vault')).body;

    if (standing?.configured !== true)
    {
        throw new Error(`the server on ${ BASE } has no vault; is NURA_VAULT_ADDRESS set?`);
    }

    vault = standing.vault;

    if (standing.chainId !== chain.id || Number(await node('eth_chainId')) !== chain.id)
    {
        throw new Error(`the server's vault is on chain ${ standing.chainId } and ${ RPC } is not a hardhat node on ${ chain.id }`);
    }

    ledger.fees = await read('fees');
    console.log(`vault ${ vault } on chain ${ chain.id }, fee ${ standing.fee } bps, ${ shown(ledger.fees) } of fees held\n`);

    const parts = { refuse, formats, consent, withdraw, quick, locking: lockingPart, refund, restart, reclaim };

    for (const part of PARTS.filter((one) => ONLY.length === 0 || ONLY.includes(one)))
    {
        if (part === 'restart' && RESTART === undefined)
        {
            console.log('[the server stopped and started again: left out, QA_RESTART is not set]\n');
            continue;
        }

        try
        {
            await parts[part]();
        }
        catch (error)
        {
            ok(`${ part } ran to its end`, false, error instanceof Error ? error.stack ?? error.message : String(error));
        }

        console.log('');
    }

    console.log('[the vault at the end]');

    const [balance, free, locked, fees] = await Promise.all([reader.getBalance({ address: vault }), read('totalBalances'), read('totalLocked'), read('fees')]);

    ok('no stake is left locked', locked === 0n, shown(locked));
    ok('the vault holds exactly what its players hold and its fees', balance === free + locked + fees, `${ shown(balance) } against ${ shown(free + locked + fees) }`);
    ok('and its fees are the ones the ledger counted', fees === ledger.fees, `${ shown(fees) } against ${ shown(ledger.fees) }`);
};

try
{
    await run();
}
catch (error)
{
    ok('the pass ran', false, error instanceof Error ? error.message : String(error));
}
finally
{
    for (const who of everyone)
    {
        who.socket?.close();
    }
}

console.log(`\n${ checks - failures } of ${ checks } checks passed`);
process.exit(failures === 0 ? 0 : 1);
