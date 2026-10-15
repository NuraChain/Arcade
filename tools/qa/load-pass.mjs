/**
 * Many live games at once, over the api and real sockets, with no browser: how the server and the
 * hub hold up as the tables grow. Each table is two accounts with a socket each; the seat on turn
 * plays over its socket the way a browser does, and every play is timed from the moment its frame is
 * sent to its `ack`, and to the `game` frame the other seat is pushed. A socket plays no faster
 * than one play in `GAP_MS`: the gateway closes a socket that sends more than forty in ten seconds
 * (4429), which a person cannot do and the first version of this pass did at every table.
 *
 *   QA_BASE=http://localhost:5300 QA_TABLES=10,25,50 QA_SECONDS=20 node tools/qa/load-pass.mjs
 *
 * The server needs the limiter raised (API_RATE_MAX=20000). The accounts are made from keys derived
 * from their index, so a second run signs the same people in again instead of making new ones; each
 * sign-in still adds a device, as a browser's would. Times are this process's monotonic clock.
 * QA_PID names the server's process, whose memory is read before and after each level.
 *
 * Each seat learns the board the way a browser does: from the `ack` to its own play and the `game`
 * frame it is pushed, with a read over http only when neither has come within five seconds.
 * QA_READ_EACH=1 reads the match over http before every play as well, which the first version of
 * this pass did and no browser does. Every answer the api gives that is not a 200 is counted.
 */
import { execSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';

import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { deviceIdFrom } from '../../backend/src/domains/device/id.ts';
import { leadIn } from './ludo-routes.mjs';
import { recorder } from './seats.mjs';
import { tableBody } from './tables.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';
const LEVELS = (process.env.QA_TABLES ?? '10,25,50').split(',').map(Number);
const SECONDS = Number(process.env.QA_SECONDS ?? 20);
const PID = process.env.QA_PID ?? '';
const GAP_MS = 300;
const READ_EACH = process.env.QA_READ_EACH === '1';
const answers = new Map();

const { record, finish } = recorder('load pass');

const centile = (values, share) =>
{
    if (values.length === 0)
    {
        return NaN;
    }

    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
};

const spread = (values) => values.length === 0
    ? 'none'
    : `p50 ${ centile(values, 0.5).toFixed(0) } ms, p95 ${ centile(values, 0.95).toFixed(0) } ms, p99 ${ centile(values, 0.99).toFixed(0) } ms, max ${ Math.max(...values).toFixed(0) } ms (${ values.length })`;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const memoryOf = () =>
{
    if (PID === '')
    {
        return null;
    }

    try
    {
        const line = execSync(`tasklist /FI "PID eq ${ PID }" /FO CSV /NH`, { encoding: 'utf8' }).trim();
        const kilobytes = Number(line.split('","').at(-1).replace(/[^0-9]/g, ''));

        return Math.round(kilobytes / 1024);
    }
    catch
    {
        return null;
    }
};

const spki = async (key) => Buffer.from(await webcrypto.subtle.exportKey('spki', key)).toString('base64url');

async function mintDevice()
{
    const exchange = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const signing = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const exchangeKey = await spki(exchange.publicKey);
    const signingKey = await spki(signing.publicKey);

    return { id: deviceIdFrom(exchangeKey, signingKey), exchangeKey, signingKey };
}

function session(index)
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

        if (response.status !== 200)
        {
            answers.set(`${ method } ${ response.status }`, (answers.get(`${ method } ${ response.status }`) ?? 0) + 1);
        }

        return { status: response.status, body: parsed };
    };

    const who = {
        index,
        get: (path) => call('GET', path),
        post: (path, body) => call('POST', path, body),
        cookie: () => cookie,
        handle: '',
        socket: null,
        sentAt: 0,
        waiting: new Map(),
        views: new Map(),
        pushed: []
    };

    return who;
}

