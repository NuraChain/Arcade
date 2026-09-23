import { turns } from '../../server/src/domains/match/backgammon/moves.ts';

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const CHECKERS = 15;

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

    return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body), handle: null };
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

let seed = 20260923;

const random = () =>
{
    seed = (seed * 1103515245 + 12345) % 2147483648;

    return seed / 2147483648;
};

const conserved = (view) => view.seats.every((row) => row.checkers.reduce((sum, count) => sum + count, 0) === CHECKERS);

const clash = (view) =>
{
    const [a, b] = view.seats;

    for (let point = 1; point <= 24; point += 1)
    {
        if (a.checkers[point] > 0 && b.checkers[25 - point] > 0)
        {
            return point;
        }
    }

    return null;
};

const play = async (target, cube) =>
{
    console.log(`[match to ${ target }, cube ${ cube ? 'on' : 'off' }]`);

    const players = [
        await guest(`Nard ${ target }a${ Math.floor(random() * 10000) }`),
        await guest(`Nard ${ target }b${ Math.floor(random() * 10000) }`)
    ];

    const made = await players[0].post('/tables/', {
        game: 'backgammon',
        seats: 2,
        mode: 'live',
        privacy: 'public',
        target,
        cube,
        blinds: 'low',
        chat: true,
        voice: false,
        invitees: []
    });

    if (!ok('the table opens', made.status === 200, `${ made.status } ${ made.text.slice(0, 160) }`))
    {
        return;
    }

    const tableId = made.body.id;
    const sat = await players[1].post(`/tables/${ tableId }/seat`);

    ok('the second player takes the other chair', sat.status === 200 && sat.body.seat !== undefined);

    for (const player of players)
    {
        await player.post(`/tables/${ tableId }/ready`, { ready: true });
    }

    const started = await players[0].post(`/tables/${ tableId }/start`);

    if (!ok('the match starts', started.status === 200, `${ started.status } ${ started.text.slice(0, 160) }`))
    {
        return;
    }

    const matchId = started.body.id;
    const stranger = await guest(`Nosy${ Math.floor(random() * 10000) }`);
    const peek = await stranger.get(`/matches/${ matchId }`);

    ok('somebody not playing is answered as if it does not exist', peek.status === 404, `${ peek.status }`);

    const bySeat = new Map();

    for (const player of players)
    {
        bySeat.set((await player.get(`/matches/${ matchId }`)).body.mine, player);
    }

    const opening = (await players[0].get(`/matches/${ matchId }`)).body;

    ok('the match opens mid-turn, with the opening dice already thrown', opening.view.phase === 'move' && opening.view.dice.length === 2
        && opening.view.dice[0] !== opening.view.dice[1], `${ opening.view.phase } ${ opening.view.dice.join('-') }`);

    const idle = bySeat.get(1 - opening.view.turn);
    const early = await idle.post(`/matches/${ matchId }/play`, { key: `early-${ matchId }`, play: { kind: 'backgammon', verb: 'roll' } });

    ok('the player not on turn is refused', early.status === 403, `${ early.status }`);

    const mover = bySeat.get(opening.view.turn);
    const wrong = await mover.post(`/matches/${ matchId }/play`, {
        key: `wrong-${ matchId }`,
        play: { kind: 'backgammon', verb: 'move', hops: [{ from: 24, to: 10 }] }
    });

    ok('a move the dice do not allow is refused', wrong.status === 409, `${ wrong.status } ${ wrong.text.slice(0, 120) }`);

    let actions = 0;
    let broken = 0;
    let disagreements = 0;
    let doubles = 0;
    let passes = 0;
    let finished = null;

    while (actions < 4000)
    {
        const views = await Promise.all(players.map((player) => player.get(`/matches/${ matchId }`)));
        const [first, second] = views.map((answer) => answer.body);

        if (JSON.stringify(first.view) !== JSON.stringify(second.view))
        {
            disagreements += 1;
        }

        if (!conserved(first.view) || clash(first.view) !== null)
        {
            broken += 1;
        }

        if (first.finishedAt !== undefined)
        {
            finished = first;
            break;
        }

        const view = first.view;
        const seat = view.turn;
        const actor = bySeat.get(seat);
        let wanted;

        if (view.phase === 'roll')
        {
            wanted = view.doubling && random() < 0.15 ? { kind: 'backgammon', verb: 'double' } : { kind: 'backgammon', verb: 'roll' };
        }
        else if (view.phase === 'double')
        {
            doubles += 1;
            wanted = { kind: 'backgammon', verb: random() < 0.7 ? 'take' : 'drop' };
        }
        else
        {
            const own = view.seats.find((row) => row.seat === seat).checkers;
            const other = view.seats.find((row) => row.seat !== seat).checkers;
            const options = turns({ me: [...own], them: [...other] }, view.dice);

            if (options.length === 0)
            {
                passes += 1;
                ok('a turn with nothing playable is never left waiting on a move', false, `${ view.dice.join('-') }`);
                break;
            }

            wanted = { kind: 'backgammon', verb: 'move', hops: options[Math.floor(random() * options.length)] };
        }

        const answer = await actor.post(`/matches/${ matchId }/play`, { key: `a${ actions }-${ matchId }`, rev: first.rev, play: wanted });

        if (answer.status !== 200 || answer.body.applied !== 'now')
        {
            ok(`action ${ actions } (${ wanted.verb }) is applied`, false, `${ answer.status } ${ answer.text.slice(0, 160) }`);
            break;
        }

        actions += 1;
    }

    ok('both players read the same board at every turn, because nothing on it is hidden', disagreements === 0, `${ disagreements } disagreements`);
    ok('fifteen checkers a side and never two colours on one point, at every turn', broken === 0, `${ broken } broken positions`);
    ok('no turn was ever stuck waiting for a move nobody could make', passes === 0);

    if (!ok('the match ends', finished !== null, `after ${ actions } actions`))
    {
        return;
    }

    const scores = finished.view.seats.map((row) => row.score);
    const winner = finished.winner;

    ok('it ends won, by somebody who reached the target', finished.outcome === 'won' && winner !== undefined && scores[winner] >= target,
        `${ finished.outcome } seat ${ winner } scores ${ scores.join('-') } of ${ target }`);
    ok('it names the winner in both players results', finished.players.find((one) => one.seat === winner)?.result === 'won'
        && finished.players.find((one) => one.seat !== winner)?.result === 'lost');

    if (cube && target > 1)
    {
        console.log(`  note  ${ doubles } doubles answered over ${ actions } actions`);
    }

    const history = await players[0].get('/matches/history');

    ok('the match is in the first player history', history.status === 200 && history.body.matches.some((one) => one.id === matchId));
};

const run = async () =>
{
    console.log(`\nbackgammon pass against ${ BASE }\n`);

    await play(1, true);
    await play(3, true);
    await play(5, false);

    console.log(`\n${ checks - failures }/${ checks } checks passed`);
    process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((error) =>
{
    console.error(error);
    process.exitCode = 1;
});
