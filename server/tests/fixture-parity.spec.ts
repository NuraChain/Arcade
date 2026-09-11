import { describe, expect, it } from 'vitest';

import { PEOPLE_FIXTURES, THREAD_FIXTURES } from '../src/db/seed-fixtures.ts';
import { PEOPLE } from '../../application/src/data/mock/people.ts';
import { THREADS } from '../../application/src/data/mock/threads.ts';

/**
 * The fixtures and the mock describe the same imaginary people, and they will drift.
 *
 * The server seeds who EXISTS and who knows whom; the browser's mock is now only the profile a
 * person has - portrait, favourite game, region, statistics - joined by handle, because no domain
 * owns those yet. Add somebody on one side without the other and the join silently produces a
 * person with no face, so this is the test that notices.
 *
 * It goes away with the mock, which is the whole point of the domain work.
 */

describe('the fixtures and the mock agree about who exists', () =>
{
    it('has the same people, by handle', () =>
    {
        expect(PEOPLE_FIXTURES.map((person) => person.handle).sort())
            .toEqual(PEOPLE.map((person) => person.handle).sort());
    });

    it('gives each of them the same name, hue and age gate', () =>
    {
        const mock = new Map(PEOPLE.map((person) => [person.handle, person]));

        for (const fixture of PEOPLE_FIXTURES)
        {
            const person = mock.get(fixture.handle);
            expect(person, fixture.handle).toBeDefined();
            expect(fixture.displayName).toBe(person!.name.en);
            expect(fixture.hue).toBe(person!.hue);
            expect(fixture.isMinor).toBe(person!.minor);
        }
    });

    it('keys the browser by handle, so the two halves can be joined at all', () =>
    {
        // The client's person id IS the handle since the people became the server's. A seed that
        // still used the old opaque ids would join to nothing.
        for (const person of PEOPLE)
        {
            expect(person.id).toBe(person.handle);
        }
    });

    it('has the same conversations, with the same people in them', () =>
    {
        expect(THREAD_FIXTURES.map((thread) => thread.slug).sort())
            .toEqual(THREADS.map((thread) => thread.id).sort());

        const mock = new Map(THREADS.map((thread) => [thread.id, thread]));
        for (const fixture of THREAD_FIXTURES)
        {
            const thread = mock.get(fixture.slug);
            expect(thread, fixture.slug).toBeDefined();
            expect([...fixture.members].sort()).toEqual([...thread!.participants].sort());
            expect(fixture.kind).toBe(thread!.kind);
        }
    });

    it('writes every message as words XOR a line, never both', () =>
    {
        for (const thread of THREAD_FIXTURES)
        {
            for (const message of thread.messages)
            {
                const words = message.body !== undefined;
                const line = message.payload !== undefined;
                expect(words, `${ thread.slug }/${ message.from }`).toBe(!line);
            }
        }
    });

    it('gives every server-authored line a key the browser knows how to render', () =>
    {
        // Mirrors `LINE_KEYS` in `application/src/lib/lines.ts`. A key the client cannot render
        // shows as nothing, which is a designed state for an old client meeting a new server -
        // but not one the fixtures should be exercising on purpose.
        const known = new Set(['chat.line.invite', 'chat.line.result', 'chat.line.system']);

        for (const thread of THREAD_FIXTURES)
        {
            for (const message of thread.messages)
            {
                if (message.payload !== undefined)
                {
                    expect(known.has(message.payload.key), message.payload.key).toBe(true);
                }
            }
        }
    });
});
