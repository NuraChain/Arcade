import { describe, it, expect, vi } from 'vitest';

import { attachStick, isNearBottom, STICK_SLACK } from '../src/lib/stick.ts';

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
