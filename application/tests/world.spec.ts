import { describe, it, expect, vi } from 'vitest';

import { damping, sampleShots, type Shot } from '../src/world/camera/path.ts';
import { DESKTOP_SHOTS, MOBILE_SHOTS, SCENE_MARKS, TABLE_BEATS, offsetShots } from '../src/world/camera/shots.ts';
import { createGovernor } from '../src/world/quality/governor.ts';
import { createRig } from '../src/world/camera/rig.ts';
import { TIERS, TIER_ORDER, pickTier, type DeviceProfile } from '../src/world/quality/tiers.ts';
import { GAMES } from '../src/data/games.ts';

const profile = (over: Partial<DeviceProfile> = {}): DeviceProfile => ({
    webgl: true,
    cores: 8,
    pixelRatio: 2,
    width: 1440,
    memory: 8,
    reducedMotion: false,
    ...over
});

describe('camera path', () =>
{
    it('passes exactly through each keyframe', () =>
    {
        for (const shot of DESKTOP_SHOTS)
        {
            const frame = sampleShots(DESKTOP_SHOTS, shot.at);
            expect(frame.position[0]).toBeCloseTo(shot.position[0], 4);
            expect(frame.position[1]).toBeCloseTo(shot.position[1], 4);
            expect(frame.position[2]).toBeCloseTo(shot.position[2], 4);
            expect(frame.fov).toBeCloseTo(shot.fov, 4);
        }
    });

    it('clamps beyond both ends instead of extrapolating', () =>
    {
        const before = sampleShots(DESKTOP_SHOTS, -0.5);
        const start = sampleShots(DESKTOP_SHOTS, 0);
        expect(before.position).toEqual(start.position);

        const after = sampleShots(DESKTOP_SHOTS, 1.7);
        const end = sampleShots(DESKTOP_SHOTS, 1);
        expect(after.position).toEqual(end.position);
    });

    it('never lets the field of view overshoot its neighbours', () =>
    {
        for (let index = 0; index < DESKTOP_SHOTS.length - 1; index += 1)
        {
            const a = DESKTOP_SHOTS[index];
            const b = DESKTOP_SHOTS[index + 1];
            const low = Math.min(a.fov, b.fov);
            const high = Math.max(a.fov, b.fov);

            for (let step = 0; step <= 10; step += 1)
            {
                const t = a.at + (b.at - a.at) * (step / 10);
                const { fov } = sampleShots(DESKTOP_SHOTS, t);
                expect(fov).toBeGreaterThanOrEqual(low - 0.001);
                expect(fov).toBeLessThanOrEqual(high + 0.001);
            }
        }
    });

    it('moves continuously - no jump between segments', () =>
    {
        let previous = sampleShots(DESKTOP_SHOTS, 0).position;
        for (let step = 1; step <= 400; step += 1)
        {
            const current = sampleShots(DESKTOP_SHOTS, step / 400).position;
            const jump = Math.hypot(
                current[0] - previous[0],
                current[1] - previous[1],
                current[2] - previous[2]
            );
            expect(jump, `jump at ${ step / 400 }`).toBeLessThan(1.2);
            previous = current;
        }
    });

    it('keeps the camera above the market floor for the whole journey', () =>
    {
        for (let step = 0; step <= 400; step += 1)
        {
            const { position } = sampleShots(DESKTOP_SHOTS, step / 400);
            expect(position[1], `height at ${ step / 400 }`).toBeGreaterThan(0.6);
        }
    });

    it('looks at each game table during the games sequence', () =>
    {
        for (const game of GAMES)
        {
            const aimed = DESKTOP_SHOTS.some((shot) =>
                Math.abs(shot.target[0] - game.anchor[0]) < 0.01 &&
                Math.abs(shot.target[2] - game.anchor[2]) < 0.01);

            expect(aimed, `no shot aims at ${ game.id }`).toBe(true);
        }
    });

    it('holds the mobile edit to the same beats as the desktop one', () =>
    {
        expect(MOBILE_SHOTS.map((shot) => shot.at)).toEqual(DESKTOP_SHOTS.map((shot) => shot.at));
    });

    it('keeps every scene mark on an ascending, in-range scroll position', () =>
    {
        const marks = SCENE_MARKS.map((mark) => mark.at);
        expect(marks).toEqual([...marks].sort((a, b) => a - b));
        expect(marks[0]).toBe(0);
        expect(marks[marks.length - 1]).toBeLessThan(1);
    });

    it('slides only the table beats sideways, by the same amount for camera and target', () =>
    {
        const shifted = offsetShots(DESKTOP_SHOTS, 0.55);
        shifted.forEach((shot, index) =>
        {
            const base = DESKTOP_SHOTS[index];
            const inside = shot.at >= TABLE_BEATS[0] && shot.at <= TABLE_BEATS[1];
            const moved = Math.hypot(shot.position[0] - base.position[0], shot.position[2] - base.position[2]);
            const aimed = Math.hypot(shot.target[0] - base.target[0], shot.target[2] - base.target[2]);
            expect(moved).toBeCloseTo(inside ? 0.55 : 0, 6);
            expect(aimed).toBeCloseTo(moved, 6);
            expect(shot.position[1]).toBe(base.position[1]);
        });
    });

    it('mirrors the sideways slide for the other reading direction', () =>
    {
        const left = offsetShots(DESKTOP_SHOTS, -0.55);
        const right = offsetShots(DESKTOP_SHOTS, 0.55);
        left.forEach((shot, index) =>
        {
            const base = DESKTOP_SHOTS[index];
            expect(shot.position[0] + right[index].position[0]).toBeCloseTo(2 * base.position[0], 6);
            expect(shot.position[2] + right[index].position[2]).toBeCloseTo(2 * base.position[2], 6);
        });
        expect(offsetShots(DESKTOP_SHOTS, 0)).toBe(DESKTOP_SHOTS);
    });

    it('holds rather than dividing by zero when two keyframes share a position', () =>
    {
        const degenerate: Shot[] = [
            { at: 0, position: [0, 1, 0], target: [0, 0, 0], fov: 40 },
            { at: 0.5, position: [1, 1, 0], target: [0, 0, 0], fov: 40 },
            { at: 0.5, position: [2, 1, 0], target: [0, 0, 0], fov: 40 },
            { at: 1, position: [3, 1, 0], target: [0, 0, 0], fov: 40 }
        ];
        expect(() => sampleShots(degenerate, 0.5)).not.toThrow();
        expect(Number.isFinite(sampleShots(degenerate, 0.5).position[0])).toBe(true);
    });
});

