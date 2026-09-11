export type Vec3 = readonly [number, number, number];

export interface Shot
{

    at: number;

    position: Vec3;

    target: Vec3;

    fov: number;
}

export interface Frame
{
    position: Vec3;
    target: Vec3;
    fov: number;
}

function spline(p0: number, p1: number, p2: number, p3: number, u: number): number
{
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * u +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * u3
    );
}

function at(shots: Shot[], index: number): Shot
{
    return shots[Math.min(Math.max(index, 0), shots.length - 1)];
}

export function sampleShots(shots: Shot[], progress: number): Frame
{
    const t = Math.min(Math.max(progress, 0), 1);

    let index = 0;
    while (index < shots.length - 2 && t > shots[index + 1].at)
    {
        index += 1;
    }

    const a = at(shots, index);
    const b = at(shots, index + 1);
    const span = b.at - a.at;
    const u = span <= 0 ? 0 : Math.min(Math.max((t - a.at) / span, 0), 1);

    const p0 = at(shots, index - 1);
    const p3 = at(shots, index + 2);

    const axis = (pick: (shot: Shot) => Vec3, component: 0 | 1 | 2): number =>
        spline(pick(p0)[component], pick(a)[component], pick(b)[component], pick(p3)[component], u);

    return {
        position: [
            axis((shot) => shot.position, 0),
            axis((shot) => shot.position, 1),
            axis((shot) => shot.position, 2)
        ],
        target: [
            axis((shot) => shot.target, 0),
            axis((shot) => shot.target, 1),
            axis((shot) => shot.target, 2)
        ],
        fov: a.fov + (b.fov - a.fov) * u
    };
}

export function damping(rate: number, deltaMs: number): number
{
    const frames = Math.min(deltaMs, 100) / (1000 / 60);
    return 1 - Math.pow(1 - rate, frames);
}
