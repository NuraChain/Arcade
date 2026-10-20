import { BOTTOM, POINT_WIDTH, RADIUS, TOP, columnOf } from '../../frontend/src/game/backgammon-layout.ts';
import { BAR, OFF, SPOTS, slotAt } from '../../frontend/src/game/backgammon-men.ts';

const SIDES = ['near', 'far'];

const SAME = 0.5;

const REACH = 6;

const other = (side) => (side === 'near' ? 'far' : 'near');

export const START = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

export const row = (points) => Array.from({ length: SPOTS }, (_, spot) => points[spot] ?? 0);

export const tonesOf = (viewer) => (viewer === 0 ? { near: 'light', far: 'dark' } : { near: 'dark', far: 'light' });

export function countsOf(view, viewer)
{
    const rowOf = (seat) => [...(view.seats.find((one) => one.seat === seat)?.checkers ?? row({}))];

    return { near: rowOf(viewer), far: rowOf(1 - viewer) };
}

export function positionOf(counts, more = {})
{
    return {
        ...(more.phase === undefined ? {} : { phase: more.phase }),
        ...(more.opening === undefined ? {} : { opening: more.opening }),
        dice: more.dice ?? [],
        seats: [
            { seat: 0, checkers: counts.near, score: more.scores?.[0] ?? 0 },
            { seat: 1, checkers: counts.far, score: more.scores?.[1] ?? 0 }
        ],
        cubed: more.cubed ?? false,
        cube: more.cube ?? 1,
        round: more.round ?? 1
    };
}

const trackOf = (side, spot) =>
{
    const column = columnOf(side === 'near' ? spot : BAR - spot);

    return { x: column.x + POINT_WIDTH / 2, y: column.row === 'top' ? TOP + RADIUS : BOTTOM - RADIUS };
};

const pointOf = (slot) => ({ x: slot.x, y: slot.y });

function routeOf(counts, hop)
{
    const route = [pointOf(slotAt(hop.side, hop.from, counts[hop.side][hop.from] - 1))];

    if (hop.from !== BAR)
    {
        for (let spot = hop.from - 1; spot > Math.max(hop.to, OFF); spot -= 1)
        {
            route.push(trackOf(hop.side, spot));
        }
    }

    route.push(pointOf(slotAt(hop.side, hop.to, counts[hop.side][hop.to])));

    return route;
}

function knockOf(counts, hop)
{
    const them = other(hop.side);

    return [pointOf(slotAt(them, BAR - hop.to, 0)), pointOf(slotAt(them, BAR, counts[them][BAR]))];
}

export function applyHop(counts, hop)
{
    const next = { near: [...counts.near], far: [...counts.far] };
    const them = other(hop.side);

    next[hop.side][hop.from] -= 1;
    next[hop.side][hop.to] += 1;

    if (hop.hit)
    {
        next[them][BAR - hop.to] -= 1;
        next[them][BAR] += 1;
    }

    return next;
}

export function planOf(men, counts, hops, tones, moved = () => false)
{
    const at = new Map(men.map((man) => [man.key, { tone: man.tone, x: man.x, y: man.y }]));
    const routes = new Map();
    let held = counts;

    const standing = (tone, point) =>
    {
        const close = [...at]
            .filter(([, man]) => man.tone === tone)
            .map(([key, man]) => ({ key, away: Math.hypot(man.x - point.x, man.y - point.y) }))
            .filter((one) => one.away <= REACH)
            .sort((a, b) => a.away - b.away);

        if (close.length === 0)
        {
            return null;
        }

        const tied = close.filter((one) => one.away <= close[0].away + SAME);

        return (tied.find((one) => moved(one.key)) ?? tied[0]).key;
    };

    const extend = (key, route) =>
    {
        const had = routes.get(key);
        const end = route[route.length - 1];

        routes.set(key, had === undefined ? route : [...had, ...route.slice(1)]);
        at.set(key, { ...at.get(key), x: end.x, y: end.y });
    };

    for (const hop of hops)
    {
        const route = routeOf(held, hop);
        const mover = standing(tones[hop.side], route[0]);

        if (mover === null)
        {
            return null;
        }

        if (hop.hit)
        {
            const knock = knockOf(held, hop);
            const blot = standing(tones[other(hop.side)], knock[0]);

            if (blot === null)
            {
                return null;
            }

            extend(blot, knock);
        }

        extend(mover, route);
        held = applyHop(held, hop);
    }

    return { routes, counts: held };
}

export async function menOf(page, layer = '.bg-layer', board = 'svg[viewBox="0 0 1000 820"]')
{
    return await page.evaluate(({ layer, board }) =>
    {
        const frame = document.querySelector(layer)?.getBoundingClientRect();
        const matrix = document.querySelector(layer)?.parentElement?.querySelector(board)?.getScreenCTM() ?? null;

        if (frame === undefined)
        {
            return { width: 0, matrix: null, men: [] };
        }

        return {
            width: frame.width,
            matrix: matrix === null ? null : { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
            men: [...document.querySelectorAll(`${ layer } .man`)].map((man) =>
            {
                const box = man.getBoundingClientRect();
                const sx = box.x + box.width / 2;
                const sy = box.y + box.height / 2;

                return {
                    key: man.dataset.key ?? '',
                    tone: man.dataset.tone ?? '',
                    off: man.hasAttribute('data-off'),
                    connected: man.isConnected,
                    sx,
                    sy,
                    x: (sx - frame.x) / frame.width * 1000,
                    y: (sy - frame.y) / frame.width * 1000
                };
            })
        };
    }, { layer, board });
}

export function expectedOf(counts, tones)
{
    const out = [];

    for (const side of SIDES)
    {
        for (let spot = 0; spot < SPOTS; spot += 1)
        {
            for (let index = 0; index < (counts[side][spot] ?? 0); index += 1)
            {
                const slot = slotAt(side, spot, index);

                out.push({ tone: tones[side], x: slot.x, y: slot.y, off: slot.off });
            }
        }
    }

    return out;
}

export function differs(seen, expected, tolerance = 1.5)
{
    const left = [...seen.men];
    const problems = [];

    if (seen.matrix === null)
    {
        return ['the board has no screen matrix'];
    }

    for (const want of expected)
    {
        const sx = seen.matrix.a * want.x + seen.matrix.c * want.y + seen.matrix.e;
        const sy = seen.matrix.b * want.x + seen.matrix.d * want.y + seen.matrix.f;
        let best = -1;
        let near = Infinity;

        left.forEach((man, index) =>
        {
            const away = Math.hypot(man.sx - sx, man.sy - sy);

            if (man.tone === want.tone && man.off === want.off && away < near)
            {
                near = away;
                best = index;
            }
        });

        if (best === -1 || near > tolerance)
        {
            problems.push(`no ${ want.tone } checker at ${ Math.round(want.x) }, ${ Math.round(want.y) }${ best === -1 ? '' : `: the nearest is ${ near.toFixed(1) }px off` }`);
        }
        else
        {
            left.splice(best, 1);
        }
    }

    if (left.length > 0)
    {
        problems.push(`${ left.length } checkers stand where the position has none`);
    }

    return problems;
}
