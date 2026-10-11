import { START, pips } from '../../../backend/src/domains/match/backgammon/board.ts';
import { countsOf, fromCounts, moved, same, settle, type Move, type Moved, type Side, type Table, type Transfer } from './backgammon-men.ts';
import { hashOf } from './stage/curves.ts';

export interface Cube
{
    on: boolean;
    value: number;
    owner: Side | null;
}

export interface Score
{
    near: number;
    far: number;
}

export interface Felt
{
    viewer: number;
    near: readonly number[];
    far: readonly number[];
    dice: readonly number[];
    spent: readonly boolean[];
    seed: number;
    cube: Cube;
    score: Score;
    round: number;
}

export interface Shown
{
    viewer: number;
    men: Table;
    dice: readonly number[];
    cube: Cube;
    score: Score;
    round: number;
}

export interface Position
{
    dice: readonly number[];
    seats: readonly { seat: number; checkers: readonly number[]; score: number }[];
    cubed: boolean;
    cube: number;
    owner?: number;
    round: number;
}

export interface Told
{
    e: string;
    seat?: number;
    dice?: readonly number[];
    from?: number;
    to?: number;
    die?: number;
    hit?: boolean;
    cube?: number;
    how?: string;
    points?: number;
}

export type Beat =
    | { kind: 'cast'; sides: readonly Side[]; faces: readonly number[]; nth: number }
    | { kind: 'hop'; move: Move; die: number }
    | { kind: 'pass'; side: Side }
    | { kind: 'clear' }
    | { kind: 'offer'; side: Side; value: number }
    | { kind: 'take'; side: Side; value: number }
    | { kind: 'drop'; side: Side }
    | { kind: 'game'; side: Side; how: string; points: number; last: boolean }
    | { kind: 'rack' }
    | { kind: 'finish'; side: Side };

export interface Stepped
{
    shown: Shown;
    moved: Moved | null;
    transfers: readonly Transfer[];
}

const NOBODY: readonly Transfer[] = [];

export const seedOf = (id: string, rev: number, nth = 0) => hashOf(id, rev, nth);

const twice = (faces: readonly number[]) => faces.length === 2 && faces[0] === faces[1];

export function feltOf(position: Position, viewer: number, over: boolean, seed: number): Felt
{
    const rowOf = (seat: number) => position.seats.find((row) => row.seat === seat)?.checkers ?? [];
    const scoreOf = (seat: number) => position.seats.find((row) => row.seat === seat)?.score ?? 0;
    const dice = over ? [] : position.dice.slice(0, 2);

    return {
        viewer,
        near: rowOf(viewer),
        far: rowOf(1 - viewer),
        dice,
        spent: spentBy(dice, []),
        seed,
        cube: {
            on: position.cubed,
            value: position.cube,
            owner: position.owner === undefined ? null : (position.owner === viewer ? 'near' : 'far')
        },
        score: { near: scoreOf(viewer), far: scoreOf(1 - viewer) },
        round: position.round
    };
}

export function shownOf(felt: Felt, serial = 0): Shown
{
    return {
        viewer: felt.viewer,
        men: fromCounts({ near: felt.near, far: felt.far }, serial),
        dice: [...felt.dice],
        cube: felt.cube,
        score: { ...felt.score },
        round: felt.round
    };
}

export function pipsOf(men: Table): Score
{
    const counts = countsOf(men);

    return { near: pips(counts.near), far: pips(counts.far) };
}

export function sameAs(shown: Shown, felt: Felt)
{
    return shown.viewer === felt.viewer
        && same(shown.men, { near: felt.near, far: felt.far })
        && shown.dice.join() === felt.dice.join()
        && shown.cube.on === felt.cube.on
        && shown.cube.value === felt.cube.value
        && shown.cube.owner === felt.cube.owner
        && shown.score.near === felt.score.near
        && shown.score.far === felt.score.far
        && shown.round === felt.round;
}

