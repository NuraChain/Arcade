/**
 * Two production servers on ONE database, and what quick play does across them.
 *
 * The deployment is one server process for each database (README). This pass is what that
 * sentence rests on: it runs two independent servers against one disposable database and asks
 * what holds across them and what does not. What holds is everything Postgres decides: the
 * locks, the chairs, nobody seated twice, a table filled by searches sent to both. What does not
 * is everything a server keeps in memory: who is here, its sweep, its pushes. Those checks say
 * what the code does today, so a change that carries them across processes fails them and has
 * to rewrite them, with the README.
 *
 *     QA_BASE=http://localhost:5320 QA_BASE_B=http://localhost:5321 node tools/qa/cross-pass.mjs
 *
 * Both servers are built from this tree, started with their own PORT and PUBLIC_ORIGIN, the
 * limiter raised, and one DATABASE_URL naming a database nobody else uses. Hand the pass each
 * server's log as QA_LOG_A and QA_LOG_B and it also reads that each one said it found the other.
 */
import { readFileSync } from 'node:fs';

import { signInWallet } from './wallets.mjs';

const A = process.env.QA_BASE ?? 'http://localhost:5320';

const B = process.env.QA_BASE_B ?? 'http://localhost:5321';

const HELLO_WITHIN_MS = 8000;

const TOLD_WITHIN_MS = 3000;

const STOOD_UP_WITHIN_MS = 150_000;

const SAID_WITHIN_MS = 45_000;

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (!condition)
    {
        failures += 1;
    }

    console.log(`  ${ condition ? 'PASS' : 'FAIL' }  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);

    return condition;
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const within = async (ms, happened) =>
{
    const until = Date.now() + ms;

    while (!await happened() && Date.now() < until)
    {
        await pause(250);
    }

    return await happened();
};

const tag = () => Math.floor(Math.random() * 100000);

const session = (base) =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ base }/api${ path }`, {
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

        return { status: response.status, body: text === '' ? null : JSON.parse(text) };
    };

    return { base, get: (path) => call('GET', path), post: (path, body) => call('POST', path, body), cookie: () => cookie, games: new Set(), socket: null, handle: '' };
};

const connect = (who) => new Promise((resolve, reject) =>
{
    const socket = new WebSocket(`${ who.base.replace(/^http/, 'ws') }/ws`, { headers: { cookie: who.cookie(), origin: who.base } });
    const patience = setTimeout(() => reject(new Error(`${ who.base } never said hello to ${ who.handle }`)), HELLO_WITHIN_MS);

    socket.addEventListener('message', (event) =>
    {
        const frame = JSON.parse(String(event.data));

        if (frame.t === 'hello')
        {
            clearTimeout(patience);
            who.socket = socket;
            resolve();
        }

        if (frame.t === 'game' && typeof frame.match?.id === 'string')
        {
            who.games.add(frame.match.id);
        }
    });
    socket.addEventListener('error', () => reject(new Error(`no socket at ${ who.base } for ${ who.handle }`)));
});

const arrive = async (base, name) =>
{
    const who = session(base);

    who.handle = (await signInWallet(who.post, `${ name } ${ tag() }`)).handle;
    await connect(who);

    return who;
};

const sitting = (table) => (table?.chairs ?? []).flatMap((chair) => chair.who === undefined ? [] : [chair.who]);

const goHome = async (people) =>
{
    for (const who of people)
    {
        for (const one of (await who.get('/tables/mine')).body?.tables ?? [])
        {
            await who.post(`/tables/${ one.id }/leave`, { forfeit: true });
        }

        who.socket?.close();
    }
};

const where = (who) => (who.base === A ? 'A' : 'B');

const bothAnswer = async () =>
{
    console.log('[two servers, one database]');

    const answers = await Promise.all([A, B].map(async (base) => (await fetch(`${ base }/api/healthz`)).status));

    ok('both servers answer', answers.every((status) => status === 200), `${ A } ${ answers[0] }, ${ B } ${ answers[1] }`);
    console.log('');

    return answers.every((status) => status === 200);
};

