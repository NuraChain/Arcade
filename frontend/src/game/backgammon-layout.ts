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

export function stackAt(row: Row, index: number, base: number = row === 'top' ? TOP : BOTTOM): number
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