async function signIn(who)
{
    const wallet = privateKeyToAccount(keccak256(toHex(`nura load pass ${ who.index }`)));
    const device = await mintDevice();
    const issued = await who.post('/auth/challenge', { address: wallet.address, device: device.id });

    if (issued.status !== 200)
    {
        throw new Error(`no challenge for player ${ who.index }: ${ issued.status }`);
    }

    const signedIn = await who.post('/auth/wallet', {
        address: wallet.address,
        nonce: issued.body.nonce,
        signature: await wallet.signMessage({ message: issued.body.message }),
        device: { ...device, label: 'The load pass' }
    });

    if (signedIn.status !== 200)
    {
        throw new Error(`player ${ who.index } could not sign in: ${ signedIn.status } ${ JSON.stringify(signedIn.body).slice(0, 160) }`);
    }

    const named = await who.post('/auth/profile', { displayName: `Load ${ who.index }`, bio: '' });

    if (named.status !== 200)
    {
        throw new Error(`player ${ who.index } could not be named: ${ named.status }`);
    }

    who.handle = named.body.handle;
}

const connect = (who) => new Promise((resolve, reject) =>
{
    const socket = new WebSocket(`${ BASE.replace(/^http/, 'ws') }/ws`, { headers: { cookie: who.cookie(), origin: BASE } });
    const patience = setTimeout(() => reject(new Error(`no hello for player ${ who.index }`)), 10_000);

    socket.addEventListener('message', (event) =>
    {
        const frame = JSON.parse(String(event.data));

        if (frame.t === 'hello')
        {
            clearTimeout(patience);
            who.socket = socket;
            resolve();
        }

        if (frame.t === 'ack' || frame.t === 'refused')
        {
            who.waiting.get(frame.key)?.(frame);
        }

        if (frame.t === 'game')
        {
            who.pushed.push({ at: performance.now(), rev: frame.match.rev, bytes: String(event.data).length });
            learn(who, frame.match);
        }
    });
    socket.addEventListener('error', () => reject(new Error(`socket error for player ${ who.index }`)));
    socket.addEventListener('close', (event) =>
    {
        closes.push({ index: who.index, code: event.code, reason: event.reason, at: performance.now() });
    });
});

const closes = [];

/** Keeps the newest board a seat has been told for each game. */
const learn = (who, view) =>
{
    const held = who.views.get(view.id);

    if (held === undefined || held.rev <= view.rev)
    {
        who.views.set(view.id, view);
    }
};

let plays = 0;

/** One play over the socket, answered by its ack. */
const send = async (who, match, rev, play) =>
{
    const wait = who.sentAt + GAP_MS - performance.now();

    if (wait > 0)
    {
        await pause(wait);
    }

    who.sentAt = performance.now();

    return await sent(who, match, rev, play);
};

const sent = (who, match, rev, play) => new Promise((resolve) =>
{
    plays += 1;

    const key = `load-${ plays }-${ who.index }`;
    const sent = performance.now();
    const late = setTimeout(() =>
    {
        who.waiting.delete(key);
        resolve({ ok: false, why: `no answer in 10 s (socket ${ ['connecting', 'open', 'closing', 'closed'][who.socket.readyState] })`, sent });
    }, 10_000);

    who.waiting.set(key, (frame) =>
    {
        clearTimeout(late);
        who.waiting.delete(key);
        if (frame.t === 'ack')
        {
            learn(who, frame.match);
        }

        resolve({ ok: frame.t === 'ack', why: frame.t === 'ack' ? frame.applied : frame.code, sent, answered: performance.now(), match: frame.match });
    });
    who.socket.send(JSON.stringify({ v: 1, t: 'play', match, key, rev, play }));
});

