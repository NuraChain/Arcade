import { describe, expect, it } from 'vitest';

import { refusalOf } from '../src/lib/refusal.ts';
import { en, type Dictionary, type MessageKey } from '../src/locales/en.ts';
import { fa } from '../src/locales/fa.ts';
import { messageText } from '../src/locales/format.ts';
import { REFUSALS, isRefusal } from '../../backend/src/domains/match/refusals.ts';
import { ApiError } from './fake-api.ts';

const WORDS = Object.keys(REFUSALS);

const CATALOGUES: readonly (readonly [string, Dictionary])[] = [['en', en], ['fa', fa]];

const PREFIX = 'match.refused.';

const said = (catalogue: Dictionary, word: string) =>
    Object.hasOwn(catalogue, `${ PREFIX }${ word }`)
        ? messageText(catalogue[`${ PREFIX }${ word }` as MessageKey]).trim()
        : '';

const unsaid = (words: readonly string[]) =>
    CATALOGUES.flatMap(([language, catalogue]) => words
        .filter((word) => said(catalogue, word) === '')
        .map((word) => `${ language } ${ PREFIX }${ word }`));

describe('the words for a refused play', () =>
{
    it('has a sentence for every word the server can refuse with, in both languages', () =>
    {
        expect(unsaid(WORDS)).toEqual([]);
    });

    it('notices a word that has no sentence', () =>
    {
        expect(unsaid(['teleport', 'constructor'])).toEqual([
            'en match.refused.teleport',
            'en match.refused.constructor',
            'fa match.refused.teleport',
            'fa match.refused.constructor'
        ]);
    });

    it('says nothing for a word the server does not have', () =>
    {
        const orphans = CATALOGUES.flatMap(([language, catalogue]) => Object.keys(catalogue)
            .filter((key) => key === 'match.refused' || key.startsWith(PREFIX))
            .filter((key) => !isRefusal(key.slice(PREFIX.length)))
            .map((key) => `${ language } ${ key }`));

        expect(orphans).toEqual([]);
    });
});

describe('reading a refusal', () =>
{
    it('reads the word off a refused play', () =>
    {
        for (const word of WORDS)
        {
            expect(refusalOf(new ApiError(409, word, 'x', undefined))).toBe(word);
        }
    });

    it('reads nothing off a code that is not a word, or off anything that is not a refusal', () =>
    {
        for (const code of ['conflict', 'forbidden', 'not-found', 'validation-failed', 'internal', 'refused', '', 'constructor', 'toString', '__proto__'])
        {
            expect(refusalOf(new ApiError(409, code, 'x', undefined)), code).toBeNull();
        }

        expect(refusalOf(new Error('not-your-turn'))).toBeNull();
        expect(refusalOf({ status: 403, code: 'not-your-turn' })).toBeNull();
        expect(refusalOf('not-your-turn')).toBeNull();
        expect(refusalOf(undefined)).toBeNull();
    });
});
