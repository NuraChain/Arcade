import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHEET_SHARE, chatNeeds, sheetNext, sheetReach, sheetRoom, watchEdge, watchFold, watchSheet, type SheetSize } from '../src/lib/sheet-room.ts';

describe('how much of the screen the chat sheet may take', () =>
{
    it('keeps half the screen while the board has room to spare', () =>
    {
        expect(sheetRoom(355, 400, 262, 238, 355)).toBe(355);
    });

    it('gives back exactly what the board is short of', () =>
    {
        expect(sheetRoom(355, 200, 262, 192, 355)).toBe(293);
    });

    it('gives the board its floor even where that leaves the chat less than its own, and never less than nothing', () =>
    {
        expect(sheetRoom(355, 160, 262, 278, 355)).toBe(253);
        expect(sheetRoom(190, 10, 262, 192, 190)).toBe(0);
    });

    it('lets a chat whose floor is taller than half the screen have it, when the board can spare it', () =>
    {
        expect(sheetRoom(300, 400, 262, 320, 300)).toBe(320);
    });

    it('only ever gives room up while the screen stays the same height, and starts again when it changes', () =>
    {
        expect(sheetNext(208, 248, true)).toBe(208);
        expect(sheetNext(248, 208, true)).toBe(208);
        expect(sheetNext(208, 352, false)).toBe(352);
    });
});

describe('how far the sheet reaches over the bar', () =>
{
    it('is exactly its room when the chat fits in it', () =>
    {
        expect(sheetReach(248, 192, 176, 248)).toBe(248);
    });

    it('lays the chat over the bar up to its own floor when the board left it less', () =>
    {
        expect(sheetReach(200, 278, 176, 300)).toBe(278);
    });

    it('stops at the board’s edge, the notice giving up the rest', () =>
    {
        expect(sheetReach(200, 400, 176, 300)).toBe(300);
    });

    it('keeps the composer whole even where that reaches over the board', () =>
    {
        expect(sheetReach(0, 278, 176, 120)).toBe(176);
    });
});

/**
 * happy-dom lays nothing out, so these install the browser's answers on the sheet itself: its
 * `scrollHeight` is everything in it laid end to end once the thread has nothing left to give, and the
 * thread is the one part that scrolls and grows. A notice that yields is a scroller of its own, and
 * what it hides is still something the chat needs.
 */
const chatSheet = (rigid: number, height: () => number, notice?: { whole: number; shown: number }) =>
{
    const sheet = document.createElement('div');

    sheet.innerHTML = '<section><header></header><div><ul style="overflow-y: auto; flex-grow: 1; padding-top: 12px; padding-bottom: 12px"></ul><div data-yield style="overflow-y: auto; min-height: 48px"></div><form><textarea style="overflow-y: auto"></textarea></form></div></section>';
    Object.defineProperty(sheet, 'scrollHeight', { configurable: true, get: () => Math.max(rigid, height()) });
    Object.defineProperty(sheet.querySelector('ul')!, 'clientHeight', { configurable: true, get: () => Math.max(0, height() - rigid) });
    Object.defineProperty(sheet.querySelector('textarea')!, 'clientHeight', { configurable: true, get: () => 24 });

    const yielding = sheet.querySelector<HTMLElement>('[data-yield]')!;

    if (notice === undefined)
    {
        yielding.remove();
    }
    else
    {
        Object.defineProperty(yielding, 'scrollHeight', { configurable: true, get: () => notice.whole });
        Object.defineProperty(yielding, 'clientHeight', { configurable: true, get: () => notice.shown });
        Object.defineProperty(yielding, 'offsetHeight', { configurable: true, get: () => notice.shown + 1 });
    }

    document.body.append(sheet);

    return sheet;
};

describe('what the chat needs', () =>
{
    afterEach(() => document.body.replaceChildren());

    it('is its header, its notices and its composer, and one line of the conversation', () =>
    {
        expect(chatNeeds(chatSheet(238, () => 355), 40).least).toBe(278);
    });

    it('reads the same when the sheet is already too short and the thread has given everything', () =>
    {
        expect(chatNeeds(chatSheet(238, () => 208), 40).least).toBe(278);
    });

    it('is lower for a sealed chat, which carries no notice', () =>
    {
        expect(chatNeeds(chatSheet(152, () => 355), 40).least).toBe(192);
    });

    it('counts a notice it has squeezed at its whole height, and can do without all of it but its first line', () =>
    {
        const needs = chatNeeds(chatSheet(193, () => 230, { whole: 86, shown: 40 }), 40);

        expect(needs.least).toBe(193 + 46 + 40);
        expect(needs.bare).toBe(193 - 41 + 48 + 24);
    });

    it('can do with no line of the conversation, but not with less than the thread’s own inset', () =>
    {
        expect(chatNeeds(chatSheet(152, () => 355), 40).bare).toBe(176);
    });
});

