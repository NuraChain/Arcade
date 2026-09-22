import { createStore } from 'azerothjs';

import type { PresenceEntry } from '../api.ts';
import { useRealtime } from './realtime.store.ts';

export type PresenceState = 'online' | 'away' | 'offline';

export interface Presence
{
    state: PresenceState;
    since: number;
    known: boolean;
}

const UNKNOWN: Presence = { state: 'offline', since: 0, known: false };

export interface PresenceApi
{
    of(id: string): Presence;

    dot(id: string): PresenceState | null;

    isOnline(id: string): boolean;
    online(ids: readonly string[]): string[];
    refresh(): void;
    reset(): void;
}

export const usePresence = createStore((): PresenceApi =>
{
    const live = useRealtime();

    let from: PresenceEntry[] | null = null;
    let index: Map<string, Presence> | null = null;

    const current = (): Map<string, Presence> | null =>
    {
        const people = live.presence();
        if (people === null)
        {
            from = null;
            index = null;
            return null;
        }
        if (people !== from)
        {
            from = people;
            index = new Map(people.map((entry) =>
                [entry.who, { state: entry.state, since: entry.since, known: true }]));
        }
        return index;
    };

    const of = (id: string): Presence => current()?.get(id) ?? UNKNOWN;

    const up = (id: string): boolean => of(id).state === 'online';

    return {
        of,
        dot: (id) => (of(id).known ? of(id).state : null),
        isOnline: up,
        online: (ids) => ids.filter(up),
        refresh: () => live.sync(),

        reset()
        {
            from = null;
            index = null;
        }
    };
});
