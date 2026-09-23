const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const STACK = 1500;

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

let seed = 97531;

const random = () =>
{
    seed = (seed * 1103515245 + 12345) % 2147483648;

    return seed / 2147483648;
};

const choose = (view) =>
{
    const roll = random();

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

const play = async (count) =>
{
    console.log(`[${ count } players]`);

    const players = [];

    for (let index = 0; index < count; index += 1)
    {
        players.push(await guest(`Poker ${ count }${ 'abcdefghi'[index] }${ Math.floor(random() * 10000) }`));
    }

    const made = await players[0].post('/tables/', {
        game: 'poker', seats: count, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'mid', chat: true, voice: false, invitees: []
    });

    if (!ok('the table opens', made.status === 200, `${ made.status } ${ made.text.slice(0, 160) }`))
    {
        return;
    }

    for (const player of players.slice(1))
    {
        const sat = await player.post(`/tables/${ made.body.id }/seat`);

        if (sat.status !== 200 || sat.body.seat === undefined)
        {
            ok(`${ player.handle } takes a chair`, false, `${ sat.status }`);
            return;
        }
    }

    for (const player of players)
    {
        await player.post(`/tables/${ made.body.id }/ready`, { ready: true });
    }

    const started = await players[0].post(`/tables/${ made.body.id }/start`);

    if (!ok('the game deals', started.status === 200, `${ started.status } ${ started.text.slice(0, 160) }`))
    {
        return;
    }

    const matchId = started.body.id;
    const stranger = await guest(`Railbird${ Math.floor(random() * 10000) }`);

    ok('somebody not playing is answered as if it does not exist', (await stranger.get(`/matches/${ matchId }`)).status === 404);

    const bySeat = new Map();

    for (const player of players)
    {
        bySeat.set((await player.get(`/matches/${ matchId }`)).body.mine, player);
    }

    const opening = (await players[0].get(`/matches/${ matchId }`)).body.view;

    ok('it opens on the blinds the table asked for', opening.blinds.small === 25 && opening.blinds.big === 50, `${ opening.blinds.small }/${ opening.blinds.big }`);

    let actions = 0;
    let leaks = 0;
    let duplicates = 0;
    let unbalanced = 0;
    let finished = null;
    let lastHand = 0;

    while (actions < 6000)
    {
        const views = await Promise.all([...bySeat.entries()].map(async ([seat, player]) => ({ seat, answer: (await player.get(`/matches/${ matchId }`)).body })));
        const first = views[0].answer;

        if (first.finishedAt !== undefined)
        {
            finished = first;
            break;
        }

        const dealt = [];

        for (const { seat, answer } of views)
        {
            const view = answer.view;
            const mine = view.seats.find((row) => row.seat === seat);

            if (view.hole.length > 0 && (mine.folded || mine.out))
            {
                leaks += 1;
            }

            dealt.push(...view.hole);
        }

        dealt.push(...first.view.board);

        if (new Set(dealt).size !== dealt.length)
        {
            duplicates += 1;
        }

        const inPlay = first.view.seats.reduce((sum, row) => sum + row.stack, 0) + first.view.pot;

        if (inPlay !== count * STACK)
        {
            unbalanced += 1;
        }

        lastHand = first.view.hand;

        const turn = first.view.turn;
        const actor = bySeat.get(turn);
        const own = views.find((one) => one.seat === turn).answer;
        const wanted = choose(own.view);
        const answer = await actor.post(`/matches/${ matchId }/play`, { key: `p${ actions }-${ matchId }`, rev: own.rev, play: wanted });

        if (answer.status !== 200 || answer.body.applied !== 'now')
        {
            ok(`action ${ actions } (${ wanted.verb }) is applied`, false, `${ answer.status } ${ answer.text.slice(0, 160) }`);
            break;
        }

        actions += 1;
    }

    ok('no player ever holds a card after folding or busting', leaks === 0, `${ leaks }`);
    ok('no card is ever in two places at once', duplicates === 0, `${ duplicates }`);
    ok('every chip is accounted for at every turn', unbalanced === 0, `${ unbalanced } unbalanced reads`);

    if (!ok('the Sit & Go ends', finished !== null, `after ${ actions } actions, ${ lastHand } hands`))
    {
        return;
    }

    const winner = finished.view.seats.find((row) => row.seat === finished.winner);

    ok('the winner holds every chip', winner !== undefined && winner.stack === count * STACK, `${ winner?.stack }`);
    ok('it is a won match, recorded for every player', finished.outcome === 'won'
        && finished.players.filter((row) => row.result === 'won').length === 1
        && finished.players.filter((row) => row.result === 'lost').length === count - 1);
};

const run = async () =>
{
    console.log(`\npoker pass against ${ BASE }\n`);

    await play(2);
    await play(6);
    await play(9);

    console.log(`\n${ checks - failures }/${ checks } checks passed`);
    process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((error) =>
{
    console.error(error);
    process.exitCode = 1;
});
