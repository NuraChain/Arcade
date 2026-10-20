export const WIDTH = 1000;

export const HEIGHT = 820;

export const FRAME = 24;

export const TRAY = 70;

export const BAR_WIDTH = 60;

export const FIELD_LEFT = FRAME;

export const FIELD_RIGHT = WIDTH - FRAME - TRAY - FRAME;

export const POINT_WIDTH = (FIELD_RIGHT - FIELD_LEFT - BAR_WIDTH) / 12;

export const POINT_HEIGHT = (HEIGHT - FRAME * 2) * 0.42;

export const RADIUS = POINT_WIDTH * 0.46;

export const BAR_LEFT = FIELD_LEFT + POINT_WIDTH * 6;

export const TRAY_LEFT = FIELD_RIGHT + FRAME;

export const TOP = FRAME;

export const BOTTOM = HEIGHT - FRAME;

export const MIDDLE = HEIGHT / 2;

export const STACK_SHOWN = 5;

export const SLAB = (HEIGHT - FRAME * 2 - 40) / 30;

export const CUBE = 48;

export const BAR_GAP = CUBE / 2 + 2;

export type Row = 'top' | 'bottom';

export interface Column
{
    x: number;
    row: Row;
}

export function columnOf(point: number): Column
{
    if (point <= 6)
    {
        return { x: BAR_LEFT + BAR_WIDTH + (6 - point) * POINT_WIDTH, row: 'bottom' };
    }

    if (point <= 12)
    {
        return { x: FIELD_LEFT + (12 - point) * POINT_WIDTH, row: 'bottom' };
    }

    if (point <= 18)
    {
        return { x: FIELD_LEFT + (point - 13) * POINT_WIDTH, row: 'top' };
    }

    return { x: BAR_LEFT + BAR_WIDTH + (point - 19) * POINT_WIDTH, row: 'top' };
}

export function stackAt(row: Row, index: number, base: number = row === 'top' ? TOP : BOTTOM)
{
    const offset = RADIUS + index * RADIUS * 2;

    return row === 'top' ? base + offset : base - offset;
}

export function pointAt(x: number, y: number): number | 'bar' | 'tray' | null
{
    if (x >= TRAY_LEFT && x <= TRAY_LEFT + TRAY)
    {
        return 'tray';
    }

    if (x >= BAR_LEFT && x < BAR_LEFT + BAR_WIDTH)
    {
        return 'bar';
    }

    if (x < FIELD_LEFT || x >= FIELD_RIGHT || y < TOP || y > BOTTOM)
    {
        return null;
    }

    const right = x >= BAR_LEFT + BAR_WIDTH;
    const slot = Math.floor((x - (right ? BAR_LEFT + BAR_WIDTH : FIELD_LEFT)) / POINT_WIDTH);
    const top = y < MIDDLE;

    if (top)
    {
        return right ? 19 + slot : 13 + slot;
    }

    return right ? 6 - slot : 12 - slot;
}

export const DICE_X = BAR_LEFT + BAR_WIDTH + POINT_WIDTH * 3;

export const CUBE_EDGE = 44;

export function cubeY(owner: 'near' | 'far' | null)
{
    if (owner === null)
    {
        return MIDDLE;
    }

    return owner === 'near' ? BOTTOM - CUBE_EDGE : TOP + CUBE_EDGE;
}

export interface Spike
{
    point: number;
    path: string;
    shade: 'a' | 'b';
}

export const SPIKES: readonly Spike[] = Array.from({ length: 24 }, (_, index) =>
{
    const point = index + 1;
    const column = columnOf(point);
    const base = column.row === 'top' ? TOP : BOTTOM;
    const tip = column.row === 'top' ? TOP + POINT_HEIGHT : BOTTOM - POINT_HEIGHT;

    return {
        point,
        path: `${ column.x },${ base } ${ column.x + POINT_WIDTH },${ base } ${ column.x + POINT_WIDTH / 2 },${ tip }`,
        shade: point % 2 === 0 ? 'a' : 'b'
    };
});

export interface Patch
{
    x: number;
    y: number;
    w: number;
    h: number;
}

export function patchOf(spot: number)
{
    if (spot === 0)
    {
        return { x: TRAY_LEFT, y: MIDDLE, w: TRAY, h: BOTTOM - MIDDLE };
    }

    if (spot === 25)
    {
        return { x: BAR_LEFT, y: MIDDLE + BAR_GAP, w: BAR_WIDTH, h: BOTTOM - CUBE_EDGE - CUBE / 2 - MIDDLE - BAR_GAP };
    }

    const column = columnOf(spot);

    return { x: column.x, y: column.row === 'top' ? TOP : MIDDLE, w: POINT_WIDTH, h: MIDDLE - TOP };
}
