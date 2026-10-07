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
import { FINISHED, RING_STEPS, SAFE, ringIndex } from '../../backend/src/domains/match/ludo/board.ts';
import { partnerOf, sideOf } from '../../backend/src/domains/match/sides.ts';
import { tableBody } from './tables.mjs';

const ROLL = { kind: 'ludo', verb: 'roll' };

const BASE = process.env.QA_BASE ?? 'http://localhost:5300';

const PAIRED = { seats: 4, variant: 'teams' };

const GAMES = [
    { seats: 2, teams: false },
    { seats: 3, teams: false },
    { seats: 4, teams: false },
    { seats: 4, teams: true },
    { seats: 4, teams: true },
    { seats: 4, teams: true },
    { seats: 4, teams: true }
];

let checks = 0;
let failures = 0;
let allCaptures = 0;

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

const standing = (match, side) =>
{
    const held = new Map();

    for (const row of match.view.seats.filter((one) => one.side === side))
    {
        for (const token of row.tokens.filter((one) => one.at >= 0 && one.at < RING_STEPS))
        {
            const square = ringIndex(row.colour, token.at);

            held.set(square, [...(held.get(square) ?? []), row.seat]);
        }
    }

    return held;
};

const moverOf = (match) => match.view.seats.find((row) => row.seat === match.view.controls);

const pairsOf = (match, side) => [...standing(match, side)].filter(([, seats]) => seats.length > 1);

const walled = (match) =>
{
    const mover = moverOf(match);
    const own = standing(match, mover.side);
    const pairs = new Map(pairsOf(match, 1 - mover.side));
    const squareOf = (to) => (to < RING_STEPS ? ringIndex(mover.colour, to) : -1);

    return mover.tokens
        .filter((token) => token.at >= 0 && token.at + match.view.die <= FINISHED)
        .map((token) =>
        {
            const ahead = Array.from({ length: match.view.die }, (_, step) => pairs.get(squareOf(token.at + step + 1))).filter((pair) => pair !== undefined);
            const room = (own.get(squareOf(token.at + match.view.die)) ?? []).length < 2;

            return { piece: token.piece, pairs: ahead.length, onlyPartners: room && ahead.every(([first, second]) => first !== second) };
        })
        .filter((one) => one.pairs > 0);
};

const crowded = (match) =>
{
    const sides = [0, 1].map((side) => standing(match, side));

    for (const [square, seats] of sides.flatMap((held) => [...held]))
    {
        if (seats.length > 2)
        {
            return `square ${ square } holds three tokens of one side`;
        }

        if (!SAFE.includes(square) && sides.every((held) => held.has(square)))
        {
            return `square ${ square } is open and holds both sides`;
        }
    }

    return '';
};

const pairing = (match) =>
{
    const mover = moverOf(match);
    const held = standing(match, mover.side);
    const beside = (at) => (at >= 0 && at < RING_STEPS ? (held.get(ringIndex(mover.colour, at)) ?? []).length : 0);
    const ranked = match.view.moves.map((piece) =>
    {
        const at = mover.tokens.find((token) => token.piece === piece).at;

        return { piece, at, breaks: beside(at) === 2, joins: beside(at < 0 ? 0 : at + match.view.die) === 1 };
    });

    return ranked.sort((a, b) => a.breaks - b.breaks || b.joins - a.joins || a.at - b.at)[0].piece;
};

