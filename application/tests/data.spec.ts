import { describe, it, expect } from 'vitest';

import { GAMES, SEAT_GAP, TABLE_OVAL, TABLE_RADIUS, gameBySlug, seatAround } from '../src/data/games.ts';
import { en, type Dictionary } from '../src/locales/en.ts';
import { fa } from '../src/locales/fa.ts';
import { messageText } from '../src/locales/format.ts';

describe('games catalogue', () =>
{
    it('has a unique id and slug for every game', () =>
    {
        expect(new Set(GAMES.map((game) => game.id)).size).toBe(GAMES.length);
        expect(new Set(GAMES.map((game) => game.slug)).size).toBe(GAMES.length);
    });

    it('names every message key it points at, in both languages', () =>
    {
        for (const game of GAMES)
        {
            for (const key of [game.nameKey, game.blurbKey, game.categoryKey])
            {
                expect(en[key], `en is missing ${ key }`).toBeTruthy();
                expect(fa[key], `fa is missing ${ key }`).toBeTruthy();
            }
        }
    });

    it('gives every table a distinct spot in the world', () =>
    {
        const anchors = GAMES.map((game) => game.anchor.join(','));
        expect(new Set(anchors).size).toBe(GAMES.length);
    });

    it('keeps every table inside the camera path the keyframes sweep', () =>
    {
        for (const game of GAMES)
        {
            const [x, y, z] = game.anchor;
            expect(Math.abs(x), `${ game.id } is outside the dolly's reach`).toBeLessThanOrEqual(16);
            expect(Math.abs(y), `${ game.id } floats too far off the market's plane`).toBeLessThanOrEqual(3);
            expect(z, `${ game.id } sits behind the camera`).toBeLessThanOrEqual(2);
        }
    });

    it('states a seat range that reads in the right order', () =>
    {
        for (const game of GAMES)
        {
            expect(game.minPlayers).toBeGreaterThan(0);
            expect(game.maxPlayers).toBeGreaterThanOrEqual(game.minPlayers);
        }
    });

    it('spends the competitive accent on nothing by default', () =>
    {
        expect(GAMES.every((game) => game.accent === 'lamp')).toBe(true);
    });

    it('finds a game by slug and refuses one that does not exist', () =>
    {
        expect(gameBySlug('backgammon')?.id).toBe('backgammon');
        expect(gameBySlug('roulette')).toBeUndefined();
    });

    it('carries exactly the four games the product supports', () =>
    {
        expect(GAMES.map((game) => game.id)).toEqual(['hokm', 'poker', 'backgammon', 'ludo']);
    });

    it('lays a physical set on every table', () =>
    {
        expect(GAMES.every((game) => game.set !== undefined)).toBe(true);
    });
});

describe('seating', () =>
{
    it('keeps a round table seat one gap outside the rim, facing away from the centre', () =>
    {
        const seat = seatAround('table-card', 0.7, 0.3);
        expect(Math.hypot(seat.x, seat.z)).toBeCloseTo(TABLE_RADIUS['table-card'] + SEAT_GAP, 6);
        expect(seat.facing).toBeCloseTo(0.7, 6);
    });

    it('offsets an oval seat along the rail normal instead of a circle', () =>
    {
        const [a, b] = TABLE_OVAL['table-poker'] ?? [0, 0];
        const end = seatAround('table-poker', 0, 0);
        expect(end.x).toBeCloseTo(a + SEAT_GAP, 6);
        expect(end.z).toBeCloseTo(0, 6);

        const side = seatAround('table-poker', Math.PI / 2, 0);
        expect(side.z).toBeCloseTo(b + SEAT_GAP, 6);

        const corner = seatAround('table-poker', Math.PI / 4, 0);
        const px = Math.cos(Math.PI / 4) * a;
        const pz = Math.sin(Math.PI / 4) * b;
        expect(Math.hypot(corner.x - px, corner.z - pz)).toBeCloseTo(SEAT_GAP, 6);
        expect(corner.facing).toBeGreaterThan(Math.PI / 4);
    });

    it('turns the oval with the table', () =>
    {
        const rotated = seatAround('table-poker', 0.5, 0.5);
        const [a] = TABLE_OVAL['table-poker'] ?? [0, 0];
        expect(Math.hypot(rotated.x, rotated.z)).toBeCloseTo(a + SEAT_GAP, 6);
        expect(rotated.facing).toBeCloseTo(0.5, 6);
    });
});

describe('message catalogues', () =>
{
    it('translates every English key into Persian with a different string', () =>
    {
        const copied = (Object.keys(en) as Array<keyof typeof en>).filter((key) =>
            messageText(en[key]) !== '' && messageText(en[key]) === messageText(fa[key]));

        expect(copied, `untranslated: ${ copied.join(', ') }`).toEqual([]);
    });

    it('spells the same plural forms in both languages', () =>
    {
        for (const key of Object.keys(en) as Array<keyof typeof en>)
        {
            const english = en[key];
            const persian = fa[key];
            expect(typeof persian, `${ key } changes shape between languages`).toBe(typeof english);
            if (typeof english !== 'string' && typeof persian !== 'string')
            {
                expect(Object.keys(persian).sort(), `${ key } plural forms`).toEqual(Object.keys(english).sort());
            }
        }
    });

    it('keeps every placeholder a key uses in both languages', () =>
    {
        const placeholders = (text: string): string[] => (text.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
        for (const key of Object.keys(en) as Array<keyof typeof en>)
        {
            expect(placeholders(messageText(fa[key])), key).toEqual(placeholders(messageText(en[key])));
        }
    });

    it('keeps the brand mark assembling to the full name in both languages', () =>
    {
        const compose = (d: Dictionary): string =>
            `${ messageText(d['brand.lead']) } ${ messageText(d['brand.accent']) } ${ messageText(d['brand.trail']) }`
                .replace(/\s+/g, ' ')
                .trim();

        expect(compose(en)).toBe(en['brand.name']);
        expect(compose(fa)).toBe(messageText(fa['brand.name']));
    });
});
