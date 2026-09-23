export const OFF = 0;

export const BAR = 25;

export const CHECKERS = 15;

export const HOME = 6;

export const START: readonly number[] = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

export interface Side
{
    me: number[];
    them: number[];
}

export interface Hop
{
    from: number;
    to: number;
}

export interface Played extends Hop
{
    die: number;
    hit: boolean;
}

export function facing(point: number): number
{
    return BAR - point;
}

export function allHome(me: readonly number[]): boolean
{
    for (let point = HOME + 1; point <= BAR; point += 1)
    {
        if (me[point] > 0)
        {
            return false;
        }
    }

    return true;
}

export function pips(me: readonly number[]): number
{
    return me.reduce((total, count, point) => total + count * point, 0);
}

export function keyOf(side: Side): string
{
    return `${ side.me.join(',') }|${ side.them.join(',') }`;
}
