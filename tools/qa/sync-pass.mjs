/**
 * Two independent browsers at one live Ludo game on the built server, and the questions the
 * networking audit asks of them: does every browser see every move, in order, once; how long does a
 * move take to reach each of them and to come to rest on its board; and does a browser that is slow,
 * hidden, cut off or behind a bad line come back to the server's board by itself.
 *
 *   QA_BASE=http://localhost:5300 node tools/qa/sync-pass.mjs
 *
 * The server needs the limiter raised (API_RATE_MAX=20000). Times are read on one clock: every
 * browser and this process run on one machine, and each stamps an event with its own
 * `performance.timeOrigin + performance.now()`, which is the same high-resolution epoch everywhere
 * on it. Nothing subtracts a time the server wrote.
 *
 * QA_ONLY=ready,ping,steady,burst,hidden,flick,slow,cut,churn,freeze,silent,reload,twin,restart,race,
 * stale,soak runs only the parts named. `restart` runs only when QA_RESTART is set: it stops whatever
 * listens on the server's port and runs QA_RESTART, a shell command that starts the built server
 * again, in the middle of a game. QA_JITTER=wifi|mobile puts the second browser behind a proxy on
 * QA_PROXY_PORT (5310) that holds a WebSocket's bytes in order and late, as the voice quality pass
 * does. The proxy is there in every run: `silent` opens a tab through it and then lets that tab's
 * socket go quiet both ways without a close, which is what a sleeping laptop or a changed network
 * leaves behind. QA_SOAK is how many actions `soak` plays a round (100) and QA_SOAK_ROUNDS how many
 * rounds (1); it weighs each page at the start of the run and after every round.
 */
import { execSync, spawn } from 'node:child_process';
import net from 'node:net';

import { leadIn, pawnsOf, differs, inside, stateOf } from './ludo-routes.mjs';
import { hideTab } from './motion.mjs';
import { BASE, clearTables, launch, recorder, seat, waitFor } from './seats.mjs';
import { tableBody } from './tables.mjs';

const ONLY = (process.env.QA_ONLY ?? '').split(',').filter((one) => one !== '');
const wanted = (part) => ONLY.length === 0 || ONLY.includes(part);
const JITTER = process.env.QA_JITTER ?? '';
const PROXY_PORT = Number(process.env.QA_PROXY_PORT ?? 5310);

const now = () => performance.timeOrigin + performance.now();

const centile = (values, share) =>
{
    if (values.length === 0)
    {
        return null;
    }

    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
};

const spread = (values) => values.length === 0
    ? 'none'
    : `p50 ${ centile(values, 0.5).toFixed(0) } ms, p95 ${ centile(values, 0.95).toFixed(0) } ms, p99 ${ centile(values, 0.99).toFixed(0) } ms, max ${ Math.max(...values).toFixed(0) } ms (${ values.length })`;

let seed = 7;

const random = () =>
{
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
};

const PROFILES = {
    none: () => 0,
    wifi: () => 4 + random() * 8 + (random() < 0.03 ? 40 + random() * 110 : 0),
    mobile: () => 20 + random() * 35 + (random() < 0.06 ? 90 + random() * 220 : 0)
};

