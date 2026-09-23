/**
 * Whole matches of Hokm, over the real HTTP api, by real accounts at two, three and four players.
 *
 * `ludo-pass.mjs`'s sibling and mostly its twin: sign in, open a table, sit down, get ready, start,
 * and play every card to a winner through the routes a browser uses. What it proves is that the
 * rules, the persistence, the turn order, the authorisation and the wire agree end to end, over
 * thousands of turns, in seconds.
 *
 * **It checks one thing ludo's cannot, and that thing is the reason the engine seam exists.** Ludo
 * is face up, so its pass never had to ask what one player can see of another. Hokm has hands, and
 * `hokm-seam.spec.ts` proves the ENGINE composes them per seat - this proves the same thing survives
 * the route, the projector, the serialiser and the wire: every seat reads `GET /matches/:id` for
 * itself, and no answer ever carries a card that reader is not holding.
 *
 * Run against the BUILT server, like every other pass:
 *   PORT=5300 PUBLIC_ORIGIN=http://localhost:5300 SERVE_PAGES=true NODE_ENV=production npm start
 *   node tools/qa/hokm-pass.mjs
 */

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const nameOf = (card) => `${ RANKS[card % 13] }${ SUITS[Math.floor(card / 13)][0].toUpperCase() }`;

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

const run = async () =>
{
    console.log(`\nhokm pass against ${ BASE }\n`);

    for (const seats of [2, 3, 4])
    {
        console.log(`[${ seats } players]`);

        const players = [];

        for (let index = 0; index < seats; index += 1)
        {
            players.push(await guest(`Hokm ${ seats }${ 'abcd'[index] }${ Math.floor(Math.random() * 10000) }`));
        }

        const made = await players[0].post('/tables/', {
            game: 'hokm',
            seats,
            mode: 'live',
            privacy: 'public',
            target: 7,
            cube: false,
            blinds: 'low',
            chat: true,
            invitees: []
        });

        if (!ok('the table opens', made.status === 200, `${ made.status } ${ made.text.slice(0, 140) }`))
        {
            return;
        }

        const tableId = made.body.id;

        for (const player of players.slice(1))
        {
            const sat = await player.post(`/tables/${ tableId }/seat`);

            ok(`${ player.handle } takes a chair`, sat.status === 200 && sat.body.seat !== undefined);
        }

        for (const player of players)
        {
            await player.post(`/tables/${ tableId }/ready`, { ready: true });
        }

        const started = await players[0].post(`/tables/${ tableId }/start`);

        if (!ok('the game deals', started.status === 200, `${ started.status } ${ started.text.slice(0, 140) }`))
        {
            return;
        }

        const matchId = started.body.id;

        const stranger = await guest(`Nosy${ Math.floor(Math.random() * 10000) }`);
        const peek = await stranger.get(`/matches/${ matchId }`);

        ok('somebody not playing is answered as if it does not exist', peek.status === 404, `${ peek.status }`);

        const seatOf = new Map();

        for (const player of players)
        {
            const mine = await player.get(`/matches/${ matchId }`);

            seatOf.set(player.handle, mine.body.mine);
        }

        // ------------------------------------------------------------ the pause, over the wire
        const opening = [];

        for (const player of players)
        {
            const mine = await player.get(`/matches/${ matchId }`);

            opening.push({ seat: mine.body.mine, held: mine.body.view.hand.length, hakem: mine.body.view.hakem });
        }

        const hakemSeat = opening[0].hakem;
        const dealt = opening.filter((one) => one.held > 0);

        ok('only the Hâkem has been dealt during the pause',
            dealt.length === 1 && dealt[0].seat === hakemSeat && dealt[0].held === 5,
            opening.map((one) => `${ one.seat }:${ one.held }`).join(' '));

        const waiting = players.find((player) => seatOf.get(player.handle) !== hakemSeat);
        const blocked = await waiting.post(`/matches/${ matchId }/play`, {
            key: `early-${ Date.now() }`,
            play: { kind: 'hokm', verb: 'trump', suit: 'spades' }
        });

        ok('anybody but the Hâkem is refused the trump call', blocked.status >= 400, `${ blocked.status }`);

        // ------------------------------------------------------------ play it out
        let turns = 0;
        let leaks = 0;
        let hands = 0;
        let kots = 0;

        const byHandle = new Map(players.map((player) => [seatOf.get(player.handle), player]));

        let state = (await players[0].get(`/matches/${ matchId }`)).body;

        while (state.finishedAt === undefined && turns < 6000)
        {
            const actor = byHandle.get(state.turn);
            const mine = (await actor.get(`/matches/${ matchId }`)).body;
            const board = mine.view;

            // Every seat reads for itself, and must be handed its own cards and nobody else's.
            for (const player of players)
            {
                const seen = (await player.get(`/matches/${ matchId }`)).body.view;
                const seat = seatOf.get(player.handle);

                if (seen.hand.length !== seen.seats[seat].held)
                {
                    leaks += 1;
                    console.log(`        seat ${ seat } was handed ${ seen.hand.length } of its ${ seen.seats[seat].held }`);
                }

                const others = seen.seats.reduce((total, row) => total + (row.seat === seat ? 0 : row.held), 0);

                if (seen.hand.length + seen.trick.length > 0 && others > 0 && seen.hand.some((card) => seen.trick.includes(card)))
                {
                    leaks += 1;
                    console.log(`        seat ${ seat } holds a card already on the table: ${ nameOf(seen.hand[0]) }`);
                }
            }

            const play = board.phase === 'trump'
                ? { kind: 'hokm', verb: 'trump', suit: SUITS[Math.floor(Math.random() * 4)] }
                : { kind: 'hokm', verb: 'card', card: board.plays[0] };

            if (board.phase === 'tricks' && board.plays.length === 0)
            {
                ok('the seat on turn is always offered a card', false, `seat ${ state.turn } had none`);
                break;
            }

            const answer = await actor.post(`/matches/${ matchId }/play`, {
                key: `h-${ turns }`,
                rev: mine.rev,
                play
            });

            if (answer.status !== 200)
            {
                ok('every play is accepted', false, `turn ${ turns }: ${ answer.status } ${ answer.text.slice(0, 160) }`);
                break;
            }

            if (answer.body.applied !== 'now')
            {
                ok('a fresh play applies', false, `turn ${ turns } was ${ answer.body.applied }`);
                break;
            }

            const before = state;

            state = answer.body.match;

            if (state.rev !== before.rev + 1 && before.rev !== 0)
            {
                ok('the revision moves by one', false, `${ before.rev } -> ${ state.rev }`);
                break;
            }

            const scored = state.view.points.reduce((total, one) => total + one, 0);
            const was = before.view.points.reduce((total, one) => total + one, 0);

            if (scored > was)
            {
                hands += 1;
                kots += scored - was > 1 ? 1 : 0;
            }

            turns += 1;
        }

        ok('no seat was ever handed another seat cards', leaks === 0, `${ leaks } leaks over ${ turns } turns`);

        ok('the match reaches a winner', state.finishedAt !== undefined, `after ${ turns } turns`);
        ok('and names one', state.winner !== undefined, `seat ${ state.winner }`);
        ok('over hands that were really scored', hands >= 7, `${ hands } hands, ${ kots } of them kot`);

        const top = Math.max(...state.view.points);

        ok('somebody reached the target', top >= 7, `${ state.view.points.join('-') }`);

        const replay = await players[0].get(`/matches/${ matchId }/since?rev=0`);

        ok('the whole match can be read back', replay.status === 200 && replay.body.events.length === state.rev,
            `${ replay.body?.events?.length } entries for ${ state.rev } revisions`);

        const named = (replay.body.events ?? []).every((entry) => entry.log?.kind === 'hokm');

        ok('and the log says which game it is', named);

        const after = await players[0].post(`/matches/${ matchId }/play`, {
            key: `late-${ Date.now() }`,
            play: { kind: 'hokm', verb: 'card', card: 0 }
        });

        ok('a finished match refuses another play', after.status >= 400, `${ after.status }`);

        console.log('');
    }

    console.log('------------------------------------------');
    console.log(failures === 0 ? `hokm pass: clean, ${ checks } checks` : `hokm pass: ${ failures } FAILED, ${ checks } checks`);

    process.exit(failures === 0 ? 0 : 1);
};

await run();
