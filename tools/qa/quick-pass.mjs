import { tableBody } from './tables.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const HELLO_WITHIN_MS = 8000;

const KEPT_ONCE_GONE_MS = 25_000;

const STOOD_UP_WITHIN_MS = 120_000;

const LOOK_EVERY_MS = 5000;

const RUNG_WITHIN_MS = 2000;

let checks = 0;
let failures = 0;

const ok = (label, condition, detail = '') =>
{
    checks += 1;

    if (condition)
    {
        console.log(`  PASS  ${ label }${ detail === '' ? '' : ` — ${ detail }` }`);
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
        rung: [],
        gone: new Map()
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

        if (frame.t === 'nudge' && frame.scope === 'table')
        {
            who.rung.push(frame.id);
        }

        if (frame.t === 'presence')
        {
            for (const handle of frame.gone ?? [])
            {
                who.gone.set(handle, Date.now());
            }
        }
    });

    socket.addEventListener('error', () =>
    {
        clearTimeout(patience);
        reject(new Error(`the socket for ${ who.handle } would not open; is PUBLIC_ORIGIN ${ BASE }?`));
    });
});

const arrive = async (name) =>
{
    const who = session();
    const answer = await who.post('/auth/guest', { name });

    if (answer.status !== 200)
    {
        throw new Error(`guest sign-in for ${ name } failed: ${ answer.status } ${ answer.text.slice(0, 200) }`);
    }

    who.handle = answer.body.account.handle;
    await connect(who);

    return who;
};

const tag = () => Math.floor(Math.random() * 100000);

const sittingAt = (table) => (table?.chairs ?? []).flatMap((chair) => chair.who === undefined ? [] : [chair.who]);

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

const eightAtOnce = async () =>
{
    console.log('[eight press quick play at once]');

    const eight = [];

    for (let index = 0; index < 8; index += 1)
    {
        eight.push(await arrive(`Quick ${ 'abcdefgh'[index] }${ tag() }`));
    }

    try
    {
        const answers = await Promise.all(eight.map((who) => who.post('/tables/quick', { game: 'ludo', voice: 'off' })));

        ok('every press is answered with a table', answers.every((answer) => answer.status === 200 && typeof answer.body?.id === 'string'),
            answers.map((answer) => answer.status).join(' '));

        const ids = [...new Set(answers.map((answer) => answer.body?.id))];

        ok('the eight are at two tables', ids.length === 2,
            `${ ids.length } tables${ ids.length === 2 ? '' : '; is somebody else waiting for ludo on this server with a socket open?' }`);

        const handles = eight.map((who) => who.handle);
        const seen = [];

        for (const id of ids)
        {
            const table = (await eight[answers.findIndex((answer) => answer.body?.id === id)].get(`/tables/${ id }`)).body;
            const sitting = sittingAt(table);

            seen.push(...sitting);
            ok('a table of four of them', table?.seats === 4 && sitting.length === 4 && sitting.every((who) => handles.includes(who)), sitting.join(' '));
            ok('with its game started and nobody pressing start', table?.status === 'playing' && table?.matchId !== undefined, `${ table?.status }`);
        }

        const mine = await Promise.all(eight.map((who) => who.get('/tables/mine')));

        ok('everybody holds one chair', mine.every((answer) => answer.body?.tables?.length === 1), mine.map((answer) => answer.body?.tables?.length).join(' '));
        ok('and nobody is in two of them', seen.length === 8 && new Set(seen).size === 8, `${ new Set(seen).size } people in ${ seen.length } chairs`);
    }
    finally
    {
        await goHome(eight);
    }

    console.log('');
};

const goneFromTheChair = async () =>
{
    console.log('[a chair whose player has gone]');

    const stays = await arrive(`Stays ${ tag() }`);
    const goes = await arrive(`Goes ${ tag() }`);
    const host = await arrive(`Slow host ${ tag() }`);
    const drifts = await arrive(`Drifts ${ tag() }`);

    try
    {
        const opened = [
            await stays.post('/tables/', tableBody({ game: 'ludo', seats: 4, mode: 'live', privacy: 'public' })),
            await host.post('/tables/', tableBody({ game: 'ludo', seats: 4, mode: 'turns', privacy: 'public' }))
        ];

        if (!ok('a live table and a turn-based one open', opened.every((answer) => answer.status === 200), opened.map((answer) => answer.status).join(' ')))
        {
            return;
        }

        const [waiting, slow] = opened.map((answer) => answer.body.id);

        await goes.post(`/tables/${ waiting }/seat`);
        await drifts.post(`/tables/${ slow }/seat`);

        for (const [who, id] of [[stays, waiting], [goes, waiting], [host, slow], [drifts, slow]])
        {
            await who.post(`/tables/${ id }/ready`, { ready: true });
        }

        const before = (await stays.get(`/tables/${ waiting }`)).body;

        ok('two sit ready at a public live table', sittingAt(before).length === 2 && before?.chairs?.filter((chair) => chair.ready).length === 2 && before?.status === 'open',
            sittingAt(before).join(' '));

        await pause(1000);
        stays.rung.length = 0;
        goes.socket.close();
        drifts.socket.close();

        const left = Date.now();
        let after = before;

        while (sittingAt(after).includes(goes.handle) && Date.now() - left < STOOD_UP_WITHIN_MS)
        {
            await pause(LOOK_EVERY_MS);
            after = (await stays.get(`/tables/${ waiting }`)).body;
        }

        const freed = Date.now();
        const stoodUp = !sittingAt(after).includes(goes.handle);
        const forgotten = stays.gone.get(goes.handle);
        const rung = await within(RUNG_WITHIN_MS, () => stays.rung.includes(waiting));

        ok('whoever closed their socket is stood up', stoodUp, `after ${ Math.round((freed - left) / 1000) } s`);
        ok('a sweep after the one that first found them away, not on it', stoodUp && forgotten !== undefined && freed - forgotten >= KEPT_ONCE_GONE_MS,
            forgotten === undefined ? 'nobody was told they had gone' : `${ Math.round((freed - forgotten) / 1000) } s after the hub forgot them`);
        ok('the table reads back with that chair free', after?.taken === 1 && after?.status === 'open' && after?.chairs?.filter((chair) => chair.who === undefined).length === 3,
            `${ after?.taken } taken, ${ after?.status }`);
        ok('whoever kept their socket open kept the chair', after?.mine !== undefined && sittingAt(after).includes(stays.handle));
        ok('and was rung about the table', rung, `${ stays.rung.length } table rings`);

        const theirs = (await goes.get('/tables/mine')).body?.tables ?? [];
        const told = (await goes.get('/notifications/')).body?.items ?? [];

        ok('the table has left the list of whoever was stood up', !theirs.some((one) => one.id === waiting), `${ theirs.length } tables`);
        ok('and nothing was written to tell them', told.length === 0, `${ told.length } notifications`);

        const kept = (await host.get(`/tables/${ slow }`)).body;

        ok('a turn-based table keeps a player who has been away as long', kept?.taken === 2 && sittingAt(kept).includes(drifts.handle), sittingAt(kept).join(' '));
    }
    finally
    {
        await goHome([stays, goes, host, drifts]);
    }

    console.log('');
};

const run = async () =>
{
    console.log(`\nquick pass against ${ BASE }\n`);

    await eightAtOnce();
    await goneFromTheChair();

    console.log('------------------------------------------');
    console.log(failures === 0 ? `quick pass: clean, ${ checks } checks` : `quick pass: ${ failures } of ${ checks } FAILED`);

    process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
