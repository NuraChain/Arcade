/**
 * A whole game of Ludo, over the real HTTP api, by two real accounts.
 *
 * This is the lifecycle check the brief asks for and the one no unit suite can make: sign in, open
 * a table, sit down, get ready, start, and then play every turn to a winner through the routes a
 * browser would use, with the server drawing every die.
 *
 * It is deliberately API-level rather than a browser pass. What it proves is that the rules, the
 * persistence, the turn order, the authorisation and the wire agree with each other end to end -
 * and it proves it in a few seconds over hundreds of turns, which a browser driving a board could
 * not. The browser's own pass covers what this cannot: that any of it is visible.
 *
 * Run it against the BUILT server, the way the other passes are run:
 *   PORT=5300 ... npm start
 *   node tools/qa/ludo-pass.mjs
 */

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

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

const session = () =>
{
    let cookie = '';

    const call = async (method, path, body) =>
    {
        const response = await fetch(`${ BASE }/api${ path }`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(cookie === '' ? {} : { cookie })
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        const raw = response.headers.getSetCookie?.() ?? [];

        for (const line of raw)
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
        handle: null
    };
};

const guest = async (name) =>
{
    const who = session();
    const answer = await who.post('/auth/guest', { name });

    if (answer.status !== 200)
    {
        throw new Error(`guest sign-in for ${ name } failed: ${ answer.status } ${ answer.text.slice(0, 200) }`);
    }

    who.handle = answer.body.account.handle;

    return who;
};

const run = async () =>
{
    console.log(`\nludo pass against ${ BASE }\n`);

    for (const seats of [2, 3, 4])
    {
        console.log(`[${ seats } players]`);

        const players = [];

        for (let index = 0; index < seats; index += 1)
        {
            players.push(await guest(`Ludo ${ seats }${ 'abcd'[index] }${ Math.floor(Math.random() * 10000) }`));
        }

        const made = await players[0].post('/tables/', {
            game: 'ludo',
            seats,
            mode: 'live',
            privacy: 'public',
            target: 0,
            cube: false,
            blinds: 'low',
            invitees: []
        });

        if (!ok('the table opens', made.status === 200, `${ made.status } ${ made.text.slice(0, 120) }`))
        {
            return;
        }

        const tableId = made.body.id;

        for (const player of players.slice(1))
        {
            const sat = await player.post(`/tables/${ tableId }/seat`);
            ok(`${ player.handle } takes a chair`, sat.status === 200 && sat.body.seat !== undefined);
        }

        const early = await players[0].post(`/tables/${ tableId }/start`);
        ok('a table nobody is ready at will not start', early.status >= 400, `${ early.status }`);

        for (const player of players)
        {
            await player.post(`/tables/${ tableId }/ready`, { ready: true });
        }

        const started = await Promise.all(players.map((player) => player.post(`/tables/${ tableId }/start`)));
        const ids = new Set(started.map((answer) => answer.body?.id));

        ok('everybody pressing start gets one game', ids.size === 1, `${ ids.size } distinct`);

        const matchId = started[0].body.id;

        const view = await players[0].get(`/tables/${ tableId }`);
        ok('the table says it is playing', view.body.status === 'playing', view.body.status);
        ok('and names the game', view.body.matchId === matchId);

        const stranger = await guest(`Nosy${ Math.floor(Math.random() * 10000) }`);
        const peek = await stranger.get(`/matches/${ matchId }`);
        ok('somebody not playing is answered as if it does not exist', peek.status === 404, `${ peek.status }`);

        const byHandle = new Map(players.map((player) => [player.handle, player]));

        let state = (await players[0].get(`/matches/${ matchId }`)).body;
        let turns = 0;
        let captures = 0;
        let rolls = 0;

        const wrongTurn = players.find((player) =>
        {
            const seat = state.players.find((row) => row.who === player.handle).seat;
            return seat !== state.turn;
        });

        if (wrongTurn !== undefined)
        {
            const refused = await wrongTurn.post(`/matches/${ matchId }/roll`, { key: `bad-${ Date.now() }` });
            ok('a player out of turn is refused', refused.status === 403, `${ refused.status }`);
        }

        while (state.finishedAt === undefined && turns < 4000)
        {
            const seat = state.turn;
            const who = state.players.find((row) => row.seat === seat).who;
            const actor = byHandle.get(who);

            const answer = state.die === undefined
                ? await actor.post(`/matches/${ matchId }/roll`, { key: `r-${ turns }`, rev: state.rev })
                : await actor.post(`/matches/${ matchId }/move`, { key: `m-${ turns }`, rev: state.rev, piece: state.moves[0] });

            if (answer.status !== 200)
            {
                ok('every turn is accepted', false, `turn ${ turns }: ${ answer.status } ${ answer.text.slice(0, 160) }`);
                break;
            }

            if (state.die === undefined)
            {
                rolls += 1;
            }

            const before = state;
            state = answer.body.match;

            if (answer.body.applied !== 'now')
            {
                ok('a fresh action applies', false, `turn ${ turns } was ${ answer.body.applied }`);
                break;
            }

            if (state.rev !== before.rev + 1)
            {
                ok('the revision moves by one', false, `${ before.rev } -> ${ state.rev }`);
                break;
            }

            const homeBefore = before.players.reduce((total, row) => total + row.tokens.filter((token) => token.at >= 0).length, 0);
            const homeAfter = state.players.reduce((total, row) => total + row.tokens.filter((token) => token.at >= 0).length, 0);

            if (homeAfter < homeBefore)
            {
                captures += 1;
            }

            turns += 1;
        }

        ok('the game reaches a winner', state.finishedAt !== undefined, `after ${ turns } turns`);
        ok('and names one', state.winner !== undefined, `seat ${ state.winner }`);
        ok('the server rolled every die', rolls > 0, `${ rolls } rolls`);
        ok('somebody got sent home along the way', captures > 0, `${ captures } captures`);

        const replay = await players[0].get(`/matches/${ matchId }/since?rev=0`);
        ok('the whole game can be read back', replay.status === 200 && replay.body.events.length === state.rev,
            `${ replay.body?.events?.length } events for ${ state.rev } revisions`);

        const after = await players[0].post(`/matches/${ matchId }/roll`, { key: `late-${ Date.now() }` });
        ok('a finished game refuses another turn', after.status >= 400, `${ after.status }`);

        const retry = await players[0].get(`/matches/${ matchId }`);
        ok('and still reads back', retry.status === 200 && retry.body.finishedAt !== undefined);

        console.log('');
    }

    console.log('------------------------------------------');
    console.log(failures === 0 ? `ludo pass: clean, ${ checks } checks` : `ludo pass: ${ failures } of ${ checks } FAILED`);

    process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
