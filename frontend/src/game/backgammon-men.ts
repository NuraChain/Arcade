import {
    BAR_GAP,
    BAR_LEFT,
    BAR_WIDTH,
    BOTTOM,
    MIDDLE,
    SLAB,
    STACK_SHOWN,
    TOP,
    TRAY,
    TRAY_LEFT,
    POINT_WIDTH,
    columnOf,
    stackAt
} from './backgammon-layout.ts';

export type Side = 'near' | 'far';

export interface Man
{
    key: string;
    side: Side;
    spot: number;
    order: number;
}

export interface Table
{
    men: readonly Man[];
    serial: number;
}

export interface Counts
{
    near: readonly number[];
    far: readonly number[];
}

export interface Move
{
    side: Side;
    from: number;
    to: number;
    hit: boolean;
}

export interface Moved
{
    table: Table;
    mover: Man;
    knocked: Man | null;
}

export interface Transfer
{
    man: Man;
    from: number;
    to: number;
}

export interface Slot
{
    x: number;
    y: number;
    off: boolean;
    index: number;
}

export const BAR = 25;

export const OFF = 0;

export const SPOTS = 26;

const other = (side: Side): Side => (side === 'near' ? 'far' : 'near');

const sides: readonly Side[] = ['near', 'far'];

export const opposite = (spot: number) => BAR - spot;

export function fromCounts(counts: Counts, serial = 0): Table
{
    const men: Man[] = [];
    let next = serial;

    for (const side of sides)
    {
        const row = counts[side];

        for (let spot = 0; spot < SPOTS; spot += 1)
        {
            for (let at = 0; at < (row[spot] ?? 0); at += 1)
            {
                next += 1;
                men.push({ key: `m${ next }`, side, spot, order: next });
            }
        }
    }

    return { men, serial: next };
}

export function countsOf(table: Table): { near: number[]; far: number[] }
{
    const near = Array.from({ length: SPOTS }, () => 0);
    const far = Array.from({ length: SPOTS }, () => 0);

    for (const man of table.men)
    {
        (man.side === 'near' ? near : far)[man.spot] += 1;
    }

    return { near, far };
}

export function stacked(table: Table, side: Side, spot: number)
{
    return table.men.filter((man) => man.side === side && man.spot === spot).sort((one, two) => one.order - two.order);
}

export function topAt(table: Table, side: Side, spot: number)
{
    const here = stacked(table, side, spot);

    return here.length === 0 ? null : here[here.length - 1];
}

export function indexOf(table: Table, man: Man)
{
    return stacked(table, man.side, man.spot).findIndex((one) => one.key === man.key);
}

const relocate = (table: Table, man: Man, spot: number): { table: Table; man: Man } =>
{
    const serial = table.serial + 1;
    const moved: Man = { ...man, spot, order: serial };

    return { table: { men: table.men.map((one) => (one.key === man.key ? moved : one)), serial }, man: moved };
};

export function moved(table: Table, move: Move): Moved | null
{
    const mover = topAt(table, move.side, move.from);

    if (mover === null)
    {
        return null;
    }

    const blot = move.hit && move.to !== OFF ? topAt(table, other(move.side), opposite(move.to)) : null;
    let next = relocate(table, mover, move.to);
    let knocked: Man | null = null;

    if (blot !== null)
    {
        const sent = relocate(next.table, blot, BAR);

        next = { table: sent.table, man: next.man };
        knocked = sent.man;
    }

    return { table: next.table, mover: next.man, knocked };
}

export function undone(table: Table, move: Move): Moved | null
{
    const mover = topAt(table, move.side, move.to);

    if (mover === null)
    {
        return null;
    }

    let next = relocate(table, mover, move.from);
    let knocked: Man | null = null;

    if (move.hit && move.to !== OFF)
    {
        const blot = topAt(next.table, other(move.side), BAR);

        if (blot !== null)
        {
            const back = relocate(next.table, blot, opposite(move.to));

            next = { table: back.table, man: next.man };
            knocked = back.man;
        }
    }

    return { table: next.table, mover: next.man, knocked };
}

export function settle(table: Table, counts: Counts): { table: Table; transfers: Transfer[] }
{
    let current = table;
    const transfers: Transfer[] = [];

    for (const side of sides)
    {
        const want = counts[side];
        const spare: Man[] = [];
        const short: number[] = [];

        for (let spot = 0; spot < SPOTS; spot += 1)
        {
            const here = stacked(current, side, spot);
            const wanted = want[spot] ?? 0;

            if (here.length > wanted)
            {
                spare.push(...here.slice(wanted).reverse());
            }

            for (let missing = here.length; missing < wanted; missing += 1)
            {
                short.push(spot);
            }
        }

        for (let index = 0; index < Math.min(spare.length, short.length); index += 1)
        {
            const man = spare[index];
            const moved = relocate(current, man, short[index]);

            transfers.push({ man: moved.man, from: man.spot, to: short[index] });
            current = moved.table;
        }

        let serial = current.serial;
        const added: Man[] = [];

        for (let index = spare.length; index < short.length; index += 1)
        {
            serial += 1;
            added.push({ key: `m${ serial }`, side, spot: short[index], order: serial });
        }

        const gone = new Set(spare.slice(short.length).map((man) => man.key));

        current = { men: [...current.men.filter((man) => !gone.has(man.key)), ...added], serial };
    }

    return { table: current, transfers };
}

export function same(table: Table, counts: Counts)
{
    const held = countsOf(table);

    return sides.every((side) => Array.from({ length: SPOTS }, (_, spot) => held[side][spot] === (counts[side][spot] ?? 0)).every(Boolean));
}

const BAR_X = BAR_LEFT + BAR_WIDTH / 2;

const TRAY_X = TRAY_LEFT + TRAY / 2;

export function slotAt(side: Side, spot: number, index: number): Slot
{
    if (spot === OFF)
    {
        return {
            x: TRAY_X,
            y: side === 'near' ? BOTTOM - 12 - (index + 1) * SLAB + (SLAB - 2) / 2 : TOP + 12 + index * SLAB + (SLAB - 2) / 2,
            off: true,
            index
        };
    }

    const shown = Math.min(index, STACK_SHOWN - 1);

    if (spot === BAR)
    {
        return {
            x: BAR_X,
            y: side === 'near' ? stackAt('top', shown, MIDDLE + BAR_GAP) : stackAt('bottom', shown, MIDDLE - BAR_GAP),
            off: false,
            index
        };
    }

    const point = side === 'near' ? spot : opposite(spot);
    const column = columnOf(point);

    return { x: column.x + POINT_WIDTH / 2, y: stackAt(column.row, shown), off: false, index };
}

export function slotOf(table: Table, man: Man)
{
    return slotAt(man.side, man.spot, indexOf(table, man));
}