/**
 * The arena is a column whose bottom padding IS the sheet's room, the stage fills what the header
 * leaves, and the fit cell is whatever the stage has after the bar. This drives the observers the way
 * a browser would after every layout, and asks where the sheet settles.
 */
describe('the sheet against a laid-out table', () =>
{
    let frames: FrameRequestCallback[] = [];
    let watchers: { fire: () => void }[] = [];
    let height = 740;
    let bar = 158;
    let rigid = 152;
    let arena: HTMLElement;
    let fit: HTMLElement;
    let sheet: HTMLElement;
    let size: SheetSize | null = null;
    let settled: (SheetSize | null)[] = [];

    const chrome = 72;

    const fire = () => watchers.forEach((watcher) => watcher.fire());

    const flush = () =>
    {
        for (let round = 0; round < 8 && frames.length > 0; round += 1)
        {
            const due = frames;

            frames = [];
            due.forEach((frame) => frame(0));
            fire();
        }
    };

    const padding = () => size?.pad ?? height * SHEET_SHARE;

    const sheetHeight = () => size?.height ?? padding();

    const fitNow = () => height - chrome - padding() - bar;

    beforeEach(() =>
    {
        frames = [];
        watchers = [];
        height = 740;
        bar = 158;
        rigid = 152;
        size = null;
        settled = [];

        vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) =>
        {
            frames.push(frame);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => undefined);
        vi.stubGlobal('ResizeObserver', class
        {
            readonly #watcher: { fire: () => void };

            constructor(callback: () => void)
            {
                this.#watcher = { fire: callback };
                watchers.push(this.#watcher);
            }

            public observe()
            {
                return undefined;
            }

            public unobserve()
            {
                return undefined;
            }

            public disconnect()
            {
                watchers = watchers.filter((one) => one !== this.#watcher);
            }
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => height });
        document.documentElement.style.fontSize = '16px';

        arena = document.createElement('div');
        arena.innerHTML = '<div class="table-stage"><div class="table-fit" style="--fit-min: 262px"></div></div>';
        fit = arena.querySelector<HTMLElement>('.table-fit')!;
        arena.style.paddingBottom = `${ padding() }px`;
        fit.getBoundingClientRect = () => ({ height: fitNow(), width: 348, top: chrome, left: 0, right: 348, bottom: chrome + fitNow(), x: 0, y: chrome, toJSON: () => ({}) }) as DOMRect;
        sheet = chatSheet(0, sheetHeight);
        Object.defineProperty(sheet, 'scrollHeight', { configurable: true, get: () => Math.max(rigid, sheetHeight()) });
        Object.defineProperty(sheet.querySelector('ul')!, 'clientHeight', { configurable: true, get: () => Math.max(0, sheetHeight() - rigid) });
        document.body.append(arena, sheet);
    });

    afterEach(() =>
    {
        arena.remove();
        sheet.remove();
        document.documentElement.style.removeProperty('font-size');
        vi.unstubAllGlobals();
    });

    const follow = () => watchSheet(arena, sheet, (next) =>
    {
        size = next;
        settled.push(next);
        arena.style.paddingBottom = `${ padding() }px`;
    });

    it('gives the board its floor on a 360x740 phone and keeps the rest for the chat', () =>
    {
        const stop = follow();

        flush();

        expect(fitNow()).toBe(262);
        expect(size).toEqual({ pad: 248, height: 248 });
        expect(size!.pad).toBeLessThan(740 * SHEET_SHARE);
        stop();
    });

    it('gives up more when the bar grows, and does not bob back when it shrinks again', () =>
    {
        const stop = follow();

        flush();
        bar = 198;
        fire();
        flush();

        expect(fitNow()).toBe(262);
        expect(size).toEqual({ pad: 208, height: 208 });

        bar = 158;
        fire();
        flush();

        expect(size).toEqual({ pad: 208, height: 208 });
        expect(fitNow()).toBe(302);
        stop();
    });

    it('starts again from half the screen when the screen itself changes height', () =>
    {
        const stop = follow();

        flush();
        height = 844;
        fire();
        flush();

        expect(fitNow()).toBe(262);
        expect(size).toEqual({ pad: 352, height: 352 });
        stop();
    });

    it('lays the chat over the bar when a notice leaves it no line in the room the board can spare, and the board keeps its floor', () =>
    {
        rigid = 238;

        const stop = follow();

        flush();

        expect(fitNow()).toBe(262);
        expect(size).toEqual({ pad: 248, height: 278 });
        stop();
    });

    it('settles once and stays put while nothing moves', () =>
    {
        rigid = 238;

        const stop = follow();

        flush();
        fire();
        flush();

        expect(settled).toHaveLength(1);
        stop();
    });

    it('stops reaching over the bar when a taller screen has room for both', () =>
    {
        rigid = 238;

        const stop = follow();

        flush();
        height = 900;
        fire();
        flush();

        expect(fitNow()).toBe(262);
        expect(size).toEqual({ pad: 408, height: 408 });
        stop();
    });

    it('keeps the board its floor on a phone too short for both, and the chat its line over the bar', () =>
    {
        height = 640;
        arena.style.paddingBottom = `${ padding() }px`;

        const stop = follow();

        flush();

        expect(fitNow()).toBe(262);
        expect(size).toEqual({ pad: 148, height: 192 });
        stop();
    });

    it('lets go of the size when the table has no floor to keep, so the half sheet comes back', () =>
    {
        fit.style.removeProperty('--fit-min');
        size = { pad: 300, height: 300 };

        const stop = follow();

        flush();

        expect(size).toBeNull();
        stop();
    });
});

describe('folding the header for a board under its floor', () =>
{
    let frames: FrameRequestCallback[] = [];
    let watchers: { fire: () => void }[] = [];
    let height = 640;
    let folded = false;
    let seen: boolean[] = [];

    const fire = () => watchers.forEach((watcher) => watcher.fire());

    const flush = () =>
    {
        for (let round = 0; round < 8 && frames.length > 0; round += 1)
        {
            const due = frames;

            frames = [];
            due.forEach((frame) => frame(0));
            fire();
        }
    };

    const table = (room: () => number) =>
    {
        const arena = document.createElement('div');

        arena.innerHTML = '<div class="table-stage"><div class="table-fit" style="--fit-min: 314px"></div></div>';
        arena.querySelector<HTMLElement>('.table-fit')!.getBoundingClientRect = () => ({ height: room(), width: 348, top: 124, left: 0, right: 348, bottom: 124 + room(), x: 0, y: 124, toJSON: () => ({}) }) as DOMRect;
        document.body.append(arena);

        return watchFold(arena, (fold) =>
        {
            folded = fold;
            seen.push(fold);
        });
    };

    beforeEach(() =>
    {
        frames = [];
        watchers = [];
        height = 640;
        folded = false;
        seen = [];

        vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) =>
        {
            frames.push(frame);
            return frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => undefined);
        vi.stubGlobal('ResizeObserver', class
        {
            readonly #watcher: { fire: () => void };

            constructor(callback: () => void)
            {
                this.#watcher = { fire: callback };
                watchers.push(this.#watcher);
            }

            public observe()
            {
                return undefined;
            }

            public unobserve()
            {
                return undefined;
            }

            public disconnect()
            {
                watchers = watchers.filter((one) => one !== this.#watcher);
            }
        });
        Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => height });
    });

    afterEach(() =>
    {
        document.body.replaceChildren();
        vi.unstubAllGlobals();
    });

    it('folds once when the board is under its floor, and does not unfold while the screen keeps its height', () =>
    {
        const stop = table(() => height - 343 + (folded ? 52 : 0));

        flush();
        fire();
        flush();

        expect(seen).toEqual([true]);
        stop();
    });

    it('unfolds when the screen grows tall enough for the board without it', () =>
    {
        const stop = table(() => height - 343 + (folded ? 52 : 0));

        flush();
        height = 740;
        fire();
        flush();

        expect(seen).toEqual([true, false]);
        expect(folded).toBe(false);
        stop();
    });

    it('never folds a board that has room', () =>
    {
        const stop = table(() => 320);

        flush();

        expect(seen).toEqual([]);
        stop();
    });
});

