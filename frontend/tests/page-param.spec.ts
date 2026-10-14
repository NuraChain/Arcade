import { describe, it, expect } from 'vitest';

import { addressWith, pageOf } from '../src/lib/page-param.ts';

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
