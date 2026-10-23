import { squareNamed } from '../../backend/src/domains/match/chess/board.ts';
import { legalMoves } from '../../backend/src/domains/match/chess/moves.ts';
import { sanOf } from '../../backend/src/domains/match/chess/san.ts';
import { tableBody } from './tables.mjs';
import { signInWallet } from './wallets.mjs';

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

const player = async (name) =>
{
    const who = session();

    who.handle = (await signInWallet(who.post, name)).handle;

    return who;
};

let made = 0;

/** A chess table of two made for the run, both seated and ready, and its game started. */
const opened = async (label, mode) =>
{
    made += 1;

    const players = [await player(`Shah ${ made }a`), await player(`Shah ${ made }b`)];
    const table = await players[0].post('/tables/', tableBody({ game: 'chess', seats: 2, mode, privacy: 'public', ...(mode === 'live' ? { clock: '10+0' } : {}) }));

    if (!ok(`${ label }: the table opens`, table.status === 200, `${ table.status } ${ table.text.slice(0, 160) }`))
    {
        return null;
    }

    const sat = await players[1].post(`/tables/${ table.body.id }/seat`);

    ok(`${ label }: the second player takes the other chair`, sat.status === 200);

    for (const one of players)
    {
        await one.post(`/tables/${ table.body.id }/ready`, { ready: true });
    }

    const started = await players[0].post(`/tables/${ table.body.id }/start`);

    if (!ok(`${ label }: the game starts`, started.status === 200, `${ started.status } ${ started.text.slice(0, 160) }`))
    {
        return null;
    }

    const id = started.body.id;
    const bySeat = new Map();

    for (const one of players)
    {
        bySeat.set((await one.get(`/matches/${ id }`)).body.mine, one);
    }

    const read = async () => (await players[0].get(`/matches/${ id }`)).body;
    const first = await read();
    const white = bySeat.get(first.view.white);
    const black = bySeat.get(1 - first.view.white);
    let keys = 0;
    let disagreements = 0;

    /** Plays a move by its SAN for the side to move, found among the legal moves of the position the server holds. */
    const play = async (san) =>
    {
        const match = await read();
        const view = match.view;
        const position = { board: view.board, turn: view.turn, castling: view.castling, ep: view.ep ?? null, halfmove: view.halfmove, fullmove: view.fullmove };
        const legal = legalMoves(position);
        const move = legal.find((one) => sanOf(one, legal) === san.replace(/[+#]$/, ''));

        if (move === undefined)
        {
            return { status: 0, text: `${ san } is not a legal move here` };
        }

        const mover = view.turn === 'w' ? white : black;
        keys += 1;

        const answer = await mover.post(`/matches/${ id }/play`, {
            key: `${ id }-${ keys }`,
            rev: match.rev,
            play: { kind: 'chess', verb: 'move', from: move.from, to: move.to, ...(move.promotion === undefined ? {} : { promotion: move.promotion }) }
        });
        const views = await Promise.all(players.map((one) => one.get(`/matches/${ id }`)));

        disagreements += JSON.stringify(views[0].body.view) === JSON.stringify(views[1].body.view) ? 0 : 1;

        return answer;
    };

    /** Plays every move of a line, and says so once, naming the first that was not taken. */
    const line = async (sans, what) =>
    {
        for (const san of sans)
        {
            const answer = await play(san);

            if (answer.status !== 200 || answer.body?.applied !== 'now')
            {
                return ok(`${ label }: ${ what }`, false, `${ san } answered ${ answer.status } ${ answer.text.slice(0, 160) }`);
            }
        }

        return ok(`${ label }: ${ what }`, true, `${ sans.length } moves`);
    };

    const send = async (by, verb) =>
    {
        keys += 1;

        return by.post(`/matches/${ id }/play`, { key: `${ id }-${ keys }`, rev: (await read()).rev, play: { kind: 'chess', verb } });
    };

    const resign = async (by) =>
    {
        keys += 1;

        return by.post(`/matches/${ id }/resign`, { key: `${ id }-${ keys }` });
    };

    return { id, players, white, black, read, play, line, send, resign, agreed: () => disagreements === 0 };
};

const at = (board, name) => board[squareNamed(name)];

const LEGAL = ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'];

const mate = async () =>
{
    console.log('\n[a mate in seven at a live table, and what it refuses]');

    const game = await opened('mate', 'live');

    if (game === null)
    {
        return;
    }

    const stranger = await player('Shah nosy');
    const peek = await stranger.get(`/matches/${ game.id }`);

    ok('mate: somebody not playing is answered as if the game does not exist', peek.status === 404, `${ peek.status }`);

    const early = await game.black.post(`/matches/${ game.id }/play`, { key: `${ game.id }-early`, play: { kind: 'chess', verb: 'move', from: squareNamed('e7'), to: squareNamed('e5') } });

    ok('mate: Black moving first is told it is not their turn', early.status === 403 && early.body?.error?.code === 'not-your-turn', `${ early.status } ${ early.body?.error?.code }`);

    const wrong = await game.white.post(`/matches/${ game.id }/play`, { key: `${ game.id }-wrong`, play: { kind: 'chess', verb: 'move', from: squareNamed('e2'), to: squareNamed('e5') } });

    ok('mate: a move the rules do not allow is refused as one', wrong.status === 409 && wrong.body?.error?.code === 'illegal-move', `${ wrong.status } ${ wrong.body?.error?.code }`);

    await game.line(LEGAL.slice(0, 2), 'the first moves are played');

    const flag = await game.send(game.black, 'flag');

    ok('mate: a flag claimed while the clock has time left is refused', flag.status === 409 && flag.body?.error?.code === 'time-left', `${ flag.status } ${ flag.body?.error?.code }`);

    await game.line(LEGAL.slice(2), 'the rest of the moves are played');

    const end = await game.read();
    const whiteSeat = end.view.white;

    ok('mate: it ends in checkmate, won by White', end.finishedAt !== undefined && end.view.over?.reason === 'checkmate' && end.view.over?.winner === whiteSeat, JSON.stringify(end.view.over));
    ok('mate: White won and Black lost, in both results', end.players.find((one) => one.seat === whiteSeat)?.result === 'won' && end.players.find((one) => one.seat !== whiteSeat)?.result === 'lost');
    ok('mate: the board carries every move as it was played, the check and the mate marked', JSON.stringify(end.view.notation) === JSON.stringify(LEGAL), end.view.notation.join(' '));
    ok('mate: both players read the same board after every move', game.agreed());

    const after = await game.white.post(`/matches/${ game.id }/play`, { key: `${ game.id }-after`, play: { kind: 'chess', verb: 'move', from: squareNamed('a2'), to: squareNamed('a3') } });

    ok('mate: a move after the end is refused as the game being over', after.status === 409 && after.body?.error?.code === 'game-over', `${ after.status } ${ after.body?.error?.code }`);

    const history = await game.white.get('/matches/history');

    ok('mate: the game is in the winner history', history.status === 200 && history.body.matches.some((one) => one.id === game.id));
};

const castling = async () =>
{
    console.log('\n[castling both ways, at a game a move a day]');

    const game = await opened('castling', 'turns');

    if (game === null)
    {
        return;
    }

    await game.line(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'], 'White castles king-side');

    let board = (await game.read()).view;

    ok('castling: the king stands on g1 and the rook on f1, and White keeps no right to castle', at(board.board, 'g1') === 'K' && at(board.board, 'f1') === 'R' && !/[KQ]/.test(board.castling), `${ board.castling }`);

    await game.line(['d6', 'd3', 'Be6', 'Nc3', 'Qd7', 'a3', 'O-O-O'], 'Black castles queen-side');

    board = (await game.read()).view;

    ok('castling: the king stands on c8 and the rook on d8, and nobody can castle again', at(board.board, 'c8') === 'k' && at(board.board, 'd8') === 'r' && board.castling === '', `${ board.castling }`);
    ok('castling: the board writes them as O-O and O-O-O', board.notation.includes('O-O') && board.notation.includes('O-O-O'));

    const resigned = await game.resign(game.white);
    const end = await game.read();

    ok('castling: a resignation once both have moved is a loss, and a win for the other side', resigned.status === 200 && end.view.over?.reason === 'resign' && end.view.over?.winner === 1 - end.view.white, JSON.stringify(end.view.over));
};

const passing = async () =>
{
    console.log('\n[a pawn taken in passing, and a draw offered, declined by a move and agreed]');

    const game = await opened('passing', 'live');

    if (game === null)
    {
        return;
    }

    await game.line(['e4', 'a6', 'e5', 'd5', 'exd6'], 'the pawn is taken in passing');

    let view = (await game.read()).view;

    ok('passing: the pawn that passed is gone from d5 and the taker stands on d6', at(view.board, 'd5') === '.' && at(view.board, 'd6') === 'P' && view.notation.at(-1) === 'exd6');

    const offer = await game.send(game.white, 'offer');

    view = (await game.read()).view;

    ok('passing: White offers a draw', offer.status === 200 && view.offer === view.white, `${ offer.status } offer ${ view.offer }`);

    await game.line(['cxd6'], 'Black plays on instead of answering');

    view = (await game.read()).view;

    ok('passing: a move made instead declines the offer', view.offer === undefined, `offer ${ view.offer }`);

    const again = await game.send(game.white, 'offer');

    ok('passing: White cannot offer again before moving', again.status === 409, `${ again.status } ${ again.body?.error?.code }`);

    await game.line(['Nf3'], 'White moves');

    const next = await game.send(game.white, 'offer');
    const accepted = await game.send(game.black, 'accept');
    const end = await game.read();

    ok('passing: an offer after a move stands, and accepted it ends the game drawn', next.status === 200 && accepted.status === 200 && end.view.over?.reason === 'agreement' && end.view.over?.winner === undefined, JSON.stringify(end.view.over));
    ok('passing: both players drew', end.outcome === 'drawn' && end.players.every((one) => one.result === 'drawn'), `${ end.outcome } ${ end.players.map((one) => one.result).join(',') }`);
};

const promotions = async () =>
{
    for (const piece of ['Q', 'R', 'B', 'N'])
    {
        console.log(`\n[a pawn becomes a ${ piece }]`);

        const game = await opened(`promotion ${ piece }`, 'live');

        if (game === null)
        {
            continue;
        }

        await game.line(['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6'], 'the pawn walks to the seventh rank');

        if (piece === 'Q')
        {
            const match = await game.read();
            const bare = await game.white.post(`/matches/${ game.id }/play`, { key: `${ game.id }-bare`, rev: match.rev, play: { kind: 'chess', verb: 'move', from: squareNamed('b7'), to: squareNamed('a8') } });

            ok('promotion: a pawn reaching the last rank with no piece named is refused, saying a piece is needed', bare.status === 409 && bare.body?.error?.code === 'promotion-needed', `${ bare.status } ${ bare.body?.error?.code }`);
        }

        await game.line([`bxa8=${ piece }`], `it takes the rook and becomes a ${ piece }`);

        const view = (await game.read()).view;

        ok(`promotion ${ piece }: the new piece stands on a8`, at(view.board, 'a8') === piece && view.notation.at(-1)?.startsWith(`bxa8=${ piece }`), `${ at(view.board, 'a8') } ${ view.notation.at(-1) }`);

        await game.resign(game.black);
    }
};

const stalemate = async () =>
{
    console.log('\n[Loyd\'s stalemate in ten]');

    const game = await opened('stalemate', 'live');

    if (game === null)
    {
        return;
    }

    await game.line(['e3', 'a5', 'Qh5', 'Ra6', 'Qxa5', 'h5', 'h4', 'Rah6', 'Qxc7', 'f6', 'Qxd7+', 'Kf7', 'Qxb7', 'Qd3', 'Qxb8', 'Qh7', 'Qxc8', 'Kg6', 'Qe6'], 'the game is played to a stalemate');

    const end = await game.read();

    ok('stalemate: the side to move has no move and is not in check: a draw', end.view.over?.reason === 'stalemate' && end.outcome === 'drawn' && end.players.every((one) => one.result === 'drawn'), `${ JSON.stringify(end.view.over) } ${ end.outcome }`);
};

const repetition = async () =>
{
    console.log('\n[the same position three times]');

    const game = await opened('repetition', 'live');

    if (game === null)
    {
        return;
    }

    await game.line(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'], 'the knights go out and back twice');

    const end = await game.read();

    ok('repetition: the third time the position stands the game is drawn', end.view.over?.reason === 'repetition' && end.outcome === 'drawn', `${ JSON.stringify(end.view.over) } ${ end.outcome }`);
};

const abort = async () =>
{
    console.log('\n[a game called off before both have moved]');

    const game = await opened('abort', 'live');

    if (game === null)
    {
        return;
    }

    await game.line(['e4'], 'White moves');

    const gone = await game.resign(game.black);
    const end = await game.read();

    ok('abort: giving up before both have moved calls the game off, with no winner', gone.status === 200 && end.view.over?.reason === 'abort' && end.view.over?.winner === undefined, JSON.stringify(end.view.over));
    ok('abort: nobody won or lost it', end.players.every((one) => one.result !== 'won' && one.result !== 'lost'), end.players.map((one) => one.result).join(','));
};

const run = async () =>
{
    console.log(`\nchess pass against ${ BASE }`);

    await mate();
    await castling();
    await passing();
    await promotions();
    await stalemate();
    await repetition();
    await abort();

    console.log(`\n${ checks - failures }/${ checks } checks passed`);
    process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((error) =>
{
    console.error(error);
    process.exitCode = 1;
});
