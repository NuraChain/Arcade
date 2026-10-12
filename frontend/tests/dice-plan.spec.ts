import { afterEach, describe, it, expect, vi } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { FACE_PLACE, NORMALS, faceUp, matrixOf, planThrow, restOf, restTurn, times, turnX, turnY, turnZ, yawOf, type Turn } from '../src/game/stage/dice.ts';
import { createDie, nearness } from '../src/game/stage/die.ts';
import { createStage } from '../src/game/stage/stage.ts';

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

describe('the die, drawn flat', () =>
{
    interface Drawn
    {
        el: Element;
        frames: Keyframe[];
    }

    const seenOf = (transform: string): Turn =>
    {
        const cells = /matrix3d\(([^)]+)\)/.exec(transform)![1].split(',').map(Number);

        return [cells[0], cells[4], cells[8], cells[1], cells[5], cells[9], cells[2], cells[6], cells[10]];
    };

    const posed = (transform: unknown) =>
    {
        const found = /^translate\((-?[\d.]+)em, (-?[\d.]+)em\) scale\(([\d.]+)\) matrix3d/.exec(String(transform));

        return found === null ? null : { x: Number(found[1]), y: Number(found[2]), scale: Number(found[3]) };
    };

    const recorded = () =>
    {
        const drawn: Drawn[] = [];
        const animate = Element.prototype.animate;

        vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, frames, options)
        {
            drawn.push({ el: this, frames: frames as Keyframe[] });

            const running = animate.call(this, frames, options);

            running.finished.catch(() => undefined);

            return running;
        });

        return drawn;
    };

    afterEach(() =>
    {
        vi.restoreAllMocks();
    });

    it('rests with the rolled face towards whoever looks, with no perspective on it, tipped just enough to show its near side', () =>
    {
        const die = createDie({ flat: true });
        const body = die.node.querySelector<HTMLElement>('.die3d-body')!;

        expect(die.node.hasAttribute('data-flat')).toBe(true);
        expect(createDie().node.hasAttribute('data-flat')).toBe(false);

        for (let face = 1; face <= 6; face += 1)
        {
            die.show(face, 4242 + face);

            const seen = seenOf(body.style.transform);
            const [x, y, z] = NORMALS[face];
            const towards = seen[6] * x + seen[7] * y + seen[8] * z;

            expect(body.style.transform, `face ${ face }`).not.toContain('perspective');
            expect(faceUp(seen), `face ${ face }`).toBe(face);
            expect(towards, `face ${ face } is turned away`).toBeGreaterThan(0.99);
            expect(towards, `face ${ face } shows no side at all`).toBeLessThan(1);
        }
    });

    it('leaves the face that looks at the reader white and readable, and shades and blanks the ones seen edge on', () =>
    {
        const die = createDie({ flat: true });
        const faces = [...die.node.querySelectorAll<HTMLElement>('.die3d-face')];
        const tone = (face: number) => Number(faces[face - 1].querySelector<HTMLElement>('.die3d-tone')!.style.opacity);
        const veil = (face: number) => Number(faces[face - 1].querySelector<HTMLElement>('.die3d-veil')!.style.opacity);

        die.show(3, 19);

        expect([tone(3), veil(3)]).toEqual([0, 0]);

        for (const side of [1, 2, 5, 6])
        {
            expect([tone(side), veil(side)], `side ${ side }`).toEqual([1, 1]);
        }

        for (const side of faces)
        {
            const parts = [...side.children].map((part) => part.className);

            expect(parts[0], 'the shade lies over the pips').toBe('die3d-tone');
            expect(parts[parts.length - 1], 'the pips lie over what blanks them').toBe('die3d-veil');
        }

        expect(createDie().node.querySelector('.die3d-tone, .die3d-veil'), 'the lit die grew a flat one\'s shading').toBeNull();
    });

    it('is thrown with no perspective: its height is drawn as its size, and it lands at its own size on the face that was rolled', () =>
    {
        const drawn = recorded();
        const stage = createStage({ clock: manualClock(0), quiet: () => false });
        const die = createDie({ flat: true });
        const plan = planThrow(4242, 4, { x: 3, y: -2 });

        die.toss(stage, 4242, 4, { x: 3, y: -2 });

        const body = drawn.find((one) => one.el.classList.contains('die3d-body'))!;
        const first = posed(body.frames[0].transform)!;
        const last = posed(body.frames[body.frames.length - 1].transform)!;

        expect(body.frames.every((frame) => posed(frame.transform) !== null), 'a frame was drawn some other way').toBe(true);
        expect([first.x, first.y]).toEqual([3, -2]);
        expect(first.scale).toBeCloseTo(nearness(plan.frames[0].lift), 3);
        expect(first.scale).toBeGreaterThan(1.1);
        expect([last.x, last.y, last.scale]).toEqual([0, 0, 1]);
        expect(faceUp(seenOf(String(body.frames[body.frames.length - 1].transform)))).toBe(4);
        expect(Math.max(...body.frames.map((frame) => posed(frame.transform)!.scale))).toBeCloseTo(nearness(Math.max(...plan.frames.map((frame) => frame.lift))), 3);

        const shaded = drawn.filter((one) => one.el.classList.contains('die3d-tone') || one.el.classList.contains('die3d-veil'));

        expect(shaded).toHaveLength(12);
        expect(shaded.every((one) => one.frames.length === plan.frames.length && one.frames.every((frame) => Number(frame.opacity) >= 0 && Number(frame.opacity) <= 1))).toBe(true);
        expect(shaded.some((one) => one.frames.some((frame) => Number(frame.opacity) > 0 && Number(frame.opacity) < 1)), 'no face was ever part shaded').toBe(true);
    });

    it('leaves the hand at the size it was held and is its own size by the time it lands', () =>
    {
        const drawn = recorded();
        const stage = createStage({ clock: manualClock(0), quiet: () => false });
        const die = createDie({ flat: true });

        die.toss(stage, 977, 2, { x: 5, y: 5 }, { held: 1.85 });

        const scales = drawn.find((one) => one.el.classList.contains('die3d-body'))!.frames.map((frame) => posed(frame.transform)!.scale);

        expect(scales[0]).toBeCloseTo(1.85, 3);
        expect(scales[scales.length - 1]).toBe(1);

        drawn.length = 0;
        createDie().toss(stage, 977, 2, { x: 5, y: 5 }, { held: 1.85 });

        const lit = drawn.find((one) => one.el.classList.contains('die3d-body'))!;

        expect(String(lit.frames[0].transform)).toMatch(/^perspective\(7em\) translate3d\(/);
        expect(drawn.filter((one) => one.el.classList.contains('die3d-tone'))).toHaveLength(0);
    });

    it('fades in whole where it comes to rest for somebody who asked for less motion', () =>
    {
        const drawn = recorded();
        const stage = createStage({ clock: manualClock(0), quiet: () => true });
        const die = createDie({ flat: true });

        die.toss(stage, 4242, 6, { x: 3, y: -2 });

        expect(drawn).toHaveLength(1);
        expect(drawn[0].el).toBe(die.node);
        expect(drawn[0].frames).toEqual([{ opacity: 0, offset: 0 }]);
        expect(die.face()).toBe(6);
    });
});
