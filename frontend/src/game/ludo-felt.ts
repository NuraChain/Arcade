import { FINISHED, YARD, cellAt, type LudoColour } from '../../../backend/src/domains/match/ludo/board.ts';
import { HOME_SLOTS, NEST, NEST_SPREAD, NEST_WELLS } from './layout.ts';

export type Fate = 'pending' | 'no-move' | 'three-sixes' | 'wasted';

export interface Pawn
{
    key: string;
    owner: number;
    piece: number;
    colour: LudoColour;
    side: number;
    progress: number;
}

export interface Rolled
{
    roller: number;
    face: number;
    fate: Fate;
}

export interface Felt
{
    pawns: readonly Pawn[];
    out: readonly number[];
    die: Rolled | null;
    winners: readonly string[];
}

export interface Shown
{
    pawns: readonly Pawn[];
    out: readonly number[];
    die: Rolled | null;
}

export interface Position
{
    die?: number;
    seats: readonly {
        seat: number;
        colour: string;
        side: number;
        out: boolean;
        tokens: readonly { piece: number; at: number }[];
    }[];
}

export interface Told
{
    e: string;
    seat?: number;
    owner?: number;
    piece?: number;
    from?: number;
    to?: number;
    victim?: number;
    victimPiece?: number;
    die?: number;
    why?: string;
}

export type Beat =
    | { kind: 'roll'; seat: number; face: number; fate: Fate }
    | { kind: 'move'; key: string; seat: number; from: number; to: number; victims: readonly string[]; home: boolean }
    | { kind: 'forfeit'; seat: number; survives: boolean }
    | { kind: 'finish' };

export interface Place
{
    col: number;
    row: number;
}

export const HISTORY = 4000;

const CORNER: Readonly<Record<string, readonly [number, number]>> = {
    red: [0, 0],
    green: [9, 0],
    yellow: [9, 9],
    blue: [0, 9]
};

export const keyOf = (owner: number, piece: number) => `${ owner }-${ piece }`;

const byKey = (one: Pawn, other: Pawn) => one.owner - other.owner || one.piece - other.piece;

export function nestAt(colour: string, seat: number): Place
{
    const corner = CORNER[colour] ?? CORNER.red;
    const nest = NEST[colour] ?? NEST.red;
    const well = NEST_WELLS[seat] ?? NEST_WELLS[0];

    return {
        col: corner[0] + nest[0] + well[0] * NEST_SPREAD - 0.5,
        row: corner[1] + nest[1] + well[1] * NEST_SPREAD - 0.5
    };
}

export function homeAt(colour: string, slot: number): Place
{
    const slots = HOME_SLOTS[colour] ?? HOME_SLOTS.red;
    const [col, row] = slots[Math.min(Math.max(slot, 0), slots.length - 1)];

    return { col, row };
}

export function placeOf(colour: string, progress: number, seat: number, slot: number): Place
{
    if (progress >= FINISHED)
    {
        return homeAt(colour, slot);
    }

    const cell = progress === YARD ? null : cellAt(colour as LudoColour, progress);

    return cell === null ? nestAt(colour, seat) : { col: cell.col, row: cell.row };
}

export function feltOf(board: Position, turn: number | undefined, winners: readonly string[] = []): Felt
{
    return {
        pawns: board.seats
            .flatMap((seat) => seat.tokens.map((token): Pawn => ({
                key: keyOf(seat.seat, token.piece),
                owner: seat.seat,
                piece: token.piece,
                colour: seat.colour as LudoColour,
                side: seat.side,
                progress: token.at
            })))
            .sort(byKey),
        out: board.seats.filter((seat) => seat.out).map((seat) => seat.seat).sort((one, other) => one - other),
        die: board.die === undefined || turn === undefined ? null : { roller: turn, face: board.die, fate: 'pending' },
        winners
    };
}

export function shownOf(felt: Felt): Shown
{
    return {
        pawns: felt.pawns.map((pawn) => ({ ...pawn })),
        out: [...felt.out],
        die: felt.die === null ? null : { ...felt.die }
    };
}

