import { describe, it, expect, vi } from 'vitest';

import { GAMES } from '../src/data/games.ts';
import { damping, lens, progressAt, sampleShots, type Shot } from '../src/world/camera/path.ts';
import { createRig } from '../src/world/camera/rig.ts';
import { FOCUS, SHOTS } from '../src/world/camera/shots.ts';
import { refused, type Conditions } from '../src/world/gate.ts';
import { createGovernor } from '../src/world/quality/governor.ts';
import { PIXEL_BUDGET, TIER_ORDER, pickTier, pixelRatioFor } from '../src/world/quality/tiers.ts';
import studio from '../src/world/render/studio.json';

const BEATS = ['arrival', 'games', 'together', 'compete', 'finale'];

const PATH: Shot[] = BEATS.map((name, index) => ({ at: index / (BEATS.length - 1), ...SHOTS[name] }));

const tan = (degrees: number): number => Math.tan((degrees * Math.PI) / 360);

describe('the shot list', () =>
{
    it('has a shot for every beat the page declares, and a close-up of every game', () =>
    {
        for (const name of BEATS)
        {
            expect(SHOTS[name], name).toBeDefined();
        }
        for (const game of GAMES)
        {
            const shot = FOCUS[game.id];
            expect(shot.target[0]).toBeCloseTo(game.anchor[0], 6);
            expect(shot.target[2]).toBeCloseTo(game.anchor[2], 6);
            expect(shot.position[1], `${ game.id } is shot from below the plinth`).toBeGreaterThan(shot.target[1]);
        }
    });

    it('gives each game a solo beat', () =>
    {
        const solos = ['arrival', 'together', 'compete', 'finale'].map((name) => SHOTS[name]);
        expect(new Set(solos.map((shot) => shot.target[0])).size).toBe(GAMES.length);
    });

    it('lets two neighbouring floor pools meet without overlapping', () =>
    {
        for (let index = 1; index < GAMES.length; index += 1)
        {
            expect(GAMES[index].anchor[0] - GAMES[index - 1].anchor[0]).toBeCloseTo(studio.floor.size, 6);
        }
    });
});

describe('camera path', () =>
{
    it('passes exactly through each beat', () =>
    {
        for (const shot of PATH)
        {
            const frame = sampleShots(PATH, shot.at);
            expect(frame.position[0]).toBeCloseTo(shot.position[0], 4);
            expect(frame.position[1]).toBeCloseTo(shot.position[1], 4);
            expect(frame.position[2]).toBeCloseTo(shot.position[2], 4);
            expect(frame.fov).toBeCloseTo(shot.fov, 4);
        }
    });

    it('clamps beyond both ends instead of extrapolating', () =>
    {
        expect(sampleShots(PATH, -0.5).position).toEqual(sampleShots(PATH, 0).position);
        expect(sampleShots(PATH, 1.7).position).toEqual(sampleShots(PATH, 1).position);
    });

    it('stays above the floor for the whole journey', () =>
    {
        for (let step = 0; step <= 400; step += 1)
        {
            expect(sampleShots(PATH, step / 400).position[1]).toBeGreaterThan(0.3);
        }
    });

    it('holds a single shot still', () =>
    {
        const single = [{ at: 0, ...SHOTS.arrival }];
        expect(sampleShots(single, 0.7).position).toEqual(sampleShots(single, 0).position);
    });
});

describe('progressAt', () =>
{
    const arrivals = [0, 800, 1600, 2400, 3200];

    it('reads zero at the top and one past the last arrival', () =>
    {
        expect(progressAt(0, arrivals)).toBe(0);
        expect(progressAt(-50, arrivals)).toBe(0);
        expect(progressAt(3200, arrivals)).toBe(1);
        expect(progressAt(9000, arrivals)).toBe(1);
    });

    it('lands exactly on a beat when its section arrives', () =>
    {
        arrivals.forEach((at, index) =>
        {
            expect(progressAt(at, arrivals)).toBeCloseTo(index / (arrivals.length - 1), 6);
        });
    });

    it('eases into each beat, so the camera rests while its section is read', () =>
    {
        const quarter = 1 / (arrivals.length - 1);
        const near = progressAt(820, arrivals) - quarter;
        const middle = progressAt(1200, arrivals) - progressAt(1180, arrivals);
        expect(near).toBeLessThan(middle);
    });

    it('never moves backwards as the page scrolls down', () =>
    {
        let previous = 0;
        for (let y = 0; y <= 3400; y += 7)
        {
            const now = progressAt(y, [0, 500, 900, 2400, 2500]);
            expect(now).toBeGreaterThanOrEqual(previous);
            previous = now;
        }
    });

    it('survives two sections arriving at the same scroll', () =>
    {
        expect(Number.isFinite(progressAt(500, [0, 500, 500, 900]))).toBe(true);
    });

    it('holds still when there is nothing to scroll between', () =>
    {
        expect(progressAt(400, [0])).toBe(0);
        expect(progressAt(400, [])).toBe(0);
    });
});