async function jitterProxy(profile)
{
    const upstream = new URL(BASE);
    const links = new Set();

    const proxy = net.createServer((client) =>
    {
        const server = net.connect(Number(upstream.port || 80), upstream.hostname === 'localhost' ? '127.0.0.1' : upstream.hostname);
        const link = { socket: false, silent: false, born: Date.now() };
        const lanes = { up: { last: 0, queue: [], timer: null }, down: { last: 0, queue: [], timer: null } };

        const flush = (lane, to) =>
        {
            lane.timer = null;

            while (!link.silent && lane.queue.length > 0 && lane.queue[0].at <= Date.now())
            {
                const { chunk } = lane.queue.shift();

                if (!to.destroyed)
                {
                    to.write(chunk);
                }
            }

            if (!link.silent && lane.queue.length > 0)
            {
                lane.timer = setTimeout(() => flush(lane, to), Math.max(0, lane.queue[0].at - Date.now()));
            }
        };

        const carry = (name, chunk, to) =>
        {
            const lane = lanes[name];

            if (link.silent)
            {
                return;
            }

            if ((!link.socket || profile === 'none') && lane.queue.length === 0)
            {
                to.write(chunk);
                return;
            }

            const at = Math.max(lane.last, Date.now() + PROFILES[profile]());

            lane.last = at;
            lane.queue.push({ at, chunk });

            if (lane.timer === null)
            {
                lane.timer = setTimeout(() => flush(lane, to), Math.max(0, lane.queue[0].at - Date.now()));
            }
        };

        client.on('data', (chunk) =>
        {
            if (!link.socket && /upgrade:\s*websocket/i.test(chunk.toString('latin1', 0, Math.min(chunk.length, 2048))))
            {
                link.socket = true;
                links.add(link);
            }

            carry('up', chunk, server);
        });
        server.on('data', (chunk) => carry('down', chunk, client));
        client.on('error', () => server.destroy());
        client.on('close', () =>
        {
            links.delete(link);
            server.destroy();
        });

        for (const ended of ['error', 'close'])
        {
            server.on(ended, () =>
            {
                if (!link.silent)
                {
                    client.destroy();
                }
            });
        }
    });

    /** Every WebSocket opened through the proxy since `since` goes quiet both ways and is never closed. */
    proxy.silence = (since) =>
    {
        let count = 0;

        for (const link of links)
        {
            if (link.born >= since)
            {
                link.silent = true;
                count += 1;
            }
        }

        return count;
    };

    await new Promise((done) => proxy.listen(PROXY_PORT, '127.0.0.1', done));

    return proxy;
}

