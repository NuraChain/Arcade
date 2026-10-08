import { describe, it, expect } from 'vitest';

import { GAMES, gameBySlug } from '../src/data/games.ts';
import { en, type Dictionary } from '../src/locales/en.ts';
import { fa } from '../src/locales/fa.ts';
import { messageText } from '../src/locales/format.ts';
import { PARTY_ENDS, PARTY_REFUSALS } from '../../backend/src/domains/party/rules.ts';

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

    it('stands the four games in one row, in catalogue order, a plinth apart', () =>
    {
        const xs = GAMES.map((game) => game.anchor[0]);
        expect(GAMES.every((game) => game.anchor[1] === 0 && game.anchor[2] === 0)).toBe(true);
        for (let index = 1; index < xs.length; index += 1)
        {
            expect(xs[index] - xs[index - 1]).toBeGreaterThan(1);
        }
        expect(xs[0] + xs[xs.length - 1]).toBeCloseTo(0, 6);
    });

    it('states a seat range that reads in the right order', () =>
    {
        for (const game of GAMES)
        {
            expect(game.minPlayers).toBeGreaterThan(0);
            expect(game.maxPlayers).toBeGreaterThanOrEqual(game.minPlayers);
        }
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
        const compose = (d: Dictionary) =>
            `${ messageText(d['brand.lead']) } ${ messageText(d['brand.accent']) } ${ messageText(d['brand.trail']) }`
                .replace(/\s+/g, ' ')
                .trim();

        expect(compose(en)).toBe(en['brand.name']);
        expect(compose(fa)).toBe(messageText(fa['brand.name']));
    });
});

describe('the words for a team-up', () =>
{
    const keys = (Object.keys(en) as string[]).filter((key) => key.startsWith('party.'));

    const said = (stem: string) => keys.filter((key) => key.startsWith(stem)).map((key) => key.slice(stem.length)).sort();

    it('have a sentence for every refusal and every ending, and none for a word the server does not have', () =>
    {
        expect(said('party.refused.')).toEqual(Object.keys(PARTY_REFUSALS).sort());
        expect(said('party.ended.')).toEqual([...PARTY_ENDS].sort());
    });

    it('are each said somewhere in the product', () =>
    {
        const source = Object.values(import.meta.glob(
            ['../src/**/*.{ts,azeroth}', '!../src/main.azeroth', '!../src/locales/**'],
            { query: '?raw', import: 'default', eager: true }
        ) as Record<string, string>).join('\n');
        const composed = ['party.refused.', 'party.ended.'].filter((stem) => source.includes(['`', stem, '$', '{'].join('')));
        const unsaid = keys.filter((key) => !source.includes(`'${ key }'`) && !composed.some((stem) => key.startsWith(stem)));

        expect(keys.length, 'the team-up has no words at all').toBeGreaterThan(10);
        expect(composed, 'nothing composes a refusal’s or an ending’s key any more').toHaveLength(2);
        expect(unsaid, 'a sentence with nothing that says it').toEqual([]);
    });
});