export function beatsOf(moves: readonly Told[], viewer: number)
{
    const beats: Beat[] = [];
    const sideOf = (seat: number | undefined): Side => (seat === viewer ? 'near' : 'far');
    let fresh = false;
    let cleared = false;

    const clear = () =>
    {
        if (!cleared)
        {
            beats.push({ kind: 'clear' });
            cleared = true;
        }
    };

    for (const [index, move] of moves.entries())
    {
        const side = sideOf(move.seat);

        if (move.e === 'opening' && move.dice !== undefined)
        {
            beats.push({ kind: 'cast', sides: [sideOf(0), sideOf(1)], faces: move.dice, nth: 0 });
            fresh = true;
            cleared = false;
        }
        else if (move.e === 'roll' && move.dice !== undefined)
        {
            beats.push({ kind: 'cast', sides: [side, side], faces: move.dice, nth: 0 });
            fresh = true;
            cleared = false;
        }
        else if (move.e === 'move' && move.from !== undefined && move.to !== undefined)
        {
            beats.push({ kind: 'hop', move: { side, from: move.from, to: move.to, hit: move.hit === true }, die: move.die ?? 0 });
            fresh = false;
        }
        else if (move.e === 'pass')
        {
            beats.push({ kind: 'pass', side });
            fresh = false;
        }
        else if (move.e === 'double')
        {
            beats.push({ kind: 'offer', side, value: move.cube ?? 2 });
        }
        else if (move.e === 'take')
        {
            beats.push({ kind: 'take', side, value: move.cube ?? 2 });
        }
        else if (move.e === 'drop')
        {
            beats.push({ kind: 'drop', side });
        }
        else if (move.e === 'game')
        {
            const last = moves[index + 1]?.e === 'finish';

            clear();
            beats.push({ kind: 'game', side, how: move.how ?? 'single', points: move.points ?? 1, last });
            fresh = false;

            if (!last)
            {
                beats.push({ kind: 'rack' });
            }
        }
        else if (move.e === 'finish')
        {
            clear();
            beats.push({ kind: 'finish', side });
            fresh = false;
        }
    }

    if (!fresh)
    {
        clear();
    }

    let after = 0;

    for (let index = beats.length - 1; index >= 0; index -= 1)
    {
        const beat = beats[index];

        if (beat.kind === 'cast')
        {
            beat.nth = after;
            after += 1;
        }
    }

    return beats;
}

export function step(shown: Shown, beat: Beat): Stepped
{
    if (beat.kind === 'cast')
    {
        return { shown: { ...shown, dice: [...beat.faces] }, moved: null, transfers: NOBODY };
    }

    if (beat.kind === 'clear')
    {
        return { shown: { ...shown, dice: [] }, moved: null, transfers: NOBODY };
    }

    if (beat.kind === 'hop')
    {
        const result = moved(shown.men, beat.move);

        return result === null
            ? { shown, moved: null, transfers: NOBODY }
            : { shown: { ...shown, men: result.table }, moved: result, transfers: NOBODY };
    }

    if (beat.kind === 'take')
    {
        return { shown: { ...shown, cube: { on: shown.cube.on, value: beat.value, owner: beat.side } }, moved: null, transfers: NOBODY };
    }

    if (beat.kind === 'game')
    {
        return { shown: { ...shown, score: { ...shown.score, [beat.side]: shown.score[beat.side] + beat.points } }, moved: null, transfers: NOBODY };
    }

    if (beat.kind === 'rack')
    {
        const racked = settle(shown.men, { near: START, far: START });

        return {
            shown: { ...shown, men: racked.table, cube: { on: shown.cube.on, value: 1, owner: null }, round: shown.round + 1 },
            moved: null,
            transfers: racked.transfers
        };
    }

    return { shown, moved: null, transfers: NOBODY };
}

export function spentBy(faces: readonly number[], used: readonly number[])
{
    if (twice(faces))
    {
        return [0, 1, 2, 3].map((nth) => nth < used.length);
    }

    const left = [...used];

    return faces.map((face) =>
    {
        const at = left.indexOf(face);

        if (at < 0)
        {
            return false;
        }

        left.splice(at, 1);

        return true;
    });
}