describe('lens', () =>
{
    it('leaves a centred subject on a square screen alone', () =>
    {
        const view = lens(30, 1, 0.5, 0.5);
        expect(view.fov).toBeCloseTo(30, 6);
        expect(view.x).toBe(0);
        expect(view.y).toBe(0);
    });

    it('shifts the frustum so the subject lands where the layout leaves room', () =>
    {
        const wide = lens(30, 16 / 9, 0.66, 0.5);
        expect(wide.x).toBeCloseTo(-0.16, 6);
        const tall = lens(30, 390 / 844, 0.5, 0.3);
        expect(tall.y).toBeCloseTo(0.2, 6);
    });

    it('widens on a portrait phone so the subject still fits across', () =>
    {
        const tall = lens(30, 390 / 844, 0.5, 0.3);
        expect(tan(tall.fov) * (390 / 844)).toBeCloseTo(tan(30), 4);
    });

    it('keeps the subject the same size on every wide screen', () =>
    {
        expect(lens(30, 16 / 9, 0.66, 0.5).fov).toBeCloseTo(30, 6);
        expect(lens(30, 21 / 9, 0.66, 0.5).fov).toBeCloseTo(30, 6);
    });

    it('mirrors for a right-to-left page', () =>
    {
        expect(lens(30, 1.6, 0.34, 0.5).x).toBeCloseTo(-lens(30, 1.6, 0.66, 0.5).x, 6);
        expect(lens(30, 1.6, 0.34, 0.5).fov).toBeCloseTo(lens(30, 1.6, 0.66, 0.5).fov, 6);
    });

    it('never opens wider than a sane lens', () =>
    {
        expect(lens(30, 0.1, 0.5, 0.05).fov).toBeLessThanOrEqual(75);
    });
});

describe('damping', () =>
{
    it('covers the stated fraction in one 60Hz frame', () =>
    {
        expect(damping(0.1, 1000 / 60)).toBeCloseTo(0.1, 6);
    });

    it('covers the same ground per second regardless of refresh rate', () =>
    {
        const sixty = 1 - (1 - damping(0.1, 1000 / 60)) ** 60;
        const oneTwenty = 1 - (1 - damping(0.1, 1000 / 120)) ** 120;
        expect(oneTwenty).toBeCloseTo(sixty, 4);
    });

    it('clamps a huge delta so a backgrounded tab does not snap the camera', () =>
    {
        expect(damping(0.1, 30000)).toBeLessThan(1);
    });
});

describe('quality tiers', () =>
{
    const desktop = { cores: 8, memory: 8, width: 1440, height: 900 };

    it('gives a phone the phone scene at medium, whatever it claims about cores', () =>
    {
        expect(pickTier({ ...desktop, width: 390, height: 844, cores: 2 })).toEqual({ tier: 'medium', set: 'phone' });
        expect(pickTier({ ...desktop, width: 844, height: 390 })).toEqual({ tier: 'medium', set: 'phone' });
    });

    it('drops a weak desktop to low', () =>
    {
        expect(pickTier({ ...desktop, memory: 4 }).tier).toBe('low');
        expect(pickTier({ ...desktop, cores: 2 }).tier).toBe('low');
    });

    it('does not punish a browser that reports nothing', () =>
    {
        expect(pickTier({ ...desktop, cores: 0, memory: 0 }).tier).toBe('medium');
    });

    it('reserves high for a many-core machine', () =>
    {
        expect(pickTier(desktop)).toEqual({ tier: 'high', set: 'desktop' });
        expect(pickTier({ ...desktop, cores: 6 }).tier).toBe('medium');
    });

    it('orders the tiers by cost, so the governor can step down by index', () =>
    {
        expect(TIER_ORDER).toEqual(['low', 'medium', 'high']);
        expect(PIXEL_BUDGET.low).toBeLessThan(PIXEL_BUDGET.medium);
        expect(PIXEL_BUDGET.medium).toBeLessThan(PIXEL_BUDGET.high);
    });

    it('spends at most the tier budget in pixels, and never more than 2x', () =>
    {
        for (const tier of TIER_ORDER)
        {
            for (const [width, height, dpr] of [[390, 844, 3], [1440, 900, 2], [2560, 1440, 1.5], [1280, 720, 1]])
            {
                const ratio = pixelRatioFor(tier, dpr, width, height);
                expect(ratio).toBeLessThanOrEqual(Math.min(dpr, 2) + 1e-9);
                expect(width * height * ratio * ratio).toBeLessThanOrEqual(PIXEL_BUDGET[tier] + 1);
            }
        }
    });
});

