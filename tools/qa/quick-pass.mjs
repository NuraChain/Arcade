import { tableBody } from './tables.mjs';
import { signInWallet } from './wallets.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const HELLO_WITHIN_MS = 8000;

const KEPT_ONCE_GONE_MS = 25_000;

const STOOD_UP_WITHIN_MS = 120_000;

const LOOK_EVERY_MS = 5000;

const RUNG_WITHIN_MS = 2000;

const TOLD_WITHIN_MS = 2000;

const GIVEN_UP_WITHIN_MS = 240_000;

const GAMES = ['ludo', 'hokm', 'poker', 'backgammon'];

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
        gone: new Map(),
        games: new Map()
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

        if (frame.t === 'game' && typeof frame.match?.id === 'string' && !who.games.has(frame.match.id))
        {
            who.games.set(frame.match.id, Date.now());
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

    who.handle = (await signInWallet(who.post, name)).handle;
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
    console.log('[eight ask for ludo at four, at once]');

    const eight = [];

    for (let index = 0; index < 8; index += 1)
    {
        eight.push(await arrive(`Quick ${ 'abcdefgh'[index] }${ tag() }`));
    }

    try
    {
        const answers = await Promise.all(eight.map((who) => who.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 })));

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

const twoWhoLeaveItOpen = async () =>
{
    console.log('[two strangers leave every choice open, at every game]');

    for (const game of ['ludo', 'hokm', 'poker', 'backgammon'])
    {
        const pair = [await arrive(`Open ${ game } a${ tag() }`), await arrive(`Open ${ game } b${ tag() }`)];

        try
        {
            const first = await pair[0].post('/tables/quick', { game, voice: 'off' });
            const second = await pair[1].post('/tables/quick', { game, voice: 'off' });
            const table = (await pair[0].get(`/tables/${ first.body?.id }`)).body;

            ok(`${ game }: the second sits down at the first one's table`, first.status === 200 && second.body?.id === first.body?.id,
                `${ first.status } ${ second.status }`);
            ok(`${ game }: a table of two, full, and its game started with nobody pressing start`,
                table?.seats === 2 && sittingAt(table).length === 2 && table?.status === 'playing' && table?.matchId !== undefined,
                `${ table?.seats } seats, ${ sittingAt(table).length } sitting, ${ table?.status }`);
        }
        finally
        {
            await goHome(pair);
        }
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

const eachTheirOwn = async () =>
{
    console.log('[each looks for a table of their own choosing]');

    const asks = [{ seats: 2 }, { seats: 3 }, { seats: 2 }, { seats: 3 }, { seats: 3 }];
    const five = [];

    for (let index = 0; index < asks.length; index += 1)
    {
        five.push(await arrive(`Format ${ 'abcde'[index] }${ tag() }`));
    }

    try
    {
        const answers = [];

        for (const [index, who] of five.entries())
        {
            answers.push(await who.post('/tables/quick', { game: 'ludo', voice: 'off', ...asks[index] }));
        }

        ok('every search is answered with a table', answers.every((answer) => answer.status === 200 && typeof answer.body?.id === 'string'),
            answers.map((answer) => answer.status).join(' '));

        const at = answers.map((answer) => answer.body?.id);
        const twos = [at[0], at[2]];
        const threes = [at[1], at[3], at[4]];

        ok('the two who asked for two are at one table, and the three who asked for three at another',
            new Set(twos).size === 1 && new Set(threes).size === 1 && twos[0] !== threes[0], at.join(' '));

        for (const [id, seats, who] of [[twos[0], 2, five[0]], [threes[0], 3, five[1]]])
        {
            const table = (await who.get(`/tables/${ id }`)).body;

            ok(`a table of ${ seats }, as asked, full and started with nobody pressing start`,
                table?.seats === seats && sittingAt(table).length === seats && table?.status === 'playing' && table?.matchId !== undefined,
                `${ table?.seats } seats, ${ sittingAt(table).length } sitting, ${ table?.status }`);
        }

        const refused = await five[0].post('/tables/quick', { game: 'backgammon', voice: 'off', target: 1, cube: true });

        ok('a cube in a game to one point is refused as a table this game does not make',
            refused.status >= 400 && refused.status < 500 && refused.body?.error?.code === 'quick-options', `${ refused.status } ${ refused.body?.error?.code }`);

        const never = await five[0].post('/tables/quick', { game: 'ludo', voice: 'off', seats: 5 });

        ok('and so is a table of a size the game does not play', never.status >= 400 && never.status < 500 && never.body?.error?.code === 'quick-options', `${ never.status } ${ never.body?.error?.code }`);
    }
    finally
    {
        await goHome(five);
    }

    console.log('');
};

const chairsOf = async (who) => (await who.get('/tables/mine')).body?.tables ?? [];

const isolatedByGame = async () =>
{
    console.log('[eight look for four games at once, two for each]');

    const first = [];
    const second = [];

    for (const game of GAMES)
    {
        first.push(await arrive(`Apart ${ game } a${ tag() }`));
        second.push(await arrive(`Apart ${ game } b${ tag() }`));
    }

    try
    {
        const opened = await Promise.all(first.map((who, index) => who.post('/tables/quick', { game: GAMES[index], voice: 'off' })));

        ok('the first four are at four tables, one for each game', new Set(opened.map((answer) => answer.body?.id)).size === 4 && opened.every((answer) => answer.status === 200),
            opened.map((answer) => answer.status).join(' '));

        const joined = await Promise.all(second.map((who, index) => who.post('/tables/quick', { game: GAMES[index], voice: 'off' })));

        for (const [index, game] of GAMES.entries())
        {
            const table = (await first[index].get(`/tables/${ opened[index].body?.id }`)).body;
            const sitting = sittingAt(table);

            ok(`${ game }: the second joins the first at a table of ${ game }, and of nothing else`,
                joined[index].body?.id === opened[index].body?.id && table?.game === game,
                `${ table?.game }`);
            ok(`${ game }: the two of them, and nobody who looked for another game, with the game started`,
                sitting.length === 2 && sitting.includes(first[index].handle) && sitting.includes(second[index].handle) && table?.matchId !== undefined,
                sitting.join(' '));
        }
    }
    finally
    {
        await goHome([...first, ...second]);
    }

    console.log('');
};

const pressedAgain = async () =>
{
    console.log('[one person presses again and again, then looks for another game]');

    const me = await arrive(`Again ${ tag() }`);

    try
    {
        const together = await Promise.all(Array.from({ length: 5 }, () => me.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 })));
        const ids = new Set(together.map((answer) => answer.body?.id));

        ok('five presses at once are answered with one table', ids.size === 1 && together.every((answer) => answer.status === 200),
            `${ ids.size } tables, ${ together.map((answer) => answer.status).join(' ') }`);

        const waiting = [...ids][0];

        for (let press = 0; press < 3; press += 1)
        {
            await me.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 });
        }

        const mine = await chairsOf(me);
        const table = (await me.get(`/tables/${ waiting }`)).body;

        ok('and three more after them, with one chair at it', mine.length === 1 && mine[0].id === waiting && sittingAt(table).filter((who) => who === me.handle).length === 1,
            `${ mine.length } tables, ${ sittingAt(table).join(' ') }`);

        const other = await me.post('/tables/quick', { game: 'hokm', voice: 'off' });
        const now = await chairsOf(me);
        const left = (await me.get(`/tables/${ waiting }`)).body;

        ok('a search for another live game lets the first wait go', other.status === 200 && now.length === 1 && now[0].id === other.body?.id,
            now.map((one) => one.game).join(' '));
        ok('and the table nobody else was at closes behind them', left === null || left?.status === 'closed' || sittingAt(left).length === 0, `${ left?.status }`);
    }
    finally
    {
        await goHome([me]);
    }

    console.log('');
};