const run = async () =>
{
    console.log(`\nludo pass against ${ BASE }\n`);

    let lent = 0;
    let met = 0;

    for (const { seats, teams } of GAMES)
    {
        if (teams && lent > 0 && met > 0)
        {
            continue;
        }

        console.log(teams ? `[${ seats } players, two against two]` : `[${ seats } players]`);

        const players = [];

        for (let index = 0; index < seats; index += 1)
        {
            players.push(await guest(`Ludo ${ seats }${ 'abcd'[index] }${ Math.floor(Math.random() * 10000) }`));
        }

        const made = await players[0].post('/tables/', tableBody({
            game: 'ludo',
            seats,
            mode: 'live',
            privacy: 'public',
            teams
        }));

        if (!ok('the table opens', made.status === 200, `${ made.status } ${ made.text.slice(0, 120) }`))
        {
            return;
        }

        ok(teams ? 'and is two against two, as its opener asked' : 'and every seat plays for itself', made.body.teams === teams, `teams ${ made.body.teams }`);

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
        let helped = 0;
        let stood = 0;
        let blocked = 0;
        let partnered = 0;
        let offered = '';
        let crowd = '';

        if (teams)
        {
            ok('the board seats partners opposite, each pair on one side',
                state.view.seats.every((row) => row.side === sideOf(row.seat, PAIRED)),
                state.view.seats.map((row) => `${ row.seat }:${ row.side }`).join(' '));
            ok('and every seat is told the side it plays for',
                state.players.every((row) => row.side === sideOf(row.seat, PAIRED)),
                state.players.map((row) => `${ row.seat }:${ row.side }`).join(' '));
        }

        const wrongTurn = players.find((player) =>
        {
            const seat = state.players.find((row) => row.who === player.handle).seat;
            return seat !== state.turn;
        });

        if (wrongTurn !== undefined)
        {
            const refused = await wrongTurn.post(`/matches/${ matchId }/play`, { key: `bad-${ Date.now() }`, play: ROLL });
            ok('a player out of turn is refused', refused.status === 403, `${ refused.status }`);
            ok('and is told it is not their turn', refused.body?.error?.code === 'not-your-turn', `${ refused.body?.error?.code }`);
        }

        while (state.finishedAt === undefined && turns < 4000)
        {
            const seat = state.turn;
            const who = state.players.find((row) => row.seat === seat).who;
            const actor = byHandle.get(who);

            if (teams && state.view.die !== undefined)
            {
                const stopped = walled(state);
                const through = stopped.filter((one) => state.view.moves.includes(one.piece));

                stood += pairsOf(state, 1 - moverOf(state).side).length > 0 ? 1 : 0;
                blocked += stopped.length - through.length;
                partnered += stopped.filter((one) => one.onlyPartners && !through.includes(one)).length;

                if (through.length > 0 && offered === '')
                {
                    offered = `turn ${ turns }: seat ${ seat } was offered token ${ through.map((one) => one.piece).join(' ') } onto or past a pair of the other side`;
                }
            }

            const answer = state.view.die === undefined
                ? await actor.post(`/matches/${ matchId }/play`, { key: `r-${ turns }`, rev: state.rev, play: ROLL })
                : await actor.post(`/matches/${ matchId }/play`, {
                    key: `m-${ turns }`, rev: state.rev,
                    play: { kind: 'ludo', verb: 'move', piece: teams ? pairing(state) : state.view.moves[0] }
                });

            if (answer.status !== 200)
            {
                ok('every turn is accepted', false, `turn ${ turns }: ${ answer.status } ${ answer.text.slice(0, 160) }`);
                break;
            }

            if (state.view.die === undefined)
            {
                rolls += 1;
            }
            else if (state.view.controls !== seat)
            {
                helped += 1;
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

            const onBoard = (match) => match.view.seats.reduce(
                (total, row) => total + row.tokens.filter((token) => token.at >= 0).length, 0);

            const homeBefore = onBoard(before);
            const homeAfter = onBoard(state);

            if (homeAfter < homeBefore)
            {
                captures += 1;
            }

            if (teams && crowd === '')
            {
                const fault = crowded(state);

                crowd = fault === '' ? '' : `turn ${ turns }: ${ fault }`;
            }

            turns += 1;
        }

        ok('the game reaches a winner', state.finishedAt !== undefined, `after ${ turns } turns`);
        ok('and names one', state.winner !== undefined, `seat ${ state.winner }`);
        ok('the server rolled every die', rolls > 0, `${ rolls } rolls`);

        allCaptures += captures;
        console.log(`        (${ captures } captures this game)`);

        const replay = await players[0].get(`/matches/${ matchId }/since?rev=0`);
        ok('the whole game can be read back', replay.status === 200 && replay.body.events.length === state.rev,
            `${ replay.body?.events?.length } events for ${ state.rev } revisions`);

        const logged = (replay.body.events ?? []).reduce((total, entry) => total + (entry.log?.moves?.length ?? 0), 0);
        const named = (replay.body.events ?? []).every((entry) => entry.log?.kind === 'ludo');

        ok('and the log says which game it is, with the turns still in it', named && logged >= state.rev,
            `${ logged } moves across ${ replay.body.events?.length } entries, named ${ named }`);

        if (teams)
        {
            const entries = (replay.body.events ?? []).map((entry) => entry.log?.moves ?? []);
            const moves = entries.flat();
            const won = state.players.filter((row) => row.result === 'won').map((row) => row.seat).sort();
            const lost = state.players.filter((row) => row.result === 'lost').map((row) => row.seat).sort();
            const sent = moves.filter((move) => move.e === 'capture');
            const last = moves.at(-1);
            const owned = entries.filter((entry) => entry.some((move) => move.owner !== undefined && move.owner !== move.seat)).length;

            lent += owned;
            met += partnered;

            ok('both partners won and both of the other side lost',
                won.length === 2 && lost.length === 2 && partnerOf(won[0], PAIRED) === won[1] && partnerOf(lost[0], PAIRED) === lost[1],
                `won ${ won.join(' ') }, lost ${ lost.join(' ') }`);
            ok('the finish in the log names the side and both of its seats',
                last?.e === 'finish' && last.side === sideOf(won[0], PAIRED) && [...(last.seats ?? [])].sort().join(' ') === won.join(' '),
                JSON.stringify(last));
            ok('nothing was sent home by its own side',
                sent.every((move) => sideOf(move.victim, PAIRED) !== sideOf(move.seat, PAIRED)),
                `${ sent.length } captures`);
            ok('nobody moved a token of the other side',
                moves.every((move) => move.owner === undefined || sideOf(move.owner, PAIRED) === sideOf(move.seat, PAIRED)));
            ok('a pair stood on the ring while the other side had a roll to play', stood > 0, `${ stood } rolls`);
            ok('and no roll was offered a move onto a pair of the other side or past one', offered === '',
                offered === '' ? `${ blocked } tokens held back, ${ partnered } of them by nothing but a pair of two colours` : offered);
            ok('no square ever held three tokens of one side, and no open square both sides', crowd === '', crowd);
            ok('the log names the owner of every token a partner moved', owned === helped, `${ owned } in the log, ${ helped } played`);
            console.log(`        (${ helped } moves of a partner's token this game)`);
        }

        const after = await players[0].post(`/matches/${ matchId }/play`, { key: `late-${ Date.now() }`, play: ROLL });
        ok('a finished game refuses another turn', after.status >= 400, `${ after.status }`);

        const retry = await players[0].get(`/matches/${ matchId }`);
        ok('and still reads back', retry.status === 200 && retry.body.finishedAt !== undefined);

        console.log('');
    }

    ok('a seat whose four were home moved its partner\'s tokens', lent > 0, `${ lent } moves`);
    ok('a pair of two colours held a token of the other side back with nothing else in its way', met > 0, `${ met } tokens`);
    ok('tokens were sent home somewhere across the games', allCaptures > 0, `${ allCaptures } captures`);

    console.log('------------------------------------------');
    console.log(failures === 0 ? `ludo pass: clean, ${ checks } checks` : `ludo pass: ${ failures } of ${ checks } FAILED`);

    process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
