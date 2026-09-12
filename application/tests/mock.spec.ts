import { describe, it, expect } from 'vitest';
import { PEOPLE_FIXTURES } from '../../server/src/db/seed-fixtures.ts';

import { ACHIEVEMENTS } from '../src/data/mock/achievements.ts';
import { buildDataset } from '../src/data/mock/index.ts';

const NOW = Date.UTC(2026, 8, 10, 18, 0, 0);

describe('mock dataset', () =>
{
    const data = buildDataset(1, NOW);

    /** Who exists, according to the only list of them that is left. */
    const ids = new Set(PEOPLE_FIXTURES.map((person) => person.handle));

    it('replays identically for the same seed and differs for another', () =>
    {
        expect(buildDataset(1, NOW)).toEqual(data);
    });

    it('keeps every reference pointing at something that exists', () =>
    {
        expect(new Set(ACHIEVEMENTS.map((achievement) => achievement.id)).size).toBe(ACHIEVEMENTS.length);
        for (const conversation of data.conversations)
        {
            expect(conversation.participants.every((member) => ids.has(member)), conversation.id).toBe(true);
        }
        for (const message of data.messages)
        {
            expect(ids.has(message.from), message.id).toBe(true);
            expect(data.conversations.some((conversation) => conversation.id === message.conversationId)).toBe(true);
        }
        for (const request of data.requests)
        {
            expect(ids.has(request.from) && ids.has(request.to)).toBe(true);
        }
    });

    it('dates everything relative to the clock it was built with', () =>
    {
        for (const message of data.messages)
        {
            expect(message.at).toBeLessThan(NOW);
            expect(message.at).toBeGreaterThan(NOW - 30 * 24 * 3600000);
        }
    });

    it('counts unread messages from the thread seed', () =>
    {
        const sara = data.conversations.find((conversation) => conversation.id === 'c-sara')!;
        const unread = data.messages.filter((message) => message.conversationId === 'c-sara' && message.at > sara.lastReadAt);
        expect(unread.length).toBe(2);
    });

    it('leaves two requests waiting for an answer', () =>
    {
        expect(data.requests.filter((request) => request.to === 'alex').length).toBe(2);
    });
});