const cancelAndAgain = async () =>
{
    console.log('[somebody stops looking, and looks again]');

    const stays = await arrive(`Keeps on ${ tag() }`);
    const stops = await arrive(`Stops ${ tag() }`);

    try
    {
        const first = await stays.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 });
        const joined = await stops.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 });
        const tableId = first.body?.id;

        ok('two wait at one table of four', joined.body?.id === tableId, `${ tableId } ${ joined.body?.id }`);

        stays.rung.length = 0;

        const stopped = await stops.post(`/tables/${ tableId }/leave`, { forfeit: false });
        const after = (await stays.get(`/tables/${ tableId }`)).body;
        const rung = await within(RUNG_WITHIN_MS, () => stays.rung.includes(tableId));

        ok('stopping takes that one chair and no other', stopped.status === 200 && sittingAt(after).join(' ') === stays.handle && after?.status === 'open',
            `${ stopped.status }, ${ sittingAt(after).join(' ') }`);
        ok('whoever is still waiting is rung about it', rung, `${ stays.rung.length } table rings`);
        ok('and whoever stopped holds no chair at all', (await chairsOf(stops)).length === 0);

        const again = await stops.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 });

        ok('looking again finds the table still waiting', again.body?.id === tableId && sittingAt((await stays.get(`/tables/${ tableId }`)).body).length === 2,
            `${ again.body?.id }`);

        await stops.post(`/tables/${ tableId }/leave`, { forfeit: false });
        await stays.post(`/tables/${ tableId }/leave`, { forfeit: false });

        const closed = (await stays.get(`/tables/${ tableId }`)).body;

        ok('when both stop, the table closes and holds nobody', closed === null || closed?.status === 'closed', `${ closed?.status }`);
        ok('and neither holds a chair anywhere', (await chairsOf(stays)).length === 0 && (await chairsOf(stops)).length === 0);
    }
    finally
    {
        await goHome([stays, stops]);
    }

    console.log('');
};

