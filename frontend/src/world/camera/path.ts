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

function at(shots: Shot[], index: number): Shot
{
    return shots[Math.min(Math.max(index, 0), shots.length - 1)];
}

function mix(a: Vec3, b: Vec3, u: number): Vec3
{
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
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

    return {
        position: mix(a.position, b.position, u),
        target: mix(a.target, b.target, u),
        fov: a.fov + (b.fov - a.fov) * u
    };
}

export function damping(rate: number, deltaMs: number): number
{
    const frames = Math.min(deltaMs, 100) / (1000 / 60);
    return 1 - Math.pow(1 - rate, frames);
}

export function progressAt(scrollY: number, arrivals: readonly number[]): number
{
    const last = arrivals.length - 1;
    if (last <= 0 || scrollY <= arrivals[0])
    {
        return 0;
    }
    if (scrollY >= arrivals[last])
    {
        return 1;
    }

    let index = 0;
    while (index < last - 1 && scrollY >= arrivals[index + 1])
    {
        index += 1;
    }

    const span = arrivals[index + 1] - arrivals[index];
    const passed = span <= 0 ? 1 : (scrollY - arrivals[index]) / span;
    return (index + passed * passed * (3 - 2 * passed)) / last;
}

export interface Lens
{
    fov: number;

    x: number;

    y: number;
}

export function lens(fov: number, aspect: number, subjectX: number, subjectY: number): Lens
{
    const room = Math.min(2 * Math.min(subjectY, 1 - subjectY), aspect * 2 * Math.min(subjectX, 1 - subjectX));
    const half = Math.tan((fov * Math.PI) / 360) / Math.max(room, 0.2);
    return {
        fov: Math.min((Math.atan(half) * 360) / Math.PI, 75),
        x: 0.5 - subjectX,
        y: 0.5 - subjectY
    };
}
