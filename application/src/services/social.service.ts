import type { Person } from '../data/mock/types.ts';
import type { Random } from '../lib/random.ts';

export interface RequestReply
{
    after: number;
    accepted: boolean;
}

export function planRequestReply(person: Person, random: Random): RequestReply
{
    const eager = person.skill === 'new' || person.skill === 'casual';
    return {
        after: random.int(eager ? 2000 : 4000, eager ? 7000 : 14000),
        accepted: random.chance(person.minor ? 0.55 : 0.82)
    };
}

export function mutualCount(friends: Record<string, string[]>, a: string, b: string): number
{
    const mine = new Set(friends[a] ?? []);
    return (friends[b] ?? []).filter((id) => mine.has(id)).length;
}

export function rankSuggestions(
    me: Person,
    people: readonly Person[],
    friends: Record<string, string[]>,
    excluded: ReadonlySet<string>,
    random: Random
): Person[]
{
    const scored = people
        .filter((person) => person.id !== me.id && !excluded.has(person.id))
        .map((person) => ({
            person,
            score: mutualCount(friends, me.id, person.id) * 10
                + (person.favourite === me.favourite ? 6 : 0)
                + (person.region === me.region ? 4 : 0)
                + random.int(0, 3)
        }));
    return scored.sort((a, b) => b.score - a.score).map((entry) => entry.person);
}

export function reasonFor(
    me: Person,
    person: Person,
    friends: Record<string, string[]>
): { kind: 'mutual'; count: number } | { kind: 'game' } | { kind: 'region' } | { kind: 'new' }
{
    const mutual = mutualCount(friends, me.id, person.id);
    if (mutual > 0)
    {
        return { kind: 'mutual', count: mutual };
    }
    if (person.favourite === me.favourite)
    {
        return { kind: 'game' };
    }
    if (person.region === me.region)
    {
        return { kind: 'region' };
    }
    return { kind: 'new' };
}
