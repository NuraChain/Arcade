import { FINISHED, RING_STEPS, YARD, cellAt, coloursFor } from '../../backend/src/domains/match/ludo/board.ts';
import { apply } from '../../backend/src/domains/match/ludo/engine.ts';
import { ludoEngine } from '../../backend/src/domains/match/engines/ludo.ts';
import { DROP } from '../../frontend/src/game/board/ludo-board.ts';
import { pathBetween } from '../../frontend/src/game/board/path.ts';
import { BLOCK, CELL, HOME_SCALE, MARGIN, stackSpot } from '../../frontend/src/game/layout.ts';
import { homeAt, keyOf, nestAt } from '../../frontend/src/game/ludo-felt.ts';

const UNITS = 1000;

const NEAR = 2;

const STIRRED = 0.5;

const round = (value) => Math.round(value * 10) / 10;

export const EMPTY = [YARD, YARD, YARD, YARD];

export { FINISHED, YARD, keyOf };

const footOf = (place, dx = 0, dy = 0) => ({
    x: (MARGIN + (place.col + 0.5 + dx) * CELL) * UNITS,
    y: (MARGIN + (place.row + 0.5 + DROP + dy) * CELL) * UNITS
});

export const standOf = (colour, progress) => footOf(cellAt(colour, progress));

const squareOf = (place) => ({
    left: (MARGIN + place.col * CELL) * UNITS,
    top: (MARGIN + place.row * CELL) * UNITS,
    size: CELL * UNITS
});

export function standing(pieces, die = null, more = {})
{
    const colours = coloursFor(pieces.length);

    return {
        v: 1,
        game: 'ludo',
        players: pieces.map((row, seat) => ({ seat, colour: colours[seat], pieces: [...row], out: more.out?.includes(seat) ?? false, side: more.sides?.[seat] ?? seat })),
        turn: more.turn ?? 0,
        die,
        sixes: more.sixes ?? (die === 6 ? 1 : 0),
        rev: more.rev ?? 1,
        winner: null
    };
}

export function stepped(state, action)
{
    const outcome = apply(state, action);

    if (!outcome.ok)
    {
        throw new Error(`the engine refused ${ JSON.stringify(action) }: ${ outcome.reason }`);
    }

    return { state: outcome.state, events: outcome.events };
}

const winnersOf = (state) => (state.winner === null ? [] : state.players.filter((player) => player.side === state.winner).map((player) => player.colour));

export const sceneOf = (state, more = {}) => ({
    rev: state.rev,
    view: ludoEngine.view(state, null),
    turn: ludoEngine.turnOf(state) ?? undefined,
    winners: winnersOf(state),
    ...more
});

const pawnsIn = (state) => state.players.flatMap((player) => player.pieces.map((progress, piece) => ({
    key: keyOf(player.seat, piece),
    owner: player.seat,
    piece,
    colour: player.colour,
    side: player.side,
    progress
})));

export const stateOf = (view) => ({
    players: view.seats.map((seat) => ({
        seat: seat.seat,
        colour: seat.colour,
        side: seat.side,
        out: seat.out,
        pieces: [...seat.tokens].sort((one, other) => one.piece - other.piece).map((token) => token.at)
    }))
});

const onSquare = (pawn) => pawn.progress !== YARD && pawn.progress < FINISHED;

const sameCell = (one, other) => one.col === other.col && one.row === other.row;

function restsOf(state)
{
    const pawns = pawnsIn(state);
    const out = new Map();

    for (const pawn of pawns)
    {
        if (pawn.progress === YARD)
        {
            out.set(pawn.key, { where: 'a seat in its yard', scale: 1, any: [0, 1, 2, 3].map((seat) => footOf(nestAt(pawn.colour, seat))), shared: `${ pawn.colour } yard` });
            continue;
        }

        if (pawn.progress >= FINISHED)
        {
            out.set(pawn.key, { where: 'a place in its home', scale: HOME_SCALE, any: [0, 1, 2, 3].map((slot) => footOf(homeAt(pawn.colour, slot))), shared: `${ pawn.colour } home` });
            continue;
        }

        const cell = cellAt(pawn.colour, pawn.progress);
        const around = pawns
            .filter((one) => onSquare(one) && sameCell(cellAt(one.colour, one.progress), cell))
            .sort((one, other) => one.owner - other.owner || one.piece - other.piece);
        const index = around.findIndex((one) => one.key === pawn.key);
        const block = around.length === BLOCK.length && around.every((one) => one.side === pawn.side && one.progress < RING_STEPS);
        const stood = block ? BLOCK[index] : stackSpot(index, around.length);

        out.set(pawn.key, { where: `square ${ cell.col }, ${ cell.row }`, scale: stood.scale, any: [footOf(cell, stood.dx, stood.dy)], shared: null });
    }

    return out;
}