/** What every page records: each frame the socket hands it, and each revision its table shows. */
const INSTRUMENT = () =>
{
    const stamp = () => performance.timeOrigin + performance.now();
    const Real = window.WebSocket;

    window.__frames = [];
    window.__sockets = [];
    window.__revs = [];
    window.__sent = [];

    window.WebSocket = class extends Real
    {
        constructor(...given)
        {
            super(...given);
            window.__sockets.push(this);
            this.addEventListener('message', (event) =>
            {
                let frame = null;

                try
                {
                    frame = JSON.parse(event.data);
                }
                catch
                {
                    return;
                }

                window.__frames.push({
                    at: stamp(),
                    t: frame.t,
                    n: frame.n,
                    bytes: typeof event.data === 'string' ? event.data.length : 0,
                    rev: typeof frame.match === 'object' && frame.match !== null ? frame.match.rev : null,
                    id: typeof frame.match === 'string' ? frame.match : frame.match?.id ?? null,
                    scope: frame.scope ?? null,
                    key: frame.key ?? null,
                    applied: frame.applied ?? null,
                    events: Array.isArray(frame.events) ? frame.events.length : null
                });
            });
        }

        send(data)
        {
            try
            {
                const frame = JSON.parse(data);

                if (frame.t !== 'sound')
                {
                    window.__sent.push({ at: stamp(), t: frame.t, key: frame.key ?? null });
                }
            }
            catch
            {
                // not JSON: not ours to count
            }

            return super.send(data);
        }
    };

    const note = (stage) =>
    {
        const rev = Number(stage.dataset.rev ?? 0);
        const presenting = stage.hasAttribute('data-presenting');
        const last = window.__revs.at(-1);

        if (last === undefined || last.rev !== rev || last.presenting !== presenting)
        {
            window.__revs.push({ at: stamp(), rev, presenting });
        }
    };

    new MutationObserver((records) =>
    {
        for (const record of records)
        {
            if (record.type === 'attributes' && record.target instanceof HTMLElement && record.target.classList.contains('table-stage'))
            {
                note(record.target);
            }
            else if (record.type === 'childList')
            {
                const stage = document.querySelector('.table-stage');

                if (stage !== null)
                {
                    note(stage);
                }
            }
        }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-rev', 'data-presenting'] });
};

const { record, finish } = recorder('sync pass');
const proxy = await jitterProxy(JITTER === '' ? 'none' : JITTER);
const PROXIED = `http://localhost:${ PROXY_PORT }`;
const browser = await launch();
const dana = await seat(browser, 'dana.w', { width: 1280, height: 800 });
const mina = await seat(browser, 'mina', { width: 1280, height: 800 });
const players = [dana, mina];
const where = new Map([[dana, BASE], [mina, JITTER === '' ? BASE : PROXIED]]);
let matchId = '';
let tableId = '';
let plays = 0;

for (const player of players)
{
    await player.context.addInitScript(INSTRUMENT);
}

const state = async (player = dana) => (await player.api('GET', `/matches/${ matchId }`)).body;

const shown = async (player) => await player.page.evaluate(() =>
{
    const stage = document.querySelector('.table-stage');

    return stage === null ? null : { rev: Number(stage.dataset.rev ?? 0), presenting: stage.hasAttribute('data-presenting') };
});

const level = async (player, rev, timeout = 15000) => await waitFor(async () =>
{
    const seen = await shown(player);

    return seen !== null && seen.rev >= rev && !seen.presenting;
}, timeout);

const framesOf = async (player) => await player.page.evaluate(() => window.__frames.slice());

const revsOf = async (player) => await player.page.evaluate(() => window.__revs.slice());

/** One action for whoever is on turn, over the api, and when it was asked and answered. */
const act = async () =>
{
    const current = await state();

    if (current.finishedAt !== undefined)
    {
        return null;
    }

    const actor = players.find((player) => player.seat === current.turn);
    const view = actor === dana ? current : await state(actor);
    const piece = view.view.die === undefined ? null : leadIn(view.view, view.turn);
    const play = view.view.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece };

    if (view.view.die !== undefined && piece === null)
    {
        return null;
    }

    plays += 1;

    const asked = now();
    const answer = await actor.api('POST', `/matches/${ matchId }/play`, { key: `sync-${ plays }-${ matchId }`, rev: view.rev, play });

    return { asked, answered: now(), status: answer.status, rev: answer.body?.match?.rev ?? null, actor };
};

/** Actions over the api and nothing asked of any page, for a page that cannot be asked while it sleeps. */
const drive = async (count, gap) =>
{
    const done = [];

    for (let step = 0; step < count; step += 1)
    {
        const one = await act();

        if (one === null)
        {
            break;
        }

        done.push(one);
        await new Promise((resolve) => setTimeout(resolve, gap));
    }

    return { done, last: await state() };
};

/** The ready state of every realtime socket a page has opened, oldest first. */
const socketsOf = async (page) => await page.evaluate(() => window.__sockets.filter((one) => new URL(one.url).pathname === '/ws').map((one) => one.readyState));

/** The page's newest realtime socket is open. */
const reopened = async (page, timeout) => await waitFor(async () => (await socketsOf(page)).at(-1) === 1, timeout);

/** What a page holds after a collection: its heap, and the elements on its table outside a result. */
const weigh = async (player) =>
{
    const cdp = await player.context.newCDPSession(player.page);

    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');

    const { usedSize } = await cdp.send('Runtime.getHeapUsage');

    await cdp.detach();

    const nodes = await player.page.evaluate(() => document.querySelectorAll('.table-stage *:not(.table-result, .table-result *)').length);

    return { heap: usedSize, nodes };
};

const weighed = new Map();

/** The board this browser draws, against the server's, pawn by pawn. */
const agrees = async (player) =>
{
    const view = await state(player);
    const drawn = await pawnsOf(player.page);

    return [...differs(drawn, stateOf(view.view)), ...inside(drawn, stateOf(view.view))];
};

/** Every revision a browser's table showed went up and never back. */
const monotonic = (revs) => revs.every((one, index) => index === 0 || one.rev >= revs[index - 1].rev);

/** Each revision a `game` or `ack` frame carried, once, and none skipped without being mended. */
const framesFor = (frames) => frames.filter((one) => (one.t === 'game' || one.t === 'ack') && one.id === matchId);

/**
 * A chair changing in the other browser: the time the page draws the person's chair as ready, or
 * as not ready, after the request that said so was sent. This is the doorbell path: the server
 * rings the table, the page reads the table again.
 */
async function doorbell(from, to, name, ready)
{
    await to.page.evaluate(([who, wanted]) =>
    {
        window.__chairAt = null;
        window.__chairWatch?.disconnect();

        const check = () =>
        {
            const chair = [...document.querySelectorAll('.lobby-chair')].find((one) => one.querySelector('.lobby-chair-name')?.textContent?.includes(who));

            if (window.__chairAt === null && chair !== undefined && (chair.dataset.state === 'ready') === wanted)
            {
                window.__chairAt = performance.timeOrigin + performance.now();
            }
        };

        window.__chairWatch = new MutationObserver(check);
        window.__chairWatch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
    }, [name, ready]);

    const sent = now();

    await from.api('POST', `/tables/${ tableId }/ready`, { ready });

    const heard = await waitFor(async () => (await to.page.evaluate(() => window.__chairAt)) !== null, 8000);
    const at = await to.page.evaluate(() => window.__chairAt);

    return heard ? at - sent : null;
}

async function open()
{
    await clearTables(dana, mina);

    const made = await dana.api('POST', '/tables/', tableBody({ game: 'ludo', seats: 2, mode: 'live', privacy: 'invite', invitees: ['mina'] }));

    tableId = made.body.id;
    await mina.api('POST', `/tables/${ tableId }/seat`);

    for (const player of players)
    {
        await player.page.goto(`${ where.get(player) }/app/play/${ tableId }`);
    }

    const both = await waitFor(async () => (await mina.page.locator('.lobby-chair').count()) >= 2 && (await dana.page.locator('.lobby-chair').count()) >= 2, 15000);

    record('both browsers show the waiting room with both chairs', both);

    if (wanted('ready'))
    {
        const heard = [];

        for (let step = 0; step < 6; step += 1)
        {
            for (const [from, to, name] of [[dana, mina, 'Dana'], [mina, dana, 'Mina']])
            {
                const took = await doorbell(from, to, name, step % 2 === 0);

                if (took !== null)
                {
                    heard.push(took);
                }
            }
        }

        record(`a Ready pressed straight after the last reaches the other browser's waiting room: ${ spread(heard) }`, heard.length === 12);

        const alone = [];

        for (let step = 0; step < 6; step += 1)
        {
            for (const [from, to, name] of [[dana, mina, 'Dana'], [mina, dana, 'Mina']])
            {
                await new Promise((resolve) => setTimeout(resolve, 700));

                const took = await doorbell(from, to, name, step % 2 === 0);

                if (took !== null)
                {
                    alone.push(took);
                }
            }
        }

        record(`a Ready pressed on its own reaches the other browser's waiting room: ${ spread(alone) }`, alone.length === 12);
    }

    await mina.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ tableId }/ready`, { ready: true });
    await dana.api('POST', `/tables/${ tableId }/start`);

    const table = (await dana.api('GET', `/tables/${ tableId }`)).body;

    matchId = table.matchId;

    const view = await state();

    for (const player of players)
    {
        const mine = (await state(player)).mine;

        player.seat = mine;
    }

    record('both browsers open the same live game', matchId !== undefined && matchId !== '', `match ${ matchId }, revision ${ view.rev }`);
    record('each browser shows the opening, at rest', await level(dana, view.rev) && await level(mina, view.rev), `revision ${ view.rev }`);
}

/**
 * Plays `count` actions, waiting `gap` ms between them, and times every one in both browsers: when
 * its frame arrived, and when the table had shown it and come to rest. A browser named in `away` is
 * not asked to be at rest: a hidden tab keeps what it is sent and plays it when it is shown again.
 */
async function play(count, gap, label, away = [])
{
    const done = [];

    for (let step = 0; step < count; step += 1)
    {
        const one = await act();

        if (one === null)
        {
            break;
        }

        done.push(one);

        if (gap > 0)
        {
            await new Promise((resolve) => setTimeout(resolve, gap));
        }
    }

    const last = await state();
    const answered = done.at(-1)?.answered ?? now();
    const asked = players.filter((player) => !away.includes(player));
    const settled = new Map(await Promise.all(asked.map(async (player) =>
    {
        const ok = await level(player, last.rev, 30000);

        return [player, { ok, after: now() - answered }];
    })));

    for (const player of players)
    {
        const frames = framesFor(await framesOf(player));
        const revs = await revsOf(player);
        const arrive = [];
        const rest = [];

        for (const one of done)
        {
            const frame = frames.find((each) => each.rev !== null && each.rev >= one.rev && each.at >= one.asked);
            const still = revs.find((each) => each.rev >= one.rev && !each.presenting && each.at >= one.asked);

            if (frame !== undefined && one.rev !== null)
            {
                arrive.push(frame.at - one.asked);
            }

            if (still !== undefined && one.rev !== null)
            {
                rest.push(still.at - one.asked);
            }
        }

        console.log(`    ${ label }, ${ player.handle }: arrives ${ spread(arrive) }; at rest ${ spread(rest) }`);
        record(`${ label }: ${ player.handle }'s table only ever moved forward`, monotonic(revs), revs.slice(-6).map((one) => `${ one.rev }${ one.presenting ? '*' : '' }`).join(' '));
    }

    for (const player of asked)
    {
        const wrong = await agrees(player);
        const { ok, after } = settled.get(player);

        record(`${ label }: ${ player.handle }'s board is the server's at revision ${ last.rev }, ${ ok ? `at rest ${ after.toFixed(0) } ms after the last action was answered` : 'NEVER at rest' }`,
            ok && wrong.length === 0, wrong.slice(0, 3).join('; '));
    }

    return { done, last };
}