const stillPlaying = async () =>
{
    console.log('[somebody still playing a live game looks again]');

    const me = await arrive(`Busy ${ tag() }`);
    const them = await arrive(`Busy too ${ tag() }`);

    try
    {
        const first = await me.post('/tables/quick', { game: 'backgammon', voice: 'off' });
        const started = await them.post('/tables/quick', { game: 'backgammon', voice: 'off' });
        const tableId = first.body?.id;

        ok('a game of two is dealt', started.body?.id === tableId && started.body?.matchId !== undefined, `${ started.body?.status }`);

        const same = await me.post('/tables/quick', { game: 'backgammon', voice: 'off' });
        const other = await me.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 });
        const mine = await chairsOf(me);

        ok('looking for the same game is answered with the game being played', same.body?.id === tableId && same.body?.matchId === started.body?.matchId,
            `${ same.body?.id }`);
        ok('and so is looking for another live game', other.body?.id === tableId, `${ other.body?.game }`);
        ok('and they hold that one chair and no other', mine.length === 1 && mine[0].id === tableId, mine.map((one) => one.game).join(' '));

        const slow = await me.post('/tables/quick', { game: 'ludo', voice: 'off', mode: 'turns' });

        ok('a game of a move a day can still be looked for beside it', slow.status === 200 && slow.body?.id !== tableId && slow.body?.mode === 'turns',
            `${ slow.status } ${ slow.body?.mode }`);
    }
    finally
    {
        await goHome([me, them]);
    }

    console.log('');
};

const cameBack = async () =>
{
    console.log('[somebody waiting loses their connection and comes back]');

    const me = await arrive(`Comes back ${ tag() }`);

    try
    {
        const first = await me.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 });
        const tableId = first.body?.id;

        me.socket.close();
        await pause(1500);
        await connect(me);

        const mine = await chairsOf(me);
        const again = await me.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 4 });
        const table = (await me.get(`/tables/${ tableId }`)).body;

        ok('the table they were waiting at is still theirs, and they are still ready', mine.length === 1 && mine[0].id === tableId && table?.chairs?.some((chair) => chair.who === me.handle && chair.ready),
            `${ mine.length } tables`);
        ok('and looking again is answered with it', again.body?.id === tableId && (await chairsOf(me)).length === 1, `${ again.body?.id }`);
    }
    finally
    {
        await goHome([me]);
    }

    console.log('');
};