export function differs(drawn, state, near = NEAR)
{
    const wanted = restsOf(state);
    const wrong = [];
    const taken = new Map();

    for (const [key, want] of wanted)
    {
        const seen = drawn.find((one) => one.key === key);

        if (seen === undefined)
        {
            wrong.push(`${ key } is not drawn`);
            continue;
        }

        const at = want.any.findIndex((spot) => Math.hypot(spot.x - seen.x, spot.y - seen.y) <= near);

        if (at === -1)
        {
            const nearest = want.any.reduce((best, spot) => Math.min(best, Math.hypot(spot.x - seen.x, spot.y - seen.y)), Infinity);

            wrong.push(`${ key } stands at ${ round(seen.x) }, ${ round(seen.y) }, ${ round(nearest) } from ${ want.where }`);
            continue;
        }

        if (Math.abs(seen.scale - want.scale) > 0.01)
        {
            wrong.push(`${ key } is drawn at ${ seen.scale } of its size on ${ want.where }, not ${ want.scale }`);
        }

        if (want.shared !== null)
        {
            const place = `${ want.shared } ${ at }`;

            if (taken.has(place))
            {
                wrong.push(`${ key } and ${ taken.get(place) } stand in one place of the ${ want.shared }`);
            }

            taken.set(place, key);
        }
    }

    for (const seen of drawn)
    {
        if (!wanted.has(seen.key))
        {
            wrong.push(`${ seen.key } is drawn and belongs to nobody`);
        }
    }

    return wrong;
}

export function inside(drawn, state)
{
    const wrong = [];
    const pawns = pawnsIn(state).filter(onSquare);
    const alone = (pawn) => pawns.filter((one) => sameCell(cellAt(one.colour, one.progress), cellAt(pawn.colour, pawn.progress))).length === 1;

    for (const pawn of pawns.filter(alone))
    {
        const seen = drawn.find((one) => one.key === pawn.key);
        const box = squareOf(cellAt(pawn.colour, pawn.progress));

        if (seen !== undefined && (seen.x < box.left || seen.x > box.left + box.size || seen.y < box.top + box.size / 2 || seen.y > box.top + box.size))
        {
            wrong.push(`${ pawn.key } has its foot at ${ round(seen.x) }, ${ round(seen.y) }, outside the lower half of its square`);
        }
    }

    return wrong;
}

const pointOf = (rests, key) =>
{
    const found = rests.find((one) => one.key === key);

    return found === undefined ? null : { x: found.x, y: found.y };
};

export function planOf(before, events, restBefore, restAfter)
{
    const pawns = pawnsIn(before);
    const routes = new Map();
    const squares = [];
    const lost = [];

    for (const event of events)
    {
        if (event.e === 'forfeit')
        {
            for (const pawn of pawns.filter((one) => one.owner === event.seat))
            {
                const start = pointOf(restBefore, pawn.key);
                const end = pointOf(restAfter, pawn.key);

                if (start !== null && end !== null && Math.hypot(end.x - start.x, end.y - start.y) > STIRRED)
                {
                    routes.set(pawn.key, [start, end]);
                }
            }

            continue;
        }

        if (event.e !== 'enter' && event.e !== 'step' && event.e !== 'capture')
        {
            continue;
        }

        const key = event.e === 'capture' ? keyOf(event.victim, event.victimPiece) : keyOf(event.owner, event.piece);
        const pawn = pawns.find((one) => one.key === key);
        const start = pointOf(restBefore, key);
        const end = pointOf(restAfter, key);

        if (pawn === undefined || start === null || end === null)
        {
            lost.push(key);
            continue;
        }

        if (event.e === 'capture')
        {
            routes.set(key, [start, end]);
            continue;
        }

        const from = event.e === 'enter' ? YARD : event.from;
        const to = event.e === 'enter' ? 0 : event.to;
        const way = pathBetween(pawn.colour, from, to);

        routes.set(key, [start, ...way.map((cell) => footOf(cell)), end]);

        if (from !== YARD)
        {
            squares.push(cellAt(pawn.colour, from));
        }

        if (way.length > 0)
        {
            squares.push(way[way.length - 1]);
        }
    }

    const shifted = [];
    const strangers = [];

    for (const one of restBefore)
    {
        const end = pointOf(restAfter, one.key);

        if (routes.has(one.key) || end === null || Math.hypot(end.x - one.x, end.y - one.y) <= STIRRED)
        {
            continue;
        }

        const pawn = pawns.find((other) => other.key === one.key);
        const cell = pawn === undefined || !onSquare(pawn) ? null : cellAt(pawn.colour, pawn.progress);

        routes.set(one.key, [{ x: one.x, y: one.y }, end]);

        if (cell !== null && squares.some((square) => sameCell(square, cell)))
        {
            shifted.push(one.key);
        }
        else
        {
            strangers.push(one.key);
        }
    }

    return { routes, shifted, strangers, lost };
}