describe('the gate', () =>
{
    const fine: Conditions = { reducedMotion: false, saveData: false, effectiveType: '4g', memory: 8 };

    it('lets an ordinary device through', () =>
    {
        expect(refused(fine)).toBe(false);
        expect(refused({ ...fine, effectiveType: '', memory: 0 })).toBe(false);
    });

    it('refuses reduced motion, Save-Data, a slow network and a small device', () =>
    {
        expect(refused({ ...fine, reducedMotion: true })).toBe(true);
        expect(refused({ ...fine, saveData: true })).toBe(true);
        for (const slow of ['slow-2g', '2g', '3g'])
        {
            expect(refused({ ...fine, effectiveType: slow })).toBe(true);
        }
        expect(refused({ ...fine, memory: 2 })).toBe(true);
    });
});

describe('governor', () =>
{
    const run = (governor: ReturnType<typeof createGovernor>, ms: number, frames: number): void =>
    {
        for (let index = 0; index < frames; index += 1)
        {
            governor.sample(ms);
        }
    };

    it('leaves a device holding 30fps alone', () =>
    {
        const onDowngrade = vi.fn();
        const governor = createGovernor({ tier: 'high', onDowngrade, onExhausted: vi.fn() });
        run(governor, 33, 600);
        expect(onDowngrade).not.toHaveBeenCalled();
    });

    it('waits before acting, so one slow moment does not cost a tier', () =>
    {
        let clock = 0;
        const onDowngrade = vi.fn();
        const governor = createGovernor({ tier: 'high', onDowngrade, onExhausted: vi.fn(), now: () => clock });

        run(governor, 50, 120);
        expect(onDowngrade).not.toHaveBeenCalled();

        clock += 2500;
        run(governor, 50, 60);
        expect(onDowngrade).toHaveBeenCalledWith('medium');
    });

    it('ignores a single enormous frame', () =>
    {
        const onDowngrade = vi.fn();
        const governor = createGovernor({ tier: 'high', onDowngrade, onExhausted: vi.fn() });
        for (let index = 0; index < 600; index += 1)
        {
            governor.sample(index % 100 === 0 ? 4000 : 14);
        }
        expect(onDowngrade).not.toHaveBeenCalled();
    });

    it('steps down to the floor, then gives up once, and never steps back up', () =>
    {
        let clock = 0;
        const seen: string[] = [];
        const onExhausted = vi.fn();
        const governor = createGovernor({ tier: 'high', onDowngrade: (tier) => seen.push(tier), onExhausted, now: () => clock });

        for (let round = 0; round < 8; round += 1)
        {
            run(governor, 60, 120);
            clock += 2500;
            run(governor, 60, 120);
        }

        expect(seen).toEqual(['medium', 'low']);
        expect(governor.tier()).toBe('low');
        expect(onExhausted).toHaveBeenCalledTimes(1);
    });
});

describe('camera rig', () =>
{
    const settle = (rig: ReturnType<typeof createRig>, frames = 600): boolean =>
    {
        let moving = true;
        for (let frame = 0; frame < frames && moving; frame += 1)
        {
            moving = rig.update(16);
        }
        return moving;
    };

    const near = (rig: ReturnType<typeof createRig>, point: readonly number[]): number =>
        Math.hypot(rig.camera.position.x - point[0], rig.camera.position.y - point[1], rig.camera.position.z - point[2]);

    it('starts already framed on the first beat, and at rest', () =>
    {
        const rig = createRig(PATH);
        rig.resize(1440, 900);
        rig.snap();
        expect(near(rig, SHOTS.arrival.position)).toBeLessThan(0.001);
        expect(rig.update(16)).toBe(false);
    });

    it('glides to a new beat rather than jumping, and then stops asking for frames', () =>
    {
        const rig = createRig(PATH);
        rig.setProgress(1);
        expect(rig.update(16)).toBe(true);
        expect(near(rig, SHOTS.finale.position)).toBeGreaterThan(0.5);
        expect(settle(rig)).toBe(false);
        expect(near(rig, SHOTS.finale.position)).toBeLessThan(0.01);
    });

    it('turns to a game while its card is focused, and back when it is not', () =>
    {
        const rig = createRig(PATH);
        rig.setProgress(0.25);
        settle(rig);
        rig.focus(FOCUS.backgammon);
        settle(rig);
        expect(near(rig, FOCUS.backgammon.position)).toBeLessThan(0.01);
        rig.focus(null);
        settle(rig);
        expect(near(rig, SHOTS.games.position)).toBeLessThan(0.01);
    });

    it('sways a few centimetres with the mouse and no more', () =>
    {
        const rig = createRig(PATH);
        const rest = rig.camera.position.clone();
        rig.setPointer(1, -1);
        settle(rig);
        const moved = rig.camera.position.distanceTo(rest);
        expect(moved).toBeGreaterThan(0.02);
        expect(moved).toBeLessThan(0.05);
    });

    it('frames the subject where the layout asks', () =>
    {
        const rig = createRig(PATH);
        rig.resize(1440, 900);
        rig.setFrame(0.66, 0.5);
        rig.snap();
        expect(rig.camera.view?.offsetX).toBeCloseTo(-0.16 * 1440, 4);
        expect(rig.camera.aspect).toBeCloseTo(1.6, 6);
    });
});
