import { clamp, outCubic, outQuad, seeded } from './curves.ts';

export type Turn = readonly [number, number, number, number, number, number, number, number, number];

export interface Release
{
    x: number;
    y: number;
}

export interface Frame
{
    at: number;
    x: number;
    y: number;
    lift: number;
    turn: Turn;
}

export interface Impact
{
    at: number;
    power: number;
}

export interface Throw
{
    duration: number;
    frames: Frame[];
    impacts: Impact[];
    rest: Turn;
    yaw: number;
}

export interface Rest
{
    x: number;
    y: number;
}

const TAU = Math.PI * 2;

const FRAME_MS = 16;

const YAW = 0.38;

const FRICTION = 0.62;

const SPIN_LEFT: Record<number, readonly number[]> = {
    3: [1, 0.46, 0.17, 0.045],
    4: [1, 0.5, 0.25, 0.1, 0.03]
};

const IDENTITY: Turn = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const turnX = (angle: number): Turn => [1, 0, 0, 0, Math.cos(angle), -Math.sin(angle), 0, Math.sin(angle), Math.cos(angle)];

export const turnY = (angle: number): Turn => [Math.cos(angle), 0, Math.sin(angle), 0, 1, 0, -Math.sin(angle), 0, Math.cos(angle)];

export const turnZ = (angle: number): Turn => [Math.cos(angle), -Math.sin(angle), 0, Math.sin(angle), Math.cos(angle), 0, 0, 0, 1];

export function times(left: Turn, right: Turn)
{
    const out: number[] = [];

    for (let row = 0; row < 3; row += 1)
    {
        for (let column = 0; column < 3; column += 1)
        {
            out.push(left[row * 3] * right[column] + left[row * 3 + 1] * right[3 + column] + left[row * 3 + 2] * right[6 + column]);
        }
    }

    return out as unknown as Turn;
}

export const NORMALS: Readonly<Record<number, readonly [number, number, number]>> = {
    1: [0, 0, 1],
    2: [0, -1, 0],
    3: [1, 0, 0],
    4: [-1, 0, 0],
    5: [0, 1, 0],
    6: [0, 0, -1]
};

export const FACE_PLACE: Readonly<Record<number, string>> = {
    1: 'translateZ(0.5em)',
    2: 'rotateX(90deg) translateZ(0.5em)',
    3: 'rotateY(90deg) translateZ(0.5em)',
    4: 'rotateY(-90deg) translateZ(0.5em)',
    5: 'rotateX(-90deg) translateZ(0.5em)',
    6: 'rotateY(180deg) translateZ(0.5em)'
};

const ALIGN: Readonly<Record<number, Turn>> = {
    1: IDENTITY,
    2: turnX(-Math.PI / 2),
    3: turnY(-Math.PI / 2),
    4: turnY(Math.PI / 2),
    5: turnX(Math.PI / 2),
    6: turnY(Math.PI)
};

export function restTurn(face: number, yaw: number)
{
    return times(turnZ(yaw), ALIGN[Math.min(6, Math.max(1, Math.round(face)))]);
}

export function faceUp(turn: Turn)
{
    let best = 1;
    let height = -Infinity;

    for (let face = 1; face <= 6; face += 1)
    {
        const [x, y, z] = NORMALS[face];
        const up = turn[6] * x + turn[7] * y + turn[8] * z;

        if (up > height)
        {
            height = up;
            best = face;
        }
    }

    return best;
}

const digits = (value: number) => String(Number(value.toFixed(5)));

export function matrixOf(turn: Turn)
{
    return `matrix3d(${ [turn[0], turn[3], turn[6], 0, turn[1], turn[4], turn[7], 0, turn[2], turn[5], turn[8], 0, 0, 0, 0, 1].map(digits).join(', ') })`;
}

export function yawOf(seed: number)
{
    return (seeded(seed ^ 0x9E3779B9)() - 0.5) * 2 * YAW;
}