describe('where a sheet below the header starts', () =>
{
    let watchers: { fire: () => void }[] = [];

    beforeEach(() =>
    {
        watchers = [];
        vi.stubGlobal('ResizeObserver', class
        {
            readonly #watcher: { fire: () => void };

            constructor(callback: () => void)
            {
                this.#watcher = { fire: callback };
                watchers.push(this.#watcher);
            }

            public observe()
            {
                return undefined;
            }

            public disconnect()
            {
                watchers = watchers.filter((one) => one !== this.#watcher);
            }
        });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('follows the header’s bottom edge as it grows, shrinks and the window moves it, and stops when asked', () =>
    {
        const header = document.createElement('header');
        let bottom = 62;
        const seen: number[] = [];

        header.getBoundingClientRect = () => ({ bottom, top: 8, height: bottom - 8, left: 0, right: 740, width: 740, x: 0, y: 8, toJSON: () => ({}) }) as DOMRect;
        document.body.append(header);

        const stop = watchEdge(header, (edge) => seen.push(edge));

        bottom = 112;
        watchers.forEach((watcher) => watcher.fire());
        bottom = 70.4;
        window.dispatchEvent(new Event('resize'));
        stop();
        bottom = 90;
        window.dispatchEvent(new Event('resize'));

        expect(seen).toEqual([62, 112, 70]);
        expect(watchers).toHaveLength(0);
        header.remove();
    });
});
