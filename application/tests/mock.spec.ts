import { describe, it, expect } from 'vitest';

import { GAMES } from '../src/data/games.ts';
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
        expect(buildDataset(2, NOW).people[3].stats).not.toEqual(data.people[3].stats);
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
        const achievementIds = new Set(ACHIEVEMENTS.map((achievement) => achievement.id));
        for (const person of data.people)
        {
            for (const achievement of person.achievements)
            {
                expect(achievementIds.has(achievement), `${ person.id } → ${ achievement }`).toBe(true);
            }
        }
        for (const group of data.groups)
        {
            expect(ids.has(group.owner)).toBe(true);
            expect(group.members.every((member) => ids.has(member))).toBe(true);
            expect(group.members).toContain(group.owner);
        }
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

    it('never wins more than it plays and keeps the favourite game the most played', () =>
    {
        for (const person of data.people)
        {
            for (const game of GAMES)
            {
                const record = person.stats[game.id];
                expect(record.won).toBeLessThanOrEqual(record.played);
            }
            const most = Math.max(...GAMES.map((game) => person.stats[game.id].played));
            expect(person.stats[person.favourite].played, person.id).toBe(most);
        }
    });

    it('dates everything relative to the clock it was built with', () =>
    {
        for (const message of data.messages)
        {
            expect(message.at).toBeLessThan(NOW);
            expect(message.at).toBeGreaterThan(NOW - 30 * 24 * 3600000);
        }
        for (const notification of data.notifications)
        {
            expect(notification.at).toBeLessThanOrEqual(NOW);
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
