import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { RouterProvider, createMemoryHistory, createRouter, type Route } from 'azerothjs';

import { addressWith, pageOf, textOf, useAddress, usePageParams, type Address, type PageParams } from '../src/lib/page-param.ts';

const settle = async () =>
{
    for (let i = 0; i < 6; i += 1)
    {
        await Promise.resolve();
    }
};

const at = (path: string) =>
{
    const Stub = (): HTMLElement => document.createElement('div');
    const routes: Route[] = [{ path: '/app/search', component: Stub }];
    const router = createRouter({ routes, history: createMemoryHistory(path), scroll: false });
    const held: { address?: Address; pages?: PageParams<'people' | 'messages'> } = {};

    renderTest(() => RouterProvider({ router, children: () =>
    {
        held.address = useAddress();
        held.pages = usePageParams(['people', 'messages']);
        return document.createElement('div');
    } }) as HTMLElement);

    return { router, address: held.address!, pages: held.pages! };
};

beforeEach(() => cleanup());

describe('a page kept in the address', () =>
{
    it('reads a page number, and the first page for anything that is not one', () =>
    {
        expect(pageOf('3')).toBe(3);
        expect(pageOf(['4', '9'])).toBe(4);

        for (const raw of [undefined, '', '1', '0', '-2', '2.5', 'two', '1e3x', ' '])
        {
            expect(pageOf(raw), `"${ String(raw) }" was read as a page`).toBe(1);
        }
    });

    it('writes the page beside what the address already says, and leaves the first page out', () =>
    {
        expect(addressWith('/app/watch', { game: 'ludo' }, { page: 2 })).toBe('/app/watch?game=ludo&page=2');
        expect(addressWith('/app/watch', { game: 'ludo', page: '2' }, { page: 1 })).toBe('/app/watch?game=ludo');
        expect(addressWith('/app/friends', {}, { page: 1 })).toBe('/app/friends');
        expect(addressWith('/app/search', { q: 'sara k', people: '3', messages: '2' }, { people: 1, messages: 1 })).toBe('/app/search?q=sara+k');
        expect(addressWith('/app/me/settings', { blocked: '2', tag: ['a', 'b'] }, { muted: 3 })).toBe('/app/me/settings?blocked=2&tag=a&tag=b&muted=3');
    });
});

describe('words kept in the address', () =>
{
    it('reads the first of a word given twice, and nothing for no word', () =>
    {
        expect(textOf('cards')).toBe('cards');
        expect(textOf(['board', 'cards'])).toBe('board');
        expect(textOf(undefined)).toBe('');
    });

    it('writes a word beside the rest of the address, and leaves an empty word out', () =>
    {
        expect(addressWith('/app/search', { people: '3' }, { q: 'sara', people: 1 })).toBe('/app/search?q=sara');
        expect(addressWith('/app/search', { q: 'sara', scope: 'people' }, { scope: '' })).toBe('/app/search?q=sara');
        expect(addressWith('/app/leaderboard', { game: 'ludo' }, { window: 'today' })).toBe('/app/leaderboard?game=ludo&window=today');
        expect(addressWith('/app/games', { category: 'cards' }, { category: 'board' })).toBe('/app/games?category=board');
        expect(addressWith('/app/leaderboard', { game: 'ludo', window: 'today' }, { game: 'hokm' }), 'a word written again moved to the end').toBe('/app/leaderboard?game=hokm&window=today');
    });

    it('writes with replace, keeps what it was not asked to change, and writes nothing the address already says', async () =>
    {
        const { router, address } = at('/app/search?q=sara&people=2');

        address.write({ scope: 'people' });
        await settle();

        expect(router.location().fullPath).toBe('/app/search?q=sara&people=2&scope=people');
        expect(router.location().navigationKind, 'a filter chosen was a step Back would walk').toBe('replace');
        expect(address.text('scope')).toBe('people');

        const key = router.location().key;

        address.write({ scope: 'people', q: 'sara' });
        await settle();

        expect(router.location().key, 'an address that already said so was written again').toBe(key);

        address.write({ scope: '' });
        await settle();

        expect(router.location().fullPath).toBe('/app/search?q=sara&people=2');
    });

    it('takes every page back to the first when the words change', async () =>
    {
        const { router, pages } = at('/app/search?q=sara&people=3&messages=2');

        pages.reset({ q: 'omid' });
        await settle();

        expect(router.location().fullPath).toBe('/app/search?q=omid');
    });
});