const turnsAcross = async () =>
{
    console.log('[eight look for a turn-based game at once, four through each server]');

    const eight = [];

    for (let index = 0; index < 8; index += 1)
    {
        eight.push(await arrive(index % 2 === 0 ? A : B, `Cross turns ${ index }`));
    }

    try
    {
        const answers = await Promise.all(eight.map((who) => who.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4, mode: 'turns' })));
        const ids = [...new Set(answers.map((answer) => answer.body?.id))];

        ok('every search is answered with a table', answers.every((answer) => answer.status === 200), answers.map((answer) => answer.status).join(' '));
        ok('the eight are at two tables, whichever server they asked', ids.length === 2, `${ ids.length } tables`);

        const seen = [];

        for (const id of ids)
        {
            const table = (await eight[0].get(`/tables/${ id }`)).body;
            const at = sitting(table);
            const servers = new Set(eight.filter((who) => at.includes(who.handle)).map(where));

            seen.push(...at);
            ok('a table of four, full, with its game started', at.length === 4 && table?.matchId !== undefined, `${ at.length } sitting, ${ table?.status }, through ${ [...servers].join(' and ') }`);
        }

        const held = await Promise.all(eight.map(async (who) => ((await who.get('/tables/mine')).body?.tables ?? []).length));

        ok('everybody holds one chair, and nobody sits twice', held.every((count) => count === 1) && new Set(seen).size === 8 && seen.length === 8,
            `${ held.join(' ') }; ${ new Set(seen).size } people in ${ seen.length } chairs`);

        for (const id of ids)
        {
            const table = (await eight[0].get(`/tables/${ id }`)).body;
            const seats = eight.filter((one) => sitting(table).includes(one.handle));

            await within(TOLD_WITHIN_MS, async () => seats.some((who) => who.games.has(table.matchId)));
            await pause(TOLD_WITHIN_MS);

            const told = new Set(seats.filter((who) => who.games.has(table.matchId)).map(where));
            const untold = new Set(seats.filter((who) => !who.games.has(table.matchId)).map(where));

            ok('a game is pushed to the sockets of the server that started it, and to no socket of the other (one server per database)',
                told.size === 1 && !untold.has([...told][0]),
                `told through ${ [...told].join(' and ') || 'neither' }, not told through ${ [...untold].join(' and ') || 'neither' }`);
        }
    }
    finally
    {
        await goHome(eight);
    }

    console.log('');
};

const liveAcross = async () =>
{
    console.log('[a live search through each server, with a socket on each]');

    const onA = await arrive(A, 'Cross live a');
    const onB = await arrive(B, 'Cross live b');

    try
    {
        const opened = await onA.post('/tables/quick', { game: 'backgammon', voice: 'off' });
        const second = await onB.post('/tables/quick', { game: 'backgammon', voice: 'off' });

        ok('the second server does not see the first one\'s waiting player, and opens a table of its own (one server per database)',
            opened.status === 200 && second.status === 200 && second.body?.id !== opened.body?.id,
            `${ opened.body?.id === second.body?.id ? 'they met' : 'two tables' }`);

        const left = Date.now();
        const stoodUp = await within(STOOD_UP_WITHIN_MS, async () =>
            !sitting((await onA.get(`/tables/${ opened.body?.id }`)).body).includes(onA.handle));

        ok('and its sweep stands up the player whose socket is open on the other server (one server per database)', stoodUp,
            `after ${ Math.round((Date.now() - left) / 1000) } s`);
    }
    finally
    {
        await goHome([onA, onB]);
    }

    console.log('');
};

const eachSaysSo = async () =>
{
    const logs = [process.env.QA_LOG_A, process.env.QA_LOG_B];

    if (logs.some((path) => path === undefined))
    {
        console.log('  NOTE  no QA_LOG_A and QA_LOG_B, so what each server said is not read\n');
        return;
    }

    console.log('[each server says another is using its database]');

    for (const [index, path] of logs.entries())
    {
        const said = await within(SAID_WITHIN_MS, async () => readFileSync(path, 'utf8').includes('another server is using this database'));

        ok(`server ${ 'AB'[index] } logs that another server is using its database`, said);
    }

    console.log('');
};

const run = async () =>
{
    console.log(`\ncross pass against ${ A } and ${ B }\n`);

    if (await bothAnswer())
    {
        await eachSaysSo();
        await turnsAcross();
        await liveAcross();
    }

    console.log('------------------------------------------');
    console.log(failures === 0 ? `cross pass: clean, ${ checks } checks` : `cross pass: ${ failures } of ${ checks } FAILED`);

    process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
