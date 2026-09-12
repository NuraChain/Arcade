import { describe, expect, it } from 'vitest';

import { GROUP_FIXTURES, THREAD_FIXTURES } from '../src/db/seed-fixtures.ts';
import { GROUP_SLUGS } from '../../application/src/data/mock/index.ts';
import { THREADS } from '../../application/src/data/mock/threads.ts';

/**
 * The fixtures and what is left of the mock describe the same conversations, and they will drift.
 *
 * The PEOPLE half of this is gone: the browser no longer keeps a mirror of who exists, because a
 * name now comes from the server through `people.store.ts`. What remains to check is the chat
 * fixtures and the group slugs, which the mock still holds - and that goes the same way.
 */

describe('the fixtures and the mock agree about who exists', () =>
{
    it('names the same groups, so a "joined" activity points at a group that exists', () =>
    {
        expect([...GROUP_SLUGS].sort()).toEqual(GROUP_FIXTURES.map((group) => group.slug).sort());
    });

    it('seats every group owner in their own group', () =>
    {
        for (const group of GROUP_FIXTURES)
        {
            expect(group.members, group.slug).toContain(group.owner);
        }
    });

    it('gives each group thread a group to belong to', () =>
    {
        const threads = new Set(THREAD_FIXTURES.filter((thread) => thread.kind === 'group').map((thread) => thread.slug));
        const claimed = GROUP_FIXTURES.map((group) => group.thread);

        expect(new Set(claimed).size).toBe(claimed.length);
        for (const thread of claimed)
        {
            expect(threads.has(thread), thread).toBe(true);
        }
        expect(claimed.length).toBe(threads.size);
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
        const known = new Set(['chat.line.invite', 'chat.line.result']);

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