export function sameAs(shown: Shown, felt: Felt)
{
    return shown.pawns.length === felt.pawns.length
        && shown.pawns.every((pawn, index) => pawn.key === felt.pawns[index].key && pawn.progress === felt.pawns[index].progress)
        && shown.out.join() === felt.out.join()
        && (shown.die?.face ?? 0) === (felt.die?.face ?? 0)
        && (shown.die?.roller ?? -1) === (felt.die?.roller ?? -1);
}

const fateOf = (acts: readonly { moves: readonly Told[] }[], index: number, at: number, sight: Felt): Fate =>
{
    const moves = acts[index].moves;
    const roll = moves[at];
    const pass = moves[at + 1]?.e === 'pass' ? moves[at + 1] : undefined;

    if (pass !== undefined)
    {
        return pass.why === 'three-sixes' ? 'three-sixes' : 'no-move';
    }

    if (roll.die !== 6)
    {
        return 'pending';
    }

    for (const later of acts.slice(index + 1))
    {
        const first = later.moves[0];

        if (first === undefined)
        {
            continue;
        }

        if (first.e === 'roll')
        {
            return first.seat === roll.seat ? 'wasted' : 'pending';
        }

        if (first.e !== 'forfeit' || first.seat === roll.seat || later.moves.some((move) => move.e === 'finish'))
        {
            return 'pending';
        }
    }

    return sight.die === null ? 'wasted' : 'pending';
};

export function beatsOf(acts: readonly { moves: readonly Told[] }[], sight: Felt): Beat[][]
{
    return acts.map((act, index) =>
    {
        const beats: Beat[] = [];
        const moves = act.moves;
        const ends = moves.some((move) => move.e === 'finish');

        for (const [at, move] of moves.entries())
        {
            if (move.e === 'roll' && move.seat !== undefined && move.die !== undefined)
            {
                beats.push({ kind: 'roll', seat: move.seat, face: move.die, fate: fateOf(acts, index, at, sight) });
            }
            else if ((move.e === 'enter' || move.e === 'step') && move.owner !== undefined && move.piece !== undefined)
            {
                beats.push({
                    kind: 'move',
                    key: keyOf(move.owner, move.piece),
                    seat: move.seat ?? move.owner,
                    from: move.e === 'enter' ? YARD : (move.from ?? YARD),
                    to: move.e === 'enter' ? 0 : (move.to ?? 0),
                    victims: moves
                        .filter((one) => one.e === 'capture' && one.victim !== undefined && one.victimPiece !== undefined)
                        .map((one) => keyOf(one.victim as number, one.victimPiece as number)),
                    home: moves.some((one) => one.e === 'home')
                });
            }
            else if (move.e === 'forfeit' && move.seat !== undefined)
            {
                beats.push({ kind: 'forfeit', seat: move.seat, survives: !ends });
            }
            else if (move.e === 'finish')
            {
                beats.push({ kind: 'finish' });
            }
        }

        return beats;
    });
}

export function step(shown: Shown, beat: Beat): Shown
{
    if (beat.kind === 'roll')
    {
        return { ...shown, die: beat.fate === 'pending' ? { roller: beat.seat, face: beat.face, fate: 'pending' } : null };
    }

    if (beat.kind === 'move')
    {
        return {
            ...shown,
            die: null,
            pawns: shown.pawns.map((pawn) =>
            {
                if (pawn.key === beat.key)
                {
                    return { ...pawn, progress: beat.to };
                }

                return beat.victims.includes(pawn.key) ? { ...pawn, progress: YARD } : pawn;
            })
        };
    }

    if (beat.kind === 'forfeit')
    {
        return {
            ...shown,
            out: shown.out.includes(beat.seat) ? shown.out : [...shown.out, beat.seat].sort((one, other) => one - other),
            die: !beat.survives || shown.die?.roller === beat.seat ? null : shown.die,
            pawns: beat.survives ? shown.pawns.map((pawn) => (pawn.owner === beat.seat ? { ...pawn, progress: YARD } : pawn)) : shown.pawns
        };
    }

    return { ...shown, die: null };
}