const toldWhenItStarts = async () =>
{
    console.log('[who is told that a game has started]');

    const opens = await arrive(`Told a ${ tag() }`);
    const fills = await arrive(`Told b ${ tag() }`);
    const aside = await arrive(`Not told ${ tag() }`);

    try
    {
        const first = await opens.post('/tables/quick', { game: 'poker', voice: 'off' });

        opens.rung.length = 0;

        const second = await fills.post('/tables/quick', { game: 'poker', voice: 'off' });
        const table = (await opens.get(`/tables/${ first.body?.id }`)).body;
        const matchId = table?.matchId;

        if (!ok('a game of two is dealt to the two of them', second.body?.id === first.body?.id && typeof matchId === 'string', `${ table?.status }`))
        {
            return;
        }

        const told = await within(TOLD_WITHIN_MS, () => opens.games.has(matchId) && fills.games.has(matchId));

        ok('each of the two is pushed the game on their own socket', told,
            `opener ${ opens.games.has(matchId) }, filler ${ fills.games.has(matchId) }`);
        ok('the one who was waiting is rung about the table as well', await within(RUNG_WITHIN_MS, () => opens.rung.includes(table.id)), `${ opens.rung.length } table rings`);
        ok('somebody else connected is told nothing about it', !aside.games.has(matchId) && !aside.rung.includes(table.id));

        const theirs = await Promise.all([opens, fills].map(async (who) => (await chairsOf(who)).find((one) => one.id === table.id)?.matchId));

        ok('and both read the same game at the same table', theirs.every((id) => id === matchId), theirs.join(' '));
    }
    finally
    {
        await goHome([opens, fills, aside]);
    }

    console.log('');
};

const oneNeverPlays = async () =>
{
    console.log('[one of the two never plays the game quick play started]');

    const stays = await arrive(`Plays ${ tag() }`);
    const absent = await arrive(`Never plays ${ tag() }`);

    try
    {
        const first = await stays.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 2 });

        await absent.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 2 });
        absent.socket.close();

        const table = (await stays.get(`/tables/${ first.body?.id }`)).body;
        const matchId = table?.matchId;

        if (!ok('a game of two is dealt', typeof matchId === 'string', `${ table?.status }`))
        {
            return;
        }

        const began = Date.now();
        let state = (await stays.get(`/matches/${ matchId }`)).body;
        let turns = 0;

        while (state?.finishedAt === undefined && Date.now() - began < GIVEN_UP_WITHIN_MS)
        {
            if (state?.turn === state?.mine && (state.view.die === undefined || state.view.moves.length > 0))
            {
                const play = state.view.die === undefined
                    ? { kind: 'ludo', verb: 'roll' }
                    : { kind: 'ludo', verb: 'move', piece: state.view.moves[0] };
                const answer = await stays.post(`/matches/${ matchId }/play`, { key: `p-${ turns }`, rev: state.rev, play });

                turns += 1;
                state = answer.status === 200 ? answer.body.match : (await stays.get(`/matches/${ matchId }`)).body;
                continue;
            }

            await pause(1000);
            state = (await stays.get(`/matches/${ matchId }`)).body;
        }

        const gone = state?.players?.find((row) => row.who === absent.handle);
        const kept = state?.players?.find((row) => row.who === stays.handle);

        ok('the game ends without the one who never played', state?.finishedAt !== undefined, `after ${ Math.round((Date.now() - began) / 1000) } s and ${ turns } plays`);
        ok('who never played lost it to the clock', gone?.result === 'abandoned' && gone?.exit === 'timeout', `${ gone?.result } ${ gone?.exit }`);
        ok('and who stayed is charged nothing: a win, or no contest when too little was played to rate', ['won', 'void'].includes(kept?.result),
            `${ kept?.result }`);

        const after = (await stays.get(`/tables/${ table.id }`)).body;

        ok('the table has no game on it any more', after?.matchId === undefined, `${ after?.status }`);

        const next = await stays.post('/tables/quick', { game: 'ludo', voice: 'off', seats: 2 });

        ok('and who stayed can look for the next game at once, at a table without the one who never played',
            next.status === 200 && next.body?.id !== table.id && !sittingAt(next.body).includes(absent.handle), `${ next.status }`);
    }
    finally
    {
        await goHome([stays, absent]);
    }

    console.log('');
};

const run = async () =>
{
    console.log(`\nquick pass against ${ BASE }\n`);

    await twoWhoLeaveItOpen();
    await isolatedByGame();
    await eightAtOnce();
    await eachTheirOwn();
    await pressedAgain();
    await cancelAndAgain();
    await stillPlaying();
    await cameBack();
    await toldWhenItStarts();
    await oneNeverPlays();
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
