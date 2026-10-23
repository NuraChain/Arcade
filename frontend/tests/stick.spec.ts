import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { manualClock, type ManualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { attachStick, centreOn, isNearBottom, JOURNEY_MS, STICK_SLACK } from '../src/lib/stick.ts';

/**
 * The maths behind "should new content follow the reader down".
 *
 * The chat decided this with `messages.length + typing.length >= 0` - a sum of two lengths, so
 * always true. The guard was dead code and the behaviour was "jump to the bottom on every change",
 * including when somebody merely started typing and including while the reader was part way up the
 * history. Nothing saw it: `npm run qa` checks overflow, hit targets, a landmark and a clean
 * console, and a list confidently scrolled to the bottom is none of those.
 *
 * Split out as arithmetic because **jsdom has no layout** - `scrollTop`, `scrollHeight` and
 * `clientHeight` are ordinary properties there, so they can be installed and driven directly. That
 * is the same shape `shell.spec.ts` uses to model the rule that a detached element reports
 * `scrollTop` as zero.
 */
const view = (scrollTop: number, scrollHeight = 1000, clientHeight = 400): {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
} => ({ scrollTop, scrollHeight, clientHeight });

describe('isNearBottom', () =>
{
    it('is true at the bottom and false at the top', () =>
    {
        expect(isNearBottom(view(600))).toBe(true);
        expect(isNearBottom(view(0))).toBe(false);
    });

    it('allows exactly the slack and no more', () =>
    {
        expect(isNearBottom(view(600 - STICK_SLACK))).toBe(true);
        expect(isNearBottom(view(600 - STICK_SLACK - 1))).toBe(false);
    });

    it('is true when there is nothing to scroll', () =>
    {
        expect(isNearBottom(view(0, 300, 400))).toBe(true);
    });
});

describe('attachStick', () =>
{
    const scroller = (scrollTop: number): HTMLElement =>
    {
        const element = document.createElement('div');
        Object.defineProperty(element, 'scrollHeight', { value: 1000, configurable: true });
        Object.defineProperty(element, 'clientHeight', { value: 400, configurable: true });
        Object.defineProperty(element, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
        return element;
    };

    it('reports once immediately, so a caller never starts from a guess', () =>
    {
        const onChange = vi.fn();
        const stop = attachStick(scroller(600), onChange);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(true);
        stop();
    });

    it('follows the reader up and back down', () =>
    {
        const element = scroller(600);
        const seen: boolean[] = [];
        const stop = attachStick(element, (near) => seen.push(near));

        (element as unknown as { scrollTop: number }).scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));

        (element as unknown as { scrollTop: number }).scrollTop = 600;
        element.dispatchEvent(new Event('scroll'));

        expect(seen).toEqual([true, false, true]);
        stop();
    });

    it('stops reporting once released', () =>
    {
        const element = scroller(600);
        const onChange = vi.fn();
        attachStick(element, onChange)();

        element.dispatchEvent(new Event('scroll'));

        expect(onChange, 'the stick kept listening after it was released').toHaveBeenCalledTimes(1);
    });
});