export function planThrow(seed: number, face: number, release: Release): Throw
{
    const next = seeded(seed);
    const bounces = next() < 0.4 ? 4 : 3;
    const yaw = yawOf(seed);
    const start = 1 + next() * 0.5;
    const apex = start + 0.6 + next() * 0.5;
    const first = 0.3 + next() * 0.08;
    const restitution = 0.46 + next() * 0.1;
    const roll = 150 + next() * 50;
    const sign = () => (next() < 0.5 ? -1 : 1);
    const totals = [sign() * (1 + next()) * TAU, sign() * (0.9 + next()) * TAU, sign() * (0.4 + next() * 0.6) * TAU];
    const side = sign() * (0.5 + next() * 0.6);

    const gravity = 2 * ((2 * apex - start) + 2 * Math.sqrt(apex * (apex - start))) / (first * first);
    const rise = gravity * first / 2 - start / first;
    const speeds = [rise];
    const flights = [first * 1000];
    const impact = gravity * first - rise;

    for (let flight = 1; flight < bounces; flight += 1)
    {
        speeds.push(impact * restitution ** flight);
        flights.push(2 * speeds[flight] / gravity * 1000);
    }

    const starts = [0];

    for (const length of flights)
    {
        starts.push(starts[starts.length - 1] + length);
    }

    const landed = starts[bounces];
    const duration = landed + roll;
    const weights = flights.map((length, flight) => length * FRICTION ** flight);
    const rolling = FRICTION ** bounces * roll * 0.5;
    const journey = weights.reduce((sum, weight) => sum + weight, 0) + rolling;
    const done: number[] = [0];

    for (const weight of weights)
    {
        done.push(done[done.length - 1] + weight / journey);
    }

    const left = SPIN_LEFT[bounces];
    const aim = restTurn(face, yaw);
    const length = Math.hypot(release.x, release.y);
    const across = length === 0 ? { x: 0, y: 0 } : { x: -release.y / length, y: release.x / length };

    const frame = (at: number): Frame =>
    {
        let progress: number;
        let lift = 0;
        let spin: number;

        if (at < landed)
        {
            let flight = 0;

            while (flight < bounces - 1 && at >= starts[flight + 1])
            {
                flight += 1;
            }

            const tau = clamp((at - starts[flight]) / flights[flight]);
            const seconds = tau * flights[flight] / 1000;

            progress = done[flight] + (done[flight + 1] - done[flight]) * tau;
            lift = flight === 0
                ? start + rise * seconds - gravity * seconds * seconds / 2
                : speeds[flight] * seconds - gravity * seconds * seconds / 2;
            spin = left[flight] + (left[flight + 1] - left[flight]) * tau;
        }
        else
        {
            const tau = clamp((at - landed) / roll);

            progress = done[bounces] + (1 - done[bounces]) * outQuad(tau);
            spin = left[bounces] * (1 - outCubic(tau));
        }

        const drift = Math.sin(Math.PI * progress) * side;
        const loose = times(times(turnX(totals[0] * spin), turnY(totals[1] * spin)), turnZ(totals[2] * spin));

        return {
            at,
            x: release.x * (1 - progress) + across.x * drift,
            y: release.y * (1 - progress) + across.y * drift,
            lift: Math.max(0, lift),
            turn: times(aim, loose)
        };
    };

    const moments = new Set<number>([0, duration, ...starts.slice(1, bounces + 1)]);

    for (let at = FRAME_MS; at < duration; at += FRAME_MS)
    {
        moments.add(Math.round(at * 100) / 100);
    }

    const frames = [...moments].sort((one, other) => one - other).map(frame);
    const last = frames[frames.length - 1];

    last.x = 0;
    last.y = 0;
    last.lift = 0;
    last.turn = aim;

    return {
        duration,
        frames,
        impacts: starts.slice(1, bounces + 1).map((at, index) => ({ at, power: clamp(0.3 + 0.7 * restitution ** index) })),
        rest: aim,
        yaw
    };
}

export function restOf(seed: number, index: number, count: number): Rest
{
    const next = seeded(seed + index * 7919);
    const spread = 1.7 + (next() - 0.5) * 0.3;

    return {
        x: count === 1 ? (next() - 0.5) * 0.4 : (index - (count - 1) / 2) * spread,
        y: (next() - 0.5) * 0.7
    };
}