async function table(a, b)
{
    for (const who of [a, b])
    {
        const seated = await who.get('/tables/mine');

        for (const one of seated.body?.tables ?? [])
        {
            await who.post(`/tables/${ one.id }/leave`, { forfeit: true });
        }
    }

    const made = await a.post('/tables/', tableBody({ game: 'ludo', seats: 2, mode: 'live', privacy: 'invite', invitees: [b.handle] }));

    if (made.status !== 200)
    {
        throw new Error(`no table for ${ a.handle }: ${ made.status } ${ JSON.stringify(made.body).slice(0, 160) }`);
    }

    const id = made.body.id;
    const steps = [
        ['seat', () => b.post(`/tables/${ id }/seat`)],
        ['ready', () => b.post(`/tables/${ id }/ready`, { ready: true })],
        ['ready', () => a.post(`/tables/${ id }/ready`, { ready: true })],
        ['start', () => a.post(`/tables/${ id }/start`)]
    ];

    for (const [name, step] of steps)
    {
        const answer = await step();

        if (answer.status !== 200)
        {
            return { id, match: undefined, why: `${ name } answered ${ answer.status } ${ answer.body?.error?.code ?? '' }` };
        }
    }

    const read = await a.get(`/tables/${ id }`);

    return { id, match: read.body?.matchId, why: read.body?.matchId === undefined ? `the table read answered ${ read.status }` : '' };
}

/** The newest board a seat holds, read over http when it has been told nothing newer within five seconds. */
async function boardOf(who, match, atLeast, times)
{
    const until = performance.now() + 5000;

    while (!READ_EACH && performance.now() < until)
    {
        const held = who.views.get(match);

        if (held !== undefined && held.rev >= atLeast)
        {
            return held;
        }

        await pause(5);
    }

    const read = await who.get(`/matches/${ match }`);

    times.reads += 1;

    if (read.status === 200 && read.body !== null)
    {
        learn(who, read.body);
    }

    return who.views.get(match);
}

/** Plays the game at one table until the clock runs out, timing every play. */
async function drive(game, until, times)
{
    const seats = new Map();

    for (const who of game.players)
    {
        const view = await boardOf(who, game.match, 1, times);

        if (view?.mine === undefined)
        {
            times.refused.push(`no seat for ${ who.handle } at ${ game.id }`);
            return;
        }

        seats.set(view.mine, who);
    }

    let rev = 1;

    while (performance.now() < until)
    {
        const current = game.players.map((who) => who.views.get(game.match)).reduce((best, one) => (one !== undefined && (best === undefined || one.rev > best.rev) ? one : best), undefined);

        if (current === undefined || current.finishedAt !== undefined)
        {
            return;
        }

        const mover = seats.get(current.turn);

        if (mover === undefined)
        {
            times.refused.push(`nobody on turn at ${ game.id }`);
            return;
        }

        const other = game.players.find((one) => one !== mover);
        const view = await boardOf(mover, game.match, Math.max(rev, current.rev), times);

        if (view === undefined || view.finishedAt !== undefined)
        {
            return;
        }

        const piece = view.view.die === undefined ? null : leadIn(view.view, view.turn);
        const play = view.view.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece };

        if (view.view.die !== undefined && piece === null)
        {
            await pause(50);
            continue;
        }

        const answer = await send(mover, game.match, view.rev, play);

        if (!answer.ok)
        {
            times.refused.push(answer.why);
            await pause(100);
            continue;
        }

        times.ack.push(answer.answered - answer.sent);
        rev = answer.match.rev;

        const reached = other.pushed.find((one) => one.rev >= rev && one.at >= answer.sent);

        if (reached !== undefined)
        {
            times.push.push(reached.at - answer.sent);
        }
        else
        {
            const waited = performance.now() + 5000;

            while (performance.now() < waited)
            {
                const late = other.pushed.find((one) => one.rev >= rev && one.at >= answer.sent);

                if (late !== undefined)
                {
                    times.push.push(late.at - answer.sent);
                    break;
                }

                await pause(5);
            }
        }

        times.plays += 1;
    }
}

const everybody = [];