const standsOn = (pawns, cell) => pawns.filter((one) => onSquare(one) && sameCell(cellAt(one.colour, one.progress), cell));

export function plainWalkIn(view, seat, least = 2)
{
    const pawns = pawnsIn(stateOf(view));

    if (view.die === undefined || view.die < least)
    {
        return null;
    }

    for (const piece of view.moves)
    {
        const pawn = pawns.find((one) => one.owner === seat && one.piece === piece);
        const to = pawn === undefined ? FINISHED : pawn.progress + view.die;

        if (pawn === undefined || !onSquare(pawn) || to >= FINISHED)
        {
            continue;
        }

        if (standsOn(pawns, cellAt(pawn.colour, pawn.progress)).length === 1 && standsOn(pawns, cellAt(pawn.colour, to)).length === 0)
        {
            return { key: pawn.key, piece, hops: view.die, events: [{ e: 'step', seat, owner: seat, piece, from: pawn.progress, to }] };
        }
    }

    return null;
}

export function plainEntryIn(view, seat)
{
    const pawns = pawnsIn(stateOf(view));
    const waiting = pawns.filter((one) => one.owner === seat && one.progress === YARD).sort((one, other) => one.piece - other.piece);
    const first = waiting[0];

    if (view.die !== 6 || first === undefined || !view.moves.includes(first.piece) || standsOn(pawns, cellAt(first.colour, 0)).length > 0)
    {
        return null;
    }

    return { key: first.key, piece: first.piece, hops: 1, events: [{ e: 'enter', seat, owner: seat, piece: first.piece }] };
}

export function endingIn(view, seat)
{
    const own = pawnsIn(stateOf(view)).filter((one) => one.owner === seat);
    const last = own.filter((one) => one.progress < FINISHED);

    if (view.die === undefined || last.length !== 1 || last[0].progress === YARD || last[0].progress + view.die !== FINISHED || !view.moves.includes(last[0].piece))
    {
        return null;
    }

    return { key: last[0].key, piece: last[0].piece, hops: FINISHED - 1 - last[0].progress, events: [{ e: 'step', seat, owner: seat, piece: last[0].piece, from: last[0].progress, to: FINISHED }] };
}

export function leadIn(view, seat)
{
    const own = pawnsIn(stateOf(view)).filter((one) => one.owner === seat && view.moves.includes(one.piece));

    return own.sort((one, other) => other.progress - one.progress || one.piece - other.piece)[0]?.piece ?? null;
}

export function retreatOf(state, key, stood, restThere, restHome)
{
    const pawn = pawnsIn(state).find((one) => one.key === key);
    const start = pointOf(restThere, key);
    const end = pointOf(restHome, key);

    if (pawn === undefined || start === null || end === null)
    {
        return null;
    }

    const way = pawn.progress === YARD ? [] : pathBetween(pawn.colour, pawn.progress, stood).slice(0, -1).reverse();

    return [start, ...way.map((cell) => footOf(cell)), end];
}

export async function dieOf(page, within = '.board-canvas')
{
    return await page.evaluate((chosen) =>
    {
        const holder = document.querySelector(`${ chosen } .lb-die`);
        const die = holder?.querySelector('.die3d') ?? null;
        const frame = document.querySelector(chosen)?.getBoundingClientRect();

        if (die === null || frame === undefined || frame.width === 0)
        {
            return null;
        }

        const body = die.querySelector('.die3d-body');
        const box = body.getBoundingClientRect();

        return {
            key: die.dataset.key ?? '',
            hidden: holder.hidden,
            hand: holder.hasAttribute('data-hand'),
            rattle: holder.hasAttribute('data-rattle'),
            spent: die.getAttribute('data-spent'),
            air: die.hasAttribute('data-air'),
            shown: Number(die.dataset.face),
            transform: getComputedStyle(body).transform,
            x: (box.x + box.width / 2 - frame.x) / frame.width * 1000,
            y: (box.y + box.height / 2 - frame.y) / frame.width * 1000
        };
    }, within);
}

export async function pawnsOf(page, within = '.board-canvas')
{
    return await page.evaluate((chosen) =>
    {
        const frame = document.querySelector(chosen)?.getBoundingClientRect();

        if (frame === undefined || frame.width === 0)
        {
            return [];
        }

        return [...document.querySelectorAll(`${ chosen } .lp`)].map((node) =>
        {
            const box = node.getBoundingClientRect();
            const scale = getComputedStyle(node).scale;

            return {
                key: node.dataset.key ?? '',
                colour: node.dataset.colour ?? '',
                x: (box.x - frame.x) / frame.width * 1000,
                y: (box.y - frame.y) / frame.width * 1000,
                scale: scale === 'none' ? 1 : Number(scale.split(' ')[0]),
                moving: node.hasAttribute('data-moving'),
                lit: node.hasAttribute('data-movable'),
                home: node.hasAttribute('data-home')
            };
        });
    }, within);
}