describe('damping', () =>
{
    it('covers the stated fraction in one 60Hz frame', () =>
    {
        expect(damping(0.1, 1000 / 60)).toBeCloseTo(0.1, 6);
    });

    it('covers the same ground per SECOND regardless of refresh rate', () =>
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
    it('treats a narrow viewport as a phone whatever it claims about cores', () =>
    {
        expect(pickTier(profile({ width: 390, cores: 8, pixelRatio: 3 }))).toBe('medium');
        expect(pickTier(profile({ width: 390, cores: 4 }))).toBe('low');
    });

    it('drops to low on a memory-constrained device', () =>
    {
        expect(pickTier(profile({ memory: 4 }))).toBe('low');
    });

    it('does not punish a browser that reports nothing', () =>
    {
        expect(pickTier(profile({ cores: 0, memory: 0 }))).toBe('medium');
    });

    it('reserves high for a wide viewport on a many-core machine', () =>
    {
        expect(pickTier(profile({ cores: 12, width: 1920 }))).toBe('high');
        expect(pickTier(profile({ cores: 4, width: 1920 }))).toBe('medium');
    });

    it('orders the tiers by cost, so the governor can step down by index', () =>
    {
        expect(TIER_ORDER).toEqual(['low', 'medium', 'high']);
        for (let index = 1; index < TIER_ORDER.length; index += 1)
        {
            const cheaper = TIERS[TIER_ORDER[index - 1]];
            const richer = TIERS[TIER_ORDER[index]];
            expect(cheaper.pixelRatio).toBeLessThanOrEqual(richer.pixelRatio);
            expect(cheaper.realLights).toBeLessThanOrEqual(richer.realLights);
            expect(cheaper.dust).toBeLessThanOrEqual(richer.dust);
        }
    });

    it('turns shadows and the grade pass off entirely at the floor', () =>
    {
        expect(TIERS.low.shadowMap).toBe(0);
        expect(TIERS.low.grade).toBe(false);
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

    it('leaves a device that keeps up alone', () =>
    {
        const onDowngrade = vi.fn();
        const governor = createGovernor({ tier: 'high', onDowngrade });
        run(governor, 16, 600);
        expect(onDowngrade).not.toHaveBeenCalled();
        expect(governor.tier()).toBe('high');
    });

    it('waits before acting, so one slow moment does not cost a tier', () =>
    {
        let clock = 0;
        const onDowngrade = vi.fn();
        const governor = createGovernor({ tier: 'high', onDowngrade, now: () => clock });

        run(governor, 40, 120);
        expect(onDowngrade).not.toHaveBeenCalled();

        clock += 2500;
        run(governor, 40, 60);
        expect(onDowngrade).toHaveBeenCalledWith('medium');
    });

    it('ignores a single enormous frame', () =>
    {
        const onDowngrade = vi.fn();
        const governor = createGovernor({ tier: 'high', onDowngrade });
        for (let index = 0; index < 600; index += 1)
        {
            governor.sample(index % 100 === 0 ? 4000 : 14);
        }
        expect(onDowngrade).not.toHaveBeenCalled();
    });

    it('never steps below the floor, and never steps back up', () =>
    {
        let clock = 0;
        const seen: string[] = [];
        const governor = createGovernor({
            tier: 'high',
            onDowngrade: (tier) => seen.push(tier),
            now: () => clock
        });

        for (let round = 0; round < 8; round += 1)
        {
            run(governor, 60, 120);
            clock += 2500;
            run(governor, 60, 120);
        }

        expect(governor.tier()).toBe('low');
        expect(seen).toEqual(['medium', 'low']);
    });

    it('recovers its footing after a downgrade before judging again', () =>
    {
        let clock = 0;
        const seen: string[] = [];
        const governor = createGovernor({
            tier: 'high',
            onDowngrade: (tier) => seen.push(tier),
            now: () => clock
        });

        run(governor, 60, 120);
        clock += 2500;
        run(governor, 60, 60);
        expect(seen).toEqual(['medium']);

        run(governor, 15, 600);
        clock += 10000;
        run(governor, 15, 600);
        expect(seen).toEqual(['medium']);
    });
});

describe('camera rig', () =>
{
    const distance = (rig: ReturnType<typeof createRig>, target: readonly number[]): number =>
        Math.hypot(
            rig.camera.position.x - target[0],
            rig.camera.position.y - target[1],
            rig.camera.position.z - target[2]
        );

    it('starts already framed on the first shot', () =>
    {
        const rig = createRig(DESKTOP_SHOTS, 1.6);
        expect(distance(rig, DESKTOP_SHOTS[0].position)).toBeLessThan(0.001);
    });

    it('eases toward a new progress rather than jumping to it', () =>
    {
        const rig = createRig(DESKTOP_SHOTS, 1.6);
        rig.setProgress(1);

        rig.update(16, 16);
        const afterOne = distance(rig, DESKTOP_SHOTS[DESKTOP_SHOTS.length - 1].position);

        for (let frame = 0; frame < 200; frame += 1)
        {
            rig.update(16 * frame, 16);
        }
        const afterMany = distance(rig, DESKTOP_SHOTS[DESKTOP_SHOTS.length - 1].position);

        expect(afterOne).toBeGreaterThan(1);
        expect(afterMany).toBeLessThan(afterOne);
    });

    it('places the camera exactly on the path when motion is reduced', () =>
    {
        const rig = createRig(DESKTOP_SHOTS, 1.6);
        rig.setReducedMotion(true);
        rig.setPointer(1, 1);
        rig.setProgress(1);
        rig.update(16, 16);

        const last = DESKTOP_SHOTS[DESKTOP_SHOTS.length - 1].position;
        expect(distance(rig, last)).toBeLessThan(0.001);
    });

    it('applies no pointer parallax at all when motion is reduced', () =>
    {
        const still = createRig(DESKTOP_SHOTS, 1.6);
        still.setReducedMotion(true);
        still.setProgress(0.5);
        still.update(16, 16);
        const without = still.camera.position.clone();

        still.setPointer(1, -1);
        still.update(32, 16);
        expect(still.camera.position.distanceTo(without)).toBeLessThan(0.001);
    });

    it('does move with the pointer when motion is not reduced', () =>
    {
        const rig = createRig(DESKTOP_SHOTS, 1.6);
        rig.setProgress(0);
        for (let frame = 0; frame < 120; frame += 1)
        {
            rig.update(16 * frame, 16);
        }
        const settled = rig.camera.position.clone();

        rig.setPointer(1, -1);
        for (let frame = 0; frame < 120; frame += 1)
        {
            rig.update(16 * (frame + 120), 16);
        }
        expect(rig.camera.position.distanceTo(settled)).toBeGreaterThan(0.05);
    });
});
