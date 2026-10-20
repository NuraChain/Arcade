import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import PlayHeader from '../src/components/games/play-header.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import type { TableSummary } from '../src/api.ts';

type Rendered = HTMLElement;

const table = (extra: Partial<TableSummary> = {}): TableSummary => ({
    id: 'table-here',
    code: 'here01',
    game: 'hokm',
    seats: 2,
    mode: 'turns',
    privacy: 'public',
    target: 7,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: 'off',
    teams: false,
    status: 'playing',
    chairs: [],
    taken: 2,
    createdAt: new Date(0).toISOString(),
    ...extra
});

const OTHERS = [
    table({ id: 'table-waits', code: 'wait01', game: 'backgammon', yourTurn: true }),
    table({ id: 'table-quiet', code: 'quiet1', game: 'ludo' })
];

const shown = (others: TableSummary[], compact = false, here: TableSummary = table()) =>
{
    const Stub = (): HTMLElement => document.createElement('div');
    const routes: Route[] = [{ path: '/app/play/:id', component: Stub }];
    const router = createRouter({ routes, history: createMemoryHistory('/app/play/table-here'), scroll: false });

    return renderTest(() => RouterProvider({ router, children: () => PlayHeader({ table: here, others, compact }) }) as Rendered).container;
};

const has = (element: Element | null | undefined, ...names: string[]) => names.map((name) => element?.classList.contains(name) === true);

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(600_000), seed: 16 });
    useLocale().setLocale('en');
});

afterEach(() =>
{
    cleanup();
});

describe('the head of a table beside the reader\'s other tables', () =>
{
    const row = (container: HTMLElement) => container.querySelector('header > div');
    const title = (container: HTMLElement) => container.querySelector('header > div > div');
    const strip = (container: HTMLElement) => container.querySelector('nav.play-others');

    it('keeps the table\'s own line its room on one row, and gives the strip of the others what is left', () =>
    {
        const container = shown(OTHERS);

        expect(has(row(container), '@2xl:flex-nowrap'), 'a thing to press could drop to a row of its own').toEqual([true]);
        expect(has(title(container), 'flex-1', '@2xl:flex-[0_1_22rem]'), 'the title takes what the strip leaves, which was a word and a half').toEqual([true, true]);
        expect(has(strip(container), '@2xl:flex-1', '@2xl:min-w-0', '@2xl:justify-end', '@2xl:order-2'), 'the strip does not take what is left').toEqual([true, true, true, true]);
        expect(has(strip(container), '@2xl:shrink-0', '@2xl:max-w-[45%]', '@2xl:basis-auto'), 'the strip holds a share of the row however little there is').toEqual([false, false, false]);
        expect(has(strip(container), 'order-3', 'basis-full'), 'on a narrow head the strip has a row of its own, as before').toEqual([true, true]);
    });

    it('never lets the table\'s code lie over the strip: what does not fit on the line is cut at the line\'s edge', () =>
    {
        const container = shown(OTHERS);
        const copy = [...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === 'Copy the table code HERE01');

        expect(copy, 'the code is not a button on the line').toBeDefined();
        expect(has(copy?.parentElement, 'overflow-x-clip', 'min-w-0')).toEqual([true, true]);
        expect(has(copy?.parentElement, 'overflow-hidden', 'overflow-x-hidden'), 'the tall box a finger presses the code by is cut to the line').toEqual([false, false]);
    });

    it('asks the title itself how much room there is, for everything drawn inside it', () =>
    {
        const container = shown(OTHERS, false, table({ voice: 'table' }));
        const inside = [...(title(container)?.querySelectorAll('*') ?? [])];
        const copy = [...container.querySelectorAll('button')].find((one) => one.getAttribute('aria-label') === 'Copy the table code HERE01');
        const said = inside.filter((one) => one.textContent === 'Voice on' && one.children.length === 0);

        expect(inside.length).toBeGreaterThan(8);
        expect(inside.filter((one) => /\/head:/.test(one.getAttribute('class') ?? '')).map((one) => one.getAttribute('class')), 'a thing inside the title asks about the head, and keeps the answer it had when the page was drawn').toEqual([]);
        expect(has(copy, 'hidden', '@min-[21rem]/title:flex'), 'the code is drawn on a title with no room for it, or never').toEqual([true, true]);
        expect(has(copy?.previousElementSibling, 'hidden', '@min-[21rem]/title:block'), 'the dot before the code does not come and go with it').toEqual([true, true]);
        expect(said.map((one) => has(one, 'hidden', '@min-[26rem]/title:inline', 'sr-only', '@min-[26rem]/title:hidden')), 'the words of a voice table are not drawn where there is room and said where there is not').toEqual([[true, true, false, false], [false, false, true, true]]);
    });

    it('leaves the title the whole row where there is no other table, and where the strip is folded into the title\'s row', () =>
    {
        expect(has(title(shown([])), 'flex-1', '@2xl:flex-[0_1_22rem]')).toEqual([true, false]);
        expect(strip(shown([]))).toBeNull();

        cleanup();

        const folded = shown(OTHERS, true);

        expect(has(title(folded), 'flex-1', '@2xl:flex-[0_1_22rem]')).toEqual([true, false]);
        expect(has(strip(folded), 'order-1', '@2xl:flex-1')).toEqual([true, false]);
    });

    it('draws a table in a narrow strip as its mark alone, and still says its game, its code and whose turn it is', () =>
    {
        const links = [...shown(OTHERS).querySelectorAll<HTMLAnchorElement>('nav.play-others a')];
        const [waits, quiet] = links;
        const words = (link: HTMLAnchorElement) => link.querySelector('[data-words]');
        const dot = (link: HTMLAnchorElement) => link.querySelector(':scope > [aria-hidden="true"]');

        expect(links.map((link) => link.getAttribute('href'))).toEqual(['/app/play/table-waits', '/app/play/table-quiet']);
        expect(has(words(waits), 'contents', '@2xl/head:block', '@2xl/head:sr-only', '@4xl/head:contents'), 'the words are drawn in a strip with no room for them, or are taken from a screen reader').toEqual([true, true, true, true]);
        expect(has(words(waits), 'hidden', '@2xl/head:hidden')).toEqual([false, false]);
        expect([...(words(waits)?.children ?? [])].map((one) => one.textContent?.trim())).toEqual(['Backgammon', 'wait01', 'Your go']);
        expect([...(words(quiet)?.children ?? [])].map((one) => one.textContent?.trim())).toEqual(['Ludo', 'quiet1']);
        expect(has(waits, 'relative', 'h-11', '@2xl/head:pe-1.5', '@4xl/head:pe-3')).toEqual([true, true, true, true]);
        expect(has(dot(waits), 'absolute', 'hidden', '@2xl/head:block', '@4xl/head:hidden', 'bg-live'), 'a table waiting on the reader has no mark of it once its words are gone').toEqual([true, true, true, true, true]);
        expect(dot(quiet), 'a table that waits on nobody is marked as waiting').toBeNull();
    });
});
