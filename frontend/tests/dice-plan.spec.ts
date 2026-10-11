import { describe, it, expect } from 'vitest';

import { FACE_PLACE, NORMALS, faceUp, matrixOf, planThrow, restOf, restTurn, times, turnX, turnY, turnZ, yawOf, type Turn } from '../src/game/stage/dice.ts';
import { createDie } from '../src/game/stage/die.ts';

const SEEDS = Array.from({ length: 160 }, (_, index) => (index + 1) * 977);

const between = (one: Turn, other: Turn) =>
{
    let trace = 0;

    for (let index = 0; index < 9; index += 1)
    {
        trace += one[index] * other[index];
    }

    return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
};

describe('the die', () =>
{
    it('shows each face to the viewer at rest, whatever way the table is turned', () =>
    {
        for (let face = 1; face <= 6; face += 1)
        {
            for (const yaw of [-0.38, -0.1, 0, 0.2, 0.38])
            {
                expect(faceUp(restTurn(face, yaw)), `face ${ face } at ${ yaw }`).toBe(face);
            }
        }
    });

    it('is a real die: opposite faces make seven, and every face has a normal of its own', () =>
    {
        for (let face = 1; face <= 3; face += 1)
        {
            const [x, y, z] = NORMALS[face];
            const [a, b, c] = NORMALS[7 - face];

            expect([x + a, y + b, z + c]).toEqual([0, 0, 0]);
        }
    });

    it('turns by rotations, so composing them never stretches the cube', () =>
    {
        const turned = times(times(turnX(0.7), turnY(-1.9)), turnZ(2.4));
        const length = (row: number) => Math.hypot(turned[row * 3], turned[row * 3 + 1], turned[row * 3 + 2]);

        expect([length(0), length(1), length(2)].map((one) => Number(one.toFixed(6)))).toEqual([1, 1, 1]);
        expect(matrixOf(restTurn(1, 0))).toBe('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)');
    });

    it('is drawn with each face where the maths says that face is', () =>
    {
        for (let face = 1; face <= 6; face += 1)
        {
            const placed = /^(?:rotate([XY])\((-?\d+)deg\) )?translateZ\(0\.5em\)$/.exec(FACE_PLACE[face]);

            expect(placed, `face ${ face }: ${ FACE_PLACE[face] }`).not.toBeNull();

            const angle = Number(placed![2] ?? 0) * Math.PI / 180;
            const turn = placed![1] === 'X' ? turnX(angle) : turnY(angle);
            const outward = [turn[2], turn[5], turn[8]].map((one) => Math.round(one));

            expect(outward, `face ${ face }`).toEqual([...NORMALS[face]]);
        }
    });

    it('rests, as it is drawn, with the face that was rolled towards whoever looks at it', () =>
    {
        const die = createDie();
        const body = die.node.querySelector<HTMLElement>('.die3d-body')!;

        for (let face = 1; face <= 6; face += 1)
        {
            die.show(face, 4242 + face);

            const cells = /matrix3d\(([^)]+)\)/.exec(body.style.transform)![1].split(',').map(Number);
            const turn: Turn = [cells[0], cells[4], cells[8], cells[1], cells[5], cells[9], cells[2], cells[6], cells[10]];

            expect(faceUp(turn), `face ${ face }`).toBe(face);
            expect(die.face()).toBe(face);
            expect(die.node.dataset.face).toBe(String(face));
        }

        expect(die.node.querySelectorAll('.die3d-face')).toHaveLength(6);
        expect([...die.node.querySelectorAll('.die3d-face')].map((side) => side.querySelectorAll('.die3d-pip').length)).toEqual([1, 2, 3, 4, 5, 6]);
    });
});