try
{
    await open();

    if (wanted('soak'))
    {
        for (const player of players)
        {
            weighed.set(player, await weigh(player));
        }
    }

    if (wanted('ping'))
    {
        const rtt = [];

        for (let step = 0; step < 40; step += 1)
        {
            const took = await mina.page.evaluate(async () =>
            {
                const socket = window.__sockets.findLast((one) => one.readyState === 1 && new URL(one.url).pathname === '/ws');

                if (socket === undefined)
                {
                    return null;
                }

                const sent = performance.now();

                return await new Promise((resolve) =>
                {
                    const heard = (event) =>
                    {
                        if (typeof event.data === 'string' && event.data.includes('"t":"pong"'))
                        {
                            socket.removeEventListener('message', heard);
                            resolve(performance.now() - sent);
                        }
                    };

                    socket.addEventListener('message', heard);
                    socket.send(JSON.stringify({ v: 1, t: 'ping' }));
                    setTimeout(() => resolve(null), 3000);
                });
            });

            if (took !== null)
            {
                rtt.push(took);
            }

            await new Promise((resolve) => setTimeout(resolve, 1100));
        }

        record(`a round trip on ${ mina.handle }'s socket${ JITTER === '' ? '' : ` behind a ${ JITTER } line` }: ${ spread(rtt) }`, rtt.length >= 30);
    }

    if (wanted('steady'))
    {
        await play(24, 600, 'one action every 600 ms');
    }

    if (wanted('burst'))
    {
        await play(40, 0, 'forty actions as fast as the api answers');
    }

    if (wanted('hidden'))
    {
        await hideTab(mina.page, true);
        const away = await play(16, 250, 'while mina\'s tab is hidden', [mina]);
        const back = now();

        await hideTab(mina.page, false);

        const ok = await level(mina, away.last.rev, 20000);

        record(`a hidden tab comes back to the server's board ${ ok ? `${ (now() - back).toFixed(0) } ms after it is shown` : 'NEVER' }`, ok);
        record('and what it shows then is the server\'s board', (await agrees(mina)).length === 0, (await agrees(mina)).slice(0, 3).join('; '));
    }

    if (wanted('flick'))
    {
        const before = await mina.page.evaluate(() => window.__sockets.filter((one) => new URL(one.url).pathname === '/ws').length);

        await mina.page.evaluate(() =>
        {
            window.__closes = [];

            for (const socket of window.__sockets)
            {
                socket.addEventListener('close', (event) => window.__closes.push(event.code));
            }
        });

        for (let step = 0; step < 12; step += 1)
        {
            await hideTab(mina.page, true);
            await mina.page.waitForTimeout(150);
            await hideTab(mina.page, false);
            await mina.page.waitForTimeout(250);
        }

        const closes = await mina.page.evaluate(() => window.__closes.slice());

        record(`a tab shown twelve times in five seconds keeps its socket${ closes.length > 0 ? ` (closed ${ closes.join(', ') })` : '' }`, closes.length === 0, `${ before } socket(s) before`);

        const after = await play(6, 400, 'after mina\'s tab was flicked');
        const pushed = framesFor(await framesOf(mina)).filter((one) => one.rev !== null && one.rev > after.done[0].rev - 1);

        record('and is still pushed every move over its socket, not left to the poll', pushed.length >= after.done.length && (await agrees(mina)).length === 0,
            `${ pushed.length } frames for ${ after.done.length } moves, revision ${ after.last.rev }`);
    }

    if (wanted('slow'))
    {
        const cdp = await mina.context.newCDPSession(mina.page);

        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        await play(24, 0, 'with mina\'s processor six times slower');
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }

    if (wanted('cut'))
    {
        const before = await state();
        const cutAt = now();

        await mina.page.evaluate(() =>
        {
            for (const socket of window.__sockets)
            {
                if (new URL(socket.url).pathname === '/ws' && socket.readyState === 1)
                {
                    socket.close();
                }
            }
        });

        const during = await play(8, 300, 'while mina\'s socket is cut and comes back');
        const sockets = await mina.page.evaluate(() => window.__sockets.filter((one) => new URL(one.url).pathname === '/ws').map((one) => one.readyState));

        record(`mina's page opened a new socket after the cut (${ sockets.join(', ') })`, sockets.at(-1) === 1, `cut at revision ${ before.rev }, ${ (now() - cutAt).toFixed(0) } ms ago`);
        record('mina was shown every move made while the socket was down', during.last.rev > before.rev && (await agrees(mina)).length === 0);
    }

    if (wanted('churn'))
    {
        const began = now();

        await mina.page.evaluate(() =>
        {
            window.__closes = [];
        });

        for (let step = 0; step < 5; step += 1)
        {
            const tab = await mina.context.newPage();

            await tab.goto(`${ where.get(mina) }/app/play/${ tableId }`);
            await tab.waitForTimeout(250);
            await tab.close();
        }

        let back = true;

        for (let step = 0; step < 3; step += 1)
        {
            await mina.page.evaluate(() =>
            {
                for (const socket of window.__sockets)
                {
                    if (new URL(socket.url).pathname === '/ws' && socket.readyState === 1)
                    {
                        socket.addEventListener('close', (event) => window.__closes.push(event.code));
                        socket.close();
                    }
                }
            });

            back = back && await reopened(mina.page, 30000);
        }

        const closes = await mina.page.evaluate(() => window.__closes.slice());

        record(`five tabs of mina's opened and shut and her socket cut three times in a row, and her page has a socket again ${ ((now() - began) / 1000).toFixed(1) } s later`,
            back && closes.every((code) => code < 4000), `closes ${ closes.join(', ') }`);
        await play(6, 400, 'after mina\'s tabs and socket churned');
    }

    if (wanted('freeze'))
    {
        const cdp = await mina.context.newCDPSession(mina.page);

        await hideTab(mina.page, true);

        const frozen = await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).then(() => true).catch((error) => error.message);

        if (frozen === true)
        {
            const slept = now();
            const asleep = await drive(10, 400);

            await new Promise((resolve) => setTimeout(resolve, 8000));

            const woke = now();

            await cdp.send('Page.setWebLifecycleState', { state: 'active' });
            await hideTab(mina.page, false);

            const ok = await level(mina, asleep.last.rev, 30000);
            const wrong = await agrees(mina);

            record(`a page frozen for ${ ((woke - slept) / 1000).toFixed(1) } s while ${ asleep.done.length } moves were made comes back to the server's board ${ ok ? `${ (now() - woke).toFixed(0) } ms after it wakes` : 'NEVER' }`,
                ok && wrong.length === 0, wrong.slice(0, 3).join('; '));
            record('and the table it showed only ever moved forward', monotonic(await revsOf(mina)));
        }
        else
        {
            await hideTab(mina.page, false);
            console.log(`  NOTE  this Chromium would not freeze the page: ${ frozen }`);
        }

        await cdp.detach();
    }

    if (wanted('silent'))
    {
        const quiet = { ...mina, page: await mina.context.newPage() };
        const mark = Date.now();

        await quiet.page.goto(`${ PROXIED }/app/play/${ tableId }`);

        const opened = await level(quiet, (await state()).rev, 20000) && await reopened(quiet.page, 20000);
        const went = proxy.silence(mark);
        const hushed = now();
        const during = await drive(8, 500);
        const ok = await level(quiet, during.last.rev, 40000);
        const took = now() - hushed;
        const states = await socketsOf(quiet.page);
        const wrong = await agrees(quiet);

        record(`a socket gone quiet with no close is found dead and replaced, and the page is back at the server's board ${ ok ? `${ (took / 1000).toFixed(1) } s after it went quiet` : 'NEVER' }`,
            opened && went > 0 && ok && states.at(-1) === 1 && wrong.length === 0, `${ went } socket(s) silenced; sockets ${ states.join(', ') }${ wrong.length > 0 ? `; ${ wrong.slice(0, 2).join('; ') }` : '' }`);
        await quiet.page.close();
    }

    if (wanted('reload'))
    {
        await mina.page.reload();

        const back = await state();
        const ok = await level(mina, back.rev, 20000);

        record('a page reloaded in the middle of a game shows the server\'s board', ok && (await agrees(mina)).length === 0);

        if (wanted('soak'))
        {
            weighed.set(mina, await weigh(mina));
        }

        await play(6, 400, 'after mina reloaded');
    }

    if (wanted('twin'))
    {
        const twin = { ...dana, page: await dana.context.newPage(), errors: dana.errors };

        await twin.page.goto(`${ where.get(dana) }/app/play/${ tableId }`);

        const now0 = await state();

        record('a second tab of the same account opens the same game', await level(twin, now0.rev, 20000));

        const both = await play(8, 300, 'with a second tab of dana\'s open');
        const ok = await level(twin, both.last.rev, 20000);

        record('the second tab is shown every move too, and agrees with the server', ok && (await agrees(twin)).length === 0);
        await twin.page.close();
    }

    if (wanted('restart') && process.env.QA_RESTART !== undefined)
    {
        const port = Number(new URL(BASE).port || 80);
        const before = await state();
        const owners = execSync('netstat -ano', { encoding: 'utf8' }).split('\n')
            .filter((line) => new RegExp(`[:.]${ port }\\s.*LISTENING`).test(line))
            .map((line) => line.trim().split(/\s+/).at(-1));

        for (const pid of new Set(owners))
        {
            execSync(process.platform === 'win32' ? `taskkill /PID ${ pid } /F` : `kill ${ pid }`);
        }

        const stopped = now();

        await waitFor(async () => !(await fetch(`${ BASE }/api/healthz`).then((answer) => answer.ok).catch(() => false)), 15000);

        const server = spawn(process.env.QA_RESTART, { shell: true, detached: true, stdio: 'ignore' });

        server.unref();

        const up = await waitFor(async () => await fetch(`${ BASE }/api/healthz`).then((answer) => answer.ok).catch(() => false), 90000);

        record(`the server came back ${ ((now() - stopped) / 1000).toFixed(1) } s after it was stopped`, up);

        const reconnected = await waitFor(async () =>
        {
            const open = await Promise.all(players.map((player) => player.page.evaluate(() =>
                window.__sockets.filter((one) => new URL(one.url).pathname === '/ws').at(-1)?.readyState === 1)));

            return open.every(Boolean);
        }, 30000);

        record(`both pages opened a socket to the new server ${ ((now() - stopped) / 1000).toFixed(1) } s after the old one went`, reconnected);

        const after = await play(8, 400, 'after the server restarted');

        record('the game went on from where it was', after.last.rev > before.rev);
    }

    if (wanted('race'))
    {
        const current = await state();
        const actor = players.find((player) => player.seat === current.turn);
        const other = players.find((player) => player !== actor);
        const view = actor === dana ? current : await state(actor);
        const move = view.view.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: leadIn(view.view, view.turn) };
        const key = `sync-race-socket-${ matchId }`;

        const [overSocket, overHttp, outOfTurn] = await Promise.all([
            actor.page.evaluate(async ([match, frameKey, rev, play]) =>
            {
                const socket = window.__sockets.findLast((one) => one.readyState === 1 && new URL(one.url).pathname === '/ws');

                if (socket === undefined)
                {
                    return null;
                }

                return await new Promise((resolve) =>
                {
                    const heard = (event) =>
                    {
                        let frame = null;

                        try
                        {
                            frame = JSON.parse(event.data);
                        }
                        catch
                        {
                            return;
                        }

                        if ((frame.t === 'ack' || frame.t === 'refused') && frame.key === frameKey)
                        {
                            socket.removeEventListener('message', heard);
                            resolve({ t: frame.t, applied: frame.applied ?? null, code: frame.code ?? null });
                        }
                    };

                    socket.addEventListener('message', heard);
                    socket.send(JSON.stringify({ v: 1, t: 'play', match, key: frameKey, rev, play }));
                    setTimeout(() => resolve('no answer'), 5000);
                });
            }, [matchId, key, view.rev, move]),
            actor.api('POST', `/matches/${ matchId }/play`, { key: `sync-race-http-${ matchId }`, rev: view.rev, play: move }),
            other.api('POST', `/matches/${ matchId }/play`, { key: `sync-race-other-${ matchId }`, rev: view.rev, play: { kind: 'ludo', verb: 'roll' } })
        ]);
        const after = await state();
        const applied = [overSocket?.applied, overHttp.body?.applied].filter((one) => one === 'now').length;

        record('one move sent at the same moment over the socket and over http, under two keys, is applied once',
            applied === 1 && after.rev === view.rev + 1,
            `socket ${ JSON.stringify(overSocket) }, http ${ overHttp.status } ${ overHttp.body?.applied ?? overHttp.body?.error?.code ?? '' }, revision ${ view.rev } -> ${ after.rev }`);
        record('the seat that is not on turn, pressing in the same moment, changes nothing',
            !outOfTurn.ok || outOfTurn.body?.applied !== 'now',
            `${ outOfTurn.status } ${ outOfTurn.body?.error?.code ?? outOfTurn.body?.applied ?? '' }`);

        for (const player of players)
        {
            record(`${ player.handle }'s board is the server's after the race`, await level(player, after.rev) && (await agrees(player)).length === 0);
        }
    }

    if (wanted('stale'))
    {
        const current = await state();
        const actor = players.find((player) => player.seat === current.turn);
        const view = actor === dana ? current : await state(actor);
        const play = view.view.die === undefined ? { kind: 'ludo', verb: 'roll' } : { kind: 'ludo', verb: 'move', piece: leadIn(view.view, view.turn) };
        const key = `sync-twice-${ matchId }`;
        const first = await actor.api('POST', `/matches/${ matchId }/play`, { key, rev: view.rev, play });
        const second = await actor.api('POST', `/matches/${ matchId }/play`, { key, rev: view.rev, play });
        const after = await state();

        record('the same play sent twice is applied once', first.ok && second.ok && second.body?.applied === 'already' && after.rev === first.body?.match?.rev,
            `first ${ first.status } ${ first.body?.applied }, second ${ second.status } ${ second.body?.applied }, revision ${ view.rev } -> ${ after.rev }`);

        const old = await actor.api('POST', `/matches/${ matchId }/play`, { key: `sync-old-${ matchId }`, rev: view.rev, play });
        const unmoved = await state();

        record('a play composed against a board that has moved changes nothing', unmoved.rev === after.rev && (old.body?.applied === 'stale' || !old.ok),
            `${ old.status } ${ old.body?.applied ?? old.body?.error?.code ?? '' }`);

        for (const player of players)
        {
            record(`${ player.handle }'s board is still the server's after both`, await level(player, unmoved.rev) && (await agrees(player)).length === 0);
        }
    }

    if (wanted('soak'))
    {
        const each = Number(process.env.QA_SOAK ?? 100);
        const rounds = Number(process.env.QA_SOAK_ROUNDS ?? 1);
        const marks = [];
        let played = 0;

        for (let round = 0; round < rounds; round += 1)
        {
            const long = await play(each, 150, `a long session, round ${ round + 1 }`);

            played += long.done.length;
            marks.push(new Map(await Promise.all(players.map(async (player) => [player, await weigh(player)]))));

            if (long.done.length < each)
            {
                break;
            }
        }

        for (const player of players)
        {
            const seen = [weighed.get(player), ...marks.map((mark) => mark.get(player))];
            const first = seen[0];
            const last = seen.at(-1);

            record(`${ player.handle }'s page holds no more after ${ played } more actions than at the start of the run: heap ${ seen.map((one) => (one.heap / 1_048_576).toFixed(1)).join(' -> ') } MB, elements on the table ${ seen.map((one) => one.nodes).join(' -> ') }`,
                (last.heap - first.heap) / 1_048_576 < 6 && last.nodes - first.nodes <= 30);
        }
    }

    for (const player of players)
    {
        const frames = await framesOf(player);
        const games = frames.filter((one) => one.t === 'game');
        const bytes = games.map((one) => one.bytes);

        console.log(`  ${ player.handle }: ${ frames.length } frames, ${ games.length } game frames, ${ spread(bytes).replaceAll(' ms', ' B') }`);
    }

    record('no console errors', dana.errors.length === 0 && mina.errors.length === 0, [...dana.errors, ...mina.errors].slice(0, 4).join(' | '));
}
finally
{
    await clearTables(dana, mina).catch(() => null);
    await browser.close();
    proxy?.close();
    finish();
}
