import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { attachGestures, resist, PULL_ARM, PULL_MAX } from '../src/lib/gestures.ts';
import { haptic, hapticsAllowed, setHaptics } from '../src/lib/haptics.ts';
import { attachHold } from '../src/lib/hold.ts';
import { createLongPress } from '../src/lib/press.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { detents, nearestIndex, projected, settleIndex, stepAlong } from '../src/lib/snap.ts';
import { createDrag } from '../src/lib/swipe.ts';

let clock: ManualClock;

beforeEach(() =>
{
    resetRuntime();
    clock = manualClock(10_000);
    setRuntime({ clock });
    setHaptics(false);
});

afterEach(() =>
{
    setHaptics(false);
    resetRuntime();
    document.body.innerHTML = '';
});

describe('snap maths', () =>
{
    it('projects the release point forward along the flick', () =>
    {
        expect(projected(100, 0, 90)).toBe(100);
        expect(projected(100, 0.5, 90)).toBe(145);
        expect(projected(100, -0.5, 90)).toBe(55);
    });

    it('picks the nearest detent, and the first of two equally near ones', () =>
    {
        expect(nearestIndex(10, [0, 100, 200])).toBe(0);
        expect(nearestIndex(90, [0, 100, 200])).toBe(1);
        expect(nearestIndex(50, [0, 100])).toBe(0);
    });

    it('lets a slow drag rest where it is and a flick carry to the next stop', () =>
    {
        const points = [0, 200, 400];
        expect(settleIndex(60, 0, points)).toBe(0);
        expect(settleIndex(60, 1.6, points)).toBe(1);
        expect(settleIndex(220, 1.6, points)).toBe(2);
    });

    it('turns fractions of a panel into pixel offsets measured from the top', () =>
    {
        expect(detents(400, [1, 0.5, 0])).toEqual([0, 200, 400]);
    });

    it('steps a rail by a page and stops at both ends', () =>
    {
        expect(stepAlong(0, 900, 300, 1)).toBe(300);
        expect(stepAlong(500, 900, 300, 1)).toBe(600);
        expect(stepAlong(500, 900, 300, -1)).toBe(200);
        expect(stepAlong(100, 900, 300, -1)).toBe(0);
        expect(stepAlong(600, 900, 300, 1)).toBe(600);
    });
});

describe('drag', () =>
{
    it('reports the speed of the last move and forgets it when the finger rests', () =>
    {
        const drag = createDrag({ threshold: 100, velocity: 0.6 });
        drag.start(0, 0, 0);
        drag.move(0, 10, 10);
        drag.move(0, 40, 20);
        expect(drag.speed()).toBeCloseTo(3, 5);
        const frame = drag.end(400);
        expect(drag.speed()).toBe(0);
        expect(frame.dismiss).toBe(false);
    });

    it('locks to one axis and ignores the cross-axis drag entirely', () =>
    {
        const drag = createDrag({ threshold: 100, velocity: 0.6, axis: 'y', lock: 8 });
        drag.start(0, 0, 0);
        const sideways = drag.move(30, 2, 10);
        expect(sideways.axis).toBe('x');
        expect(drag.active()).toBe(false);
        expect(drag.move(60, 200, 20).offset).toBe(0);
    });
});

describe('long press', () =>
{
    it('fires after the delay and reports itself to the release', () =>
    {
        const seen = vi.fn();
        const press = createLongPress({ onPress: seen });
        press.start(10, 10);
        clock.advance(479);
        expect(seen).not.toHaveBeenCalled();
        clock.advance(2);
        expect(seen).toHaveBeenCalledTimes(1);
        expect(press.end()).toBe(true);
        expect(press.end()).toBe(false);
    });

    it('is cancelled by a finger that wanders past the slop', () =>
    {
        const seen = vi.fn();
        const press = createLongPress({ onPress: seen, slop: 10 });
        press.start(0, 0);
        press.move(6, 6);
        clock.advance(200);
        press.move(0, 24);
        clock.advance(600);
        expect(seen).not.toHaveBeenCalled();
    });

    it('starts over rather than stacking when a second finger lands', () =>
    {
        const seen = vi.fn();
        const press = createLongPress({ onPress: seen });
        press.start(0, 0);
        clock.advance(300);
        press.start(0, 0);
        clock.advance(300);
        expect(seen).not.toHaveBeenCalled();
        clock.advance(200);
        expect(seen).toHaveBeenCalledTimes(1);
    });
});

describe('haptics', () =>
{
    it('stays silent until the shell allows it', () =>
    {
        const vibrate = vi.fn(() => true);
        Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
        expect(hapticsAllowed()).toBe(false);
        expect(haptic('tick')).toBe(false);
        expect(vibrate).not.toHaveBeenCalled();
        setHaptics(true);
        expect(haptic('tick')).toBe(true);
        expect(vibrate).toHaveBeenCalledWith(7);
    });

    it('reports failure rather than throwing where the device has no motor', () =>
    {
        Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
        setHaptics(true);
        expect(haptic('win')).toBe(false);
    });
});

