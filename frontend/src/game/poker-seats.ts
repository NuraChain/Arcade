export interface Spot
{
    x: number;
    y: number;
    ux: number;
    uy: number;
    lies: 'flat' | 'upright';
}

interface Point
{
    x: number;
    y: number;
    nx: number;
    ny: number;
}

interface Leg
{
    length: number;
    at: (along: number) => Point;
}

const QUARTER = Math.PI / 2;

export const RAIL = 0.102;

export function aroundStadium(seats: number, ratio: number, inset = RAIL / 2): Spot[]
{
    const width = ratio >= 1 ? ratio : 1;
    const height = ratio >= 1 ? 1 : 1 / ratio;
    const a = width / 2 - inset;
    const b = height / 2 - inset;
    const r = Math.min(a, b);
    const lx = a - r;
    const ly = b - r;

    const straight = (length: number, x: number, y: number, dx: number, dy: number, nx: number, ny: number): Leg => ({
        length,
        at: (along) => ({ x: x + dx * along, y: y + dy * along, nx, ny })
    });

    const bend = (cx: number, cy: number, from: number): Leg => ({
        length: QUARTER * r,
        at: (along) =>
        {
            const nx = Math.cos(from + along / r);
            const ny = Math.sin(from + along / r);

            return { x: cx + r * nx, y: cy + r * ny, nx, ny };
        }
    });

    const legs = [
        straight(lx, 0, b, -1, 0, 0, 1),
        bend(-lx, ly, QUARTER),
        straight(2 * ly, -a, ly, 0, -1, -1, 0),
        bend(-lx, -ly, 2 * QUARTER),
        straight(2 * lx, -lx, -b, 1, 0, 0, -1),
        bend(lx, -ly, 3 * QUARTER),
        straight(2 * ly, a, -ly, 0, 1, 1, 0),
        bend(lx, ly, 0),
        straight(lx, lx, b, -1, 0, 0, 1)
    ];
    const round = legs.reduce((sum, leg) => sum + leg.length, 0);

    const pointAt = (walked: number) =>
    {
        let left = walked;

        for (const leg of legs)
        {
            if (left <= leg.length)
            {
                return leg.at(left);
            }

            left -= leg.length;
        }

        return legs[0].at(0);
    };

    return Array.from({ length: seats }, (_, place) =>
    {
        const { x, y, nx, ny } = pointAt((place / seats) * round);
        const flat = Math.abs(ny) > Math.abs(nx);

        return {
            x: 50 + (x / width) * 100,
            y: 50 + (y / height) * 100,
            ux: flat ? 0 : 0 - Math.sign(nx),
            uy: flat ? 0 - Math.sign(ny) : 0,
            lies: flat ? 'flat' : 'upright'
        };
    });
}
