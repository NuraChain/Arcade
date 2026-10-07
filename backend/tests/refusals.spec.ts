import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError } from '@azerothjs/http';

import { REFUSALS, isRefusal } from '../src/domains/match/refusals.ts';
import { refuse } from '../src/domains/match/service.ts';
import { refused } from '../src/realtime/frames.ts';
import { refusalOf } from '../src/realtime/gateway.ts';

const WORDS = Object.keys(REFUSALS);

const FRAMEWORK = [400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 499, 500, 502, 503, 599]
    .map((status) => new HttpError(status, 'x').code)
    .concat(new ValidationError({}).code);

const UNSAID = ['', new ForbiddenError().message, new ConflictError().message];

const thrownBy = (reason: string) =>
{
    try
    {
        refuse(reason);
    }
    catch (error)
    {
        return error;
    }
};

describe('a refused play', () =>
{
    it.each(Object.entries(REFUSALS))('answers %s with that word as its code', (word, kind) =>
    {
        const thrown = thrownBy(word);

        expect(thrown).toBeInstanceOf(HttpError);
        expect(thrown).toMatchObject({ status: kind === 'forbidden' ? 403 : 409, code: word, expose: true });
        expect(UNSAID).not.toContain((thrown as HttpError).message.trim());
    });

    it('answers a reason nobody listed as an illegal move, in the code and in the sentence', () =>
    {
        const known = thrownBy('illegal-move') as HttpError;

        for (const reason of ['teleport', '', 'toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'])
        {
            expect(isRefusal(reason), reason).toBe(false);
            expect(thrownBy(reason), reason).toMatchObject({ status: 409, code: 'illegal-move', message: known.message });
        }
    });

    it('spells every word in kebab case, which is what the wire calls a code', () =>
    {
        for (const word of WORDS)
        {
            expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
    });

    it('shares no word with a code the framework answers on its own', () =>
    {
        expect(FRAMEWORK).toEqual(expect.arrayContaining(['forbidden', 'conflict', 'not-found', 'validation-failed', 'internal']));
        expect(WORDS.filter((word) => FRAMEWORK.includes(word))).toEqual([]);
    });
});

describe('a refusal on its way to a socket', () =>
{
    it('keeps the status, the word and the sentence of everything the match service refuses', () =>
    {
        for (const word of WORDS)
        {
            const thrown = thrownBy(word) as HttpError;

            expect(refusalOf(thrown)).toEqual({ status: thrown.status, code: word, message: thrown.message });
        }
    });

    it('forwards the code of any error meant to be read, a match word or not', () =>
    {
        expect(refusalOf(new ConflictError('A game is being played at that table.', { code: 'playing' })))
            .toEqual({ status: 409, code: 'playing', message: 'A game is being played at that table.' });
        expect(refusalOf(new NotFoundError('No game there.'))).toEqual({ status: 404, code: 'not-found', message: 'No game there.' });
        expect(refusalOf(new ValidationError({ play: 'Not a play this game knows.' }, 'That is not a move in this game.')))
            .toEqual({ status: 422, code: 'validation-failed', message: 'That is not a move in this game.' });
    });

    it('says nothing about an error that was never meant to be read', () =>
    {
        const quiet = { status: 500, code: 'internal', message: 'Something went wrong.' };

        expect(refusalOf(new Error('boom'))).toEqual(quiet);
        expect(refusalOf(new HttpError(500, 'relation "matches" does not exist'))).toEqual(quiet);
        expect(refusalOf(new HttpError(503, 'the pool is exhausted', { code: 'pool-exhausted' }))).toEqual(quiet);
        expect(refusalOf('boom')).toEqual(quiet);
        expect(refusalOf(null)).toEqual(quiet);
    });

    it('builds the frame with the code beside the status and the sentence', () =>
    {
        expect(refused(3, 'k-1', 'm-1', { status: 403, code: 'not-your-turn', message: 'It is not your turn.' }))
            .toEqual({ v: 1, t: 'refused', n: 3, key: 'k-1', match: 'm-1', status: 403, code: 'not-your-turn', message: 'It is not your turn.' });
    });
});
