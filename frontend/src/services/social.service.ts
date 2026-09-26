import type { Person } from '../data/person.ts';

export function mutualCount(friends: Record<string, string[]>, a: string, b: string): number
{
    const mine = new Set(friends[a] ?? []);
    return (friends[b] ?? []).filter((id) => mine.has(id)).length;
}

export function reasonFor(
    me: Person,
    person: Person,
    friends: Record<string, string[]>
): { kind: 'mutual'; count: number } | { kind: 'new' }
{
    const mutual = mutualCount(friends, me.id, person.id);
    return mutual > 0 ? { kind: 'mutual', count: mutual } : { kind: 'new' };
}