try
{
    const most = Math.max(...LEVELS);

    for (let index = everybody.length; index < most * 2; index += 1)
    {
        const who = session(index);

        await signIn(who);
        everybody.push(who);
    }

    record(`${ everybody.length } players signed in`, everybody.every((one) => one.handle !== ''));

    for (const tables of LEVELS)
    {
        const players = everybody.slice(0, tables * 2);

        for (const who of players)
        {
            if (who.socket === null || who.socket.readyState !== 1)
            {
                await connect(who);
            }

            who.pushed.length = 0;
        }

        const games = [];
        const unstarted = [];

        answers.clear();

        for (let index = 0; index < tables; index += 1)
        {
            const [a, b] = [players[index * 2], players[index * 2 + 1]];
            const opened = await table(a, b);

            if (opened.match === undefined)
            {
                unstarted.push(opened.why);
                continue;
            }

            games.push({ ...opened, players: [a, b] });
        }

        record(`${ tables } tables: every table started`, unstarted.length === 0, unstarted.slice(0, 3).join('; '));

        const before = memoryOf();
        const times = { ack: [], push: [], refused: [], plays: 0, reads: 0 };
        const started = performance.now();
        const until = started + SECONDS * 1000;
        const health = [];
        const watch = (async () =>
        {
            while (performance.now() < until)
            {
                const asked = performance.now();
                const answer = await fetch(`${ BASE }/api/healthz`).catch(() => null);

                health.push(answer?.ok ? performance.now() - asked : 10_000);
                await pause(500);
            }
        })();

        await Promise.all(games.map((game) => drive(game, until, times)));
        await watch;

        const took = (performance.now() - started) / 1000;
        const after = memoryOf();
        const bytes = players.flatMap((one) => one.pushed.map((frame) => frame.bytes));

        console.log(`\n  ${ tables } tables, ${ tables * 2 } sockets, ${ took.toFixed(1) } s`);
        console.log(`    plays answered: ${ times.plays } (${ (times.plays / took).toFixed(1) } a second), refused or lost: ${ times.refused.length }${ times.refused.length > 0 ? ` (${ [...new Set(times.refused)].join(', ') })` : '' }`);
        console.log(`    play -> ack:                ${ spread(times.ack) }`);
        console.log(`    play -> other seat pushed:  ${ spread(times.push) }`);
        console.log(`    a health check meanwhile:   ${ spread(health) }`);
        console.log(`    match reads over http:      ${ times.reads }${ READ_EACH ? ' (one before every play, QA_READ_EACH)' : '' }`);
        console.log(`    api answers not 200:        ${ answers.size === 0 ? 'none' : [...answers].map(([kind, count]) => `${ count } x ${ kind }`).join(', ') }`);
        console.log(`    a game frame:               ${ bytes.length === 0 ? 'none' : `p50 ${ centile(bytes, 0.5) } B, max ${ Math.max(...bytes) } B` }`);

        if (before !== null && after !== null)
        {
            console.log(`    server memory:              ${ before } MB before, ${ after } MB after`);
        }

        const closed = closes.filter((one) => one.at >= started);

        if (closed.length > 0)
        {
            const codes = closed.reduce((counts, one) => counts.set(`${ one.code } ${ one.reason }`, (counts.get(`${ one.code } ${ one.reason }`) ?? 0) + 1), new Map());

            console.log(`    sockets the server closed:  ${ [...codes].map(([code, count]) => `${ count } x ${ code }`).join(', ') }, the first ${ (closed[0].at - started).toFixed(0) } ms in`);
        }

        record(`${ tables } tables: every play was answered`, times.refused.length === 0, times.refused.slice(0, 3).join(', '));

        for (const game of games)
        {
            for (const who of game.players)
            {
                await who.post(`/tables/${ game.id }/leave`, { forfeit: true });
            }
        }
    }
}
finally
{
    for (const who of everybody)
    {
        who.socket?.close();
    }

    finish();
}