describe('centreOn, and the journey it makes', () =>
{
    let clock: ManualClock;

    beforeEach(() =>
    {
        clock = manualClock(0);
        setRuntime({ clock, seed: 7 });
    });

    afterEach(() => resetRuntime());

    /** A thread 3000 tall in a view of 600, at its end, whose scrolls are only recorded: the spec moves it. */
    const thread = () =>
    {
        const element = document.createElement('div');
        const asked: ScrollToOptions[] = [];

        Object.defineProperty(element, 'scrollHeight', { value: 3000, configurable: true });
        Object.defineProperty(element, 'clientHeight', { value: 600, configurable: true });
        Object.defineProperty(element, 'scrollTop', { value: 2400, writable: true, configurable: true });
        element.getBoundingClientRect = () => ({ top: 50, bottom: 650, left: 0, right: 0, width: 0, height: 600, x: 0, y: 50, toJSON: () => null });
        element.scrollTo = ((options: ScrollToOptions) => asked.push(options)) as typeof element.scrollTo;

        return { element, asked };
    };

    /** A line `offset` down the thread's content, 40 tall, as the screen sees it scrolled. */
    const lineIn = (element: HTMLElement, offset: number) =>
    {
        const line = document.createElement('div');

        line.getBoundingClientRect = () =>
        {
            const top = 50 + offset - element.scrollTop;

            return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top, toJSON: () => null };
        };

        return line;
    };

    const moved = (element: HTMLElement, top: number, kind = 'scroll') =>
    {
        (element as unknown as { scrollTop: number }).scrollTop = top;
        element.dispatchEvent(new Event(kind));
    };

    it('answers where the reader is going at once, and the scroll on the way says nothing until it gets there', () =>
    {
        const { element, asked } = thread();
        const seen: boolean[] = [];
        const stop = attachStick(element, (near) => seen.push(near));

        expect(centreOn(element, lineIn(element, 1000), true), 'far from the end, from the moment it is asked').toBe(false);
        expect(asked).toEqual([{ top: 720, behavior: 'smooth' }]);

        moved(element, 2390);
        moved(element, 1800);

        expect(seen, 'the frames on the way were not taken for where the reader is').toEqual([true]);

        moved(element, 720);

        expect(seen, 'arrived').toEqual([true, false]);

        moved(element, 2400);

        expect(seen, 'and then every scroll is the reader\'s again').toEqual([true, false, true]);
        stop();
    });

    it('lets the reader take the scroll with a wheel or a finger', () =>
    {
        for (const kind of ['wheel', 'touchstart'])
        {
            const { element } = thread();
            const seen: boolean[] = [];
            const stop = attachStick(element, (near) => seen.push(near));

            centreOn(element, lineIn(element, 1000), true);
            element.dispatchEvent(new Event(kind));
            moved(element, 2350);

            expect(seen, kind).toEqual([true, true]);
            stop();
        }
    });

    it('ends the journey where the browser says the scroll ended, wherever that was', () =>
    {
        const { element } = thread();
        const seen: boolean[] = [];
        const stop = attachStick(element, (near) => seen.push(near));

        centreOn(element, lineIn(element, 1000), true);
        moved(element, 1500);
        moved(element, 1500, 'scrollend');

        expect(seen).toEqual([true, false]);

        moved(element, 2400);

        expect(seen).toEqual([true, false, true]);
        stop();
    });

    it('gives up on a journey that never arrives, and reads where the thread is', () =>
    {
        const { element } = thread();
        const seen: boolean[] = [];
        const stop = attachStick(element, (near) => seen.push(near));

        centreOn(element, lineIn(element, 1000), true);
        moved(element, 2350);
        clock.advance(JOURNEY_MS - 1);

        expect(seen, 'still on its way').toEqual([true]);

        clock.advance(1);

        expect(seen, 'given up on where it stood').toEqual([true, true]);
        stop();
    });

    it('centres the line, held at either end, and plainly, with less motion', () =>
    {
        const { element, asked } = thread();

        expect(centreOn(element, lineIn(element, 30), false), 'a line at the top').toBe(false);
        expect(centreOn(element, lineIn(element, 2900), true), 'a line at the end').toBe(true);
        expect(asked).toEqual([{ top: 0, behavior: 'auto' }, { top: 2400, behavior: 'smooth' }]);
    });

    it('holds nothing for a line already in the middle, which no scroll will ever arrive at', () =>
    {
        const { element } = thread();
        const seen: boolean[] = [];
        const stop = attachStick(element, (near) => seen.push(near));

        expect(centreOn(element, lineIn(element, 2680), true)).toBe(true);

        moved(element, 1000);

        expect(seen, 'the next scroll is the reader\'s').toEqual([true, false]);
        stop();
    });

    it('lets a line asked for where the thread already stands end a journey still on its way', () =>
    {
        const { element } = thread();
        const seen: boolean[] = [];
        const stop = attachStick(element, (near) => seen.push(near));

        centreOn(element, lineIn(element, 1000), true);
        centreOn(element, lineIn(element, 2680), true);
        moved(element, 1000);

        expect(seen, 'the first journey no longer speaks for the reader').toEqual([true, false]);
        stop();
    });
});