describe('pull resistance', () =>
{
    it('follows the finger at first, then drags its heels, and never runs away', () =>
    {
        expect(resist(0)).toBe(0);
        expect(resist(-30)).toBe(0);
        expect(resist(40)).toBe(40);
        expect(resist(140)).toBeLessThan(140);
        expect(resist(140)).toBeGreaterThan(PULL_ARM);
        expect(resist(4000)).toBe(PULL_MAX);
    });
});

function touch(target: HTMLElement, type: string, x: number, y: number): void
{
    const point = { identifier: 1, clientX: x, clientY: y, target } as unknown as Touch;
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [point] });
    target.dispatchEvent(event);
}

describe('page gestures', () =>
{
    it('refreshes when the pull is released past the arming point, and not before', () =>
    {
        const page = document.createElement('div');
        document.body.append(page);
        const refresh = vi.fn();
        const pulls: number[] = [];
        const release = attachGestures(page, { rtl: () => false, refresh, onPull: (distance) => pulls.push(distance) });

        touch(page, 'touchstart', 100, 100);
        touch(page, 'touchmove', 100, 140);
        touch(page, 'touchend', 100, 140);
        expect(refresh).not.toHaveBeenCalled();
        expect(pulls.some((distance) => distance > 0)).toBe(true);

        touch(page, 'touchstart', 100, 100);
        touch(page, 'touchmove', 100, 300);
        touch(page, 'touchend', 100, 300);
        expect(refresh).toHaveBeenCalledTimes(1);
        release();
    });

    it('will not pull a list that is already scrolled down', () =>
    {
        const page = document.createElement('div');
        Object.defineProperty(page, 'scrollTop', { value: 240, configurable: true });
        document.body.append(page);
        const refresh = vi.fn();
        const release = attachGestures(page, { rtl: () => false, refresh });

        touch(page, 'touchstart', 100, 100);
        touch(page, 'touchmove', 100, 400);
        touch(page, 'touchend', 100, 400);
        expect(refresh).not.toHaveBeenCalled();
        release();
    });

    it('goes back on a drag from the leading edge, and mirrors that edge under rtl', () =>
    {
        const page = document.createElement('div');
        Object.defineProperty(page, 'clientWidth', { value: 400, configurable: true });
        document.body.append(page);

        const back = vi.fn();
        let rtl = false;
        const release = attachGestures(page, { rtl: () => rtl, back });

        touch(page, 'touchstart', 200, 300);
        touch(page, 'touchmove', 360, 300);
        touch(page, 'touchend', 360, 300);
        expect(back).not.toHaveBeenCalled();

        touch(page, 'touchstart', 8, 300);
        touch(page, 'touchmove', 220, 300);
        touch(page, 'touchend', 220, 300);
        expect(back).toHaveBeenCalledTimes(1);

        rtl = true;
        touch(page, 'touchstart', 8, 300);
        touch(page, 'touchmove', 220, 300);
        touch(page, 'touchend', 220, 300);
        expect(back).toHaveBeenCalledTimes(1);

        touch(page, 'touchstart', 392, 300);
        touch(page, 'touchmove', 180, 300);
        touch(page, 'touchend', 180, 300);
        expect(back).toHaveBeenCalledTimes(2);
        release();
    });
});

function pointer(target: HTMLElement, type: string, x: number, y: number, kind = 'touch'): void
{
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'clientY', { value: y });
    Object.defineProperty(event, 'pointerType', { value: kind });
    Object.defineProperty(event, 'isPrimary', { value: true });
    target.dispatchEvent(event);
}

describe('hold', () =>
{
    it('opens on a held finger and swallows the click that follows', () =>
    {
        const row = document.createElement('a');
        document.body.append(row);
        const run = vi.fn();
        const clicked = vi.fn();
        row.addEventListener('click', clicked);
        const release = attachHold(row, run);

        pointer(row, 'pointerdown', 10, 10);
        clock.advance(500);
        expect(run).toHaveBeenCalledTimes(1);
        pointer(row, 'pointerup', 10, 10);
        row.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
        expect(clicked).not.toHaveBeenCalled();

        clock.advance(700);
        row.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
        expect(clicked).toHaveBeenCalledTimes(1);
        release();
    });

    it('leaves a mouse alone', () =>
    {
        const row = document.createElement('div');
        document.body.append(row);
        const run = vi.fn();
        const release = attachHold(row, run);
        pointer(row, 'pointerdown', 10, 10, 'mouse');
        clock.advance(900);
        expect(run).not.toHaveBeenCalled();
        release();
    });
});
