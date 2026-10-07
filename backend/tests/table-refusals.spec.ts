import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HttpError, ValidationError, errorResponse } from '@azerothjs/http';

import { REFUSALS } from '../src/domains/match/refusals.ts';
import { TABLE_REFUSALS, isTableRefusal, type TableRefusal } from '../src/domains/table/refusals.ts';
import { noInvitee, tableRefusal } from '../src/domains/table/service.ts';

const WORDS = Object.keys(TABLE_REFUSALS) as TableRefusal[];

const FRAMEWORK = [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 499, 500, 502, 503, 599]
    .map((status) => new HttpError(status, 'x').code)
    .concat(new ValidationError({}).code);

const HERE = dirname(fileURLToPath(import.meta.url));

const THROWERS = ['domains/table/service.ts', 'domains/match/service.ts', 'services.ts'];

const sourceOf = (path: string) => readFileSync(join(HERE, '..', 'src', path), 'utf8');

const sent = async (refusal: HttpError) =>
{
    const response = errorResponse(refusal);

    return { status: response.status, body: await response.text() };
};

describe('a table refusal', () =>
{
    it.each(Object.entries(TABLE_REFUSALS) as [TableRefusal, number][])('answers %s with that word as its code, at the status the list gives it', (word, status) =>
    {
        const refusal = tableRefusal(word, 'Why not.');

        expect(refusal).toBeInstanceOf(HttpError);
        expect(refusal).toMatchObject({ status, code: word, message: 'Why not.', expose: true });
    });

    it('is a mistake a reader is told about, never a fault kept back', () =>
    {
        expect(WORDS.length).toBeGreaterThan(0);

        for (const word of WORDS)
        {
            expect(TABLE_REFUSALS[word], word).toBeGreaterThanOrEqual(400);
            expect(TABLE_REFUSALS[word], word).toBeLessThan(500);
        }
    });

    it('spells every word in kebab case, which is what the wire calls a code', () =>
    {
        for (const word of WORDS)
        {
            expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
    });

    it('shares no word with a refused play, or with a code the framework answers on its own', () =>
    {
        expect(FRAMEWORK).toEqual(expect.arrayContaining(['forbidden', 'conflict', 'not-found', 'validation-failed', 'internal']));
        expect(WORDS.filter((word) => FRAMEWORK.includes(word))).toEqual([]);
        expect(WORDS.filter((word) => Object.hasOwn(REFUSALS, word))).toEqual([]);
    });

    it('knows its own words and nothing an object merely inherits', () =>
    {
        for (const word of WORDS)
        {
            expect(isTableRefusal(word), word).toBe(true);
        }

        for (const other of ['', 'conflict', 'not-found', 'not-your-turn', 'teleport', 'toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'])
        {
            expect(isTableRefusal(other), other).toBe(false);
        }
    });

    it('is never spelled by hand where it is thrown', () =>
    {
        for (const path of THROWERS)
        {
            expect(sourceOf(path).match(/\bcode:\s*['"`][^'"`]*['"`]/g) ?? [], path).toEqual([]);
        }
    });

    it('has somebody who throws every word on the list', () =>
    {
        const thrown = THROWERS.map(sourceOf).join('\n');

        expect(WORDS.filter((word) => !thrown.includes(`tableRefusal('${ word }'`))).toEqual([]);
    });
});

describe('a quick search that cannot be run', () =>
{
    it('is a request that was wrong, never a table that stood in the way', () =>
    {
        expect(TABLE_REFUSALS['quick-game']).toBe(422);
        expect(TABLE_REFUSALS['quick-options']).toBe(422);
    });

    it('has no word for finding nothing to join, or for a table it could not have', () =>
    {
        expect(WORDS.filter((word) => word.startsWith('quick-'))).toEqual(['quick-game', 'quick-options']);
    });
});

describe('nobody to invite', () =>
{
    it('answers as a missing thing, never as a forbidden one', () =>
    {
        expect(TABLE_REFUSALS['no-invitee']).toBe(404);
        expect(noInvitee()).toMatchObject({ status: 404, code: 'no-invitee', expose: true });
    });

    it('is one sentence, the same bytes every time it is said', async () =>
    {
        const first = await sent(noInvitee());

        expect(first).toEqual({
            status: 404,
            body: JSON.stringify({ error: { code: 'no-invitee', message: 'No one by that name can be invited.' } })
        });
        expect(await sent(noInvitee())).toEqual(first);
    });

    it('is the only thing an invitation says about who somebody is, a name nobody holds included', () =>
    {
        const source = sourceOf('domains/table/service.ts');

        expect(['You cannot reach that account.', 'They are not taking invitations'].filter((old) => source.includes(old))).toEqual([]);
        expect(sourceOf('services.ts').includes('throw noInvitee()')).toBe(true);
    });
});
