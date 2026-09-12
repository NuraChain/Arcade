import { describe, it, expect } from 'vitest';

import { ACHIEVEMENTS } from '../src/data/mock/achievements.ts';
import { buildDataset } from '../src/data/mock/index.ts';
import { PEOPLE } from '../src/data/mock/people.ts';

const NOW = Date.UTC(2026, 8, 10, 18, 0, 0);

describe('mock dataset', () =>
{
    const data = buildDataset(1, NOW);
    const ids = new Set(data.people.map((person) => person.id));

    it('replays identically for the same seed and differs for another', () =>
    {
        expect(buildDataset(1, NOW)).toEqual(data);
    });

    it('gives every person a unique id and handle, both scripts, and no lorem', () =>
    {
        expect(ids.size).toBe(PEOPLE.length);
        expect(new Set(data.people.map((person) => person.handle)).size).toBe(PEOPLE.length);
        for (const person of data.people)
        {
            expect(person.name.en).not.toBe(person.name.fa);
            expect(person.bio.en.toLowerCase()).not.toContain('lorem');
            expect(/^user \d+$/i.test(person.name.en)).toBe(false);
        }
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

    it('gives the default demo identity a dozen friends and open requests', () =>
    {
        expect(data.friends.alex.length).toBe(12);
        expect(data.requests.filter((request) => request.to === 'alex').length).toBe(2);
        expect(data.friends.alex).not.toContain('alex');
    });
});