describe('a thrown die', () =>
{
    const release = { x: 6, y: -4 };

    it('always comes to rest showing exactly the face the game rolled', () =>
    {
        for (const seed of SEEDS)
        {
            for (let face = 1; face <= 6; face += 1)
            {
                const plan = planThrow(seed, face, release);
                const last = plan.frames[plan.frames.length - 1];

                expect(faceUp(last.turn), `seed ${ seed } face ${ face }`).toBe(face);
                expect(faceUp(plan.rest)).toBe(face);
                expect([last.x, last.y, last.lift]).toEqual([0, 0, 0]);
            }
        }
    });

    it('starts where it was thrown from, in the air, and ends on the table', () =>
    {
        const plan = planThrow(4242, 3, release);

        expect(plan.frames[0].at).toBe(0);
        expect(plan.frames[0].x).toBeCloseTo(release.x);
        expect(plan.frames[0].y).toBeCloseTo(release.y);
        expect(plan.frames[0].lift).toBeGreaterThan(0.9);
        expect(plan.frames[plan.frames.length - 1].at).toBeCloseTo(plan.duration);
    });

    it('lasts long enough to read and short enough not to wait for', () =>
    {
        for (const seed of SEEDS)
        {
            const { duration } = planThrow(seed, 5, release);

            expect(duration).toBeGreaterThan(650);
            expect(duration).toBeLessThan(1200);
        }
    });

    it('lands several times, each time softer than the last', () =>
    {
        for (const seed of SEEDS)
        {
            const { impacts, duration } = planThrow(seed, 2, release);

            expect(impacts.length).toBeGreaterThanOrEqual(3);
            expect(impacts.length).toBeLessThanOrEqual(4);

            for (let index = 1; index < impacts.length; index += 1)
            {
                expect(impacts[index].at).toBeGreaterThan(impacts[index - 1].at);
                expect(impacts[index].power).toBeLessThan(impacts[index - 1].power);
            }

            expect(impacts[0].power).toBe(1);
            expect(impacts[impacts.length - 1].at).toBeLessThan(duration);
        }
    });

    it('touches the table at every landing and never goes under it', () =>
    {
        for (const seed of SEEDS.slice(0, 40))
        {
            const plan = planThrow(seed, 6, release);

            for (const impact of plan.impacts)
            {
                const frame = plan.frames.find((one) => Math.abs(one.at - impact.at) < 0.01);

                expect(frame?.lift ?? 99).toBeLessThan(0.01);
            }

            expect(Math.min(...plan.frames.map((one) => one.lift))).toBeGreaterThanOrEqual(0);
            expect(Math.max(...plan.frames.map((one) => one.lift))).toBeLessThan(3);
        }
    });

    it('never turns so fast between frames that the eye cannot follow it', () =>
    {
        for (const seed of SEEDS.slice(0, 60))
        {
            const { frames } = planThrow(seed, 4, release);

            for (let index = 1; index < frames.length; index += 1)
            {
                expect(between(frames[index - 1].turn, frames[index].turn)).toBeLessThan(Math.PI / 3);
            }
        }
    });

    it('slows to a stop rather than stopping dead', () =>
    {
        const { frames } = planThrow(31337, 1, release);
        const step = (index: number) => Math.hypot(frames[index].x - frames[index - 1].x, frames[index].y - frames[index - 1].y);
        const early = step(3);
        const late = step(frames.length - 1);

        expect(late).toBeLessThan(early / 3);
    });

    it('is the same throw for the same roll, and a different one for the next', () =>
    {
        const one = planThrow(1000, 4, release);
        const again = planThrow(1000, 4, release);
        const other = planThrow(1001, 4, release);

        expect(again).toEqual(one);
        expect(other.frames.map((frame) => frame.x)).not.toEqual(one.frames.map((frame) => frame.x));
        expect(other.duration).not.toBe(one.duration);
    });

    it('rests at the same angle whether it was thrown or simply shown', () =>
    {
        for (const seed of SEEDS.slice(0, 20))
        {
            expect(planThrow(seed, 3, release).yaw).toBe(yawOf(seed));
        }
    });

    it('keeps two dice apart at rest, so neither hides the other', () =>
    {
        for (const seed of SEEDS)
        {
            const left = restOf(seed, 0, 2);
            const right = restOf(seed, 1, 2);

            expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThan(1.3);
        }
    });
});
